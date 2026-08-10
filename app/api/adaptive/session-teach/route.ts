import { NextRequest, NextResponse } from 'next/server';
import { sanitizeClassContent } from '../../../../lib/adaptive/sanitizeLatex';
import { recoverAcademicFragment } from '../../../../lib/academic-content/recovery';
import { alai, alaiJson } from '../../../../lib/alai';
import {
  buildDeterministicEvaluationPlan,
  compactTeachingForEvaluation,
  mergeEvaluationPlanEnrichment,
  runSessionPreparationFactory,
  type EvaluationCoverageDiagnosis,
  type EvaluationPlan,
  type EvaluationPlanBlock,
  type PreparedEvaluationBlock,
  type PreparedEvaluationQuestion,
  type PreparedTeachingContent,
  type SessionPreparationState,
} from '../../../../lib/ai/sessionPreparationFactory';
import { runSessionContentGenerationPipeline, repairJsonLocally, withTechnicalJsonRetry } from '../../../../lib/ai/sessionContentGenerationPipeline';
import { parseTeachingContent, teachingResponseDiagnostics, type TeachingContent } from '../../../../lib/ai/teachingContentContract';
import {
  canonicalizeGeneratedSession,
} from '../../../../lib/adaptive/evaluation/sessionEvaluation';
import {
  shouldEvaluateSession,
  validateSessionEvaluationForKind,
  type SessionKind,
} from '../../../../lib/adaptive/sessionKind';
import { legacyMaterialType, resolveAcademicDomain, type AcademicDomain } from '../../../../lib/adaptive/academicDomain';
import { signQuestionsInPlace } from '../../../../lib/adaptive/evaluation/questionIntegrity';

export const maxDuration = 120;
export const dynamic = 'force-dynamic';

// Cache breve en memoria para no re-generar la misma clase varias veces seguidas
const teachCache = new Map<string, { result: any; timestamp: number }>();
const preparationStore = new Map<string, SessionPreparationState>();
const CACHE_TTL = 5 * 60 * 1000; // 5 minutos

function hashKey(
  sessionId: string,
  sessionKind: SessionKind,
  blueprintVersion: number,
  userId: string,
  materialHash: string,
  planVersion: string,
): string {
  return `${userId}::${sessionId}::${sessionKind}::v${blueprintVersion}::${materialHash}::${planVersion}`;
}

interface TeachRequest {
  preparationState?: SessionPreparationState;
  materialHash?: string;
  planVersion?: string | number;
  session: {
    id: string;
    chapterNumber: number;
    title: string;
    objective: string;
    topicIds: string[];
    blockIds: string[];
    concepts: string[];
    pages: number[];
    kind: SessionKind;
  };
  blueprint: {
    version?: number;
    topics: any[];
    blocks: any[];
  };
  userProfile?: {
    name?: string;
    career?: string;
    university?: string;
    goal?: string;
    type?: string;
  };
  setup: {
    knowledgeLevel: string;
    examDateType: string;
    mainConcern?: string;
    evalPreference?: string;
  };
  materialTitle: string;
  totalSessions: number;
  previousSessionTitle?: string;
  nextSessionTitle?: string;
  allBlocks?: any[]; // Para intro y final_review: todo el material
  allTopics?: any[]; // Para intro y final_review: mapa completo
  // Scope de bloques para evitar redundancia
  previouslyTaughtBlocks?: Array<{ id: string; label: string; summary: string; kind: string }>;
  upcomingBlocks?: Array<{ id: string; label: string; kind: string }>;
  primaryBlockIds?: string[];
  // Contenido ya enseñado en sesiones previas (para NO repetir)
  previouslyTaught?: Array<{
    sessionTitle: string;
    conceptsCovered: string[];
  }>;
  // Contenido de sesiones futuras (para NO adelantar)
  upcomingConcepts?: string[];
  academicDomain?: AcademicDomain;
  academicDomainSource?: string;
  academicDomainConfidence?: number;
  academicDomainVersion?: string;
  // Auditoría adversarial (Codex, Intro/Review #2): contenido REAL ya
  // presentado en sesiones previas (no labels de blueprint), factKeys
  // efectivamente demostrados y recuperaciones — única fuente que permite a
  // final_review sintetizar el recorrido real en vez de regenerar linealmente
  // los bloques del blueprint como si fuera una sesión normal.
  finalReviewContext?: {
    sessions: Array<{
      sessionNumber: number;
      sessionTitle: string;
      steps: Array<{ title: string; content: string; keyPoints: any[] }>;
      demonstratedFactKeys: string[];
      recoverySummary: Array<{ factKeys: string[]; resolved: boolean }>;
    }>;
  };
}

function buildTeachingPrompt(req: TeachRequest, materialType: string, langHint: 'es' | 'en'): string {
  const { session, blueprint, userProfile, setup, materialTitle, totalSessions, previousSessionTitle, nextSessionTitle, previouslyTaught, upcomingConcepts, allBlocks, allTopics, previouslyTaughtBlocks, upcomingBlocks } = req;

  const isIntro = session.kind === 'introduction';
  const isFinalReview = session.kind === 'final_review';

  // ═══════════════════════════════════════════════════════════════
  // CONTEXTO DEL USUARIO
  // ═══════════════════════════════════════════════════════════════
  const userLines: string[] = [];
  if (userProfile?.name) userLines.push(`Nombre: ${userProfile.name.split(' ')[0]}`);
  if (userProfile?.type) userLines.push(`Tipo de estudiante: ${userProfile.type}`);
  if (userProfile?.career) userLines.push(`Carrera: ${userProfile.career}`);
  if (userProfile?.university) userLines.push(`Institución: ${userProfile.university}`);
  if (userProfile?.goal) userLines.push(`Objetivo: ${userProfile.goal}`);
  const userContext = userLines.length > 0
    ? `\nESTUDIANTE:\n${userLines.join('\n')}\n`
    : '';

  const knowledgeMap: Record<string, string> = {
    never_seen: 'NUNCA ha visto el material. Explica cada término desde cero. No asumas conocimiento previo. Define lo básico antes de avanzar.',
    know_little: 'Tiene conocimientos básicos. Puedes ir más rápido en lo elemental. Enfócate en profundizar lo importante.',
    want_review: 'Ya conoce el tema. Consolida y aclara relaciones. Evita repetir lo obvio. Enfócate en matices.',
    already_know: 'Domina el tema. Profundiza en matices avanzados, excepciones, conexiones sutiles.',
  };
  const levelContext = knowledgeMap[setup.knowledgeLevel] || 'Adapta la profundidad al nivel del estudiante.';

  const examMap: Record<string, string> = {
    today: 'EXAMEN HOY — máxima urgencia. Sé directo, prioriza lo esencial, sin adornos.',
    tomorrow: 'Examen mañana — urgencia alta. Explicaciones claras y directas.',
    this_week: 'Examen esta semana — puedes ir con calma pero enfocado.',
    custom: 'Examen próximo — balance entre profundidad y ritmo.',
    just_studying: 'Sin urgencia de examen — puedes tomar el tiempo para profundizar bien.',
  };
  const urgencyContext = examMap[setup.examDateType] || 'Ajusta el ritmo a la urgencia del estudiante.';

  const concernContext = setup.mainConcern && !['no especificado', 'ninguna', 'ninguno', '(omitido)', 'omitido', 'n/a', '-', ''].includes(setup.mainConcern.toLowerCase().trim())
    ? `\nPREOCUPACIÓN DEL ESTUDIANTE: "${setup.mainConcern}"\nAtiéndela si aparece en la sesión.`
    : '';

  const languageInstruction = langHint === 'es'
    ? 'IDIOMA: escribe TODO en español.'
    : 'LANGUAGE: write EVERYTHING in English.';

  const formattingInstruction = `
═══════════════════════════════════════════════════════════════
FORMATO DEL CONTENIDO — REGLAS ESTRICTAS DE LATEX
═══════════════════════════════════════════════════════════════

El campo "content" se renderiza con Markdown + KaTeX.

REGLAS ABSOLUTAS PARA MATEMÁTICAS:

1. TODA fórmula o expresión matemática DEBE ir DENTRO de delimitadores LaTeX:
   - Inline: $...$ (por ejemplo: $E = mc^2$, $x^2$, $H_2O$)
   - Bloque: $$...$$ (línea propia, para fórmulas grandes)

2. NUNCA dejes símbolos matemáticos sueltos sin delimitadores:
   - MAL: "La energía es E_n = -13.6 eV/n^2"
   - BIEN: "La energía es $E_n = -\\frac{-13.6 \\text{ eV}}{n^2}$"
   - MAL: "concentración [H2]"
   - BIEN: "concentración $[H_2]$"

3. NUNCA mezcles LaTeX plano con texto sin delimitadores:
   - MAL: "K_c = [C]^c[D]^d / [A]^a[B]^b"
   - BIEN: "$K_c = \\frac{[C]^c[D]^d}{[A]^a[B]^b}$"

4. Para fórmulas complejas, USA SIEMPRE bloque $$...$$:
   - "La expresión es: $$K_c = \\frac{[C]^c[D]^d}{[A]^a[B]^b}$$"

5. SUBÍNDICES: usa _ dentro de LaTeX
   - MAL: "H2O"  →  BIEN: "$H_2O$"
   - MAL: "N2O4"  →  BIEN: "$N_2O_4$"
   - MAL: "Kc"  →  BIEN: "$K_c$"

6. EXPONENTES: usa ^ dentro de LaTeX
   - MAL: "x2"  →  BIEN: "$x^2$"
   - MAL: "10^-3"  →  BIEN: "$10^{-3}$"

7. FRACCIONES: usa \\frac{}{}
   - MAL: "a/b"  →  BIEN: "$\\frac{a}{b}$"

8. RAÍCES: usa \\sqrt{}
   - MAL: "sqrt(x)"  →  BIEN: "$\\sqrt{x}$"

9. GRIEGOS: usa \\alpha, \\beta, \\pi, \\theta, \\Delta, etc.
   - MAL: "Δn"  →  BIEN: "$\\Delta n$"

10. FLECHAS QUÍMICAS: usa \\rightleftharpoons para equilibrio
    - MAL: "H2 + I2 ⇌ 2HI"  →  BIEN: "$H_2 + I_2 \\rightleftharpoons 2HI$"

11. UNIDADES dentro de fórmulas: usa \\text{}
    - MAL: "13.6 eV"  →  BIEN: "$13.6 \\text{ eV}$"

12. CONCENTRACIONES: los corchetes van DENTRO del LaTeX
    - MAL: "[HI]^2"  →  BIEN: "$[HI]^2$"

VERIFICACIÓN OBLIGATORIA:
Antes de devolver la respuesta, revisa cada campo "content":
- ¿Todo símbolo matemático está dentro de $ o $$?
- ¿Todos los subíndices y exponentes usan _ y ^?
- ¿No hay caracteres Unicode raros (Δ, ⇌, ²) fuera de LaTeX?
- ¿Los delimitadores $ están balanceados (par de apertura y cierre)?

TEXTO NORMAL SIN MATEMÁTICAS:
Para materiales sin fórmulas (historia, biografía, argumentativo, narrativo), escribe texto plano normal.
NO fuerces LaTeX si el contenido no lo necesita.

EJEMPLO CORRECTO — reacción química:
"En la reacción $N_2O_4(g) \\rightleftharpoons 2NO_2(g)$, la constante de equilibrio se expresa como $$K_c = \\frac{[NO_2]^2}{[N_2O_4]}$$"

EJEMPLO INCORRECTO — NUNCA hagas esto:
"En la reacción N2O4(g) ⇌ 2NO2(g), la constante de equilibrio se expresa como Kc = [NO2]^2 / [N2O4]"
`;


  // ═══════════════════════════════════════════════════════════════
  // PRINCIPIOS PEDAGÓGICOS UNIVERSALES
  // Aplican a CUALQUIER material — la IA decide cómo aplicarlos
  // ═══════════════════════════════════════════════════════════════
  const pedagogyCore = `
═══════════════════════════════════════════════════════════════
CÓMO ENSEÑAR — PRINCIPIOS UNIVERSALES
═══════════════════════════════════════════════════════════════

REGLA 0: TÚ DECIDES TODO
- Cuántos pasos genera esta clase (podrían ser 3, 5, 8 o 12 — depende del material)
- Qué tipo de paso usar en cada momento
- Cuánto profundizar en cada idea
- Cómo agrupar los conceptos
- El orden pedagógico correcto
- Cuándo dar un ejemplo, cuándo hacer una conexión, cuándo advertir un matiz

No hay plantilla. Cada material es único. Léelo y decide qué necesita el estudiante para entenderlo al 100%.

REGLA 1: LEE EL MATERIAL PRIMERO
Antes de escribir cualquier paso, entiende:
- ¿Qué tipo de contenido es? (argumento, fenómeno, procedimiento, narrativa, análisis, mezcla)
- ¿Cuál es la tesis, el punto central, o lo que el material intenta transmitir?
- ¿Qué conceptos son fundamentos y cuáles son consecuencia?
- ¿Qué relaciones existen entre las ideas?
- ¿Qué haría que un estudiante que NUNCA vio esto lo entienda?

REGLA 2: EL MATERIAL DICTA EL ENFOQUE
- No apliques categorías rígidas
- Un texto sobre "historia del cálculo" se enseña como historia con vocabulario técnico
- Un texto sobre "cómo derivar" se enseña como procedimiento
- Un texto que ARGUMENTA algo se enseña presentando el argumento con evidencia
- Un texto que DESCRIBE un fenómeno se enseña explicando el fenómeno
- Deja que el contenido específico decida el enfoque

REGLA 3: LOS BLOQUES SON MATERIA PRIMA, NO PANTALLAS
- NUNCA hagas "1 bloque = 1 paso"
- Agrupa bloques relacionados en explicaciones coherentes
- Un paso puede cubrir varios bloques que forman una misma idea
- Un bloque muy denso puede necesitar 2 pasos para explicarse bien
- TÚ decides el agrupamiento óptimo

REGLA 4: CADA PASO ES ESPECÍFICO DEL MATERIAL
Prueba: si puedes cambiar el nombre del material y el texto sigue funcionando, está mal.
Cada paso debe mencionar:
- Nombres específicos del material
- Datos, fechas, cifras concretas
- Términos técnicos exactos
- Ejemplos que el material realmente da

REGLA 5: HABLA COMO TUTOR PERSONAL (SEGUNDA PERSONA SINGULAR)
- Habla al estudiante en SINGULAR ("tú"), NUNCA en plural
- Usa frases naturales: "fíjate cómo", "esto es importante porque", "ahora que entiendes X, veamos Y"
- Aclara solo confusiones que el propio material permita resolver explícitamente; no inventes contrastes, causas o matices que el texto no enseñe.
- Conecta explícitamente cada paso con el anterior
- NO uses lenguaje de resumen ejecutivo ni de wiki
- ENSEÑA — no listes ni resumas

REGLA 5B: VARIEDAD PEDAGÓGICA — ESTRATEGIAS DE ENSEÑANZA
Cada paso debe usar UNA estrategia pedagógica principal. No uses la misma en todos los pasos.

Estrategias disponibles (decide cuál aplica mejor a cada idea):

ANALOGÍA: Conecta el concepto con algo que el estudiante ya conoce del mundo cotidiano.
Úsala cuando: el concepto es abstracto o difícil de visualizar.
Ejemplo: "Piensa en la membrana celular como el portero de una discoteca..."

CONTRASTE: Explica qué ES mostrando qué NO ES o comparando con algo similar pero diferente.
Úsala cuando: hay conceptos similares que se confunden fácilmente.
Ejemplo: "A diferencia de X, Y no... La diferencia clave es..."

EJEMPLO RESUELTO: Muestra el concepto en acción con un caso concreto específico del material.
Úsala cuando: el concepto es procedimental o tiene aplicaciones concretas.
Ejemplo: "Veamos cómo funciona esto: si tomamos el caso de... entonces..."

CAUSALIDAD: Explica el mecanismo de por qué ocurre algo, no solo qué ocurre.
Úsala cuando: hay una cadena causa-efecto que el estudiante necesita entender.
Ejemplo: "Cuando X sucede, esto activa Y porque... lo que finalmente produce Z."

PERSPECTIVA: Presenta el concepto desde un ángulo no obvio o contra-intuitivo.
Úsala cuando: el concepto tiene matices o excepciones importantes.
Ejemplo: "Lo que parece ser X en realidad es Y cuando consideras que..."

PREGUNTA GUÍA: Plantea una pregunta que el estudiante debería poder responder y luego la respondes.
Úsala cuando: quieres que el estudiante active conocimiento previo.
Ejemplo: "¿Por qué crees que X ocurre antes que Y? La razón es..."

REGLA: Varía las estrategias a lo largo de los pasos. No uses la misma dos veces seguidas.
Si un paso es de tipo 'formula', prioriza EJEMPLO RESUELTO.
Si un paso es de tipo 'concept', prioriza ANALOGÍA o CONTRASTE.
Si un paso es de tipo 'causal', prioriza CAUSALIDAD.
Si un paso es de tipo 'connection', prioriza PERSPECTIVA.

TONO ADAPTATIVO AL NIVEL DEL ESTUDIANTE:
- Si el estudiante nunca ha visto el material: "como vienes empezando desde cero, primero vamos a construir la intuición..."
- Si tiene el examen mañana: "vamos directo a lo esencial..."
- Si domina el tema: "ya conoces X, así que vamos directo a Y..."
Adapta el enfoque según el setup, no solo el contenido.

ANTI-REPETICIÓN — MUY IMPORTANTE:
- Cada frase icónica o descripción del material se usa UNA sola vez en todo el recorrido
- Si el material describe a X como "arquitecto de la ciencia moderna", usa esa frase máximo 1 vez, no en cada sesión
- Si una analogía o metáfora ya se usó, no la repitas
- Varía el vocabulario en referencias a los mismos conceptos
- Cada sesión debe sentir que agrega algo, no que recicla

PROHIBIDO ABSOLUTAMENTE (frases de aula grupal):
- "Hola a todos"
- "Bienvenidos"
- "Ustedes"
- "Piensen"
- "Prepárense"
- "Recuerden"
- "Vamos a ver"
- "Estamos aquí para..."
- "En esta sesión veremos" (usar "verás" en su lugar)
- "¡Excelente trabajo!" (dirigido al grupo)

USAR EN SU LUGAR:
- "Hoy vas a entender..."
- "Observa cómo..."
- "Fíjate en..."
- "Recuerda que..."
- "Verás que..."
- "Piensa en..."

Esto es un tutor personal 1-a-1, no una clase presencial.

REGLA 6: FIDELIDAD ABSOLUTA AL MATERIAL — CERO INVENCIONES
- Si el material AFIRMA algo, preséntalo como afirmación
- Si el material OPINA o valora, preserva la modalidad: "el autor sostiene que...", "según el texto..."
- NUNCA inventes datos, ejemplos, contexto, características o conclusiones que no estén en el material
- Usa términos EXACTOS del material cuando sean técnicos

EJEMPLOS DE INVENCIONES PROHIBIDAS:
- Añadir detalles descriptivos que suenan bien pero no están en el material
- Intensificar afirmaciones del material
- Añadir ejemplos ilustrativos externos que no aparecen en el material
- Especular sobre causas o consecuencias no mencionadas
- Añadir contexto histórico, geográfico, biográfico no presente

PROHIBIDO PROMETER PROBLEMAS O CONTENIDO NO EXISTENTE:
- NO digas "resolveremos las limitaciones del modelo anterior" si nunca se planteó ese modelo
- NO digas "recuerda el problema que vimos" si no se enseñó explícitamente
- NO inventes narrativas de "problema → solución" que el material no plantea
- Solo puedes conectar con algo que YA se enseñó explícitamente en una sesión anterior

REGLA DE ORO: Si no puedes señalar la frase exacta del material donde está ese detalle, NO lo digas.

REGLA 7: PASOS LIGEROS Y LEGIBLES
- Cada paso debe leerse en 30-45 segundos aproximadamente
- Contenido: 3-5 oraciones normalmente, no párrafos de 200+ palabras
- Si una idea necesita más contenido, divídela en 2 pasos:
  * Un paso para "qué es"
  * Otro paso para "por qué importa" o "cómo se aplica"
- Es mejor 6 pasos ligeros que 3 pasos pesados
- El cerebro procesa mejor información en bloques pequeños

REGLA 8: NO DECLARAR PREPARACIÓN SIN EVIDENCIA
- PROHIBIDO decir "estás listo para el examen" (no hay evaluación aún)
- PROHIBIDO decir "ahora dominas el tema"
- PROHIBIDO decir "tienes todo lo necesario para aprobar"
- USA en su lugar:
  * "ya recorriste todo el contenido del material"
  * "ahora tienes una visión completa del argumento"
  * "el siguiente paso sería practicar para verificar qué recuerdas"

REGLA 7: PROGRESIÓN Y CONEXIÓN
- El paso 2 requiere entender el paso 1
- El paso 3 requiere entender el paso 2
- Cada paso construye sobre lo anterior
- No hagas pasos aislados

REGLA 8: COBERTURA COMPLETA
- Al final de esta sesión, TODOS los bloques asignados deben quedar enseñados
- Al final del recorrido completo (todas las sesiones), el material debe estar 100% enseñado
- Un bloque está enseñado cuando fue explicado con contexto, no solo mencionado
`;

  // ═══════════════════════════════════════════════════════════════
  // INTRO — Clase introductoria específica del material
  // ═══════════════════════════════════════════════════════════════
  if (isIntro) {
    const allBlocksForContext = allBlocks || blueprint.blocks || [];
    const allTopicsForContext = allTopics || blueprint.topics || [];

    const topicsOverview = allTopicsForContext.map((tp: any, i: number) =>
      `${i + 1}. ${tp.title}${tp.description ? ' — ' + tp.description : ''}`
    ).join('\n');

    const topBlocks = [...allBlocksForContext]
      .sort((a: any, b: any) => (b.importance || 0) - (a.importance || 0))
      .slice(0, 15)
      .map((b: any, i: number) => `${i + 1}. [${b.kind}] ${b.label}: ${b.summary}`)
      .join('\n');

    return `Eres un profesor experto dando la CLASE INTRODUCTORIA del material "${materialTitle}".

REGLAS UNIVERSALES DE FORMATO:
- Si aparece cualquier fórmula, variable, reacción, constante, subíndice, superíndice o símbolo matemático/científico, escríbelo en LaTeX correcto.
- Usa $...$ para inline.
- Usa $$...$$ para bloque.
- Usa SIEMPRE \\frac{a}{b}, NUNCA \\rac.
- Usa SIEMPRE \\rightleftharpoons para equilibrio químico.
- Usa SIEMPRE \\rightarrow para flechas simples.
- Usa subíndices correctos: $K_c$, $K_p$, $N_2$, $H_2$, $NH_3$.
- Usa superíndices correctos: $x^2$, $(RT)^{\\Delta n}$.
- NO inventes símbolos raros como i˚ghtleftharpoons.
- NO escribas fórmulas partidas carácter por carácter.
- Si el contenido no tiene matemáticas o ciencia, ignora estas reglas.


Esta es la sesión 1 de ${totalSessions}. Es una CLASE INTRODUCTORIA — su rol pedagógico es que el estudiante SEPA de qué se trata el material y qué va a aprender en las próximas sesiones.\n\nIMPORTANTE — LO QUE NO DEBES HACER EN ESTA SESIÓN:\n- NO enseñes en profundidad los conceptos individuales (esos se enseñarán en las sesiones de learning)\n- NO desarrolles cada bloque como si fuera una clase completa\n- NO expliques detalles como si fueras a evaluar\n\nLO QUE SÍ DEBES HACER:\n- Presentar la tesis o idea central del material (qué argumenta o explica en su conjunto)\n- Dar un mapa de lo que se aprenderá (mencionar los temas por venir sin desarrollarlos)\n- Contextualizar el material (de qué trata, por qué existe, qué problema aborda)\n- Familiarizar al estudiante con el vocabulario clave (sin definir cada término técnico en detalle)\n- Terminar con expectativa clara de lo que viene\n\nAl final de esta sesión el estudiante debe poder responder:\n- "¿De qué trata este material?"\n- "¿Cuál es su idea central?"\n- "¿Qué voy a aprender en el recorrido?"\n\nPero NO debe haber aprendido todavía los detalles — eso viene después.

${userContext}
NIVEL: ${levelContext}
URGENCIA: ${urgencyContext}${concernContext}
${languageInstruction}
${formattingInstruction}

═══════════════════════════════════════════════════════════════
MATERIAL COMPLETO A INTRODUCIR
═══════════════════════════════════════════════════════════════

TOPICS DETECTADOS:
${topicsOverview}

CONCEPTOS E IDEAS PRINCIPALES:
${topBlocks}

${pedagogyCore}

═══════════════════════════════════════════════════════════════
TU TAREA — FAMILIARIZACIÓN, NO ENSEÑANZA
═══════════════════════════════════════════════════════════════

Esta sesión es una FAMILIARIZACIÓN. El estudiante necesita saber a QUÉ se está enfrentando, no aprenderlo todavía.

PROCESO:
1. LEE el análisis completo (topics + bloques importantes)
2. IDENTIFICA:
   - Qué TIPO de material es (argumentativo, expositivo, narrativo, procedimental, biográfico, técnico, mixto)
   - La TESIS o idea central (si el material argumenta algo)
   - El TEMA principal (si el material describe/explica algo)
   - El VOCABULARIO técnico básico que aparecerá (términos que un estudiante debe reconocer)
3. ADAPTA la profundidad al nivel del estudiante:
   - "Nunca lo he visto" → intro más completa: contexto + vocabulario + mapa del recorrido
   - "Lo conozco un poco" → intro media: tesis + mapa + puntos clave
   - "Quiero repasarlo" → intro breve: mapa del recorrido
   - "Ya lo domino" → intro muy breve: solo mapa y estructura
4. DECIDE cuántos pasos necesita (3-6 pasos según el nivel)
5. GENERA la intro

CONTENIDO OBLIGATORIO EN LA INTRO:

A. QUÉ ES EL MATERIAL — de qué trata, cuál es el tema/tesis principal
B. MAPA DEL RECORRIDO — qué se aprenderá en las próximas sesiones (nombrar temas sin desarrollarlos)
C. VOCABULARIO CLAVE — términos técnicos básicos necesarios (solo si el nivel del estudiante lo requiere)

REGLAS ESTRICTAS DE ESTA SESIÓN:

PROHIBIDO:
- Explicar en detalle a personas, eventos, conceptos individuales
- Dedicar un paso completo a un solo bloque del análisis
- Desarrollar la evidencia o los argumentos con profundidad
- Definir términos con explicaciones extensas (solo definición mínima si es necesario)
- Cualquier explicación que parezca una "clase" sobre el contenido
- ADELANTAR DETALLES ESPECÍFICOS que se enseñarán después. Ejemplos de spoilers PROHIBIDOS:
  * Explicar cómo funciona un modelo central (solo mencionar que existe)
  * Explicar los niveles de energía específicos (solo decir que se estudiarán)
  * Explicar por qué la unión clásica-cuántica es importante (solo nombrar el tema)
  * Explicar la ecuación matemática (solo mencionar que hay una)
  * Explicar la interpretación de Copenhague (solo nombrar que existe)
  * En general: si vas a decir CÓMO funciona algo o POR QUÉ es importante, es spoiler

REGLA DE ORO PARA INTRO:
Un paso de intro está BIEN si menciona QUÉ se estudiará (nombre del tema, personas involucradas, área del material).
Un paso de intro está MAL si explica CÓMO funciona algo, POR QUÉ importa en detalle, o desarrolla la idea.

PERMITIDO:
- Mencionar la tesis general del material
- Nombrar los temas y personas que se cubrirán (sin explicar por qué son importantes)
- Dar el contexto general del material
- Definir términos técnicos básicos en 1 frase corta (ej: "quarterback: jugador que dirige la ofensiva")
- Explicar la estructura del recorrido de sesiones

EJEMPLO DE LO QUE DEBE PARECER UN PASO:

MAL (esto es enseñar, no familiarizar):
"El concepto central transformó el campo mediante propiedades específicas, cambiando la interpretación anterior..."

BIEN (esto es familiarizar):
"En las próximas sesiones conocerás los conceptos clave del material. Se presentan como piezas fundamentales del argumento — verás por qué en detalle más adelante."

Piensa: si tu paso EXPLICA algo, es enseñanza — no va aquí. Si tu paso NOMBRA algo que se explicará después, es familiarización — sí va aquí.

Cada paso puede ser del tipo que tenga más sentido pedagógicamente:
- "intro": apertura o contextualización general
- "concept": presentación GENERAL de la tesis/tema (sin desarrollar)
- "connection": cómo se conectan las partes
- "example": mención de casos concretos
- "recap": mapa de lo que viene
- "closing": preparación para la primera sesión

Al final de esta clase el estudiante debe poder responder:
- ¿De qué trata este material?
- ¿Cuál es su idea central o argumento?
- ¿Qué voy a aprender en el recorrido?
- ¿Por qué importa?

Responde SOLO con JSON válido:
{
  "sessionIntro": "Frase específica que introduce el material real (1-2 oraciones)",
  "steps": [
    {
      "id": "step_1",
      "type": "intro",
      "title": "Título específico del paso",
      "content": "Contenido específico del material. Nombra conceptos, tesis, elementos concretos. Habla como profesor.",
      "keyPoints": ["Idea clave concreta"],
      "importance": "supporting",
      "relatedBlockIds": []
    }
  ],
  "evaluationBlocks": [],
  "sessionClosing": "Cierre específico que conecta con la primera sesión de contenido (mencionando qué viene concretamente)"
}`;
  }

  // ═══════════════════════════════════════════════════════════════
  // FINAL REVIEW — Síntesis real del material completo
  // ═══════════════════════════════════════════════════════════════
  if (isFinalReview) {
    const allBlocksForReview = [...(allBlocks || blueprint.blocks || [])]
      .sort((a: any, b: any) => (b.importance || 0) - (a.importance || 0));

    const allBlocksSummary = allBlocksForReview
      .map((b: any) => `- [${b.kind}, imp:${b.importance}] ${b.label}: ${b.summary}`)
      .join('\n');

    const taughtInPreviousSessions = (previouslyTaught || [])
      .map((s: any) => `- "${s.sessionTitle}": ${s.conceptsCovered.join(', ')}`)
      .join('\n');

    return `Eres un profesor experto dando la CLASE DE REPASO FINAL del material "${materialTitle}".

REGLAS UNIVERSALES DE FORMATO:
- Si aparece cualquier fórmula, variable, reacción, constante, subíndice, superíndice o símbolo matemático/científico, escríbelo en LaTeX correcto.
- Usa $...$ para inline.
- Usa $$...$$ para bloque.
- Usa SIEMPRE \\frac{a}{b}, NUNCA \\rac.
- Usa SIEMPRE \\rightleftharpoons para equilibrio químico.
- Usa SIEMPRE \\rightarrow para flechas simples.
- Usa subíndices correctos: $K_c$, $K_p$, $N_2$, $H_2$, $NH_3$.
- Usa superíndices correctos: $x^2$, $(RT)^{\\Delta n}$.
- NO inventes símbolos raros como i˚ghtleftharpoons.
- NO escribas fórmulas partidas carácter por carácter.
- Si el contenido no tiene matemáticas o ciencia, ignora estas reglas.


Esta es la última sesión (${session.chapterNumber} de ${totalSessions}). El estudiante YA ESTUDIÓ TODO EL MATERIAL en las sesiones anteriores.\n\nIMPORTANTE — LO QUE NO DEBES HACER EN ESTA SESIÓN:\n- NO vuelvas a enseñar los conceptos como si fuera la primera vez\n- NO repitas explicaciones completas de definiciones\n- NO desarrolles cada bloque como si el estudiante no supiera nada\n- NO uses el mismo nivel de detalle que en las sesiones de learning\n\nLO QUE SÍ DEBES HACER:\n- SINTETIZAR: comprimir varios conceptos en visiones integradas\n- CONECTAR: mostrar cómo las ideas de las diferentes sesiones se relacionan\n- MAPEAR: dar una vista aérea del argumento completo del material\n- CONSOLIDAR: destacar las 3-5 ideas esenciales que el estudiante debe llevarse\n- CERRAR: dar sentido al recorrido completo\n\nUsa referencias explícitas como "recuerda que en la sesión 2 estudiaste X" — no re-expliques X.\nEl tono es de repaso comprimido, no de enseñanza nueva.\nDeben ser MENOS pasos que las sesiones de learning (típicamente 3-5 pasos), cada uno más denso pero más corto en explicación individual.

${userContext}
NIVEL: ${levelContext}
URGENCIA: ${urgencyContext}${concernContext}
${languageInstruction}
${formattingInstruction}

═══════════════════════════════════════════════════════════════
TODO EL CONTENIDO DEL MATERIAL
═══════════════════════════════════════════════════════════════

${allBlocksSummary}

SESIONES YA ENSEÑADAS:
${taughtInPreviousSessions || '(el estudiante ya vio todo el contenido)'}

${pedagogyCore}

═══════════════════════════════════════════════════════════════
TU TAREA
═══════════════════════════════════════════════════════════════

1. USA EL ANÁLISIS COMPLETO como referencia — todos los bloques ya fueron enseñados en sesiones anteriores
2. IDENTIFICA la tesis, el fenómeno o el argumento central del material
3. AGRUPA los conceptos por función argumentativa (evidencia, mecanismo, ejemplo, conclusión)
4. INTEGRA todo en una síntesis COMPRIMIDA — no reenseñes
5. DECIDE cuántos pasos necesita este repaso (típicamente 3-5, no más)

FORMATO DE UN PASO EN EL REPASO:
Cada paso debe usar REFERENCIAS al aprendizaje previo, NO explicaciones nuevas:

MAL (esto es reenseñar):
"El concepto central transformó la interpretación anterior..."

BIEN (esto es sintetizar):
"Ya estudiaste cómo cada evidencia sostiene una parte del argumento. En conjunto permiten integrar la tesis central del material."

REGLAS ESTRICTAS DE ESTA SESIÓN:

PROHIBIDO:
- Redefinir conceptos como si el estudiante no los conociera
- Desarrollar explicaciones completas de bloques individuales
- Explicar detalles como si fuera la primera vez
- Repetir estructuras completas ya vistas

PERMITIDO Y REQUERIDO:
- Referenciar lo aprendido: "recuerda que...", "ya viste que...", "como estudiaste en la sesión X..."
- Conectar bloques que se enseñaron por separado
- Mostrar el ARGUMENTO COMPLETO integrado
- Dar el mapa mental final
- Cerrar el recorrido consolidando

El repaso NO es una lista secuencial. Es una síntesis nueva que:
- Recuerda la idea central del material
- Muestra cómo cada parte contribuye al argumento total
- Menciona los ejemplos, datos, o casos clave
- Presenta la conclusión del material
- Consolida sin repetir palabra por palabra

Cada paso puede ser del tipo que mejor sirva:
- "recap": recordatorio integrado de una parte
- "connection": cómo se conectan las ideas
- "concept": recordatorio profundo de una idea clave
- "example": ejemplo central del material
- "closing": conclusión final del recorrido

Al final el estudiante debe poder EXPLICAR el material completo con sus palabras.

Responde SOLO con JSON válido:
{
  "sessionIntro": "Apertura que recuerda la tesis o idea central del material (1-2 oraciones específicas)",
  "steps": [
    {
      "id": "step_1",
      "type": "recap",
      "title": "Título específico del repaso",
      "content": "Síntesis con nombres específicos y relaciones concretas.",
      "keyPoints": ["La idea consolidada más importante"],
      "importance": "critical",
      "relatedBlockIds": []
    }
  ],
  "evaluationBlocks": [],
  "sessionClosing": "Cierre real que menciona qué aprendió concretamente el estudiante (2-3 oraciones)"
}

CONTRATO NO EVALUABLE: evaluationBlocks debe ser exactamente []. No generes preguntas, actividades, scoring, evidencia ni recuperación.`;
  }

  // ═══════════════════════════════════════════════════════════════
  // LEARNING — Clase real, decidida por la IA según el material
  // ═══════════════════════════════════════════════════════════════

  const sessionBlocks = blueprint.blocks.filter((b: any) =>
    session.blockIds.includes(b.id)
  ).sort((a: any, b: any) => (a.globalOrder || 0) - (b.globalOrder || 0));

  const contentForTeaching = sessionBlocks.map((b: any) => ({
    id: b.id,
    kind: b.kind,
    label: b.label,
    summary: b.summary,
    importance: b.importance,
    sourceQuote: b.sourceSpans?.[0]?.quote || null,
  }));

  const positionContext = `Esta es la sesión ${session.chapterNumber} de ${totalSessions}.${previousSessionTitle ? ` Anterior: "${previousSessionTitle}".` : ''}${nextSessionTitle ? ` Siguiente: "${nextSessionTitle}".` : ''}`;

  const alreadyTaughtContext = previouslyTaughtBlocks && previouslyTaughtBlocks.length > 0
    ? `\n\n═══════════════════════════════════════════════════════════════
BLOQUES YA ENSEÑADOS EN SESIONES ANTERIORES (NO RE-ENSEÑAR)
═══════════════════════════════════════════════════════════════

Estos conceptos el estudiante YA los aprendió en clases previas.
Puedes REFERENCIARLOS brevemente (máx. 1 frase) si es imprescindible para la explicación actual, usando frases como "recuerda que ya vimos X" o "como estudiaste en la sesión anterior".
PROHIBIDO re-explicarlos, definirlos de nuevo, o dedicarles un paso.

${previouslyTaughtBlocks.map((b: any) => `- [${b.kind}] ${b.label}: ${b.summary}`).join('\n')}`
    : '';

  const upcomingContext = upcomingBlocks && upcomingBlocks.length > 0
    ? `\n\n═══════════════════════════════════════════════════════════════
BLOQUES QUE SE ENSEÑARÁN EN SESIONES FUTURAS (NO ADELANTAR)
═══════════════════════════════════════════════════════════════

Estos conceptos se enseñarán DESPUÉS. NO los expliques ahora.
Puedes mencionarlos brevemente solo si son necesarios para dar contexto, usando frases como "esto lo verás en detalle en la próxima sesión".
PROHIBIDO explicarlos, desarrollarlos, o dar detalles.

${upcomingBlocks.map((b: any) => `- [${b.kind}] ${b.label}`).join('\n')}`
    : '';

  const blockCount = contentForTeaching.length;

  const blocksForPrompt = contentForTeaching.map((b: any, i: number) =>
    `[Bloque ${i + 1}] ID: ${b.id}
Tipo: ${b.kind}
Tema: ${b.label}
Contenido: ${b.summary}${b.sourceQuote ? `
Cita del material: "${b.sourceQuote}"` : ""}
Importancia: ${b.importance}/100`
  ).join("\n\n");

  return `Eres un profesor experto. Vas a dar UNA CLASE REAL, no listar conceptos.

REGLAS UNIVERSALES DE FORMATO:
- Si aparece cualquier fórmula, variable, reacción, constante, subíndice, superíndice o símbolo matemático/científico, escríbelo en LaTeX correcto.
- Usa $...$ para inline.
- Usa $$...$$ para bloque.
- Usa SIEMPRE \\frac{a}{b}, NUNCA \\rac.
- Usa SIEMPRE \\rightleftharpoons para equilibrio químico.
- Usa SIEMPRE \\rightarrow para flechas simples.
- Usa subíndices correctos: $K_c$, $K_p$, $N_2$, $H_2$, $NH_3$.
- Usa superíndices correctos: $x^2$, $(RT)^{\\Delta n}$.
- NO inventes símbolos raros como i˚ghtleftharpoons.
- NO escribas fórmulas partidas carácter por carácter.
- Si el contenido no tiene matemáticas o ciencia, ignora estas reglas.


MATERIAL: "${materialTitle}"
SESIÓN ${session.chapterNumber}/${totalSessions}: "${session.title}"
OBJETIVO DE LA SESIÓN: ${session.objective}
${positionContext}

ROL DE ESTA SESIÓN EN EL PLAN:
Esta es una sesión de LEARNING. Su rol es enseñar en profundidad los ${blockCount} bloques asignados a ella, y SOLO esos.
- NO enseñes bloques que ya se enseñaron en sesiones anteriores (mira "BLOQUES YA ENSEÑADOS")
- NO enseñes bloques que se enseñarán en sesiones futuras (mira "BLOQUES DE SESIONES FUTURAS")
- SÍ puedes referenciar brevemente lo ya enseñado si es necesario para conectar
- SÍ puedes mencionar lo futuro con frases como "esto lo verás luego"

Otras sesiones existen precisamente para enseñar los otros bloques. Tu responsabilidad es SOLO tus bloques primarios.
${userContext}
NIVEL: ${levelContext}
URGENCIA: ${urgencyContext}${concernContext}${alreadyTaughtContext}${upcomingContext}
${languageInstruction}
${formattingInstruction}

═══════════════════════════════════════════════════════════════
CONTENIDO A ENSEÑAR EN ESTA SESIÓN (${blockCount} bloques)
═══════════════════════════════════════════════════════════════

${blocksForPrompt}

${pedagogyCore}

═══════════════════════════════════════════════════════════════
CÓMO USAR EL ANÁLISIS DEL MATERIAL
═══════════════════════════════════════════════════════════════

Los bloques anteriores VIENEN DEL ANÁLISIS DEL MATERIAL REAL. Son el resultado de haber leído el material entero.

TU FUENTE DE VERDAD:
- El campo "Contenido" de cada bloque = lo que el material realmente dice
- El campo "Cita del material" (cuando existe) = fragmento textual exacto
- El campo "Tipo" = qué naturaleza tiene ese bloque (concepto/dato/entidad/fórmula/ejemplo/etc)
- El campo "Importancia" = cuánto peso tiene en el material completo

CÓMO DECIDIR EL ENFOQUE PEDAGÓGICO:
- Si los bloques son mayormente "entity" + "fact" → el material es descriptivo/biográfico → enseña narrativamente
- Si los bloques son mayormente "concept" con "example" → el material es argumentativo → enseña presentando el argumento
- Si los bloques son mayormente "formula" + "concept" → el material es técnico/científico → enseña con derivación e intuición
- Si los bloques son mixtos → identifica cuál es el HILO principal y adáptate
- Si hay una tesis clara en los conceptos de mayor importancia → enséñala como argumento con evidencia

REGLAS ESTRICTAS DE FIDELIDAD:
- NUNCA agregues información que no esté en los bloques (no inventes datos, ejemplos, contexto)
- Si necesitas conectar con algo del material general, usa "previouslyTaughtBlocks" para referenciar
- No mezcles conocimiento tuyo del tema con lo que dice el material
- Si el material dice "muchos consideran a X el mejor", NO digas "X es el mejor" — preserva la modalidad

═══════════════════════════════════════════════════════════════
TU PROCESO
═══════════════════════════════════════════════════════════════

PASO A: Lee los ${blockCount} bloques y comprende qué se está enseñando realmente
PASO B: Identifica la naturaleza del contenido (argumento, procedimiento, narrativa, etc.)
PASO C: Agrupa los bloques relacionados en ideas coherentes
PASO D: Decide cuántos pasos necesita esta clase para enseñar bien
        - Podría ser 3 pasos si el contenido es simple y muy conectado
        - Podría ser 8 pasos si hay muchas ideas distintas
        - Podría ser lo que sea — TÚ decides según lo que necesite el material
PASO E: Escribe la clase paso por paso, respetando la progresión pedagógica

═══════════════════════════════════════════════════════════════
TIPOS DE PASO DISPONIBLES (usa el que corresponda en cada momento)
═══════════════════════════════════════════════════════════════

- "intro": apertura de la clase — qué se aprende hoy y por qué importa
- "concept": explicación profunda de una idea
- "example": caso, dato, ejemplo del propio material
- "connection": puente explícito entre ideas
- "warning": matiz importante, error común, aclaración crítica
- "formula": si hay fórmulas o expresiones formales
- "recap": mini-síntesis intermedia o final
- "closing": cierre que integra lo aprendido y conecta con lo siguiente

═══════════════════════════════════════════════════════════════
COBERTURA Y DIMENSIONAMIENTO
═══════════════════════════════════════════════════════════════

Al final de esta sesión, los ${blockCount} bloques deben quedar enseñados.
Cada bloque en \`relatedBlockIds\` de algún paso. Ninguno puede quedar sin cubrir.

CUÁNTOS PASOS GENERAR — SIN LÍMITES ARTIFICIALES:
No hay un número fijo ni un ratio predefinido. Genera exactamente los pasos que el contenido necesite.

Piensa así:
- ¿Este bloque es un dato simple que se agrupa con otro? → van en un paso
- ¿Este bloque es un concepto denso que necesita explicación + ejemplo? → 2 pasos
- ¿Este bloque es una fórmula? → puede necesitar 2-3 pasos (intuición + fórmula + ejemplo resuelto)
- ¿Este bloque es una idea compleja con múltiples aristas? → 2-3 pasos según necesite
- ¿Estos bloques forman una progresión argumentativa? → un paso por eslabón del argumento

Un material matemático puede necesitar más pasos por bloque que un material biográfico.
Un material narrativo puede necesitar pasos que fluyan cronológicamente.
Un material argumentativo puede necesitar pasos que sigan la estructura del argumento.

Lo justo es lo justo. Ni forces pasos extra ni comprimas ideas complejas en un solo paso.

═══════════════════════════════════════════════════════════════
FORMATO DE RESPUESTA
═══════════════════════════════════════════════════════════════

Responde SOLO con JSON válido, sin markdown ni texto extra:
{
  "sessionIntro": "Apertura ESPECÍFICA de esta sesión (1-2 oraciones que mencionan lo concreto que se verá)",
  "steps": [
    {
      "id": "step_1",
      "type": "intro",
      "title": "Título específico (no genérico)",
      "content": "Contenido específico del material. Nombres, datos, argumentos exactos. Se siente como un profesor real explicando en persona.",
      "keyPoints": ["Una o más ideas evaluables, concretas y autosuficientes"],
      "microId": "id estructural del bloque o unidad principal enseñada",
      "importance": "supporting | important | critical",
      "cognitiveTarget": "recognition | comprehension | application | transfer",
      "relatedBlockIds": ["ids_de_los_bloques_cubiertos_en_este_paso"]
    }
  ],
  "evaluationBlocks": [
    {
      "id": "evaluation_block_1",
      "afterStepId": "step_id_real",
      "coveredStepIds": ["step_id_real"],
      "coveredKeyPoints": ["keyPoint literal enseñado"],
      "questions": [
        {
          "id": "question_id_estable",
          "type": "multiple_choice",
          "coveredStepIds": ["step_id_real"],
          "coveredKeyPoints": ["keyPoint literal enseñado"],
          "targetObjectiveIds": ["objective_id"],
          "factKeys": ["fact_key"],
          "cognitiveTarget": "comprehension",
          "questionFamily": "familia_semántica",
          "prompt": "pregunta alineada únicamente con ese alcance",
          "options": [{"id":"a","text":"..."},{"id":"b","text":"..."}],
          "correctAnswer": "a",
          "explanation": "feedback específico basado en lo enseñado",
          "hint": "pista breve",
          "difficulty": "medium"
        }
      ]
    }
  ],
  "sessionClosing": "Cierre específico que integra lo aprendido y conecta con la siguiente sesión (2-3 oraciones con contenido real)"
}

CONTRATO DE EVALUACIÓN PERSISTIDA:
- Genera pasos y evaluationBlocks conjuntamente en esta única respuesta.
- Cada bloque se coloca después de un stepId real y solo cubre pasos ya presentados.
- Cada pregunta declara coveredStepIds y coveredKeyPoints literales del bloque.
- La unión de bloques cubre todos los pasos important/critical, todos los keyPoints critical y al menos un keyPoint por paso important.
- Genera el conjunto mínimo suficiente, sin repetir factKey + questionFamily.
- En quick_test usa exclusivamente formatos cerrados compatibles.
`;
}

function detectLang(materialTitle: string, blocks: any[]): 'es' | 'en' {
  const text = [
    materialTitle,
    ...blocks.slice(0, 5).map(b => `${b.label || ''} ${b.summary || ''}`)
  ].join(' ');

  if (/[áéíóúüñÁÉÍÓÚÜÑ]/.test(text)) return 'es';

  const lower = text.toLowerCase();
  const esCount = (lower.match(/\b(el|la|los|las|de|del|en|un|una|que|es|con|para|por|como|más|también|este|esta|su|sus|se|al|lo)\b/g) || []).length;
  const enCount = (lower.match(/\b(the|of|and|in|is|it|for|as|on|with|this|that|are|was|were|be|been|have|has|had|but|not|from|they|their)\b/g) || []).length;

  return esCount >= enCount ? 'es' : 'en';
}


/**
 * Decide cuándo evaluar basándose en el contenido real de los pasos.
 * No usa heurísticas fijas — analiza cada paso:
 * - intro: siempre se incluye en el primer grupo (tiene ideas evaluables)
 * - concept/formula/warning: densos, tienden a evaluarse solos o en pares pequeños
 * - example/connection: pueden agruparse con pasos anteriores
 * - recap/closing: siempre genera un checkpoint final
 * Garantía: TODOS los pasos quedan cubiertos en algún checkpoint.
 */
function buildCheckpointsFromContent(
  steps: Array<{ id: string; type: string; title: string; content: string; keyPoint: string | null }>
): Array<{ afterStepIndex: number; coveredStepIndices: number[]; reason: string }> {
  // Lógica adaptativa real: sin números mágicos fijos.
  // Usa densidad real del contenido (content.length) y calidad del keyPoint.
  // formula/warning siempre evalúan solos.
  // Garantía: todos los pasos evaluables terminan en algún checkpoint.
  // ensureCheckpointCoverage en coverageExtractor repara cualquier hueco restante.

  const ALWAYS_FLUSH = new Set(['formula', 'warning']);
  const HIGH_PRIORITY = new Set(['concept', 'recap']);
  const MEDIUM_PRIORITY = new Set(['intro', 'example', 'connection']);

  const checkpoints: Array<{ afterStepIndex: number; coveredStepIndices: number[]; reason: string }> = [];
  let pending: number[] = [];

  steps.forEach((step, index) => {
    const isLast = index === steps.length - 1;
    const isAlwaysFlush = ALWAYS_FLUSH.has(step.type);
    const isHighPriority = HIGH_PRIORITY.has(step.type);
    const isMediumPriority = MEDIUM_PRIORITY.has(step.type);
    const contentDensity = step.content.length;
    const hasStrongKeyPoint = step.keyPoint !== null && step.keyPoint.length > 35;

    if (step.type !== 'closing') {
      pending.push(index);
    }

    const shouldFlushNow =
      isLast ||
      isAlwaysFlush ||
      (isHighPriority && (contentDensity > 650 || hasStrongKeyPoint)) ||
      (pending.length >= 4) ||
      (pending.length >= 3 && (isHighPriority || (isMediumPriority && contentDensity > 400)));

    if (shouldFlushNow && pending.length > 0) {
      checkpoints.push({
        afterStepIndex: index,
        coveredStepIndices: [...pending],
        reason: isLast ? 'final_checkpoint'
               : isAlwaysFlush ? 'always_flush'
               : isHighPriority ? 'high_density'
               : 'content_group',
      });
      pending = [];
    }
  });

  // Safety net: pasos evaluables que no cayeron en ningún checkpoint
  if (pending.length > 0) {
    checkpoints.push({
      afterStepIndex: pending[pending.length - 1],
      coveredStepIndices: [...pending],
      reason: 'final_safety',
    });
  }

  return checkpoints;
}


function recoverTeachingOnlyCandidate(rawOutputs: string[]): any | null {
  for (const raw of [...rawOutputs].reverse()) {
    const parsed = repairJsonLocally(raw) as any
    if (!parsed || typeof parsed !== 'object') continue

    const teaching = parsed?.teaching_content && typeof parsed.teaching_content === 'object'
      ? parsed.teaching_content
      : parsed

    if (Array.isArray(teaching?.steps) && teaching.steps.length > 0) {
      return {
        sessionIntro: typeof teaching.sessionIntro === 'string' ? teaching.sessionIntro : '',
        steps: teaching.steps,
        sessionClosing: typeof teaching.sessionClosing === 'string' ? teaching.sessionClosing : '',
        evaluationBlocks: [],
      }
    }
  }
  return null
}

function buildLazyEvaluationBlocks(
  steps: Array<{
    id: string
    type: string
    title: string
    content: string
    keyPoint: string | null
    keyPoints?: string[]
    relatedBlockIds: string[]
    importance?: "supporting" | "important" | "critical"
  }>
): any[] {
  const evaluableSteps = steps.filter(step =>
    ['concept', 'formula', 'example', 'warning', 'connection', 'recap', 'closing'].includes(step.type)
  )

  if (!evaluableSteps.length) return []

  const important = evaluableSteps.filter(step =>
    (step.importance || 'important') === 'important' || (step.importance || 'important') === 'critical'
  )

  const critical = evaluableSteps.filter(step => (step.importance || 'important') === 'critical')

  const targetSteps = important.length > 0 ? important : evaluableSteps
  const coveredKeyPoints = targetSteps
    .flatMap(step => Array.isArray(step.keyPoints) && step.keyPoints.length > 0
      ? step.keyPoints
      : step.keyPoint ? [step.keyPoint] : []
    )
    .filter(Boolean)

  return [{
    id: 'evaluation_block_lazy_1',
    afterStepId: targetSteps[targetSteps.length - 1]?.id || steps[steps.length - 1]?.id || 'step_1',
    coveredStepIds: targetSteps.map(step => step.id),
    coveredKeyPoints: coveredKeyPoints.length > 0 ? coveredKeyPoints : ['Comprensión general del contenido enseñado'],
    questions: [],
    lazyGeneration: true,
    coverageHint: {
      importantStepIds: important.map(step => step.id),
      criticalStepIds: critical.map(step => step.id),
    },
  }]
}


export function parseFactoryJson(value: string): Record<string, any> {
  const parsed = repairJsonLocally(value)
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('INVALID_JSON')
  return parsed as Record<string, any>
}

export function buildTeachingOnlyPrompt(body: TeachRequest): string {
  const assignedIds=new Set(body.session.blockIds||[])
  const learningSource=(body.blueprint.blocks||[]).filter((block:any)=>!assignedIds.size||assignedIds.has(String(block.id))).map((block:any)=>({id:String(block.id||''),label:String(block.label||''),summary:String(block.summary||''),kind:String(block.kind||''),importance:Number(block.importance||0),sourceQuote:typeof block.sourceQuote==='string'?block.sourceQuote:undefined}))
  // Auditoría adversarial (Codex, Intro/Review #3): la versión anterior
  // tomaba SIEMPRE los primeros 5 topics por posición y asignaba el type por
  // índice (0='intro',1='concept',resto='connection'), ignorando el `role`
  // real que extractDocumentStructure ya calculó por CONTENIDO (foundation/
  // problem/mechanism/application/integration/context) — dos materiales con
  // los mismos 3-5 primeros topics por posición producían el mismo armazón
  // sin importar de qué trataran, y un topic genuinamente central que
  // apareciera después de la posición 5 quedaba descartado sin más. Fix: el
  // `type` de cada paso de introducción se deriva del role real del topic, y
  // cuando hay más de 5 topics se prioriza foundation/mechanism (roles que
  // típicamente cargan el núcleo conceptual) antes de completar con el
  // resto en orden original — nunca las primeras 5 posiciones a ciegas.
  const INTRO_TYPE_BY_ROLE: Record<string, string> = {
    foundation: 'intro', problem: 'concept', mechanism: 'concept',
    application: 'example', integration: 'connection', context: 'connection',
  }
  const allTopicsForIntro=(body.blueprint.topics||[]) as any[]
  const priorityRoles=new Set(['foundation','mechanism'])
  const introTopicPool=allTopicsForIntro.length<=5?allTopicsForIntro:[
    ...allTopicsForIntro.filter(t=>priorityRoles.has(String(t.role))),
    ...allTopicsForIntro.filter(t=>!priorityRoles.has(String(t.role))),
  ]
  const introSource=introTopicPool.slice(0,5).map((topic:any,index:number)=>({id:`introduction_orientation_${index+1}`,label:String(topic.title||`Parte ${index+1}`),summary:String(topic.description||''),kind:INTRO_TYPE_BY_ROLE[String(topic.role)]||(index===0?'intro':'concept'),importance:0}))
  // Auditoría adversarial (Codex, Intro/Review #2): final_review tenía
  // blockIds:[] (capítulo final), así que caía en learningSource filtrando
  // TODOS los bloques del blueprint — un paso por bloque, regeneración
  // lineal del material entero, nunca síntesis transversal del recorrido
  // REAL del estudiante. Con finalReviewContext (contenido efectivamente
  // enseñado + factKeys demostrados + recovery por sesión) disponible, se
  // construye un pool de "slots" de síntesis GENÉRICOS — la cantidad se
  // deriva del volumen real de contenido (no un número fijo), pero el TEMA
  // de cada uno lo decide el LLM a partir del material agregado real más
  // abajo (finalReviewMaterialBlock), nunca una plantilla de secciones fija.
  const finalReviewSessions=(body.finalReviewContext?.sessions||[])
  const finalReviewTotalKeyPoints=finalReviewSessions.reduce((sum,s)=>sum+(s.steps||[]).reduce((n,step)=>n+(step.keyPoints?.length||0),0),0)
  const finalReviewStepCount=finalReviewSessions.length>0?Math.min(7,Math.max(4,Math.ceil(finalReviewTotalKeyPoints/10))):0
  const finalReviewSource=Array.from({length:finalReviewStepCount},(_,index)=>({id:`final_review_synthesis_${index+1}`,label:'',summary:'',kind:'recap',importance:0}))
  const usesFinalReviewSynthesis=body.session.kind==='final_review'&&finalReviewSessions.length>0
  const source=body.session.kind==='introduction'?(introSource.length>=3?introSource:introSource.concat([{id:'introduction_vocabulary',label:'Vocabulario clave',summary:'Orientación mínima de términos sin desarrollo profundo.',kind:'concept',importance:0},{id:'introduction_journey_map',label:'Mapa del recorrido',summary:'Temas que se estudiarán después, sin explicarlos.',kind:'recap',importance:0}]).slice(0,Math.max(3,introSource.length))):usesFinalReviewSynthesis?finalReviewSource:learningSource
  const stepCount=Math.max(1,usesFinalReviewSynthesis?finalReviewSource.length:(assignedIds.size||source.length)); const charLimitPerStep = stepCount > 10 ? 450 : stepCount > 6 ? 700 : 1000;
  // Material real agregado del recorrido, SOLO para final_review con
  // contexto disponible — steps efectivamente enseñados (título+extracto+
  // keyPoints), factKeys demostrados y qué necesitó recuperación, por
  // sesión. Esto es lo que el LLM debe sintetizar; nunca se le pide repetir
  // cada sesión una por una.
  const finalReviewMaterialBlock=usesFinalReviewSynthesis?`

MATERIAL REAL DEL RECORRIDO COMPLETO (${finalReviewSessions.length} sesiones ya estudiadas — sintetiza, NO repitas cada una por separado):
${JSON.stringify(finalReviewSessions)}`:''
  // Auditoría adversarial (Codex, Teaching #4.2): antes solo distinguía
  // fact→recognition vs cualquier otro kind→comprehension, así que una
  // fórmula, un procedimiento (kind='formula'), un ejemplo trabajado
  // (kind='example') o un error común (kind='common_mistake') — que exigen
  // poder USAR/aplicar la idea, no solo reconocerla — quedaban marcados
  // igual que una simple definición. La evaluación posterior puede pedir
  // aplicación sobre contenido que el teaching solo etiquetó como
  // comprensión. Taxonomía real de block.kind (ver blueprint/route.ts):
  // concept | entity | definition | formula | example | fact |
  // common_mistake | note.
  const COGNITIVE_TARGET_BY_KIND: Record<string, string> = {
    fact: 'recognition', entity: 'recognition',
    formula: 'application', example: 'application', common_mistake: 'application',
    definition: 'comprehension', concept: 'comprehension', note: 'comprehension',
  }
  const fixedStepMetadata=source.map((block,index)=>({
    id:`step_${index+1}`,
    microId:block.id,
    type:['intro','concept','example','connection','formula','recap','closing'].includes(block.kind)?block.kind:'concept',
    importance:block.importance>=100?'critical':block.importance>=80?'important':'supporting',
    cognitiveTarget:COGNITIVE_TARGET_BY_KIND[block.kind]||'comprehension',
    relatedBlockIds:body.session.kind==='introduction'||usesFinalReviewSynthesis?[]:[block.id],
    factKeys:[`${block.id}:fact:1`],
  }))
  return `Genera únicamente la enseñanza de la sesión. No generes preguntas, evaluaciones, bloques evaluativos, respuestas correctas, opciones ni feedback. La evaluación se planificará en una operación posterior.

MATERIAL: ${body.materialTitle}
SESIÓN: ${body.session.title}
OBJETIVO: ${body.session.objective}
Genera exactamente ${stepCount} pasos docentes. PRESUPUESTO DE ESPACIO: Debido a que la sesión tiene ${stepCount} pasos, cada campo "content" DEBE tener menos de ${charLimitPerStep} caracteres para evitar truncamiento del JSON. Sé extremadamente directo y conciso.${body.session.kind==='introduction'?' (contrato de orientación: entre 3 y 5, vocabulario y mapa; cero desarrollo profundo)':usesFinalReviewSynthesis?' (contrato de repaso global: cada paso es una unidad de SÍNTESIS que tú defines libremente — big picture, conexiones entre sesiones, fórmulas esenciales, comparaciones, procesos, errores típicos recurrentes, "si recuerdas solo X cosas", puntos de examen — elige dinámicamente lo que el material real haga útil, NUNCA una lista fija de secciones ni un resumen sesión-por-sesión)':' , uno por cada bloque asignado'}, manteniendo un orden pedagógico coherente y sin inventar información.${finalReviewMaterialBlock}
${usesFinalReviewSynthesis?`INSTRUCCIÓN DE SÍNTESIS: usa demonstratedFactKeys para saber qué SÍ demostró dominar el estudiante (puedes ser breve ahí) y recoverySummary para saber qué le costó (dale más énfasis o una comparación que aclare la confusión). Compacta el recorrido completo — el resultado debe sentirse como "ahora tengo toda la materia organizada en la cabeza", no como releer cada sesión de nuevo.`:`CONTENIDO ASIGNADO: ${JSON.stringify(source)}`}
METADATOS OBLIGATORIOS POR PASO: ${JSON.stringify(fixedStepMetadata)}

Devuelve exclusivamente este TeachingContentSchema como JSON válido, sin markdown:
{"sessionIntro":"string","steps":[{"id":"step_1","type":"intro|concept|example|connection|formula|recap|closing","title":"string","content":"string","keyPoints":[{"id":"step_1:kp:1","text":"string"}],"microId":"string","importance":"supporting|important|critical","cognitiveTarget":"recognition|comprehension|application|analysis","relatedBlockIds":["string"],"factKeys":["string"],"sourceReferences":[]}],"closing":"string"}

Cada paso debe copiar exactamente su id, microId, type, importance, cognitiveTarget, relatedBlockIds y factKeys desde METADATOS OBLIGATORIOS; factKeys nunca puede quedar vacío. Cada id de keyPoint debe ser estable y seguir <stepId>:kp:<posición>. Usa LaTeX correcto cuando corresponda. No añadas ningún campo raíz aparte de sessionIntro, steps y closing.
Tu respuesta debe terminar inmediatamente después del campo closing.`
}

function factoryTeaching(source: TeachingContent, session: TeachRequest['session']): PreparedTeachingContent {
  const steps = (Array.isArray(source.steps) ? source.steps : []).map((item: any, index: number) => {
    const stepId = String(item.stepId || item.id || `step_${index + 1}`)
    const keyPoints = Array.isArray(item.keyPoints) ? [...new Set<string>(item.keyPoints.map((point:any)=>String(point.text||'')).filter(Boolean))] : []
    const factKeys = Array.isArray(item.factKeys) && item.factKeys.length ? [...new Set<string>(item.factKeys.map(String).filter(Boolean))] : keyPoints.map((_: string, i: number) => `${stepId}:fact:${i + 1}`)
    const keyPointIds=Array.isArray(item.keyPoints)?item.keyPoints.map((point:any)=>String(point.id||'')):keyPoints.map((_:string,i:number)=>`${stepId}:kp:${i+1}`)
    return { stepId, id:stepId, microId:String(item.microId || factKeys[0] || stepId), title:String(item.title || '').trim(), type:String(item.type || 'concept'), content:String(item.content || '').trim(), keyPoints, keyPointIds, factKeys, importance:item.importance === 'critical' || item.importance === 'supporting' ? item.importance : 'important', cognitiveTarget:String(item.cognitiveTarget || 'comprehension'), sourceReferences:Array.isArray(item.sourceReferences) ? item.sourceReferences : [], objectiveIds:Array.isArray(item.objectiveIds) ? item.objectiveIds.map(String) : keyPoints.map((_:string,i:number)=>`${session.id}:${stepId}:objective:${i+1}`), relatedBlockIds:Array.isArray(item.relatedBlockIds) ? item.relatedBlockIds.map(String) : [] }
  })
  if (!steps.length || new Set(steps.map((step: any) => step.stepId)).size !== steps.length || steps.some((step: any) => !step.title || !step.content || !step.keyPoints.length || !step.factKeys.length)) throw new Error('TEACHING_CONTENT_INVALID')
  if (session.kind === 'introduction' && (steps.length < 3 || steps.length > 5 || steps.some(step => step.relatedBlockIds?.length))) throw new Error('INTRODUCTION_CONTRACT_INVALID')
  return { sessionId:session.id,title:session.title,introduction:source.sessionIntro,closing:source.closing,steps }
}

function factoryPlan(raw: Record<string, any>): EvaluationPlan {
  const source = raw.evaluationPlan && typeof raw.evaluationPlan === 'object' ? raw.evaluationPlan : raw
  return { blocks:(Array.isArray(source.blocks) ? source.blocks : []).map((item:any)=>({ blockId:typeof item.blockId==='string'?item.blockId:'',afterStepId:typeof item.afterStepId==='string'?item.afterStepId:'',coveredStepIds:Array.isArray(item.coveredStepIds)?item.coveredStepIds.map(String):[],coveredKeyPointIds:Array.isArray(item.coveredKeyPointIds)?item.coveredKeyPointIds.map(String):[],coveredFactKeys:Array.isArray(item.coveredFactKeys)?item.coveredFactKeys.map(String):[],targetObjectiveIds:Array.isArray(item.targetObjectiveIds)?item.targetObjectiveIds.map(String):[],cognitiveTargets:Array.isArray(item.cognitiveTargets)?item.cognitiveTargets.map(String):[],recommendedQuestionCount:Number(item.recommendedQuestionCount),recommendedFormats:Array.isArray(item.recommendedFormats)?item.recommendedFormats.map(String):[],difficulty:typeof item.difficulty==='string'?item.difficulty:'' })) }
}


// Auditoría adversarial (Codex, misión nocturna FASE 1, P0 CONFIRMADO):
// short_response nunca estuvo en este canonicalizador — el flujo VIVO de
// generación (generateEvaluationBlock más abajo) no podía producir una
// evaluación escrita aunque el modo fuera write_explain, y cualquier
// intento del LLM de devolver format="short_response" era descartado
// silenciosamente por canonicalizeEvaluationFormat (retornaba null). Esto
// hacía que write_explain no fuera realmente "written-only" en la práctica.
type CanonicalEvaluationFormat =
  | 'multiple_choice'
  | 'multi_select'
  | 'true_false'
  | 'matching'
  | 'word_bank'
  | 'ordering'
  | 'classify'
  | 'scenario'
  | 'find_the_error'
  | 'short_response'

const CANONICAL_EVALUATION_FORMATS = new Set<CanonicalEvaluationFormat>([
  'multiple_choice',
  'multi_select',
  'true_false',
  'matching',
  'word_bank',
  'ordering',
  'classify',
  'scenario',
  'find_the_error',
  'short_response',
])

const EVALUATION_FORMAT_ALIASES: Record<string, CanonicalEvaluationFormat> = {
  // canonical direct
  'multiple_choice': 'multiple_choice',
  'multi_select': 'multi_select',
  'true_false': 'true_false',
  'matching': 'matching',
  'word_bank': 'word_bank',
  'ordering': 'ordering',
  'classify': 'classify',
  'scenario': 'scenario',
  'find_the_error': 'find_the_error',

  // mcq family
  'mcq': 'multiple_choice',
  'mcq_best_answer': 'multiple_choice',
  'mcq_best_explanation': 'multiple_choice',
  'mcq_except': 'multiple_choice',
  'mcq_most_likely': 'multiple_choice',
  'mcq_least_likely': 'multiple_choice',
  'mcq_cause': 'multiple_choice',
  'mcq_consequence': 'multiple_choice',
  'mcq_next_step': 'multiple_choice',
  'mcq_analogy': 'multiple_choice',

  // multi select
  'mcq_all_that_apply': 'multi_select',

  // true/false
  'true_false_factual': 'true_false',
  'true_false_negation': 'true_false',

  // matching
  'matching_concept_def': 'matching',
  'matching_cause_effect': 'matching',
  'matching_formula_name': 'matching',
  'matching_example_rule': 'matching',

  // word bank / fill blank
  'word_bank_fill': 'word_bank',
  'word_bank_formula': 'word_bank',
  'word_bank_definition': 'word_bank',
  'fill_in_the_blank': 'word_bank',
  'fill_blank': 'word_bank',

  // ordering
  'ordering_steps': 'ordering',
  'ordering_events': 'ordering',
  'ordering_magnitude': 'ordering',

  // scenario
  'scenario_predict': 'scenario',
  'scenario_diagnose': 'scenario',
  'scenario_choose_action': 'scenario',
  'scenario_compare': 'scenario',

  // find error
  'find_error_calculation': 'find_the_error',
  'find_error_reasoning': 'find_the_error',
  'find_error_definition': 'find_the_error',

  // classify
  'classify_category': 'classify',
  'classify_valid_invalid': 'classify',
  'classify_affected_not': 'classify',

  // written / open response (write_explain). Auditoría adversarial (Codex,
  // revisión final FASE 5, P1 CONFIRMADO): las claves deben ser los
  // ÚNICOS QuestionVariant realmente registrados en
  // questionFormatRegistry.ts (QUESTION_VARIANT_FORMAT) — ese es el
  // registro que normalizeGeneratedQuestion() consulta más adelante en
  // canonicalizeGeneratedSession(); una variante inventada aquí (p.ej.
  // 'explain_why' o 'justify' sueltos, sin sufijo) pasaba ESTE
  // canonicalizador local pero luego normalizeGeneratedQuestion() la
  // rechazaba silenciosamente por no estar en QUESTION_VARIANT_FORMAT,
  // descartando la pregunta escrita que write_explain necesitaba.
  'short_response': 'short_response',
  'open_response': 'short_response',
  'short_answer_define': 'short_response',
  'short_answer_compare': 'short_response',
  'short_answer_summarize': 'short_response',
  'explain_why_cause': 'short_response',
  'explain_why_consequence': 'short_response',
  'justify_answer': 'short_response',
  'teach_back': 'short_response',
  'problem_setup': 'short_response',
}

const DEFAULT_VARIANT_BY_FORMAT: Record<CanonicalEvaluationFormat, string> = {
  multiple_choice: 'mcq_best_answer',
  multi_select: 'mcq_all_that_apply',
  true_false: 'true_false_factual',
  matching: 'matching_concept_def',
  word_bank: 'word_bank_fill',
  ordering: 'ordering_steps',
  classify: 'classify_category',
  scenario: 'scenario_predict',
  find_the_error: 'find_error_reasoning',
  short_response: 'explain_why_cause',
}

function normalizeEvalToken(value: unknown): string {
  if (value === null || value === undefined) return ''
  return String(value).trim().toLowerCase()
}

function canonicalizeEvaluationFormat(
  rawFormat: unknown,
  rawVariant: unknown,
): CanonicalEvaluationFormat | null {
  const candidates = [normalizeEvalToken(rawFormat), normalizeEvalToken(rawVariant)].filter(Boolean)
  for (const candidate of candidates) {
    if (CANONICAL_EVALUATION_FORMATS.has(candidate as CanonicalEvaluationFormat)) {
      return candidate as CanonicalEvaluationFormat
    }
    const mapped = EVALUATION_FORMAT_ALIASES[candidate]
    if (mapped) return mapped
  }
  return null
}

function canonicalVariantForQuestion(
  rawFormat: unknown,
  rawVariant: unknown,
  format: CanonicalEvaluationFormat,
): string {
  const formatToken = normalizeEvalToken(rawFormat)
  const variantToken = normalizeEvalToken(rawVariant)
  const candidateTokens = [variantToken, formatToken].filter(Boolean)

  for (const token of candidateTokens) {
    const mapped = EVALUATION_FORMAT_ALIASES[token]
    if (mapped === format && !CANONICAL_EVALUATION_FORMATS.has(token as CanonicalEvaluationFormat)) {
      return token
    }
  }

  return DEFAULT_VARIANT_BY_FORMAT[format]
}

function optionText(value: unknown): string {
  if (value === null || value === undefined) return ''
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return String(value).trim()
  }
  if (typeof value !== 'object' || Array.isArray(value)) return ''
  for (const candidate of [(value as any).text, (value as any).label, (value as any).content, (value as any).value, (value as any).id]) {
    if (typeof candidate === 'string' || typeof candidate === 'number') {
      const normalized = String(candidate).trim()
      if (normalized) return normalized
    }
  }
  return ''
}

function normalizeChoiceOptionsForFamily(rawOptions: unknown): Array<{ id: string; text: string }> | null {
  if (!Array.isArray(rawOptions) || rawOptions.length === 0) return null
  const options = rawOptions.map((raw, index) => {
    let id = `option_${index + 1}`
    if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
      const rawId = (raw as any).id ?? (raw as any).value
      if (typeof rawId === 'string' || typeof rawId === 'number') id = String(rawId)
    }
    const text = optionText(raw)
    return { id, text }
  })
  return options.every(option => option.text) ? options : null
}

function resolveSingleChoiceAnswer(
  rawCorrectAnswer: unknown,
  options: Array<{ id: string; text: string }>,
): string | null {
  const first = Array.isArray(rawCorrectAnswer) ? rawCorrectAnswer[0] : rawCorrectAnswer
  if (first === null || first === undefined) return null

  const direct = optionText(first)
  if (direct) {
    const byId = options.find(option => option.id === direct)
    if (byId) return byId.id
    const byText = options.find(option => option.text === direct)
    if (byText) return byText.id
    const idx = Number(direct)
    if (Number.isInteger(idx) && idx >= 0 && idx < options.length) return options[idx].id
  }

  return null
}

function resolveMultipleChoiceAnswers(
  rawCorrectAnswer: unknown,
  options: Array<{ id: string; text: string }>,
): string[] | null {
  const values = Array.isArray(rawCorrectAnswer) ? rawCorrectAnswer : [rawCorrectAnswer]
  const resolved = values.map(value => resolveSingleChoiceAnswer(value, options)).filter(Boolean) as string[]
  return resolved.length ? resolved : null
}

function resolveTrueFalseSemantic(text: string): boolean | null {
  const normalized = text.trim().toLowerCase()
  if (['true', 'verdadero', 'sí', 'si', 'yes', 'correcto', 'v'].includes(normalized)) return true
  if (['false', 'falso', 'no', 'incorrecto', 'f'].includes(normalized)) return false
  return null
}

function resolveTrueFalseAnswer(
  rawCorrectAnswer: unknown,
  rawOptions: unknown,
): boolean | null {
  if (typeof rawCorrectAnswer === 'boolean') return rawCorrectAnswer

  if (Array.isArray(rawCorrectAnswer) && rawCorrectAnswer.length > 0) {
    return resolveTrueFalseAnswer(rawCorrectAnswer[0], rawOptions)
  }

  const direct = optionText(rawCorrectAnswer)
  if (direct) {
    const semantic = resolveTrueFalseSemantic(direct)
    if (semantic !== null) return semantic
  }

  const options = normalizeChoiceOptionsForFamily(rawOptions)
  if (!options) return null

  const candidate = optionText(rawCorrectAnswer)
  if (!candidate) return null

  const byId = options.find(option => option.id === candidate)
  if (byId) return resolveTrueFalseSemantic(byId.text)

  const byText = options.find(option => option.text === candidate)
  if (byText) return resolveTrueFalseSemantic(byText.text)

  const idx = Number(candidate)
  if (Number.isInteger(idx) && idx >= 0 && idx < options.length) {
    return resolveTrueFalseSemantic(options[idx].text)
  }

  return null
}

function normalizeMatchingOptionsForFamily(rawOptions: unknown): Array<{ id: string; left: string; right: string; rightId: string }> | null {
  if (!Array.isArray(rawOptions) || rawOptions.length < 2) return null
  const pairs = rawOptions.map((raw, index) => {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
    const id = optionText((raw as any).id) || `pair_${index + 1}`
    const left = optionText((raw as any).left ?? (raw as any).prompt ?? (raw as any).item)
    const right = optionText((raw as any).right ?? (raw as any).answer ?? (raw as any).match)
    const rightId = optionText((raw as any).rightId ?? (raw as any).answerId) || `match_${index + 1}`
    if (!left || !right) return null
    return { id, left, right, rightId }
  })
  return pairs.every(Boolean) ? pairs as Array<{ id: string; left: string; right: string; rightId: string }> : null
}

function buildMatchingOptionOrderLocal(
  pairs: Array<{ id: string; left: string; right: string; rightId: string }>,
): string[] {
  const ids = [...new Set(pairs.map(pair => pair.rightId))]
  if (ids.length < 2) return ids
  // Evitar orden trivial: rotación determinista simple
  return [...ids.slice(1), ids[0]]
}

function normalizeStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.map(String).filter(Boolean) : []
}

function normalizeMatchingOptionOrderInput(
  rawOrder: unknown,
  pairs: Array<{ id: string; left: string; right: string; rightId: string }>,
): string[] {
  const validIds = [...new Set(pairs.map(pair => pair.rightId))]
  const provided = normalizeStringArray(rawOrder)
  const validProvided =
    provided.length === validIds.length &&
    new Set(provided).size === validIds.length &&
    provided.every(id => validIds.includes(id))

  // Si el provider manda orden trivial o inválido, regenerar localmente
  if (!validProvided) return buildMatchingOptionOrderLocal(pairs)
  const isTrivial = provided.every((id, index) => id === validIds[index])
  return isTrivial ? buildMatchingOptionOrderLocal(pairs) : provided
}

function resolveMatchingAnswer(
  rawCorrectAnswer: unknown,
  pairs: Array<{ id: string; left: string; right: string; rightId: string }>,
): Record<string, string> | null {
  if (!rawCorrectAnswer || typeof rawCorrectAnswer !== 'object' || Array.isArray(rawCorrectAnswer)) {
    // Sin correctAnswer explícito — no podemos asumir orden secuencial
    // La alineación pair→right solo es válida si el LLM la confirmó
    return null
  }

  const raw = rawCorrectAnswer as Record<string, unknown>
  const pairIds = new Set(pairs.map(p => p.id))
  const rightIds = new Set(pairs.map(p => p.rightId))
  const byLeft = new Map(pairs.map(p => [p.left.trim().toLowerCase(), p.id] as const))
  const byRightText = new Map(pairs.map(p => [p.right.trim().toLowerCase(), p.rightId] as const))

  const output: Record<string, string> = {}

  for (const [key, rawValue] of Object.entries(raw)) {
    const valueStr = optionText(rawValue).trim()
    if (!key || !valueStr) return null

    let pairId: string | null = null
    let rightId: string | null = null

    // Resolver la clave (left side)
    if (pairIds.has(key)) {
      pairId = key
    } else {
      // La clave puede ser el texto del left
      pairId = byLeft.get(key.toLowerCase()) ?? null
    }

    if (!pairId) return null

    // Resolver el valor (right side)
    if (rightIds.has(valueStr)) {
      rightId = valueStr
    } else {
      // El valor puede ser el texto del right
      rightId = byRightText.get(valueStr.toLowerCase()) ?? null
    }

    if (!rightId) return null

    output[pairId] = rightId
  }

  // Validar que se cubrieron todos los pares
  if (Object.keys(output).length !== pairs.length) return null
  if (!pairs.every(p => p.id in output)) return null

  return output
}

function normalizeClassifyOptionsForFamily(
  rawOptions: unknown,
): { categories: string[]; items: Array<{ id: string; text: string; category: string }> } | null {
  if (!rawOptions || typeof rawOptions !== 'object' || Array.isArray(rawOptions)) return null
  const value = rawOptions as {
    categories?: unknown[]
    items?: unknown[]
    [key: string]: unknown
  }

  if (Array.isArray(value.categories) && Array.isArray(value.items)) {
    const categories: string[] = value.categories
      .map((item: unknown) => optionText(item))
      .filter((item): item is string => Boolean(item))

    const items = value.items.map((raw: unknown, index: number) => {
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
      const entry = raw as Record<string, unknown>
      const id = optionText(entry.id) || `item_${index + 1}`
      const text = optionText(entry.text ?? entry.item ?? entry.label)
      const category = optionText(entry.category ?? entry.value)
      if (!text || !category) return null
      return { id, text, category }
    })

    if (!categories.length || !items.every((item): item is { id: string; text: string; category: string } => item !== null)) {
      return null
    }

    return {
      categories: [...new Set<string>(categories)],
      items,
    }
  }

  const entries = Object.entries(value)
  const items = entries.map(([text, category], index) => {
    const normalizedCategory = optionText(category)
    if (!text || !normalizedCategory) return null
    return { id: `item_${index + 1}`, text, category: normalizedCategory }
  })

  if (!items.every((item): item is { id: string; text: string; category: string } => item !== null)) {
    return null
  }

  return {
    categories: [...new Set<string>(items.map(item => item.category))],
    items,
  }
}

function resolveClassifyAnswer(
  rawCorrectAnswer: unknown,
  options: { categories: string[]; items: Array<{ id: string; text: string; category: string }> },
): Record<string, string> | null {
  if (rawCorrectAnswer && typeof rawCorrectAnswer === 'object' && !Array.isArray(rawCorrectAnswer)) {
    const byId = new Set(options.items.map(item => item.id))
    const byText = new Map(options.items.map(item => [item.text, item.id] as const))
    const categories = new Set(options.categories)
    const output: Record<string, string> = {}

    for (const [rawKey, rawCategory] of Object.entries(rawCorrectAnswer as Record<string, unknown>)) {
      const category = optionText(rawCategory)
      if (!categories.has(category)) return null
      const itemId = byId.has(rawKey) ? rawKey : byText.get(rawKey)
      if (!itemId) return null
      output[itemId] = category
    }

    if (Object.keys(output).length) return output
  }

  return Object.fromEntries(options.items.map(item => [item.id, item.category]))
}

function factoryQuestions(raw: Record<string, any>, block: EvaluationPlanBlock): PreparedEvaluationQuestion[] {
  const list = Array.isArray(raw.questions)
    ? raw.questions
    : Array.isArray(raw.evaluationBlock?.questions)
      ? raw.evaluationBlock.questions
      : []

  return list.map((item: any, index: number) => {
    const targetStepIds = Array.isArray(item.targetStepIds) ? item.targetStepIds.map(String) : []
    const targetKeyPointIds = Array.isArray(item.targetKeyPointIds) ? item.targetKeyPointIds.map(String) : []
    const questionId = String(item.questionId || `${block.blockId}_q${index + 1}`)
    const prompt = String(item.prompt || '')
    const canonicalFormat = canonicalizeEvaluationFormat(item.format, item.variant)

    let options: unknown = null
    let correctAnswer: unknown = null
    let extras: Record<string, unknown> = {}

    switch (canonicalFormat) {
      case 'multiple_choice':
      case 'scenario':
      case 'find_the_error': {
        const normalizedOptions = normalizeChoiceOptionsForFamily(item.options)
        options = normalizedOptions
        correctAnswer = normalizedOptions ? resolveSingleChoiceAnswer(item.correctAnswer, normalizedOptions) : null
        break
      }
      case 'multi_select': {
        const normalizedOptions = normalizeChoiceOptionsForFamily(item.options)
        options = normalizedOptions
        correctAnswer = normalizedOptions ? resolveMultipleChoiceAnswers(item.correctAnswer, normalizedOptions) : null
        break
      }
      case 'true_false': {
        options = null
        correctAnswer = resolveTrueFalseAnswer(item.correctAnswer, item.options)
        break
      }
      case 'word_bank': {
        const normalizedOptions = normalizeChoiceOptionsForFamily(item.options)
        options = normalizedOptions
        correctAnswer = normalizedOptions ? resolveMultipleChoiceAnswers(item.correctAnswer, normalizedOptions) : null
        break
      }
      case 'ordering': {
        const normalizedOptions = normalizeChoiceOptionsForFamily(item.options)
        options = normalizedOptions
        correctAnswer = normalizedOptions ? resolveMultipleChoiceAnswers(item.correctAnswer, normalizedOptions) : null
        break
      }
      case 'matching': {
        const normalizedPairs = normalizeMatchingOptionsForFamily(item.options)
        options = normalizedPairs
        correctAnswer = normalizedPairs ? resolveMatchingAnswer(item.correctAnswer, normalizedPairs) : null
        if (normalizedPairs) {
          extras = {
            matchingSemantics: optionText(item.matchingSemantics) === 'many_to_one' ? 'many_to_one' : 'bijective',
            matchingOptionOrder: normalizeMatchingOptionOrderInput(item.matchingOptionOrder, normalizedPairs),
          }
        }
        break
      }
      case 'classify': {
        const normalizedClassify = normalizeClassifyOptionsForFamily(item.options)
        options = normalizedClassify
        correctAnswer = normalizedClassify ? resolveClassifyAnswer(item.correctAnswer, normalizedClassify) : null
        break
      }
      case 'short_response': {
        // Auditoría adversarial (Codex, misión nocturna FASE 1): sin este
        // case, el `default` de abajo ponía correctAnswer=null — la
        // respuesta modelo que evaluateWithAI necesita para graduar
        // (session-check/route.ts) se perdía por completo para write_explain.
        options = null
        correctAnswer = typeof item.correctAnswer === 'string' ? item.correctAnswer : optionText(item.correctAnswer)
        break
      }
      default: {
        options = item.options ?? null
        correctAnswer = null
      }
    }

    const cogTarget = String(item.cognitiveTarget || '').toLowerCase()
    const calibratedDifficulty: string =
      cogTarget === 'recognition' ? 'easy'
      : cogTarget === 'comprehension' ? 'medium'
      : cogTarget === 'application' || cogTarget === 'analysis' || cogTarget === 'transfer' ? 'hard'
      : String(item.difficulty || block.difficulty || 'medium')

    return {
      questionId,
      id: questionId,
      blockId: block.blockId,
      targetStepIds,
      coveredStepIds: targetStepIds,
      targetKeyPointIds,
      targetFactKeys: Array.isArray(item.targetFactKeys) ? item.targetFactKeys.map(String) : [],
      targetObjectiveIds: Array.isArray(item.targetObjectiveIds) ? item.targetObjectiveIds.map(String) : [],
      cognitiveTarget: String(item.cognitiveTarget || ''),
      variant: canonicalFormat ? canonicalVariantForQuestion(item.format, item.variant, canonicalFormat) : optionText(item.variant || item.format) || undefined,
      format: canonicalFormat || optionText(item.format || item.variant) || '',
      prompt,
      questionText: prompt,
      options,
      correctAnswer,
      feedback: String(item.feedback || ''),
      explanation: String(item.feedback || ''),
      difficulty: calibratedDifficulty,
      ...extras,
    } as any
  })
}

async function prepareSessionByFactory(body: TeachRequest & { userId?: string }, teachingPrompt: string, generationKey: string, materialType: string): Promise<NextResponse> {
  const { session, setup } = body
  let remoteCallNumber = 0
  const telemetry = (event:string,payload:Record<string,unknown>) => console.info('[session-preparation]',JSON.stringify({event,sessionId:session.id,planId:String(body.planVersion||''),materialId:body.materialHash||null,generationKey,provider:'openrouter',model:'google/gemini-2.5-flash',remoteCallNumber,...payload}))
  if (body.preparationState?.evaluationPlan) telemetry('plan_regeneration_prevented',{generationKey})
  // Presupuesto de retry TÉCNICO (JSON malformado/truncado de UNA llamada
  // remota) — nunca pedagogical repair, que sigue viviendo exclusivamente en
  // repairEvaluationBlock/diagnoseEvaluationBlock, disparado solo cuando el
  // JSON YA es válido pero la cobertura/contenido pedagógico no lo es. Bug
  // real (chapter_6, remoteCallNumber=3): una única respuesta con JSON
  // corrupto ("text": "Rojo"\n immunotherapy") en evaluation_block_generation
  // propagaba el throw directo hasta session_assembly, sin ninguna
  // oportunidad de reintento — a diferencia de generateTeachingStrict, que sí
  // reintenta 2 veces. remote() es el punto compartido por
  // evaluation_plan_enrichment, evaluation_block_generation e
  // incremental_evaluation_repair — las 3 carecían de retry técnico por
  // igual. El fix vive aquí, una sola vez, para las 3.
  const MAX_STAGE_JSON_ATTEMPTS = 2
  const remote = async(stage:string,content:string,maxTokens:number) => {
    const planningStage='evaluation_'+'planning'
    const questionStages=new Set(['evaluation_'+'block_generation','incremental_'+'evaluation_repair'])
    let lastRawText = ''
    return withTechnicalJsonRetry({
      maxAttempts: MAX_STAGE_JSON_ATTEMPTS,
      attempt: async (attemptNumber, isRetry) => {
        remoteCallNumber += 1
        const startedAt = Date.now()
        // Retry técnico: MISMA instrucción pedagógica + aviso de sintaxis.
        // Nunca regenera teaching, evaluation plan, ni bloques ya aceptados —
        // eso sigue exactamente igual, gobernado por sessionPreparationFactory
        // (state persistido), ajeno a este retry local de una sola llamada.
        const attemptContent = isRetry
          ? `${content}\n\nREPARACIÓN TÉCNICA — tu respuesta anterior no era JSON válido. Devuelve EXCLUSIVAMENTE el objeto JSON solicitado, sin markdown, sin fences, sin texto antes o después del JSON, sin comas finales colgantes. No cambies el contenido pedagógico solicitado, corrige únicamente la sintaxis.`
          : content
        const generated = await alai({messages:[{role:'user',content:attemptContent}],temperature:0.2,maxTokens,json:true,taskType:'session_content',stage,maxProviderAttempts:1})
        lastRawText = generated.text
        telemetry(`${stage}_remote_succeeded`,{stage,attempt:attemptNumber,durationMs:Date.now()-startedAt,provider:generated.provider,model:generated.model})
        if(stage===planningStage)telemetry('evaluation_plan_raw_received',{stage,attempt:attemptNumber,raw:generated.text.slice(0,20000),rawLength:generated.text.length})
        if(questionStages.has(stage))telemetry('evaluation_questions_raw_received',{stage,attempt:attemptNumber,raw:generated.text.slice(0,12000),rawLength:generated.text.length})
        return generated.text
      },
      parse: parseFactoryJson,
      onAttemptFailed: (attemptNumber, error) => {
        telemetry(stage===planningStage?'evaluation_plan_parse_failed':'session_stage_parse_failed',{stage,attempt:attemptNumber,errorCode:'INVALID_JSON',message:error instanceof Error?error.message:String(error),raw:lastRawText.slice(0,20000)})
      },
      onRetryScheduled: (attemptNumber, nextAttempt) => {
        telemetry(`${stage}_technical_retry_scheduled`,{stage,attempt:attemptNumber,nextAttempt,reason:'INVALID_JSON'})
      },
    })
  }
  const generateTeachingStrict=async():Promise<PreparedTeachingContent>=>{let lastError='TEACHING_SCHEMA_INVALID';for(let attempt=1;attempt<=2;attempt++){remoteCallNumber+=1;const startedAt=Date.now();const content=attempt===1?`${teachingPrompt}

REGLA DE SALIDA:
- Devuelve JSON puro, sin markdown y sin fences.
- Si la sesión tiene muchos pasos, prioriza cerrar un JSON completo y válido.
- Mantén cada step conciso y evita redundancias innecesarias.`:`Repara exclusivamente la respuesta de enseñanza. ${lastError}. Devuelve solo sessionIntro, steps y closing. No generes preguntas ni bloques evaluativos. Usa exactamente TeachingContentSchema y termina inmediatamente después de closing. Sin markdown. Sin fences. JSON puro. Si el error anterior fue INVALID_JSON_TRUNCATED, conserva la estructura pedagógica pero acorta el texto de cada step drásticamente (máximo 300 caracteres por content) para garantizar que el JSON cierre completo. PRIORIDAD: JSON VÁLIDO > DETALLE.\n\n${teachingPrompt}`;const generated=await alai({messages:[{role:'user',content}],temperature:0.2,maxTokens:lastError==='INVALID_JSON_TRUNCATED'?7200:6200,json:true,taskType:'session_content',stage:attempt===1?'teaching_generation':'targeted_repair',maxProviderAttempts:1});const diagnostic=teachingResponseDiagnostics(generated.text);telemetry('teaching_generation_remote_succeeded',{stage:'teaching_generation',attempt,durationMs:Date.now()-startedAt,provider:generated.provider,model:generated.model,responseLength:diagnostic.length,first500:diagnostic.first500,last500:diagnostic.last500,detectedFence:diagnostic.detectedFence,appearsTruncated:diagnostic.appearsTruncated,lastValidToken:diagnostic.lastValidToken,extraFields:diagnostic.extraFields,containsForbiddenTeachingFields:/\"(?:evaluationBlocks|questions|correctAnswer)\"/.test(generated.text)});if(!diagnostic.parsed){lastError=diagnostic.appearsTruncated?'INVALID_JSON_TRUNCATED':'TEACHING_SCHEMA_INVALID';telemetry('teaching_schema_failed',{attempt,errorCode:lastError,appearsTruncated:diagnostic.appearsTruncated});continue}const parsed=parseTeachingContent(diagnostic.parsed);if(parsed.success===true){telemetry('teaching_schema_validated',{attempt,responseLength:diagnostic.length,extraFields:[]});return factoryTeaching(parsed.value,session)}lastError=parsed.errorCode;telemetry('teaching_schema_failed',{attempt,errorCode:parsed.errorCode,validationErrors:parsed.validationErrors,extraFields:parsed.extraFields})}throw new Error(lastError)}
  let state=await runSessionPreparationFactory({ sessionKind:session.kind,generationKey,evalPreference:setup.evalPreference||'mix_everything',load:async()=>body.preparationState||preparationStore.get(generationKey)||null,persist:async value=>{preparationStore.set(generationKey,structuredClone(value))},telemetry,
    generateTeaching:generateTeachingStrict,
    planEvaluations:async teaching=>{telemetry('evaluation_planning',{generationKey});const base=buildDeterministicEvaluationPlan(teaching,{evalPreference:setup.evalPreference||'mix_everything'});telemetry('deterministic_evaluation_plan_built',{blockCount:base.blocks.length,blocks:base.blocks.map(block=>({blockId:block.blockId,afterStepId:block.afterStepId,coveredStepIds:block.coveredStepIds}))});try{const raw=await remote('evaluation_plan_enrichment',`Enriquece únicamente cantidad, formatos y dificultad de estos bloques ya inmutables. Devuelve SOLO JSON {"blocks":[{"blockId":"...","recommendedQuestionCount":2,"recommendedFormats":["multiple_choice"],"difficulty":"medium"}]}. No devuelvas afterStepId, coveredStepIds, coveredKeyPointIds, coveredFactKeys ni targetObjectiveIds. Modo=${setup.evalPreference||'mix_everything'}.\nBLOQUES=${JSON.stringify(base.blocks.map(block=>({blockId:block.blockId,afterStepId:block.afterStepId,coveredStepIds:block.coveredStepIds,coveredKeyPointIds:block.coveredKeyPointIds,cognitiveTargets:block.cognitiveTargets,stepSummaries:compactTeachingForEvaluation(teaching).filter(step=>block.coveredStepIds.includes(step.stepId)).map(step=>({stepId:step.stepId,title:step.title,keyPoints:step.keyPoints}))})))}`,1200);const enrichments=Array.isArray(raw.blocks)?raw.blocks:[];const byId=new Map(enrichments.map((item:any)=>[String(item.blockId||''),item]));for(const item of enrichments){const forbidden=Object.keys(item||{}).filter(key=>!['blockId','recommendedQuestionCount','recommendedFormats','difficulty'].includes(key));if(forbidden.length)telemetry('EVALUATION_PLAN_FORBIDDEN_STRUCTURAL_OVERRIDE',{blockId:String(item?.blockId||''),fields:forbidden})}return{blocks:base.blocks.map(block=>mergeEvaluationPlanEnrichment(block,(byId.get(block.blockId)||{}) as Record<string,unknown>))}}catch(error){telemetry('evaluation_plan_enrichment_failed',{message:error instanceof Error?error.message:String(error),structuralPlanPreserved:true});return base}},
    generateEvaluationBlock:async(block,teaching,accepted)=>{const scoped=compactTeachingForEvaluation(teaching).filter(step=>block.coveredStepIds.includes(step.stepId));const raw=await remote('evaluation_block_generation',`Genera preguntas de evaluación para ${block.blockId}.

CONTRATO DE SALIDA — cada pregunta DEBE tener estos campos:
{
  "questionId": "string único",
  "variant": "uno de los valores listados abajo",
  "targetStepIds": ["step_N"],
  "targetKeyPointIds": ["step_N:kp:N"],
  "targetFactKeys": ["fact_key_del_bloque"],
  "targetObjectiveIds": ["step_N:objective:comprehension"],
  "cognitiveTarget": "recognition|comprehension|application|transfer",
  "format": "derivado del variant",
  "prompt": "texto de la pregunta",
  "options": "según formato",
  "correctAnswer": "según formato",
  "feedback": "explicación específica de por qué es correcta",
  "difficulty": "easy|medium|hard"
}

VARIANTS DISPONIBLES Y SU FORMAT:
- multiple_choice → mcq_best_answer, mcq_cause, mcq_consequence, mcq_best_explanation, mcq_analogy
- true_false → true_false_factual, true_false_negation
- matching → matching_concept_def, matching_cause_effect, matching_formula_name, matching_example_rule
- ordering → ordering_steps, ordering_events, ordering_magnitude
- word_bank → word_bank_fill, word_bank_formula, word_bank_definition
- scenario → scenario_predict, scenario_diagnose, scenario_choose_action
- find_the_error → find_error_calculation, find_error_reasoning, find_error_definition
- classify → classify_category, classify_valid_invalid
- numeric_problem → problem_solve, numeric_missing_value (permitido en cualquier MODO incluido quick_test — respuesta corta cerrada, no escritura abierta; usa esta variant, no scenario_predict, cuando el paso trae una fórmula o un ejemplo numérico resuelto — el estudiante debe calcular, no reconocer)
- short_response → explain_why_cause, explain_why_consequence, justify_answer, teach_back, short_answer_define, short_answer_compare, short_answer_summarize, problem_setup (respuesta ESCRITA abierta — el estudiante redacta, no selecciona nada. OBLIGATORIO en MODO=write_explain, ver regla de modo más abajo; PROHIBIDO en MODO=quick_test. Usa EXACTAMENTE uno de estos variants, nunca una variación libre como "explain_why" o "justify" sueltos)

SELECCIÓN DE VARIANT POR TIPO DE PASO — GUÍA DETALLADA:

Paso tipo "concept":
  RECONOCIMIENTO: true_false_factual, mcq_best_answer
  COMPRENSIÓN: mcq_best_explanation, matching_concept_def, mcq_all_that_apply
  APLICACIÓN: scenario_predict, mcq_cause, mcq_consequence
  Regla: varía entre niveles. No uses solo true_false.

Paso tipo "example":
  SIEMPRE incluye el nombre concreto del ejemplo en el prompt.
  RECONOCIMIENTO: mcq_best_answer (con los valores exactos del ejemplo)
  COMPRENSIÓN: mcq_cause, matching_example_rule
  APLICACIÓN: scenario_predict, scenario_diagnose, find_error_calculation
  Ejemplo: "En el ejemplo de la síntesis de amoniaco, si K=0.212 y Q=0.5, ¿qué ocurre?"

Paso tipo "formula":
  RECONOCIMIENTO: word_bank_formula (completar la fórmula con ___)
  COMPRENSIÓN: mcq_best_explanation, find_error_calculation
  APLICACIÓN: numeric_problem calculando con la fórmula y datos del material (permitido en todos los MODOS, incluido quick_test)
  OBLIGATORIO: usa valores numéricos exactos del material (groundedness). Si el material ya resuelve un ejemplo numérico, la pregunta de aplicación debe ejercitar ESE cálculo (con los mismos valores o una variación mínima), no solo pedir reconocer la fórmula.

Paso tipo "connection":
  COMPRENSIÓN: matching_cause_effect, mcq_analogy, ordering_steps
  APLICACIÓN: scenario_compare, mcq_consequence

Paso tipo "warning":
  COMPRENSIÓN: true_false_negation (afirmación incorrecta común), find_error_reasoning
  APLICACIÓN: mcq_except (¿cuál NO es correcto?), scenario_diagnose

Paso tipo "recap":
  COMPRENSIÓN: classify_category, ordering_magnitude
  APLICACIÓN: mcq_all_that_apply, scenario_choose_action

REGLA DE VARIEDAD — OBLIGATORIA:
En un bloque de 3+ preguntas usa mínimo 3 variants DIFERENTES.
Nunca uses el mismo variant dos veces seguidas.
En sesiones cuantitativas: al menos 1 pregunta con datos numéricos reales.
En sesiones conceptuales: al menos 1 escenario o analogía.
En sesiones de procedimientos: al menos 1 ordering o find_error.
${(() => {
  const history = (body as any).generationHistory as {
    recentFormats?: string[]; recentVariants?: string[]
    priorCognitiveLevelByFactKey?: Record<string, string>
  } | undefined
  if (!history) return ''
  const recentFormats = Array.isArray(history.recentFormats) ? history.recentFormats : []
  const recentVariants = Array.isArray(history.recentVariants) ? history.recentVariants : []
  const escalations = Object.entries(history.priorCognitiveLevelByFactKey || {})
    .filter(([factKey]) => block.coveredFactKeys.includes(factKey))
  if (!recentFormats.length && !escalations.length) return ''
  return `
HISTORIAL REAL DE ESTE JOURNEY (desempate — PRIORIDAD MÍNIMA, nunca criterio principal):
Formatos usados recientemente en sesiones anteriores: ${recentFormats.join(', ') || 'ninguno'}.
Variants usados recientemente: ${recentVariants.join(', ') || 'ninguno'}.
Si dos formatos son igualmente apropiados para el mismo contenido y nivel cognitivo, prefiere el que NO aparece en esta lista. Si un formato es claramente el más apropiado, úsalo de todos modos — esto es solo desempate.
${escalations.length ? `Estos hechos de este bloque YA fueron evaluados antes en este journey con el nivel cognitivo indicado — si vuelves a evaluarlos, exige un nivel IGUAL O SUPERIOR (nunca repitas recognition puro sobre un hecho ya evaluado en comprehension o superior):\n${escalations.map(([factKey, level]) => `- "${factKey}" → ya evaluado en nivel "${level}"`).join('\n')}` : ''}`
})()}

CONTRATOS ADICIONALES:

multi_select / mcq_all_that_apply:
  variant="mcq_all_that_apply", format="multi_select"
  prompt: "Selecciona TODAS las afirmaciones correctas sobre X."
  options: [{id:"a",...},{id:"b",...},{id:"c",...},{id:"d",...}]
  correctAnswer: ["a","c"]  ← ARRAY de IDs correctos (mínimo 2)
  Solo usar si hay genuinamente 2+ opciones correctas.

mcq_except:
  prompt: "¿Cuál de las siguientes es INCORRECTA?"
  1 opción incorrecta entre 3-4 correctas.

scenario_*:
  El enunciado describe una situación concreta con datos del material.
  Ejemplo: "Un sistema tiene Q=120 y K=51. ¿Cuál es la dirección del desplazamiento?"
  Nunca escenarios abstractos sin datos reales.

find_error_*:
  Presenta razonamiento/cálculo/definición con UN error concreto y realista.
  Las opciones identifican o corrigen ese error.

word_bank_formula:
  El prompt incluye ___ para cada término faltante.
  options: términos reales del material.
  correctAnswer: array en orden de aparición de los ___.

classify_category:
  Mínimo 2 categorías reales del material, mínimo 2 ítems por categoría.

MODO=${setup.evalPreference||'mix_everything'}
quick_test: usa solo múltiple opción, V/F, matching, ordering, word_bank, scenario, find_the_error, numeric_problem — NUNCA short_response (respuesta abierta larga). numeric_problem SÍ está permitido en quick_test: es una respuesta corta y cerrada (un valor), no escritura abierta.
write_explain: la evaluación inicial de este bloque DEBE usar short_response (variant explain_why_cause, explain_why_consequence, justify_answer, teach_back, short_answer_define, short_answer_compare o short_answer_summarize según lo que la pregunta exija — usa EXACTAMENTE uno de estos nombres) para TODAS las preguntas que evalúen comprensión/aplicación/transferencia de un concepto. Excepción única: si el paso es de tipo "formula" y el keyPoint exige un cálculo numérico concreto, usa numeric_problem para ESA pregunta específica (sigue siendo respuesta corta cerrada, no una elección entre opciones). NO generes multiple_choice, true_false, matching, word_bank, ordering, scenario, find_the_error ni classify en este modo — este modo existe precisamente para que el estudiante REDACTE su comprensión, no para que seleccione entre alternativas ya escritas.
mix_everything: elige el formato que mejor demuestre la capacidad exigida por CADA objetivo — no repartas formatos por variedad ni por cuota. Guía mínima: objetivo numérico → numeric_problem; secuencia/proceso → ordering; relación término-definición → matching; categorización → classify; explicación causal que exige que el estudiante PRODUZCA el razonamiento (no solo reconocerlo entre opciones) → short_response o scenario; selección de varios componentes simultáneos genuinamente correctos → multi_select. La regla de variedad de más arriba sigue aplicando como desempate entre formatos igualmente apropiados, nunca como criterio principal.

FORMATO DE OPTIONS POR VARIANT:
- mcq_*: options=[{id:"a",text:"..."},{id:"b",text:"..."},{id:"c",text:"..."},{id:"d",text:"..."}], correctAnswer="a"
- true_false_*: NO incluyas options, correctAnswer=true o false (boolean, no string)
- matching_*: options=[{id:"pair_1",left:"concepto",right:"definición",rightId:"match_1"},...], correctAnswer={"pair_1":"match_1",...}, matchingSemantics="bijective", matchingOptionOrder=["match_1","match_2",...]. CADA "right" debe describir ÚNICAMENTE a su propio "left" — antes de responder, verifica cada par contra el contenido del paso; no reasignes descripciones entre pares.
- ordering_*: options=[{id:"a",text:"paso 1"},{id:"b",text:"paso 2"},...], correctAnswer=["a","b",...] en orden correcto
- word_bank_*: prompt incluye ___ para cada hueco, options=[{id:"w1",text:"palabra"},...], correctAnswer=["w1","w2",...] en orden de aparición de los huecos
- scenario_*: opciones de selección describiendo acciones o predicciones
- find_error_*: presenta un enunciado con error, opciones identifican el error
- classify_*: options={categories:["Cat A","Cat B"],items:[{id:"i1",text:"...",category:"Cat A"},...]}
- numeric_problem: NO incluyas options; correctAnswer={"value":numero,"tolerance":numero,"unit":"unidad exacta del material o cadena vacía"} — value y unit deben coincidir literalmente con el material; tolerance pequeña y razonable (ej. redondeo del último dígito calculado)
- short_response: NO incluyas options; correctAnswer="respuesta modelo en texto, describiendo el requisito CENTRAL que la respuesta del estudiante debe cumplir para considerarse correcta — no exijas ahí detalles opcionales que la pregunta no pidió explícitamente"

REGLA DE GROUNDEDNESS — OBLIGATORIA:
Toda opción, valor, número, unidad, fórmula o dato DEBE estar tomado LITERALMENTE del contenido de los PASOS.
Si un paso enseña "[H₂]=1.000×10⁻³ M", usa exactamente ese valor — no "1.00 M".
Si un paso enseña "K=0.212", usa K=0.212.
Si la pregunta evalúa un paso tipo "example", el prompt DEBE nombrar el ejemplo explícitamente.

REGLA DE CALIBRACIÓN COGNITIVA:
- recognition → easy (recordar un dato literal)
- comprehension → medium (entender una relación)
- application → hard (aplicar una fórmula o procedimiento)
- transfer → hard (aplicar a nuevo contexto)

VARIEDAD: no repitas el mismo variant dos veces en el mismo bloque.
MÍNIMO SUFICIENTE: genera las preguntas necesarias para cubrir los keyPoints del bloque, sin exceder.

Devuelve SOLO JSON {"questions":[...]} sin markdown ni fences.
BLOQUE=${JSON.stringify(block)}
PASOS=${JSON.stringify(scoped)}
ACEPTADAS=${JSON.stringify(accepted.map(q=>({format:q.format,prompt:q.prompt,targetFactKeys:q.targetFactKeys})))}`,2600);const generatedQuestions=factoryQuestions(raw,block);
      // Auditoría adversarial (Codex, misión nocturna FASE 1, P0): write_explain
      // debe ser written-only para la evaluación inicial (excepto
      // numeric_problem, respuesta corta cerrada legítima cuando el paso es
      // numérico). Un fallback silencioso a formatos cerrados normales es
      // exactamente lo que el hallazgo señaló — esto NO bloquea ni
      // reintenta (evita riesgo de loop infinito), pero lo deja observable:
      // un fallback genuino de infraestructura debe quedar telemetrado, no
      // silencioso.
      if ((setup.evalPreference||'mix_everything')==='write_explain') {
        const nonWritten=generatedQuestions.filter(q=>q.format!=='short_response'&&q.format!=='numeric_problem')
        if (nonWritten.length>0) telemetry('write_explain_produced_closed_format_fallback',{blockId:block.blockId,nonWrittenCount:nonWritten.length,totalCount:generatedQuestions.length,formats:nonWritten.map(q=>q.format)})
      }
      return {...block,questions:generatedQuestions}},
    repairEvaluationBlock:async(block,missing:EvaluationCoverageDiagnosis,accepted)=>{const requiredReplacementCount=Math.max(missing.invalidQuestionIds.length+missing.duplicateQuestionIds.length,missing.missingRequiredStepIds.length,missing.missingCriticalKeyPoints.length,missing.missingImportantKeyPoints.length,missing.missingFactKeys.length);const teaching=preparationStore.get(generationKey)!.teachingContent!;const scopedSteps=compactTeachingForEvaluation(teaching).filter(step=>block.coveredStepIds.includes(step.stepId));const repairPayload={blockId:block.blockId,requiredReplacementCount,missingKeyPointIds:[...missing.missingCriticalKeyPoints,...missing.missingImportantKeyPoints],missingFactKeys:missing.missingFactKeys,invalidQuestionIds:missing.invalidQuestionIds,coveredStepIds:block.coveredStepIds,allowedKeyPointIds:block.coveredKeyPointIds,allowedFactKeys:block.coveredFactKeys,allowedObjectiveIds:block.targetObjectiveIds,allowedCognitiveTargets:block.cognitiveTargets,targetTeaching:scopedSteps,acceptedQuestions:accepted.map(question=>({questionId:question.questionId,format:question.format,prompt:question.prompt,targetStepIds:question.targetStepIds,targetKeyPointIds:question.targetKeyPointIds,targetFactKeys:question.targetFactKeys}))};return factoryQuestions(await remote('incremental_evaluation_repair',`Genera exactamente ${requiredReplacementCount} preguntas nuevas alineadas con targetTeaching. GROUNDEDNESS: todos los valores, números y datos deben estar tomados literalmente de targetTeaching. Si la pregunta evalúa un ejemplo, incluye el contexto del ejemplo en el enunciado. CALIBRACIÓN: recognition=easy, comprehension=medium, application/analysis/transfer=hard. Cada pregunta debe incluir questionId,targetStepIds,targetKeyPointIds,targetFactKeys,targetObjectiveIds,cognitiveTarget,format,prompt,options,correctAnswer,feedback,difficulty. targetFactKeys debe contener al menos un valor literal de allowedFactKeys; targetObjectiveIds debe usar allowedObjectiveIds; cognitiveTarget debe usar allowedCognitiveTargets. Cada pregunta debe cubrir literalmente al menos uno de missingKeyPointIds y evaluar el texto asociado en targetTeaching, sin desviarse a otro dato. Si missingFactKeys no está vacío, el conjunto de preguntas nuevas debe cubrir TODOS esos factKeys literalmente en targetFactKeys (una sola pregunta puede cubrir varios factKeys si genuinamente aplica). Reemplaza funcionalmente invalidQuestionIds. No repitas acceptedQuestions. Usa exclusivamente los IDs suministrados. Devuelve SOLO JSON {"questions":[...]}, con exactamente ${requiredReplacementCount} elementos. No devuelvas un array vacío. Modo=${setup.evalPreference||'mix_everything'}; quick_test exige formatos cerrados.\nTAREA=${JSON.stringify(repairPayload)}`,3200),block)},
  })
  const academicDomainMetadata = {
    academicDomain:body.academicDomain || 'general_conceptual',
    academicDomainSource:body.academicDomainSource || 'content_contract',
    academicDomainConfidence:body.academicDomainConfidence ?? 0,
    academicDomainVersion:body.academicDomainVersion || 'academic-domain-v1',
  }
  Object.assign(state, academicDomainMetadata)
  preparationStore.set(generationKey, structuredClone(state))
  if(state.preparationStatus!=='ready'||!state.teachingContent){const diagnostic=state.lastDiagnostic;console.error('[session-preparation]',JSON.stringify({event:'session_teach_503',sessionId:session.id,errorCode:diagnostic?.errorCode||'SESSION_PREPARATION_RETRY_REQUIRED',message:state.lastTechnicalError||'',validationErrors:diagnostic?.validationErrors||[],offendingBlock:diagnostic?.offendingBlock||null,unknownStepIds:diagnostic?.unknownStepIds||[],unknownKeyPoints:diagnostic?.unknownKeyPoints||[],missingStepIds:diagnostic?.missingStepIds||[],stack:diagnostic?.stack||'',preparationStatus:state.preparationStatus,teachingPreserved:Boolean(state.teachingContent)}));return NextResponse.json({ok:false,success:false,stage:state.currentGenerationStage==='technical_retry_required'?'evaluation_planning_validation':state.currentGenerationStage,errorCode:diagnostic?.errorCode||'SESSION_PREPARATION_RETRY_REQUIRED',message:state.lastTechnicalError,validationErrors:diagnostic?.validationErrors||[],offendingBlock:diagnostic?.offendingBlock||null,unknownStepIds:diagnostic?.unknownStepIds||[],unknownKeyPoints:diagnostic?.unknownKeyPoints||[],missingStepIds:diagnostic?.missingStepIds||[],preparationStatus:state.preparationStatus,teachingPreserved:Boolean(state.teachingContent),retryFromStage:state.teachingContent&&!state.evaluationPlan?'evaluation_planning':'evaluation_generation',retryable:true,preparationState:state,remoteCalls:remoteCallNumber},{status:503})}
  const keyPointText=new Map(state.teachingContent.steps.flatMap(step=>step.keyPointIds.map((id,index)=>[id,step.keyPoints[index]] as const)))
  const rawSession={sessionIntro:state.teachingContent.introduction,sessionClosing:state.teachingContent.closing,steps:state.teachingContent.steps.map(step=>({...step,id:step.stepId})),evaluationBlocks:state.generatedEvaluationBlocks.map(block=>({id:block.blockId,...block,coveredKeyPoints:block.coveredKeyPointIds.map(id=>keyPointText.get(id)).filter(Boolean),questions:block.questions.map(q=>({...q,id:q.questionId,type:q.format,coveredStepIds:q.targetStepIds,coveredKeyPoints:q.targetKeyPointIds.map(id=>keyPointText.get(id)).filter(Boolean),questionText:q.prompt,explanation:q.feedback,targetDimension:q.cognitiveTarget}))}))}
  const canonical=canonicalizeGeneratedSession(rawSession,{sessionId:session.id,kind:session.kind,evaluationMode:setup.evalPreference||'mix_everything'})
  if(!canonical.session){state={...state,preparationStatus:'technical_retry_required',currentGenerationStage:'session_assembly_validation',lastTechnicalError:'SESSION_PREPARATION_VALIDATION_FAILED',lastDiagnostic:{errorCode:'SESSION_PREPARATION_VALIDATION_FAILED',validationErrors:canonical.errors,unknownStepIds:[],unknownKeyPoints:[],missingStepIds:[]}};preparationStore.set(generationKey,structuredClone(state));console.error('[session-preparation]',JSON.stringify({event:'session_teach_503',sessionId:session.id,stage:'session_assembly_validation',errorCode:'SESSION_PREPARATION_VALIDATION_FAILED',message:'La sesión preparada no pasó la canonicalización final',validationErrors:canonical.errors,offendingBlock:null,unknownStepIds:[],unknownKeyPoints:[],missingStepIds:[],stack:'',preparationStatus:state.preparationStatus,teachingPreserved:true}));return NextResponse.json({ok:false,success:false,stage:'session_assembly_validation',errorCode:'SESSION_PREPARATION_VALIDATION_FAILED',message:'La sesión preparada no pasó la canonicalización final',validationErrors:canonical.errors,offendingBlock:null,unknownStepIds:[],unknownKeyPoints:[],missingStepIds:[],preparationStatus:state.preparationStatus,teachingPreserved:true,retryFromStage:'evaluation_generation',retryable:true,preparationState:state},{status:503})}
  if (body.preparationState) {
    for (const question of canonical.session.evaluationBlocks.flatMap(block => block.questions)) {
      telemetry('evaluation_question_revalidated',{questionId:question.id,requiresNumericData:question.requiresNumericData===true,valid:true})
    }
  }
  telemetry('evaluation_coverage_validated',{coveredKeyPointIds:canonical.session.evaluationBlocks.flatMap(block=>block.questions.flatMap(question=>question.coveredKeyPointIds||[]))})
  const classContent=sanitizeClassContent({sessionId:session.id,sessionTitle:session.title,sessionNumber:session.chapterNumber,sessionKind:session.kind,materialType,...academicDomainMetadata,sessionIntro:state.teachingContent.introduction,steps:canonical.session.steps,sessionClosing:state.teachingContent.closing,totalSteps:canonical.session.steps.length,contentVersion:state.teachingHash,assessmentPlanVersion:3,evaluationBlocks:canonical.session.evaluationBlocks,evaluationCoverage:state.missingCoverage,preparationStatus:state.preparationStatus,preparationState:state})
  // Codex Finding 2 — server-authoritative question contract: firmar cada
  // pregunta ANTES de enviarla al cliente, este es el único punto de salida
  // real (el resto del archivo, debajo de esta función, es código
  // inalcanzable — ver comentario en POST).
  for(const block of classContent.evaluationBlocks) signQuestionsInPlace(block.questions)
  telemetry('session_assembly_validated',{blockCount:canonical.session.evaluationBlocks.length});const payload={success:true,classContent};teachCache.set(generationKey,{result:payload,timestamp:Date.now()});telemetry('session_preparation_ready',{generationKey});return NextResponse.json(payload)
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json() as TeachRequest & { userId?: string };
    const {
      session,
      blueprint,
      userProfile,
      setup,
      materialTitle,
      totalSessions,
      previousSessionTitle,
      nextSessionTitle,
      previouslyTaught,
      upcomingConcepts,
      userId,
    } = body;
    const previouslyTaughtBlocks = (body as any).previouslyTaughtBlocks || [];
    const upcomingBlocks = (body as any).upcomingBlocks || [];
    const primaryBlockIds = (body as any).primaryBlockIds || [];

    if (!session || !blueprint || !setup || !materialTitle || !session.kind) {
      return NextResponse.json(
        { success: false, error: 'session.kind, session, blueprint, setup y materialTitle son requeridos' },
        { status: 400 }
      );
    }

    // Cache
    const cacheKey = hashKey(
      session.id,
      session.kind,
      blueprint.version || 0,
      userId || 'anon',
      String(body.materialHash || materialTitle),
      String(body.planVersion || 'current'),
    );
    console.info('[session-content]', JSON.stringify({
      event: 'session_kind_resolved', sessionId: session.id, kind: session.kind,
      planId: String(body.planVersion || ''), materialId: body.materialHash || null,
    }))
    const cached = teachCache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
      console.log(`[session-teach] Cache hit para sesión ${session.chapterNumber} "${session.title}"`);
      console.info('[session-content]', JSON.stringify({
        event: 'session_content_cache_hit',
        generationKey: cacheKey,
        sessionId: session.id,
      }))
      return NextResponse.json(cached.result);
    }

    const academicDomain = resolveAcademicDomain({ persistedDomain:body.academicDomain, materialTitle, blocks:blueprint.blocks || [], topics:blueprint.topics || [] });
    const materialType = legacyMaterialType(academicDomain.academicDomain);
    const lang = detectLang(materialTitle, blueprint.blocks || []);

    console.info('[session-content]', JSON.stringify({ event:'academic_domain_resolved', sessionId:session.id, planId:String(body.planVersion||''), materialId:body.materialHash||null, ...academicDomain }))

    console.log(`[session-teach] Generando clase: sesión ${session.chapterNumber}/${totalSessions} "${session.title}" | material=${materialType} | lang=${lang}`);

    const prompt = buildTeachingPrompt(
      {
        session,
        blueprint,
        userProfile,
        setup,
        materialTitle,
        totalSessions,
        previousSessionTitle,
        nextSessionTitle,
        previouslyTaught,
        upcomingConcepts,
        previouslyTaughtBlocks,
        upcomingBlocks,
        primaryBlockIds,
        allBlocks: (body as any).allBlocks || blueprint.blocks,
        allTopics: (body as any).allTopics || blueprint.topics,
      },
      materialType,
      lang,
    );
    const teachingOnlyPrompt = buildTeachingOnlyPrompt(body)

    const generationKey = cacheKey;
    // El flujo visible usa exclusivamente la fábrica persistente por fases.
    // El bloque monolítico inferior queda temporalmente conservado como código de
    // compatibilidad histórica, pero es inalcanzable y no gobierna ninguna petición.
    return await prepareSessionByFactory({ ...body, ...academicDomain }, teachingOnlyPrompt, generationKey, materialType)

    const validateGeneratedContent = (value: unknown) => {
      const prepared = canonicalizeGeneratedSession(value, {
        sessionId: session.id,
        kind: session.kind,
        evaluationMode: setup.evalPreference || 'mix_everything',
      })
      const errors = [...prepared.errors]
      if (prepared.session) {
        const kindValidation = validateSessionEvaluationForKind({
          sessionId: session.id,
          kind: session.kind,
          steps: prepared.session.steps,
          evaluationBlocks: prepared.session.evaluationBlocks,
        }, setup.evalPreference || 'mix_everything')
        const event = shouldEvaluateSession(session.kind)
          ? kindValidation.valid ? 'learning_session_evaluation_generated' : 'learning_session_missing_evaluation'
          : kindValidation.valid ? 'non_evaluated_session_generated' : 'evaluation_forbidden_for_session_kind'
        console.info('[session-content]', JSON.stringify({
          event, sessionId: session.id, kind: session.kind,
          planId: String(body.planVersion || ''), materialId: body.materialHash || null,
          errors: kindValidation.errors,
        }))
        errors.push(...kindValidation.errors)
      }
      return { valid: errors.length === 0, errors, retryable: false }
    }
    const teachingPipeline = await runSessionContentGenerationPipeline<Record<string, any>>({
      generationKey,
      telemetry: (event, payload) => console.info('[ai-generation]', JSON.stringify({
        event, taskType: 'session_content', sessionId: session.id, generationKey, ...payload,
      })),
      validate: validateGeneratedContent,
      validateTeaching: value => {
        const part = value && typeof value === 'object' && !Array.isArray(value)
          ? value as Record<string, unknown> : {}
        const steps = Array.isArray(part.steps) ? part.steps : []
        const errors: string[] = []
        if (!steps.length) errors.push('SESSION_CONTENT_SPLIT:teaching_steps_required')
        steps.forEach((step, index) => {
          const item = step && typeof step === 'object' && !Array.isArray(step) ? step as Record<string, unknown> : {}
          if (!String(item.title || '').trim() || !String(item.content || '').trim()) errors.push(`SESSION_CONTENT_SPLIT:invalid_step:${index}`)
          if (!Array.isArray(item.keyPoints) || item.keyPoints.length === 0) errors.push(`SESSION_CONTENT_SPLIT:key_points_required:${index}`)
        })
        return { valid: errors.length === 0, errors }
      },
      validateAssessment: (value, teaching) => {
        const part = value && typeof value === 'object' && !Array.isArray(value)
          ? value as Record<string, unknown> : {}
        const evaluationBlocks = Array.isArray(part.evaluationBlocks) ? part.evaluationBlocks : null
        if (!evaluationBlocks) return { valid: false, errors: ['SESSION_CONTENT_SPLIT:evaluation_blocks_required'] }
        return validateGeneratedContent({ ...(teaching as object), evaluationBlocks })
      },
      assemble: (teaching, assessment) => ({ ...(teaching as object), ...(assessment as object) }),
      generate: async context => {
        let content = prompt
        if (context.stage === 'split_teaching') {
          const scopedBlocks = (blueprint.blocks || []).filter((block: any) =>
            (session.blockIds || []).includes(String(block.id))
          )
          content = `Genera únicamente teaching_content para esta sesión. No generes preguntas ni evaluationBlocks.
Devuelve JSON con sessionIntro, steps y sessionClosing. Cada step incluye id, type, title, content, keyPoints, microId, importance, cognitiveTarget y relatedBlockIds.
Sesión: ${JSON.stringify({ id: session.id, kind: session.kind, title: session.title, objective: session.objective })}
Contenido fuente: ${JSON.stringify(scopedBlocks.length ? scopedBlocks : blueprint.blocks || [])}`
        } else if (context.stage === 'split_assessment') {
          content = `Genera únicamente assessment_content para el teaching_content validado siguiente.
Devuelve JSON con evaluationBlocks, preguntas, respuestas, explicaciones, coveredStepIds y coveredKeyPoints.
No agregues ni reescribas pasos. Cubre el 100% de los keyPoints evaluables y respeta ${setup.evalPreference || 'mix_everything'}.
TEACHING_CONTENT VALIDADO: ${JSON.stringify(context.acceptedTeaching)}`
        } else if (context.stage === 'directed_json_repair') {
          content = context.providerFailure ? prompt : `Devuelve exactamente el mismo contenido, reparado al schema JSON solicitado. No agregues, elimines ni reescribas contenido.

SALIDA ORIGINAL A REPARAR:
${context.rawText}`
        } else if (context.stage === 'split_generation') {
          const prior = context.acceptedTeaching
            ? `TEACHING_CONTENT YA VALIDADO (cópialo exactamente y genera assessment_content usando únicamente este contenido):\n${JSON.stringify(context.acceptedTeaching)}`
            : context.acceptedContent
            ? `CONTENIDO PARCIAL RECUPERADO (úsalo como fuente y no lo muestres fuera del envelope):\n${JSON.stringify(context.acceptedContent)}`
            : `SALIDA ORIGINAL FALLIDA (recupera únicamente su contenido académico):\n${context.rawText}`
          content = `${prompt}

La salida completa anterior no pudo validarse. Devuelve un único JSON envelope con dos partes independientes:
{
  "teaching_content": {
    "sessionIntro": "...",
    "steps": [/* pasos con id, type, title, content, keyPoints, microId, importance, cognitiveTarget, relatedBlockIds */],
    "sessionClosing": "..."
  },
  "assessment_content": {
    "evaluationBlocks": [/* bloques y preguntas alineados exclusivamente con teaching_content */]
  }
}
Para introduction o final_review assessment_content.evaluationBlocks debe ser [].
Para learning genera cobertura completa usando exactamente los ids y keyPoints de teaching_content.
No incluyas texto fuera del JSON. No inventes contenido ajeno a la fuente.

${prior}`
        }
        const generated = await alai({
          messages: [{ role: 'user', content }],
          temperature: context.stage === 'complete_generation' ? 0.3 : 0,
          maxTokens: context.stage === 'split_assessment' ? 3200 : context.stage === 'split_teaching' ? 3600 : context.stage === 'split_generation' ? 5200 : 4800,
          json: true,
          fallbackError: context.stage.startsWith('split_') ? context.providerError : undefined,
          taskType: 'session_content',
          stage: context.stage,
          maxProviderAttempts: 1,
        })
        return { text: generated.text, provider: generated.provider, model: generated.model }
      },
    })
    let result = teachingPipeline.content as any

    if (teachingPipeline.status !== 'validated' || !teachingPipeline.content) {
      console.error('[session-teach] PIPELINE FALLIDO:', {
        status: teachingPipeline.status,
        remoteCalls: teachingPipeline.remoteCalls,
        validationErrors: teachingPipeline.validationResult?.errors,
      });

      return NextResponse.json({
        success: false,
        error: 'SESSION_CONTENT_PREPARATION_FAILED',
        retryable: true,
        remoteCalls: teachingPipeline.remoteCalls,
      }, { status: 503 })
    }

    const preparedSession = canonicalizeGeneratedSession(result, {
      sessionId: session.id,
      kind: session.kind,
      evaluationMode: setup.evalPreference || 'mix_everything',
    })
    console.log('[session-teach] canonicalizeGeneratedSession:', {
      hasSession: !!preparedSession.session,
      errors: preparedSession.errors,
      stepsCount: preparedSession.session?.steps?.length,
      evalBlocksCount: preparedSession.session?.evaluationBlocks?.length,
      stepIds: preparedSession.session?.steps?.map((s: any) => s.id),
      evalAfterStepIds: preparedSession.session?.evaluationBlocks?.map((b: any) => b.afterStepId),
    });
    if (!preparedSession.session) {
      throw new Error(preparedSession.errors.join(','))
    }

    // Estructurar pasos; el pipeline académico valida/repara después.
    const blocksById = new Map((blueprint.blocks || []).map((block: any) => [String(block.id), block]))
    const validSteps = preparedSession.session.steps
      .filter((s: any) => s?.title && s?.content && String(s.content).trim().length >= 20)
      .map((s: any, i: number) => {
        const relatedBlockIds: string[] = Array.isArray(s.relatedBlockIds) ? [...new Set<string>(s.relatedBlockIds.map(String))] : []
        const primaryBlock = relatedBlockIds.map(id => blocksById.get(id)).find(Boolean) as any
        const factKeys: string[] = Array.isArray(s.factKeys) && s.factKeys.length
          ? [...new Set<string>(s.factKeys.map(String))]
          : Array.isArray(s.keyPoints) && s.keyPoints.length
            ? [...new Set<string>(s.keyPoints.map(String))]
          : relatedBlockIds.length ? relatedBlockIds : [String(s.id || `step_${i + 1}`)]
        const microId = String(s.microId || primaryBlock?.microId || primaryBlock?.id || factKeys[0])
        const cognitiveTarget = ['recognition', 'comprehension', 'application', 'transfer'].includes(s.cognitiveTarget)
          ? s.cognitiveTarget
          : s.type === 'formula' || s.type === 'example'
            ? 'application'
            : s.type === 'connection'
              ? 'transfer'
              : s.type === 'concept' || s.type === 'warning'
                ? 'comprehension'
                : 'recognition'
        const stepId = String(s.id || `step_${i + 1}`)
        return {
        id: stepId,
        type: ['intro', 'concept', 'formula', 'example', 'connection', 'warning', 'recap', 'closing'].includes(s.type) ? s.type : 'concept',
        title: String(s.title).trim(),
        content: String(s.content).trim(),
        keyPoint: s.keyPoints?.[0] ? String(s.keyPoints[0]).trim() : null,
        keyPoints: Array.isArray(s.keyPoints) ? s.keyPoints.map(String) : [],
        relatedBlockIds,
        microId,
        factKeys,
        cognitiveTarget,
        objectiveIds: Array.isArray(s.objectiveIds) && s.objectiveIds.length
          ? s.objectiveIds.map(String)
          : factKeys.map(factKey => `${session.id}:${stepId}:${factKey}`),
        importance: s.importance,
      }});

    if (validSteps.length === 0) {
      throw new Error('No hay pasos válidos después de filtrar');
    }

    const phase = session.kind === 'final_review' ? 'final_review' : 'teaching'
    const normalizeFragment = async (
      source: string,
      role: string,
      stepId: string,
      nodePath: string,
      fallback: string,
    ): Promise<string> => {
      const normalized = await recoverAcademicFragment(
        source,
        {
          surface: role,
          sessionId: session.id,
          stepId,
          phase,
          nodePath,
          nodeType: 'academic_fragment',
          fallback,
        },
        async (fragment, issues) => {
          const repair = await alaiJson({
            messages: [{
              role: 'user',
              content: `Regenera únicamente este fragmento académico conservando su significado y su idioma.
ROL: ${role}
ERRORES ESTRUCTURALES: ${issues.join(', ')}
FRAGMENTO:
${fragment}

Devuelve JSON válido: {"content":"fragmento corregido"}.
Conserva Unicode válido. Usa delimitadores explícitos para matemáticas, \\ce{...} para química y fences para código.`,
            }],
            temperature: 0.1,
            maxTokens: 900,
            json: true,
          })
          return typeof repair?.content === 'string' ? repair.content : ''
        },
      )
      if (!normalized.valid) {
        throw new Error(`INVALID_ACADEMIC_FRAGMENT:sessionId=${session.id}:stepId=${stepId}:nodePath=${nodePath}`)
      }
      return normalized.content
    }

    const normalizedSteps = await Promise.all(validSteps.map(async (step, index) => ({
      ...step,
      title: await normalizeFragment(step.title, 'teaching_step_title', step.id, `steps[${index}].title`, 'Contenido de estudio'),
      content: await normalizeFragment(step.content, 'teaching_step_content', step.id, `steps[${index}].content`, 'Este fragmento no pudo mostrarse de forma segura. Continúa con la siguiente idea del paso.'),
      keyPoint: step.keyPoint ? await normalizeFragment(step.keyPoint, 'teaching_key_point', step.id, `steps[${index}].keyPoint`, 'Revisa la explicación principal de este paso.') : null,
    })))
    const normalizedIntro = await normalizeFragment(
      typeof result.sessionIntro === 'string' ? result.sessionIntro : `Comencemos con ${session.title}.`,
      'session_intro',
      'session',
      'sessionIntro',
      'Comencemos la sesión.',
    )
    const normalizedClosing = await normalizeFragment(
      typeof result.sessionClosing === 'string' ? result.sessionClosing : 'Has completado esta sesión.',
      'session_closing',
      'session',
      'sessionClosing',
      'Has completado esta sesión.',
    )

    const evaluationBlocks = session.kind === 'learning'
      ? preparedSession.session.evaluationBlocks
      : []
    const evaluationValidation = validateSessionEvaluationForKind({
      sessionId: session.id,
      kind: session.kind,
      steps: normalizedSteps.map(step => ({
        id: step.id,
        type: step.type,
        title: step.title,
        content: step.content,
        keyPoints: step.keyPoints,
        importance: step.importance,
        relatedBlockIds: step.relatedBlockIds,
      })),
      evaluationBlocks,
    }, setup.evalPreference || 'mix_everything')
    if (normalizedSteps.length === 0) {
      throw new Error('No hay pasos de enseñanza válidos')
    }

    const responsePayload = {
      success: true,
      classContent: {
        sessionId: session.id,
        sessionTitle: session.title,
        sessionNumber: session.chapterNumber,
        sessionKind: session.kind,
        materialType,
        sessionIntro: normalizedIntro,
        steps: normalizedSteps,
        sessionClosing: normalizedClosing,
        totalSteps: normalizedSteps.length,
        contentVersion: generationKey,
        assessmentPlanVersion: 2,
        evaluationBlocks,
        evaluationCoverage: evaluationValidation,
      },
    };

    // Sanitize LaTeX before caching — universal, works for any material
    responsePayload.classContent = sanitizeClassContent(responsePayload.classContent)

    // CRITICAL: garantizar que afterStepId de cada evaluationBlock coincida con un step.id real
    const validStepIds = new Set(responsePayload.classContent.steps?.map((s: any) => s.id) || []);
    const evalBlocks = Array.isArray(responsePayload.classContent.evaluationBlocks)
      ? responsePayload.classContent.evaluationBlocks
      : [];

    // Separar bloques válidos de huérfanos
    const validBlocks: any[] = [];
    const orphanBlocks: any[] = [];
    for (const block of evalBlocks) {
      if (validStepIds.has(block.afterStepId)) {
        validBlocks.push(block);
      } else {
        orphanBlocks.push(block);
        console.warn(`[session-teach] evaluationBlock huérfano: afterStepId="${block.afterStepId}" no existe en steps. Steps disponibles: ${[...validStepIds].join(", ")}`);
      }
    }

    // Reasignar huérfanos al último paso enseñable (no intro ni closing)
    if (orphanBlocks.length > 0) {
      const teachingSteps = (responsePayload.classContent.steps || []).filter(
        (s: any) => !["intro", "closing"].includes(s.type)
      );
      const lastTeachingStep = teachingSteps[teachingSteps.length - 1];
      if (lastTeachingStep) {
        for (const block of orphanBlocks) {
          block.afterStepId = lastTeachingStep.id;
          validBlocks.push(block);
          console.warn(`[session-teach] evaluationBlock reasignado a step: ${lastTeachingStep.id}`);
        }
      }
    }

    responsePayload.classContent.evaluationBlocks = validBlocks;

    teachCache.set(cacheKey, { result: responsePayload, timestamp: Date.now() });

    // Limpiar cache viejo
    for (const [k, v] of teachCache.entries()) {
      if (Date.now() - v.timestamp > CACHE_TTL) teachCache.delete(k);
    }

    console.log(`[session-teach] ${normalizedSteps.length} pasos generados para "${session.title}"`);

    return NextResponse.json(responsePayload);

  } catch (e: unknown) {
    console.error('[session-teach] Error:', e instanceof Error ? e.message : 'unknown');
    return NextResponse.json(
      { success: false, error: 'No pudimos preparar esta sesión. Vuelve al plan e inténtalo de nuevo.' },
      { status: 500 }
    );
  }
}
// Este bloque no hace nada — solo marca que session-teach ya fue patcheado para checkpoints
// Los checkpoints reales se calculan en el cliente con buildCoverageMap
