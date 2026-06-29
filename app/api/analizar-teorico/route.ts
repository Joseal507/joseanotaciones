// ═══════════════════════════════════════════════════════════════
// /api/analizar-teorico — Análisis pedagógico con ALAI
// Cache por material + auth + fallback completo
// ═══════════════════════════════════════════════════════════════

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '../../../lib/auth/options';
import { alaiJson, cleanDeep } from '../../../lib/alai';
import { detectContentLanguage } from '../../../lib/detectLanguage';
import {
  getMaterialResult,
  saveMaterialResult,
} from '../../../lib/materials/repository';

export const maxDuration = 120;
export const dynamic = 'force-dynamic';

// ── Validación básica de strings ───────────────────────────────
const ok = (s: any, min = 10) =>
  typeof s === 'string' && s.trim().length >= min;

// ── Chunking / reducción jerárquica ─────────────────────────────
function splitIntoChunks(text: string, chunkSize = 9000): string[] {
  const chunks: string[] = [];
  let remaining = String(text || '').trim();

  while (remaining.length > 0) {
    if (remaining.length <= chunkSize) {
      chunks.push(remaining);
      break;
    }

    let cut = remaining.lastIndexOf('\n\n', chunkSize);
    if (cut < chunkSize * 0.5) cut = remaining.lastIndexOf('\n', chunkSize);
    if (cut < chunkSize * 0.5) cut = chunkSize;

    chunks.push(remaining.slice(0, cut).trim());
    remaining = remaining.slice(cut).trim();
  }

  return chunks.filter(Boolean);
}

function extractPrompt(lang: 'es' | 'en', materialName: string, chunkIndex: number, totalChunks: number, text: string): string {
  if (lang === 'es') return `Eres ALAI EXTRACTOR PEDAGÓGICO 10/10.

Tu trabajo NO es resumir.
Tu trabajo es convertir este fragmento en conocimiento enseñable, completo y estructurado.

REGLA PRINCIPAL:
Si este fragmento contiene una idea, dato, proceso, fórmula, síntoma, mecanismo, personaje, fecha, causa, consecuencia, ejemplo, definición o relación importante, DEBE aparecer en el JSON.

PROHIBIDO:
- Resumir demasiado.
- Devolver solo 2 o 3 conceptos.
- Repetir frases genéricas.
- Inventar información externa al fragmento.
- Conectar con materiales externos.
- Perder pasos de procesos.
- Ignorar fórmulas, variables, fechas, nombres o ejemplos.
- Elevar a concepto principal algo que el fragmento menciona de pasada.
- Explicar una fórmula solo con "describe X" sin decir qué significa cada parte.

OBLIGATORIO:
- Identifica qué es CENTRAL en el fragmento (se repite, se explica en detalle, ocupa más de 3 oraciones) vs qué es SECUNDARIO (se menciona en 1-2 oraciones como contexto).
- Los conceptos centrales deben tener explicacion_profesor de 6-12 oraciones.
- Los conceptos secundarios pueden tener 1-2 oraciones y marca importancia: "secundario".
- Para CADA fórmula que aparezca: explica qué significa el signo, qué pasa cuando n=1/2/3, qué límite tiene y qué fenómeno describe.
- Separa subideas específicas: problema de Rutherford, estabilidad del átomo, órbitas cuantizadas, niveles de energía, saltos cuánticos, espectro del hidrógeno, fórmula Eₙ.
- Si el fragmento menciona el espectro del hidrógeno, extráelo como concepto separado.
- Si el fragmento menciona algo en 1 oración (Nobel, Instituto, energía nuclear, WWII), márcalo importancia: "secundario". NO lo incluyas en no_omitir.
- REGLA CRÍTICA: no_omitir solo debe contener conceptos que un estudiante NECESITA para entender el tema central. Excluye premios, instituciones y datos biográficos.

Material: ${materialName}
Fragmento: ${chunkIndex + 1}/${totalChunks}

Devuelve SOLO JSON válido con esta estructura exacta:

{
  "tema_principal": "De qué trata este fragmento en una oración clara",

  "puntos_del_fragmento": [
    {
      "punto": "idea, dato o subtema específico del fragmento",
      "explicacion": "explicación clara de 1-3 oraciones",
      "tipo": "concepto | dato | proceso | fórmula | causa | consecuencia | ejemplo | persona | fecha | aplicación"
    }
  ],

  "conceptos": [
    {
      "nombre": "concepto importante",
      "definicion_clara": "definición entendible",
      "explicacion_profesor": "explicación pedagógica de 6-12 oraciones: qué es, qué problema resuelve, por qué importa, cómo funciona, qué causa, qué consecuencia tiene y cómo se usa en este fragmento",
      "nivel": "base | intermedio | avanzado",
      "importancia": "central | secundario | contextual"
    }
  ],

  "vocabulario_tecnico": [
    {
      "termino": "término técnico",
      "definicion": "definición simple",
      "como_recordarlo": "forma fácil de recordarlo"
    }
  ],

  "procesos_paso_a_paso": [
    {
      "nombre": "proceso, mecanismo, cronología o secuencia",
      "pasos": [
        "paso 1 explicado",
        "paso 2 explicado",
        "paso 3 explicado"
      ],
      "resultado": "qué produce el proceso",
      "por_que_importa": "por qué este proceso ayuda a entender el material"
    }
  ],

  "causas_y_consecuencias": [
    {
      "causa": "qué ocurre primero",
      "mecanismo": "cómo esa causa produce el efecto",
      "consecuencia": "qué ocurre después",
      "importancia": "por qué importa"
    }
  ],

  "formulas_y_variables": [
    {
      "formula": "fórmula exacta si aparece",
      "variables": [
        { "simbolo": "símbolo", "significado": "qué representa" }
      ],
      "para_que_sirve": "qué permite calcular o entender",
      "ejemplo_uso": "ejemplo breve si el fragmento lo permite",
      "interpretacion_profunda": "Explica: 1) qué significa el signo (positivo/negativo/fracción), 2) qué pasa cuando cada variable aumenta o disminuye, 3) qué valor límite tiene y qué significa físicamente ese límite, 4) qué fenómeno real describe esta ecuación que sin ella no se podría entender"
    }
  ],

  "personas_fechas_datos": [
    {
      "dato": "persona, fecha, lugar, premio, número o dato concreto",
      "explicacion": "por qué aparece y por qué importa"
    }
  ],

  "ejemplos_del_material": [
    {
      "ejemplo": "ejemplo o caso mencionado",
      "que_demuestra": "qué enseña ese ejemplo"
    }
  ],

  "relaciones_internas": [
    {
      "idea_a": "idea A",
      "idea_b": "idea B",
      "relacion": "cómo se conectan dentro del MISMO material"
    }
  ],

  "errores_o_confusiones": [
    {
      "confusion": "malentendido probable",
      "correccion": "forma correcta de entenderlo",
      "mini_ejemplo": "ejemplo breve"
    }
  ],

  "preguntas_examen_chunk": [
    {
      "pregunta": "pregunta profunda que un profesor podría hacer sobre este fragmento",
      "respuesta_esperada": "respuesta ideal en 2-4 oraciones"
    }
  ],

  "orden_para_ensenar": [
    "primero enseña esto",
    "después esto",
    "luego esto"
  ],

  "no_omitir": [
    "lista de detalles concretos del fragmento que NO deben perderse en la clase final"
  ]
}

Fragmento:
${text}`;

  return `You are ALAI PEDAGOGICAL EXTRACTOR 10/10.

Your job is NOT to summarize.
Your job is to turn this chunk into complete, teachable, structured knowledge.

MAIN RULE:
If this chunk contains an important idea, fact, process, formula, symptom, mechanism, person, date, cause, consequence, example, definition or relationship, it MUST appear in the JSON.

FORBIDDEN:
- Over-summarizing.
- Returning only 2 or 3 concepts.
- Repeating generic phrases.
- Inventing external information.
- Connecting this material with other materials.
- Losing process steps.
- Ignoring formulas, variables, dates, names or examples.

MANDATORY:
- Extract between 8 and 25 concepts if the chunk contains them.
- Extract between 8 and 30 details in no_omitir if the chunk contains them.
- Do NOT group many ideas under "Quantum mechanics" or "Bohr model".
- Separate subideas: Rutherford problem, atomic stability, orbits, energy levels, quantum jumps, hydrogen spectrum, formula, variables, Copenhagen interpretation, Nobel, applications, etc.
- If there are few facts, extract all. If there are many, prioritize academically useful facts.

Material: ${materialName}
Chunk: ${chunkIndex + 1}/${totalChunks}

Return ONLY valid JSON with this exact structure:

{
  "tema_principal": "What this chunk is about in one clear sentence",

  "puntos_del_fragmento": [
    {
      "punto": "specific idea, fact or subtopic from the chunk",
      "explicacion": "clear 1-3 sentence explanation",
      "tipo": "concept | fact | process | formula | cause | consequence | example | person | date | application"
    }
  ],

  "conceptos": [
    {
      "nombre": "important concept",
      "definicion_clara": "understandable definition",
      "explicacion_profesor": "6-12 sentence pedagogical explanation: what it is, what problem it solves, why it matters, how it works, what it causes, what consequence it has and how it is used in this chunk",
      "nivel": "base | intermedio | avanzado"
    }
  ],

  "vocabulario_tecnico": [
    {
      "termino": "technical term",
      "definicion": "simple definition",
      "como_recordarlo": "easy way to remember it"
    }
  ],

  "procesos_paso_a_paso": [
    {
      "nombre": "process, mechanism, chronology or sequence",
      "pasos": [
        "explained step 1",
        "explained step 2",
        "explained step 3"
      ],
      "resultado": "what the process produces",
      "por_que_importa": "why this process helps understand the material"
    }
  ],

  "causas_y_consecuencias": [
    {
      "causa": "what happens first",
      "mecanismo": "how that cause produces the effect",
      "consecuencia": "what happens next",
      "importancia": "why it matters"
    }
  ],

  "formulas_y_variables": [
    {
      "formula": "exact formula if present",
      "variables": [
        { "simbolo": "symbol", "significado": "what it represents" }
      ],
      "para_que_sirve": "what it calculates or explains",
      "ejemplo_uso": "brief example if supported by the chunk"
    }
  ],

  "personas_fechas_datos": [
    {
      "dato": "person, date, place, award, number or concrete fact",
      "explicacion": "why it appears and why it matters"
    }
  ],

  "ejemplos_del_material": [
    {
      "ejemplo": "example or case mentioned",
      "que_demuestra": "what that example teaches"
    }
  ],

  "relaciones_internas": [
    {
      "idea_a": "idea A",
      "idea_b": "idea B",
      "relacion": "how they connect inside the SAME material"
    }
  ],

  "errores_o_confusiones": [
    {
      "confusion": "likely misunderstanding",
      "correccion": "correct way to understand it",
      "mini_ejemplo": "brief example"
    }
  ],

  "preguntas_examen_chunk": [
    {
      "pregunta": "deep question a professor could ask about this chunk",
      "respuesta_esperada": "ideal 2-4 sentence answer"
    }
  ],

  "orden_para_ensenar": [
    "teach this first",
    "then this",
    "then this"
  ],

  "no_omitir": [
    "concrete details from the chunk that must NOT be lost in the final class"
  ]
}

Chunk:
${text}`;
}


function compactExtractedKnowledge(extracted: any[]) {
  const out = {
    temas: [] as string[],
    ideas: [] as string[],
    vocabulario: [] as string[],
    causas: [] as string[],
    procesos: [] as string[],
    formulas: [] as string[],
    relaciones: [] as string[],
    ejemplos: [] as string[],
    datos: [] as string[],
    confusiones: [] as string[],
    preguntas: [] as string[],
    orden: [] as string[],
    noOmitir: [] as string[],
  };

  const push = (arr: string[], value: any) => {
    const text = formatStudyText(value);
    if (!text || isPlaceholderText(text)) return;
    const key = text.toLowerCase();
    if (!arr.some((x) => x.toLowerCase() === key)) arr.push(text);
  };

  for (const e of extracted || []) {
    push(out.temas, e?.tema_principal);

    for (const x of e?.puntos_del_fragmento || []) {
      push(out.ideas, `${x.punto}: ${x.explicacion || ''}${x.tipo ? ` Tipo: ${x.tipo}` : ''}`);
      push(out.noOmitir, `${x.punto}: ${x.explicacion || ''}`);
    }

    for (const x of e?.conceptos || []) {
      push(out.ideas, `${x.nombre}: ${x.definicion_clara || ''}. ${x.explicacion_profesor || ''}${x.nivel ? ` Nivel: ${x.nivel}` : ''}`);
    }

    for (const x of e?.ideas_nucleares || []) {
      push(out.ideas, `${x.idea}: ${x.explicacion}${x.por_que_importa ? ` Importancia: ${x.por_que_importa}` : ''}`);
    }

    for (const x of e?.elementos_clave || []) {
      push(out.ideas, `${x.elemento}: ${x.explicacion || ''}${x.importancia ? ` Importancia: ${x.importancia}` : ''}`);
    }

    for (const x of e?.vocabulario_tecnico || []) {
      push(out.vocabulario, `${x.termino}: ${x.definicion || ''}${x.contexto ? ` Contexto: ${x.contexto}` : ''}${x.como_recordarlo ? ` Recordatorio: ${x.como_recordarlo}` : ''}`);
    }

    for (const x of e?.causas_y_consecuencias || []) {
      push(out.causas, `${x.causa} → ${x.consecuencia}. ${x.mecanismo || x.explicacion || ''}${x.importancia ? ` Importancia: ${x.importancia}` : ''}`);
    }

    for (const x of e?.procesos_paso_a_paso || []) {
      const pasos = Array.isArray(x.pasos) ? x.pasos.join(' → ') : '';
      push(out.procesos, `${x.nombre}: ${pasos}${x.resultado ? ` Resultado: ${x.resultado}` : ''}${x.por_que_importa ? ` Importancia: ${x.por_que_importa}` : ''}`);
    }

    for (const x of e?.procesos || []) {
      const pasos = Array.isArray(x.pasos) ? x.pasos.join(' → ') : '';
      push(out.procesos, `${x.nombre}: ${pasos}${x.resultado ? ` Resultado: ${x.resultado}` : ''}`);
    }

    for (const x of e?.formulas_y_variables || []) {
      const formulaRaw = formatStudyText(x?.formula);
      const vars = Array.isArray(x.variables)
        ? x.variables
            .map((v: any) => `${formatStudyText(v?.simbolo)}=${formatStudyText(v?.significado)}`)
            .filter((v: string) =>
              v &&
              !/no aplica/i.test(v) &&
              !/no hay/i.test(v) &&
              !/no se menciona/i.test(v)
            )
            .join(', ')
        : '';

      const interpretacion = x.interpretacion_profunda ? ` Interpretación: ${x.interpretacion_profunda}` : '';
      const formulaLine = formatStudyText(`${formulaRaw}: ${vars}. Sirve para: ${x.para_que_sirve || ''}${x.ejemplo_uso ? ` Ejemplo: ${x.ejemplo_uso}` : ''}${interpretacion}`);

      if (
        !formulaRaw ||
        formulaRaw === '=' ||
        /no aplica/i.test(formulaLine) ||
        /no hay/i.test(formulaLine) ||
        /no se menciona/i.test(formulaLine)
      ) {
        continue;
      }

      push(out.formulas, formulaLine);
    }

    for (const x of e?.relaciones_internas || []) {
      push(out.relaciones, `${x.idea_a} → ${x.idea_b}: ${x.relacion}`);
    }

    for (const x of e?.relaciones || []) {
      push(out.relaciones, `${x.de} → ${x.a}: ${x.como}`);
    }

    for (const x of e?.ejemplos_del_material || []) {
      push(out.ejemplos, `${x.ejemplo}: ${x.que_demuestra}`);
    }

    for (const x of e?.ejemplos || []) {
      push(out.ejemplos, `${x.titulo}: ${x.explicacion}`);
    }

    for (const x of e?.personas_fechas_datos || []) {
      push(out.datos, `${x.dato}: ${x.explicacion}`);
    }

    for (const x of e?.datos_importantes || []) {
      push(out.datos, x);
    }

    for (const x of e?.errores_o_confusiones || []) {
      push(out.confusiones, `${x.confusion}: ${x.correccion}${x.mini_ejemplo ? ` Ejemplo: ${x.mini_ejemplo}` : ''}`);
    }

    for (const x of e?.confusiones || []) {
      push(out.confusiones, `${x.error}: ${x.correccion}`);
    }

    for (const x of e?.preguntas_examen_chunk || []) {
      push(out.preguntas, `${x.pregunta} Respuesta esperada: ${x.respuesta_esperada}`);
    }

    for (const x of e?.orden_para_ensenar || []) {
      push(out.orden, x);
    }

    for (const x of e?.no_omitir || []) {
      push(out.noOmitir, x);
    }
  }

  return {
    temas: out.temas.slice(0, 20),
    ideas: out.ideas.slice(0, 120),
    vocabulario: out.vocabulario.slice(0, 100),
    causas: out.causas.slice(0, 80),
    procesos: out.procesos.slice(0, 70),
    formulas: out.formulas.slice(0, 40),
    relaciones: out.relaciones.slice(0, 90),
    ejemplos: out.ejemplos.slice(0, 60),
    datos: out.datos.slice(0, 100),
    confusiones: out.confusiones.slice(0, 50),
    preguntas: out.preguntas.slice(0, 60),
    orden: out.orden.slice(0, 80),
    noOmitir: out.noOmitir.slice(0, 120),
  };
}

function synthPromptA(lang: 'es' | 'en', materialName: string, extracted: any[], masteryCtx: any = null): string {
  const compact = compactExtractedKnowledge(extracted);
const priorityData = JSON.stringify({
  ideas: compact.ideas,
  procesos: compact.procesos,
  formulas: compact.formulas,
  relaciones: compact.relaciones,
  datos: compact.datos,
  noOmitir: compact.noOmitir,
  ejemplos: compact.ejemplos,
  causas: compact.causas,
});
const data = priorityData.length > 45000
  ? priorityData.slice(0, 45000)
  : priorityData;

  const adaptiveBlockA = masteryCtx ? [
    '',
    'PERFIL DEL ESTUDIANTE (adapta la clase según esto):',
    'Dominio general: ' + (masteryCtx.overallMastery ?? 0) + '%',
    'Comprension: ' + (masteryCtx.understanding ?? 0) + '% | Memoria: ' + (masteryCtx.memory ?? 0) + '% | Aplicacion: ' + (masteryCtx.application ?? 0) + '%',
    masteryCtx.criticalConcepts?.length ? 'CONCEPTOS CRITICOS (< 20%) - explica estos con maxima profundidad: ' + masteryCtx.criticalConcepts.join(', ') : '',
    masteryCtx.weakConcepts?.length ? 'CONCEPTOS DEBILES (< 40%) - enfoca aqui la clase: ' + masteryCtx.weakConcepts.join(', ') : '',
    masteryCtx.strongConcepts?.length ? 'CONCEPTOS DOMINADOS - no repetir basicos: ' + masteryCtx.strongConcepts.join(', ') : '',
    masteryCtx.repeatedMistakes?.length ? 'ERRORES REPETIDOS - corregir explicitamente: ' + masteryCtx.repeatedMistakes.join(', ') : '',
    masteryCtx.studentProfile === 'beginner' ? 'INSTRUCCION: Empieza desde cero, usa analogias simples, no asumas conocimiento previo.' : '',
    masteryCtx.studentProfile === 'memorizer' ? 'INSTRUCCION: El estudiante memoriza pero no conecta. Enfoca en relaciones causales y aplicaciones.' : '',
    masteryCtx.studentProfile === 'understander' ? 'INSTRUCCION: El estudiante entiende pero olvida. Enfoca en patrones memorables y ejemplos concretos.' : '',
    masteryCtx.studentProfile === 'advanced' ? 'INSTRUCCION: Estudiante avanzado. Sube el nivel, integra conceptos, usa casos complejos.' : '',
    '',
  ].filter(Boolean).join('\n') : '';

  if (lang === 'es') return `Eres Profesor ALAI 10/10 de StudyAL.

${adaptiveBlockA}

MISIÓN ÚNICA:
Construir una clase que enseñe de verdad, no que resuma.
La clase debe girar alrededor de UN PROBLEMA CENTRAL que el material intenta resolver.
Todo lo demás (conceptos, fórmulas, procesos, personas) existe para responder ese problema.

PASO 1 — ANTES DE ESCRIBIR, IDENTIFICA:
A) ¿Cuál es el problema o pregunta central del material? (Lo que no se podía explicar antes)
B) ¿Cuál es la solución o idea principal que lo resuelve?
C) ¿Qué evidencia o mecanismo demuestra que funciona?
D) ¿Qué consecuencias tuvo esa solución?

PASO 2 — ESTRUCTURA OBLIGATORIA DE LA CLASE:
Parte 1: El problema que nadie podía resolver (contexto + limitación anterior)
Parte 2: La solución propuesta (idea central, quién la propuso y cómo)
Parte 3: El mecanismo exacto (cómo funciona paso a paso)
Parte 4: La evidencia que lo prueba (espectro, experimento, dato concreto del material)
Parte 5: Las fórmulas explicadas de verdad (cada variable, el signo, qué pasa cuando cambia n)
Parte 6+: Consecuencias e impacto (solo lo que el material desarrolla, no menciones de pasada)

REGLAS DE ORO:
1. CADA CONCEPTO APARECE EN UNA SOLA PARTE. Si ya explicaste Copenhague en Parte 3, no lo repitas en Parte 5.
2. La Parte 1 debe empezar con el problema, no con la biografía del científico.
3. Las fórmulas deben explicarse con precisión: si Eₙ = -13.6/n², debes decir que cuando n=1 la energía es -13.6 eV, cuando n=2 es -3.4 eV, y que el signo negativo significa que el electrón está LIGADO (no que la energía sea menor).
4. Si algo se menciona brevemente en el material (ej: energía nuclear en una oración), mencionarlo en UNA oración dentro de otra parte, NO como capítulo propio.
5. El espectro del hidrógeno es evidencia clave — si aparece en el material, debe tener su propia parte explicando POR QUÉ antes no se podía explicar y CÓMO el modelo lo resolvió.
6. PROHIBIDO repetir la misma idea con otras palabras en partes distintas.
7. PROHIBIDO inventar relaciones que el material no establece explícitamente.
8. Cada parte debe enseñar algo NUEVO que las partes anteriores no enseñaron.

TONO OBLIGATORIO — así debe sonar cada explicación:
❌ MAL: "La interpretación de Copenhague propone que las partículas no tienen propiedades definidas hasta que son observadas."
✅ BIEN: "Imagina que disparas un electrón hacia una pantalla con dos ranuras. Según la física clásica, el electrón debería pasar por una u otra ranura. Pero el experimento muestra que pasa por las dos al mismo tiempo, como si fuera una onda. Solo cuando lo mides, el electrón 'elige' una ranura. Eso es lo que Bohr y sus colegas intentaban explicar: la realidad subatómica no existe de forma definida hasta que la observamos."

Material: ${materialName}

CONOCIMIENTO EXTRAÍDO:
${data}

Devuelve SOLO JSON válido:
{
  "titulo": "Título claro de 4-8 palabras que describe el problema central",
  "objetivos": [
    "Al terminar podrás explicar el problema que Bohr resolvió y cómo lo hizo",
    "Podrás interpretar la fórmula Eₙ con palabras, no solo con números",
    "Entenderás por qué el espectro del hidrógeno fue la prueba clave",
    "Podrás distinguir el modelo de Rutherford del de Bohr y por qué importa la diferencia"
  ],
  "si_no_sabes_nada": "8-10 oraciones que expliquen el PROBLEMA que existía antes de la idea central del material. Empieza con la situación que no se podía explicar. No empieces con la biografía del científico.",
  "mapa_inicial": "6-8 oraciones que muestren la ruta lógica: problema → solución → mecanismo → evidencia → consecuencia. Menciona los conceptos clave en ese orden.",
  "cobertura_material": [
    {
      "elemento": "nombre del concepto central del material",
      "por_que_importa": "una oración que diga exactamente qué resuelve o explica este concepto"
    }
  ],
  "clase_narrativa": [
    {
      "titulo": "Título específico que dice el PROBLEMA o IDEA que enseña esta parte",
      "explicacion": "15-20 oraciones en tono de profesor explicando en voz alta. ESTRUCTURA: 1) situación previa o problema, 2) idea nueva o solución, 3) mecanismo exacto de cómo funciona, 4) ejemplo concreto del material, 5) por qué esto cambia la comprensión. NUNCA repitas conceptos de partes anteriores.",
      "ejemplo": "Ejemplo concreto y específico extraído del material. No genérico.",
      "checkpoint": "Pregunta que obligue a explicar causa→mecanismo→consecuencia, no definición."
    }
  ]
}

CANTIDAD DE PARTES:
- Cuenta los conceptos CENTRALES (no secundarios) en el conocimiento extraído
- 3-5 conceptos centrales → 4-6 partes
- 6-10 conceptos centrales → 7-10 partes  
- 11+ conceptos centrales → 10-14 partes
- Cada parte enseña UN concepto central
- Los conceptos secundarios van en UNA oración dentro de la parte más relevante`;

  return `You are Professor ALAI 10/10 for StudyAL.

GOAL:
Turn extracted knowledge into a CAUSAL AND PROGRESSIVE CLASS.
The student must understand the material, not memorize definitions.

FORBIDDEN:
- Writing Wikipedia-style summaries.
- Making a list of concepts.
- Repeating phrases like "it is important because..." without explanation.
- Repeating the same example.
- Inventing external facts.
- Omitting processes, formulas, dates, symptoms, causes or consequences present in extraction.

MANDATORY METHOD:
For each class part use this logic:
1. What problem or question appears.
2. What new concept is needed.
3. What that concept means in simple words.
4. What happens step by step.
5. What causes what.
6. What consequence it produces.
7. Concrete example.
8. How it connects to the previous part.
9. What the student must remember.

IMPORTANT — CRITICAL RULES:
- USE ONLY information from the EXTRACTED KNOWLEDGE provided. FORBIDDEN to add external data.
- If there are processes, narrate each as a story: what problem existed → what was proposed → how it works → what it solved.
- If there is a formula, explain in words what relationship it describes, what each variable represents and what it allows to calculate.
- If there is history/people, narrate chronology → problem faced → solution proposed → impact.
- If extracted data does not mention something, do NOT include it. Only use what is in the material.
- If a formula does not appear in the extracted material, do NOT include it even if famous.
- Each part must teach ONE single central idea, not several mixed together.

Material: ${materialName}

EXTRACTED KNOWLEDGE:
${data}

Return ONLY valid JSON:
{
  "titulo": "Clear title",
  "objetivos": [
    "By the end you will be able to explain..."
  ],
  "si_no_sabes_nada": "Initial from-zero class in 8-12 sentences. Do not only define: prepare the student's mind and explain the central problem.",
  "mapa_inicial": "8-12 sentence map of the material. Explain the logical order to learn it.",
  "cobertura_material": [
    {
      "elemento": "important concept, fact, formula, process, person, symptom or mechanism",
      "por_que_importa": "why it is needed to understand the material"
    }
  ],
  "clase_narrativa": [
    {
      "titulo": "Pedagogical title for the part",
      "explicacion": "16-24 sentence mini class. Must be causal narrative, not definition. Explain problem, concept, step by step, cause, consequence, example, connection and closure.",
      "ejemplo": "Distinct useful concrete example based on the material.",
      "checkpoint": "Question measuring reasoning, not memory."
    }
  ]
}

MANDATORY COVERAGE:
1. First look at elements in ideas, procesos, formulas, relaciones, datos and noOmitir from extracted knowledge.
2. clase_narrativa must cover almost all of those elements, not only the famous ones.
3. Use this quantitative rule:
   - 1-5 relevant elements: create 3-5 parts.
   - 6-10 relevant elements: create 6-10 parts.
   - 11-20 relevant elements: create 10-15 parts.
   - 21+ relevant elements: create 15-25 parts if the content supports it.
4. Every important noOmitir element must appear at least once inside clase_narrativa.
5. If a REAL formula exists, create a dedicated part interpreting it: meaning, variables and use.
6. If chronology or biography exists, create parts in time order: origin → problem → contribution → consequence → legacy.
7. If a mechanism or process exists, create a dedicated part explaining it step by step.
8. Merge repeated concepts, but do NOT delete unique details.
9. Do NOT create generic sections called "Key point". Each title must say exactly what it teaches.
10. Do NOT call a person, institution, collaboration or historical event a formula.
9. Do not ask 'What is X?' if you can ask cause/consequence.
10. Prefer too much coverage over too much summary.`;
}

function synthPromptB(lang: 'es' | 'en', materialName: string, extracted: any[], masteryCtx: any = null): string {
  const compact = compactExtractedKnowledge(extracted);
const priorityData = JSON.stringify({
  ideas: compact.ideas,
  procesos: compact.procesos,
  formulas: compact.formulas,
  relaciones: compact.relaciones,
  datos: compact.datos,
  noOmitir: compact.noOmitir,
  ejemplos: compact.ejemplos,
  causas: compact.causas,
});
const data = priorityData.length > 45000
  ? priorityData.slice(0, 45000)
  : priorityData;

  const adaptiveBlockB = masteryCtx ? [
    '',
    'PERFIL DEL ESTUDIANTE para consolidacion:',
    masteryCtx.weakConcepts?.length ? 'REFORZAR especialmente: ' + masteryCtx.weakConcepts.join(', ') : '',
    masteryCtx.criticalConcepts?.length ? 'CONCEPTOS CRITICOS que el estudiante NO domina: ' + masteryCtx.criticalConcepts.join(', ') : '',
    masteryCtx.repeatedMistakes?.length ? 'CORREGIR errores repetidos: ' + masteryCtx.repeatedMistakes.join(', ') : '',
    '',
  ].filter(Boolean).join('\n') : '';

  if (lang === 'es') return `Eres Profesor ALAI 10/10. Tu trabajo es consolidar una clase para que el estudiante pueda explicar, aplicar y responder examen.

${adaptiveBlockB}

NO generes preguntas repetidas.
NO generes "qué es X" como pregunta principal.
NO inventes.
NO uses placeholders.

Material: ${materialName}

CONOCIMIENTO EXTRAÍDO:
${data}

Devuelve SOLO JSON válido:
{
  "panorama_completo": "Explicación de 10-14 oraciones que una todo como historia causal. Debe explicar qué ocurre primero, qué ocurre después y por qué importa.",
  "conexiones_clave": [
    {
      "titulo": "Relación causal o lógica importante",
      "explicacion": "Explica cómo una idea produce, explica, limita o conecta con otra."
    }
  ],
  "errores_comunes": [
    {
      "error": "Confusión realista",
      "correccion": "Corrección clara",
      "mini_ejemplo": "Ejemplo breve"
    }
  ],
  "preguntas_profesor": [
    {
      "pregunta": "Pregunta de razonamiento sobre causa, consecuencia, proceso, comparación, fórmula, diagnóstico, tratamiento o aplicación.",
      "que_evalua": "Comprensión específica que evalúa",
      "respuesta_esperada": "Respuesta ideal de 3-5 oraciones"
    }
  ],
  "para_examen": [
    {
      "punto": "Punto que un profesor sí podría preguntar",
      "por_que": "Por qué importa para examen o exposición oral"
    }
  ],
  "ya_puedes_explicar": [
    "Habilidad concreta que el estudiante puede explicar"
  ],
  "resumen_final": "Resumen final de 7-10 oraciones que cierre sin repetir.",
  "preguntas_sugeridas": [
    "Pregunta útil para profundizar"
  ],
  "preguntale_alai": "Puedes preguntarme cualquier duda sobre este material."
}

REGLAS:
- preguntas_profesor deben ser únicas.
- conexiones_clave deben ser pocas pero profundas.
- errores_comunes deben corregir malentendidos reales.
- para_examen debe ser práctico.
- ya_puedes_explicar debe sonar como logro aprendido.
- Si hay fórmulas, incluye preguntas de interpretación.
- Si hay procesos clínicos, incluye preguntas de secuencia y mecanismo.`;

  return `You are Professor ALAI 10/10. Your job is to consolidate a class so the student can explain, apply and answer exam questions.

Do NOT generate repeated questions.
Do NOT generate "what is X" as the main question.
Do NOT invent.
Do NOT use placeholders.

Material: ${materialName}

EXTRACTED KNOWLEDGE:
${data}

Return ONLY valid JSON:
{
  "panorama_completo": "10-14 sentence explanation connecting everything as a causal story. Explain what happens first, what happens next and why it matters.",
  "conexiones_clave": [
    {
      "titulo": "Important causal or logical relationship",
      "explicacion": "Explain how one idea produces, explains, limits or connects to another."
    }
  ],
  "errores_comunes": [
    {
      "error": "Realistic confusion",
      "correccion": "Clear correction",
      "mini_ejemplo": "Brief example"
    }
  ],
  "preguntas_profesor": [
    {
      "pregunta": "Reasoning question about cause, consequence, process, comparison, formula, diagnosis, treatment or application.",
      "que_evalua": "Specific understanding being tested",
      "respuesta_esperada": "Ideal 3-5 sentence answer"
    }
  ],
  "para_examen": [
    {
      "punto": "Point a professor could actually ask",
      "por_que": "Why it matters for exam or oral presentation"
    }
  ],
  "ya_puedes_explicar": [
    "Concrete skill the student can explain"
  ],
  "resumen_final": "Final 7-10 sentence summary that closes without repetition.",
  "preguntas_sugeridas": [
    "Useful question for going deeper"
  ],
  "preguntale_alai": "You can ask me any question about this material."
}

RULES:
- preguntas_profesor must be unique.
- conexiones_clave must be few but deep.
- errores_comunes must correct real misunderstandings.
- para_examen must be practical.
- ya_puedes_explicar must sound like a learned achievement.
- If there are formulas, include interpretation questions.
- If there are clinical processes, include sequence and mechanism questions.`;
}

function multiMaterialPrompt(lang: 'es' | 'en', analyses: any[]): string {
  const data = JSON.stringify(analyses.map((a) => ({
    materialName: a.materialName,
    titulo: a.titulo,
    objetivos: a.objetivos,
    cobertura_material: a.cobertura_material,
    clase_narrativa: a.clase_narrativa,
    panorama_completo: a.panorama_completo || a.historia_completa,
    para_examen: a.para_examen || a.examen,
    resumen_final: a.resumen_final_profesor || a.resumen_30s,
  }))).slice(0, 34000);

  if (lang === 'es') return `Eres Profesor ALAI 10/10. El estudiante seleccionó VARIOS materiales.

Tu tarea:
1. NO mezclarlos artificialmente.
2. Enseñar cada material como una clase separada.
3. Solo mencionar conexiones si son explícitas o académicamente evidentes.
4. Mantener cobertura alta de cada material.
5. Evitar que el estudiante confunda temas sin relación.

Análisis completos por material:
${data}

Devuelve SOLO JSON válido:
{
  "titulo": "Clase completa de varios materiales",
  "objetivos": ["Qué podrá explicar el estudiante al terminar"],
  "si_no_sabes_nada": "Explica en 8-12 oraciones que hay varios materiales, qué trata cada uno y cómo estudiarlos sin confundirlos.",
  "mapa_inicial": "Mapa de 10-14 oraciones: material por material, qué enseña cada uno y si existe o no relación real entre ellos.",
  "cobertura_material": [
    { "elemento": "Material: elemento importante", "por_que_importa": "qué aporta para entender ese material" }
  ],
  "clase_narrativa": [
    {
      "titulo": "Material 1: título de la clase",
      "explicacion": "Clase de 14-22 oraciones sobre este material. Enseña contexto, ideas centrales, causas, consecuencias, ejemplos y cierre. No lo mezcles con otros materiales.",
      "ejemplo": "Ejemplo propio de este material.",
      "checkpoint": "Pregunta de comprensión de este material."
    }
  ],
  "panorama_completo": "Explica en 10-14 oraciones cómo estudiar todos los materiales juntos. Si no hay relación directa, dilo claramente y enseña a separarlos mentalmente.",
  "conexiones_clave": [],
  "errores_comunes": [
    { "error": "Confusión probable", "correccion": "Corrección", "mini_ejemplo": "Ejemplo rápido" }
  ],
  "preguntas_profesor": [
    { "pregunta": "Pregunta por material o comparación válida", "que_evalua": "qué mide", "respuesta_esperada": "respuesta ideal" }
  ],
  "para_examen": [
    { "punto": "idea clave de un material", "por_que": "por qué importa" }
  ],
  "ya_puedes_explicar": ["qué puede explicar ahora el estudiante"],
  "resumen_final": "Resumen final de 8-10 oraciones.",
  "preguntas_sugeridas": ["pregunta útil"],
  "preguntale_alai": "Puedes preguntarme cualquier duda sobre este material."
}

REGLAS:
- Si los materiales no tienen relación directa, dilo sin inventar conexión.
- Cada material seleccionado debe tener su propia parte en clase_narrativa.
- No reduzcas cada material a una sola frase.
- Cubre lo más importante de cada material.
- Enseña, no solo resumas.`;

  return `You are Professor ALAI 10/10. The student selected MULTIPLE materials.

Your task:
1. Do NOT artificially mix them.
2. Teach each material as a separate class.
3. Mention connections only if explicit or academically evident.
4. Keep high coverage for each material.
5. Prevent the student from confusing unrelated topics.

Complete per-material analyses:
${data}

Return ONLY valid JSON with Spanish keys:
{
  "titulo": "Complete class for multiple materials",
  "objetivos": ["What the student can explain by the end"],
  "si_no_sabes_nada": "Explain in 8-12 sentences that there are multiple materials, what each is about and how to study them without confusion.",
  "mapa_inicial": "10-14 sentence map: material by material, what each teaches and whether there is a real relationship between them.",
  "cobertura_material": [
    { "elemento": "Material: important element", "por_que_importa": "what it contributes to understanding that material" }
  ],
  "clase_narrativa": [
    {
      "titulo": "Material 1: class title",
      "explicacion": "14-22 sentence class about this material. Teach context, central ideas, causes, consequences, examples and closure. Do not mix with other materials.",
      "ejemplo": "Example from this material.",
      "checkpoint": "Understanding question for this material."
    }
  ],
  "panorama_completo": "Explain in 10-14 sentences how to study all materials together. If there is no direct relationship, say so clearly and teach how to separate them mentally.",
  "conexiones_clave": [],
  "errores_comunes": [
    { "error": "Likely confusion", "correccion": "Correction", "mini_ejemplo": "Quick example" }
  ],
  "preguntas_profesor": [
    { "pregunta": "Question per material or valid comparison", "que_evalua": "what it measures", "respuesta_esperada": "ideal answer" }
  ],
  "para_examen": [
    { "punto": "key idea from one material", "por_que": "why it matters" }
  ],
  "ya_puedes_explicar": ["what the student can now explain"],
  "resumen_final": "Final 8-10 sentence summary.",
  "preguntas_sugeridas": ["useful question"],
  "preguntale_alai": "You can ask me any question about this material."
}

RULES:
- If materials are unrelated, say so without inventing a connection.
- Each selected material must have its own part in clase_narrativa.
- Do not reduce each material to one sentence.
- Cover the most important parts of each material.
- Teach, do not only summarize.`;
}


function simpleSynthPromptA(lang: 'es' | 'en', materialName: string, compact: any): string {
  const data = JSON.stringify(compact);

  if (lang === 'es') return `Devuelve SOLO JSON válido. Sin markdown.

Crea una clase clara basada SOLO en estos datos extraídos.

Material: ${materialName}
Datos:
${data}

JSON:
{
  "titulo": "Profesor ALAI",
  "objetivos": ["objetivo 1", "objetivo 2", "objetivo 3"],
  "si_no_sabes_nada": "Explicación inicial clara de 5-8 oraciones.",
  "mapa_inicial": "Mapa del tema de 5-8 oraciones.",
  "cobertura_material": [
    { "elemento": "elemento importante", "por_que_importa": "por qué importa" }
  ],
  "clase_narrativa": [
    {
      "titulo": "título",
      "explicacion": "Clase clara de 8-12 oraciones. Explica paso a paso, causa y consecuencia.",
      "ejemplo": "ejemplo",
      "checkpoint": "pregunta de comprensión"
    }
  ]
}`;

  return `Return ONLY valid JSON. No markdown.

Create a clear class based ONLY on this extracted data.

Material: ${materialName}
Data:
${data}

JSON:
{
  "titulo": "Professor ALAI",
  "objetivos": ["objective 1", "objective 2", "objective 3"],
  "si_no_sabes_nada": "Clear initial 5-8 sentence explanation.",
  "mapa_inicial": "5-8 sentence topic map.",
  "cobertura_material": [
    { "elemento": "important element", "por_que_importa": "why it matters" }
  ],
  "clase_narrativa": [
    {
      "titulo": "title",
      "explicacion": "Clear 8-12 sentence class. Explain step by step, cause and consequence.",
      "ejemplo": "example",
      "checkpoint": "understanding question"
    }
  ]
}`;
}

function simpleSynthPromptB(lang: 'es' | 'en', materialName: string, compact: any): string {
  const data = JSON.stringify(compact);

  if (lang === 'es') return `Devuelve SOLO JSON válido. Sin markdown.

Consolida esta clase basada SOLO en estos datos.

Material: ${materialName}
Datos:
${data}

JSON:
{
  "panorama_completo": "Explicación completa de 6-10 oraciones.",
  "conexiones_clave": [
    { "titulo": "conexión", "explicacion": "explicación" }
  ],
  "errores_comunes": [
    { "error": "error común", "correccion": "corrección", "mini_ejemplo": "ejemplo" }
  ],
  "preguntas_profesor": [
    { "pregunta": "pregunta profunda", "que_evalua": "qué evalúa", "respuesta_esperada": "respuesta esperada" }
  ],
  "para_examen": [
    { "punto": "punto clave", "por_que": "por qué importa" }
  ],
  "ya_puedes_explicar": ["algo que puedes explicar"],
  "resumen_final": "Resumen final de 5-7 oraciones.",
  "preguntas_sugeridas": ["pregunta sugerida"],
  "preguntale_alai": "Puedes preguntarme cualquier duda sobre este material."
}`;

  return `Return ONLY valid JSON. No markdown.

Consolidate this class based ONLY on this data.

Material: ${materialName}
Data:
${data}

JSON:
{
  "panorama_completo": "Complete 6-10 sentence explanation.",
  "conexiones_clave": [
    { "titulo": "connection", "explicacion": "explanation" }
  ],
  "errores_comunes": [
    { "error": "common mistake", "correccion": "correction", "mini_ejemplo": "example" }
  ],
  "preguntas_profesor": [
    { "pregunta": "deep question", "que_evalua": "what it evaluates", "respuesta_esperada": "expected answer" }
  ],
  "para_examen": [
    { "punto": "key point", "por_que": "why it matters" }
  ],
  "ya_puedes_explicar": ["something you can explain"],
  "resumen_final": "Final 5-7 sentence summary.",
  "preguntas_sugeridas": ["suggested question"],
  "preguntale_alai": "You can ask me any question about this material."
}`;
}


async function safeAlaiJson(prompt: string, maxTokens = 5000) {
  try {
    return await alaiJson({
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.25,
      maxTokens,
      json: true,
    });
  } catch (firstError: any) {
    console.warn('⚠️ safeAlaiJson json=true falló:', firstError?.message || firstError);

    try {
      return await alaiJson({
        messages: [{
          role: 'user',
          content: `${prompt}

IMPORTANTE FINAL:
Devuelve SOLO JSON válido.
No uses markdown.
No uses explicaciones fuera del JSON.
No uses comillas sin escapar dentro de strings.
Si no sabes un campo, usa [] o "" según corresponda.`,
        }],
        temperature: 0.15,
        maxTokens: Math.min(maxTokens, 5200),
        json: true,
      });
    } catch (secondError: any) {
      console.warn('⚠️ safeAlaiJson segundo intento falló:', secondError?.message || secondError);
      return null;
    }
  }
}


// ── Prompts ────────────────────────────────────────────────────
const REGLAS = (lang: 'es' | 'en') => lang === 'es'
  ? `REGLAS OBLIGATORIAS:
0. BASA TODO en el material enviado. PROHIBIDO inventar datos externos.
1. Actúa como Profesor ALAI: enseña como tutor particular, no como diccionario.
2. Asume que el estudiante NO sabe nada del tema.
3. Define términos técnicos la primera vez que aparezcan.
4. Explica el material como una historia mental: contexto → base → desarrollo → conexiones → conclusión.
5. Cubre el 100% de las ideas, nombres, procesos, fórmulas, fechas, ejemplos o personajes importantes del material seleccionado.
6. No hagas listas de definiciones aisladas.
7. No copies literal el material. Reescribe con tus palabras.
8. No uses relleno ni frases genéricas.
9. Cada sección debe hacer que el estudiante pueda explicar el tema con sus propias palabras.
10. Devuelve SOLO JSON válido. Sin markdown, sin texto extra.`
  : `MANDATORY RULES:
0. BASE EVERYTHING on the provided material. FORBIDDEN to invent external data.
1. Act as Professor ALAI: teach like a private tutor, not like a dictionary.
2. Assume the student knows nothing about the topic.
3. Define technical terms the first time they appear.
4. Explain the material as a mental story: context → foundation → development → connections → conclusion.
5. Cover 100% of the important ideas, names, processes, formulas, dates, examples or people in the selected material.
6. Do not make isolated definition lists.
7. Do not copy the material verbatim. Rewrite in your own words.
8. Avoid filler and generic phrases.
9. Every section must help the student explain the topic in their own words.
10. Return ONLY valid JSON. No markdown, no extra text.`;

function promptA(lang: 'es' | 'en', text: string): string {
  const reglas = REGLAS(lang);
  if (lang === 'es') return `Eres Profesor ALAI, el profesor IA de StudyAL.

El estudiante ya repasó el material. Ahora tu misión es que lo ENTIENDA completo.

NO conviertas el material en "concepto → definición".
Construye una clase real, como si te sentaras con el estudiante y le explicaras el tema desde cero hasta que pueda enseñárselo a otra persona.

${reglas}

Material seleccionado:
${text.slice(0, 30000)}

Devuelve EXACTAMENTE este JSON:
{
  "titulo": "Título claro de 4-8 palabras",
  "objetivos": [
    "Al terminar podrás explicar...",
    "..."
  ],
  "si_no_sabes_nada": "Explicación inicial de 6-9 oraciones. Empieza desde cero. Si el tema requiere contexto previo, explícalo aquí. Debe sentirse como un profesor diciendo: 'antes de entrar al tema, entiende esto'.",
  "mapa_inicial": "Explica en 6-9 oraciones qué intenta enseñar TODO el material, cuál es la idea central y por qué importa.",
  "cobertura_material": [
    {
      "elemento": "Idea, persona, término, proceso, fecha, fórmula o ejemplo importante del material",
      "por_que_importa": "Por qué este elemento es necesario para entender el material completo"
    }
  ],
  "clase_narrativa": [
    {
      "titulo": "Parte 1: título natural de la explicación",
      "explicacion": "Explicación narrativa de 7-10 oraciones. No definas solamente: enseña el qué, el por qué, el cómo y cómo se relaciona con lo anterior.",
      "ejemplo": "Ejemplo concreto basado en el material.",
      "checkpoint": "Pregunta corta para que el estudiante compruebe si entendió esta parte."
    }
  ]
}

REQUISITOS:
- objetivos: 4 a 8.
- cobertura_material: incluye TODOS los elementos importantes del material seleccionado.
- clase_narrativa: 4 a 8 partes que se lean como una clase continua, no como fichas sueltas.
- La primera parte debe dar contexto.
- Las partes intermedias deben desarrollar el tema.
- La última parte debe cerrar la idea central.
- Si el material menciona nombres/personajes/fórmulas/procesos, deben aparecer en cobertura_material y dentro de la clase_narrativa.
- Evita títulos como "Identidad única" si no estás explicando primero el contexto completo.`;

  return `You are Professor ALAI, StudyAL's AI teacher.

The student has reviewed the material. Now your mission is to make them fully UNDERSTAND it.

Do NOT turn the material into "concept → definition".
Build a real class, as if you sat with the student and explained the topic from zero until they can teach it to someone else.

${reglas}

Selected material:
${text.slice(0, 30000)}

Return EXACTLY this JSON:
{
  "titulo": "Clear 4-8 word title",
  "objetivos": [
    "By the end you will be able to explain...",
    "..."
  ],
  "si_no_sabes_nada": "Initial explanation in 6-9 sentences. Start from zero. If the topic needs prior context, explain it here. It should feel like a teacher saying: 'before entering the topic, understand this'.",
  "mapa_inicial": "Explain in 6-9 sentences what ALL the material is trying to teach, what the central idea is, and why it matters.",
  "cobertura_material": [
    {
      "elemento": "Important idea, person, term, process, date, formula or example from the material",
      "por_que_importa": "Why this element is necessary to understand the whole material"
    }
  ],
  "clase_narrativa": [
    {
      "titulo": "Part 1: natural explanation title",
      "explicacion": "Narrative explanation of 7-10 sentences. Don't just define: teach what, why, how, and how it connects to what came before.",
      "ejemplo": "Concrete example based on the material.",
      "checkpoint": "Short question for the student to check understanding."
    }
  ]
}

REQUIREMENTS:
- objetivos: 4 to 8.
- cobertura_material: include ALL important elements from the selected material.
- clase_narrativa: 4 to 8 parts that read like a continuous class, not disconnected cards.
- First part gives context.
- Middle parts develop the topic.
- Last part closes the central idea.
- If the material mentions names/people/formulas/processes, they must appear in cobertura_material and inside clase_narrativa.
- Avoid titles like "Unique identity" if you have not explained the full context first.`;
}

function promptB(lang: 'es' | 'en', text: string): string {
  const reglas = REGLAS(lang);
  if (lang === 'es') return `Eres Profesor ALAI. Genera la segunda parte de una clase para que el estudiante consolide el material completo.

${reglas}

Material seleccionado:
${text.slice(0, 30000)}

Devuelve EXACTAMENTE este JSON:
{
  "panorama_completo": "Une TODO el material en una sola explicación de 8-12 oraciones. Debe sentirse como: 'ahora que viste las piezas, así encaja todo'.",
  "conexiones_clave": [
    {
      "titulo": "Conexión importante",
      "explicacion": "Explica cómo se conectan varias ideas del material y por qué esa relación cambia la comprensión del tema."
    }
  ],
  "errores_comunes": [
    {
      "error": "Confusión probable del estudiante",
      "correccion": "Cómo debe entenderlo correctamente",
      "mini_ejemplo": "Ejemplo rápido que corrige la confusión"
    }
  ],
  "preguntas_profesor": [
    {
      "pregunta": "Pregunta tipo profesor que obligue a pensar, no a memorizar",
      "que_evalua": "Qué comprensión está midiendo",
      "respuesta_esperada": "Respuesta ideal en 2-4 oraciones"
    }
  ],
  "para_examen": [
    {
      "punto": "Idea clave que debe recordar",
      "por_que": "Por qué importa para una prueba, presentación o explicación oral"
    }
  ],
  "ya_puedes_explicar": [
    "Cosa concreta que el estudiante debería poder explicar con sus palabras"
  ],
  "resumen_final": "Resumen final de 5-7 oraciones que cierre la clase de forma clara.",
  "preguntas_sugeridas": [
    "Pregunta útil que el estudiante podría hacerle a ALAI"
  ],
  "preguntale_alai": "Puedes preguntarme cualquier duda sobre este material."
}

REQUISITOS:
- panorama_completo debe unir el material como sistema, no repetir conceptos.
- preguntas_profesor deben medir comprensión real.
- errores_comunes no debe venir vacío si hay al menos una confusión probable.
- para_examen debe ser práctico.
- ya_puedes_explicar debe cerrar la sensación de aprendizaje.
- preguntas_sugeridas deben ayudar a estudiar mejor.
- No repitas lo mismo con otras palabras.`;

  return `You are Professor ALAI. Generate the second half of a class so the student consolidates the whole material.

${reglas}

Selected material:
${text.slice(0, 30000)}

Return EXACTLY this JSON:
{
  "panorama_completo": "Connect ALL the material into one explanation of 8-12 sentences. It should feel like: 'now that you saw the pieces, this is how everything fits'.",
  "conexiones_clave": [
    {
      "titulo": "Important connection",
      "explicacion": "Explain how several ideas from the material connect and why that relationship changes understanding."
    }
  ],
  "errores_comunes": [
    {
      "error": "Likely student confusion",
      "correccion": "How it should be understood correctly",
      "mini_ejemplo": "Quick example that corrects the confusion"
    }
  ],
  "preguntas_profesor": [
    {
      "pregunta": "Teacher-style question that forces thinking, not memorization",
      "que_evalua": "What understanding it measures",
      "respuesta_esperada": "Ideal answer in 2-4 sentences"
    }
  ],
  "para_examen": [
    {
      "punto": "Key idea to remember",
      "por_que": "Why it matters for a test, presentation or oral explanation"
    }
  ],
  "ya_puedes_explicar": [
    "Concrete thing the student should now be able to explain in their own words"
  ],
  "resumen_final": "Final summary of 5-7 sentences that closes the class clearly.",
  "preguntas_sugeridas": [
    "Useful question the student could ask ALAI"
  ],
  "preguntale_alai": "You can ask me any question about this material."
}

REQUIREMENTS:
- panorama_completo must connect the material as a system, not repeat concepts.
- preguntas_profesor must measure real understanding.
- errores_comunes must not be empty if there is at least one likely confusion.
- para_examen must be practical.
- ya_puedes_explicar must close the learning experience.
- preguntas_sugeridas must help studying.
- Do not repeat the same thing in different words.`;
}




function formatStudyText(value: any): string {
  let t = String(value || '');

  t = t.replace(/\^2/g, '²');
  t = t.replace(/\^3/g, '³');
  t = t.replace(/\bDelta\b/gi, 'Δ');
  t = t.replace(/lambda/gi, 'λ');
  t = t.replace(/\bnu\b/gi, 'ν');

  return t
    .replace(/\bE_n\b/g, 'Eₙ')
    .replace(/n\^2/g, 'n²')
    .replace(/c\^2/g, 'c²')
    .replace(/\\frac\s*\{([^{}]+)\}\s*\{([^{}]+)\}/g, '$1 / $2')
    .replace(/-rac\{?13\.6\s*(?:ext\{\s*)?eV\s*(?:\})?\}?\{?n\^?2\}?/gi, '-13.6 eV / n²')
    .replace(/ext\{\s*eV\s*\}/gi, 'eV')
    .replace(/No hay fórmulas en este fragmento\.?:?[^.]*\.?/gi, '')
    .replace(/No se menciona una fórmula específica[^.]*\.?/gi, '')
    .replace(/\s+\/\s+n\^2/g, ' / n²')
    .replace(/\s+/g, ' ')
    .trim();
}


function isPlaceholderText(value: any): boolean {
  const t = String(value || '').trim().toLowerCase();
  if (!t) return true;

  const bad = [
    'confusión probable',
    'corrección',
    'ejemplo rápido',
    'idea clave de un material',
    'por qué importa',
    'pregunta por material o comparación válida',
    'qué mide',
    'respuesta ideal',
    'qué puede explicar ahora el estudiante',
    'pregunta útil',
    'conexión importante',
    'important connection',
    'likely confusion',
    'correction',
    'quick example',
    'key idea from one material',
    'why it matters',
    'question per material or valid comparison',
    'what it measures',
    'ideal answer',
    'what the student can now explain',
    'useful question',
  ];

  return bad.includes(t) || /^material \d+:\s*tema$/i.test(t);
}

function goodText(value: any, min = 8): string {
  const t = formatStudyText(value);
  return !isPlaceholderText(t) && t.length >= min ? t : '';
}


function normalizeLessonTitle(title: string): string {
  return String(title || '')
    .replace(/^Parte\s*\d+:\s*/i, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function dedupeNarrativeSections(parts: any[]) {
  const seen = new Set<string>();

  return parts.filter((p) => {
    const key = normalizeLessonTitle(p?.titulo);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function uniqueByText<T>(items: T[], getText: (item: T) => string): T[] {
  const seen = new Set<string>();
  const out: T[] = [];

  for (const item of items) {
    const key = getText(item).toLowerCase().replace(/\s+/g, ' ').trim();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }

  return out;
}

function buildMultiMaterialAnalisis({
  perMaterial,
  materialNames,
  detectedLang,
}: {
  perMaterial: any[];
  materialNames: string[];
  detectedLang: 'es' | 'en';
}) {
  const isEs = detectedLang === 'es';

  const objetivos = uniqueByText(
    perMaterial.flatMap((a, i) =>
      (a.objetivos || []).map((x: string) => `${materialNames[i]}: ${x}`),
    ).filter((x: string) => goodText(x, 12)),
    (x) => x,
  ).slice(0, 24);

  
const BIOGRAPHY_RE = /\b(naci[oó]|nacimiento|familia|ciudad|universidad|university|premio nobel|nobel prize|copenhagen|dinamarca)\b/i;

const cobertura_material = uniqueByText(
    perMaterial.flatMap((a, i) =>
      (a.cobertura_material || []).map((x: any) => ({
        elemento: `${materialNames[i]}: ${x.elemento}`,
        por_que_importa: x.por_que_importa,
      })),
    ).filter((x: any) => goodText(x.elemento, 5) && goodText(x.por_que_importa, 10)),
    (x: any) => `${x.elemento} ${x.por_que_importa}`,
  ).slice(0, 120);

  const clase_narrativa = perMaterial.flatMap((a, i) =>
    (a.clase_narrativa || []).map((c: any, idx: number) => ({
      titulo: `${materialNames[i]} — ${String(c.titulo || '').replace(/^Parte\s*\d+:\s*/i, '').trim()}`,
      explicacion: c.explicacion,
      ejemplo: c.ejemplo,
      checkpoint: c.checkpoint,
    })),
  ).filter((c: any) => goodText(c.titulo, 8) && goodText(c.explicacion, 80));

  const conexiones_clave = uniqueByText(
    perMaterial.flatMap((a, i) =>
      (a.conexiones_clave || []).map((x: any) => ({
        titulo: `${materialNames[i]}: ${x.titulo}`,
        explicacion: x.explicacion,
      })),
    ).filter((x: any) => goodText(x.titulo, 8) && goodText(x.explicacion, 20)),
    (x) => `${x.titulo} ${x.explicacion}`,
  ).slice(0, 24);

  const errores_comunes = uniqueByText(
    perMaterial.flatMap((a, i) =>
      (a.errores_comunes || []).map((x: any) => ({
        error: `${materialNames[i]}: ${x.error}`,
        correccion: x.correccion,
        mini_ejemplo: x.mini_ejemplo,
      })),
    ).filter((x: any) => goodText(x.error, 12) && goodText(x.correccion, 12)),
    (x) => `${x.error} ${x.correccion}`,
  ).slice(0, 24);

  const preguntas_profesor = uniqueByText(
    perMaterial.flatMap((a, i) =>
      (a.preguntas_profesor || []).map((x: any) => ({
        pregunta: `${materialNames[i]}: ${x.pregunta}`,
        que_evalua: x.que_evalua,
        respuesta_esperada: x.respuesta_esperada,
      })),
    ).filter((x: any) => goodText(x.pregunta, 12) && goodText(x.respuesta_esperada, 20)),
    (x) => x.pregunta,
  ).slice(0, 24);

  const para_examen = uniqueByText(
    perMaterial.flatMap((a, i) =>
      (a.para_examen || []).map((x: any) => ({
        punto: `${materialNames[i]}: ${x.punto}`,
        por_que: x.por_que,
      })),
    ).filter((x: any) => goodText(x.punto, 12)),
    (x: any) => x.punto,
  ).slice(0, 30);

  const ya_puedes_explicar = uniqueByText(
    perMaterial.flatMap((a, i) =>
      (a.ya_puedes_explicar || []).map((x: string) => `${materialNames[i]}: ${x}`),
    ).filter((x: string) => goodText(x, 12)),
    (x) => x,
  ).slice(0, 30);

  const preguntas_sugeridas = uniqueByText(
    perMaterial.flatMap((a, i) =>
      (a.preguntas_sugeridas || []).map((x: string) => `${materialNames[i]}: ${x}`),
    ).filter((x: string) => goodText(x, 12)),
    (x) => x,
  ).slice(0, 20);

  const taughtCount = cobertura_material.filter((item: any) =>
    clase_narrativa.some((c: any) =>
      c.explicacion.toLowerCase().includes(String(item.elemento).split(':').pop().trim().toLowerCase().slice(0, 24)),
    ),
  ).length;

  const coveragePercent = cobertura_material.length
    ? Math.round((taughtCount / cobertura_material.length) * 100)
    : 0;

  const titulo = isEs ? 'Clase completa de varios materiales' : 'Complete multi-material class';

  const si_no_sabes_nada = isEs
    ? `Seleccionaste ${materialNames.length} materiales. ALAI los va a enseñar por separado para que no mezcles temas que no tienen relación directa. Primero estudiarás cada material como una clase independiente. Después verás cómo organizar mentalmente todos los temas seleccionados. Si dos materiales no se conectan de forma clara, ALAI lo dirá directamente en vez de inventar una relación. La meta es que puedas explicar cada documento con tus propias palabras sin volver a abrirlo.`
    : `You selected ${materialNames.length} materials. ALAI will teach them separately so you do not mix topics that are not directly related. First you will study each material as an independent class. Then you will see how to organize all selected topics mentally. If two materials do not clearly connect, ALAI will say so instead of inventing a relationship. The goal is for you to explain each document in your own words without reopening it.`;

  const mapa_inicial = isEs
    ? `Materiales seleccionados: ${materialNames.join(', ')}. Cada material tiene su propia explicación, sus conceptos clave, sus preguntas de comprensión y sus puntos importantes para examen. El análisis está organizado para cubrir el contenido relevante de cada documento, no solo una idea general. Si los materiales pertenecen a áreas distintas, debes estudiarlos como bloques separados.`
    : `Selected materials: ${materialNames.join(', ')}. Each material has its own explanation, key concepts, understanding questions and exam points. The analysis is organized to cover the relevant content of each document, not only a general idea. If the materials belong to different areas, study them as separate blocks.`;

  const panorama_completo = isEs
    ? `Para estudiar estos materiales juntos, primero separa cada tema. No intentes forzar una conexión entre documentos que hablan de áreas distintas. Estudia cada clase completa, identifica sus conceptos clave y luego usa las preguntas de comprobación para verificar si realmente entendiste. Cuando termines, debes poder explicar qué enseña cada material, cuáles son sus conceptos centrales, qué procesos o relaciones aparecen y qué sería importante para una prueba o exposición.`
    : `To study these materials together, first separate each topic. Do not force a connection between documents from different areas. Study each complete class, identify its key concepts, then use the checking questions to verify whether you truly understood. When finished, you should be able to explain what each material teaches, its central concepts, its processes or relationships, and what matters for a test or presentation.`;

  const resumen_final = isEs
    ? `Este análisis organiza varios materiales como clases separadas para maximizar comprensión y evitar mezclas falsas. La prioridad es que aprendas cada documento con cobertura alta: conceptos, procesos, vocabulario, ejemplos, conexiones internas, errores comunes y puntos de examen. Primero domina cada material por separado; luego usa las preguntas de comprobación para verificar que puedes explicar causa, consecuencia y aplicación. Si algo todavía no está claro, usa Pregúntale a ALAI con una duda específica de ese material.`
    : `This analysis organizes multiple materials as separate classes to maximize understanding and avoid false mixing. The priority is learning each document with high coverage: concepts, processes, examples, internal connections and exam points. To go deeper, use Ask ALAI with a specific question from each material.`;

  return {
    titulo,
    objetivos,
    si_no_sabes_nada,
    mapa_inicial,
    cobertura_material,
    clase_narrativa,
    panorama_completo,
    conexiones_clave,
    errores_comunes,
    preguntas_profesor,
    para_examen,
    ya_puedes_explicar,
    resumen_final_profesor: resumen_final,
    preguntas_sugeridas,
    preguntale_alai: isEs
      ? 'Puedes preguntarme cualquier duda sobre este material.'
      : 'You can ask me any question about this material.',
    idioma: detectedLang,
    docNames: materialNames,
    coverage: {
      detected: cobertura_material.length,
      taught: taughtCount,
      percent: coveragePercent,
    },

    // Compatibilidad temporal
    historia_completa: panorama_completo,
    clases: clase_narrativa.map((c: any) => ({
      titulo: c.titulo,
      idea_central: c.explicacion.slice(0, 220),
      explicacion: c.explicacion,
      ejemplo_guiado: c.ejemplo,
      pregunta_reflexion: c.checkpoint,
    })),
    vocabulario_base: cobertura_material.map((x: any) => ({
      termino: x.elemento,
      explicacion: x.por_que_importa,
      por_que_aparece: x.por_que_importa,
    })),
    comprobacion: preguntas_profesor,
    desde_cero: [si_no_sabes_nada, mapa_inicial],
    ensenanza_guiada: clase_narrativa.map((c: any) => ({
      concepto: c.titulo,
      explicacion_simple: c.explicacion.slice(0, 220),
      explicacion_profunda: c.explicacion,
      ejemplo: c.ejemplo,
      por_que_importa: c.checkpoint,
    })),
    conexiones: conexiones_clave,
    confusiones: errores_comunes.map((e: any) => ({
      error: e.error,
      correccion: e.correccion,
      truco: e.mini_ejemplo,
    })),
    examen: para_examen.map((x: any) => x.punto),
    resumen_30s: resumen_final,
    vision_general: [si_no_sabes_nada, mapa_inicial],
    conceptos: clase_narrativa.map((c: any) => ({
      nombre: c.titulo,
      definicion_simple: c.explicacion.slice(0, 220),
      definicion_tecnica: c.explicacion,
      por_que_importa: c.checkpoint,
      ejemplo_concreto: c.ejemplo,
    })),
    resumen_final: para_examen.map((x: any) => x.punto),
    autoevaluacion: preguntas_profesor,
    ejemplos: [],
    analogias: [],
    aplicacion_real: [],
  };
}


function titleFromItem(item: any, fallback: string): string {
  const text = formatStudyText(item);
  const first = text.split(':')[0].trim();
  return goodText(first, 4) ? first.slice(0, 90) : fallback;
}

function cleanLearningLine(value: any): string {
  return formatStudyText(value)
    .replace(/\bTipo:\s*(concepto|dato|proceso|fecha|causa|consecuencia|fórmula|idea)\b\.?/gi, '')
    .replace(/\bNivel:\s*(base|intermedio|avanzado)\b\.?/gi, '')
    .replace(/\s*:\s*$/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function shortExplain(value: any, max = 360): string {
  const text = cleanLearningLine(value);
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  const lastDot = Math.max(cut.lastIndexOf('.'), cut.lastIndexOf(';'));
  return (lastDot > 160 ? cut.slice(0, lastDot + 1) : cut + '…').trim();
}

function makeHumanTeachingLesson({ cA, cB, lang, detectedLang, docNames }: any) {
  const compact = cA.__compact || cB.__compact || null;
  const isEs = detectedLang === 'es' || lang === 'es';
  if (!compact) return null;

  const clean = (v: any) =>
    cleanLearningLine(v)
      .replace(/^([^:]{3,90}):\s*\1:\s*/i, '$1: ')
      .replace(/^([^:]{3,90}):\s*\1\b/i, '$1')
      .replace(/\bTipo:\s*\w+\.?/gi, '')
      .replace(/\bNivel:\s*\w+\.?/gi, '')
      .replace(/\s+/g, ' ')
      .trim();

  const uniqueStrings = (items: any[]) =>
    uniqueByText<string>(
      items.map(clean).filter((x: string) => goodText(x, 18)),
      (x: string) => x,
    );

  const bioRe = /\b(naci[oó]|nacimiento|familia|ciudad|universidad|university|infancia|premio nobel|nobel prize|copenhagen|dinamarca|lugar de nacimiento|fecha de nacimiento)\b/i;
  const formulaRe = /[A-Za-zÁÉÍÓÚáéíóú₀-₉]\s*=|Eₙ|E_n|n²|n\^2|Δ|λ|π|=|eV|J\b|mol|kg|m\/s|N\b|Pa\b/i;
  const problemRe = /\b(problema|limitaci[oó]n|dificultad|no pod[ií]a explicar|pregunta|confusi[oó]n|causa|riesgo|fallo|déficit|enfermedad|síntoma|necesidad)\b/i;
  const solutionRe = /\b(soluci[oó]n|propuso|modelo|explica|resuelve|tratamiento|mecanismo|teor[ií]a|respuesta|intervenci[oó]n|funci[oó]n|proceso)\b/i;
  const evidenceRe = /\b(ejemplo|caso|evidencia|demuestra|observa|experimento|resultado|espectro|gr[aá]fica|dato|medici[oó]n)\b/i;
  const impactRe = /\b(importancia|impacto|consecuencia|legado|aplicaci[oó]n|permite|sirve|uso|tecnolog|cl[ií]nica|examen|conclusi[oó]n)\b/i;

  const ideas = uniqueStrings(compact.ideas || []);
  const procesos = uniqueStrings(compact.procesos || []);
  const formulas = uniqueStrings([...(compact.formulas || []), ...ideas.filter((x: string) => formulaRe.test(x))]);
  const relaciones = uniqueStrings(compact.relaciones || []);
  const datos = uniqueStrings(compact.datos || []);
  const noOmitir = uniqueStrings(compact.noOmitir || []);
  const preguntas = uniqueStrings(compact.preguntas || []);
  const confusiones = uniqueStrings(compact.confusiones || []);

  const all = uniqueStrings([
    ...procesos,
    ...formulas,
    ...relaciones,
    ...ideas,
    ...datos,
    ...noOmitir,
  ]);

  if (!all.length) return null;

  const academicCore = uniqueStrings([
    ...procesos,
    ...formulas,
    ...relaciones,
    ...ideas.filter((x: string) => !bioRe.test(x)),
    ...noOmitir.filter((x: string) => !bioRe.test(x)),
  ]);

  const base = academicCore.length >= 4 ? academicCore : all;

  const findOne = (pool: string[], re: RegExp, fallback = '') =>
    pool.find((x: string) => re.test(x)) || fallback;

  const contextItem = findOne(base, /^(?!.*\b(naci[oó]|nacimiento|familia|universidad|university)\b).{20,}$/i, base[0]);
  const problemItem = findOne(base, problemRe, procesos[0] || base[1] || base[0]);
  const solutionItem = findOne(base, solutionRe, procesos[0] || base[2] || base[0]);
  const processItem = procesos[0] || solutionItem || base[0];
  const formulaItem = formulas[0] || '';
  const evidenceItem = findOne(base, evidenceRe, relaciones[0] || base[3] || base[0]);
  const impactItem = findOne(base, impactRe, relaciones[0] || noOmitir.find((x: string) => !bioRe.test(x)) || base[4] || base[0]);

  const chapterItems = uniqueByText<string>(
    [
      contextItem,
      problemItem,
      solutionItem,
      processItem,
      formulaItem || evidenceItem,
      impactItem,
    ].filter((x: string) => goodText(x, 18)),
    (x: string) => x,
  ).slice(0, 8);

  const theme = titleFromItem(contextItem || all[0], docNames?.[0] || 'Material');

  const explainFormula = (item: string) => {
    const text = shortExplain(item, 420);
    const hasNegative = /-\s*\d|−\s*\d/.test(item);
    const hasN = /\bn\b|n²|n\^2|Eₙ|E_n/i.test(item);

    return isEs
      ? `Cuando aparece una fórmula, no la memorices como dibujo: léela como una relación entre cantidades. ${text} Primero identifica qué representa cada símbolo. Después mira qué variable cambia y qué resultado produce. ${hasNegative ? 'Si la expresión tiene valor negativo, normalmente indica una cantidad ligada a un sistema o medida respecto a un punto de referencia, por eso no debe leerse como “energía mala”, sino como posición dentro de una escala.' : ''} ${hasN ? 'Si aparece n, suele representar un nivel, número de etapa o posición dentro de una secuencia; cuando n cambia, también cambia el resultado de la fórmula.' : ''} Lo importante es poder explicar con palabras qué relación resume la ecuación y para qué sirve dentro del tema.`
      : `When a formula appears, do not memorize it as a drawing: read it as a relationship between quantities. ${text} Identify each symbol, what changes, and what result the formula explains.`;
  };

  const chapter = (kind: 'context' | 'problem' | 'solution' | 'process' | 'formula' | 'impact', item: string, idx: number) => {
    const text = shortExplain(item, 520);
    const title =
      kind === 'context'
        ? (isEs ? 'De qué trata realmente este material' : 'What this material is really about')
      : kind === 'problem'
        ? (isEs ? 'El problema o pregunta central' : 'The central problem or question')
      : kind === 'solution'
        ? (isEs ? 'La idea principal que resuelve el problema' : 'The main idea that solves the problem')
      : kind === 'process'
        ? (isEs ? 'Cómo funciona paso a paso' : 'How it works step by step')
      : kind === 'formula'
        ? (isEs ? 'La fórmula explicada con palabras' : 'The formula explained in words')
      : (isEs ? 'Por qué esto importa y qué recordar' : 'Why this matters and what to remember');

    let explicacion = '';

    if (kind === 'context') {
      explicacion = isEs
        ? `${text} Esta es la base del material. Antes de memorizar nombres, fechas o fórmulas, debes entender qué tema está explicando el documento y cuál es su idea central. Si entiendes esta parte, el resto deja de sentirse como información suelta y empieza a verse como una explicación conectada.`
        : `${text} This is the foundation of the material. Before memorizing names, dates or formulas, understand what topic the document is explaining and what its central idea is.`;
    } else if (kind === 'problem') {
      explicacion = isEs
        ? `${text} Este es el problema o la limitación que el material intenta resolver. Entender bien esta dificultad es clave, porque la solución solo tiene sentido cuando sabes qué faltaba explicar antes. Pregúntate siempre: ¿qué no se podía entender todavía y por qué eso era importante?`
        : `${text} This is the problem or limitation the material is trying to solve. The solution only makes sense when you understand what could not be explained before.`;
    } else if (kind === 'solution') {
      explicacion = isEs
        ? `${text} Aquí aparece la idea principal que responde al problema central del tema. No la estudies como una frase aislada: piensa qué cambió gracias a esta idea, qué permite explicar y por qué representa un avance respecto a lo anterior. Si puedes decir eso con tus palabras, ya entendiste el corazón del material.`
        : `${text} Here appears the main idea that answers the central problem of the topic. Do not study it as an isolated phrase: think about what changed because of this idea and what it now allows us to explain.`;
    } else if (kind === 'process') {
      explicacion = isEs
        ? `${text} Este proceso debe entenderse en orden. Primero identifica qué ocurre al inicio, luego qué mecanismo produce el cambio, y finalmente qué resultado aparece. Cuando puedes narrar esa secuencia de principio a fin sin mirar el texto, ya no estás memorizando: realmente estás entendiendo cómo funciona el tema.`
        : `${text} This process must be understood in order. First identify what happens at the beginning, then what mechanism produces the change, and finally what result appears.`;
    } else if (kind === 'formula') {
      explicacion = explainFormula(item);
    } else {
      explicacion = isEs
        ? `${text} Esta parte muestra por qué el tema importa. Aquí debes fijarte en la consecuencia, el impacto o la aplicación de lo que se explicó antes. Esto es lo que más suelen evaluar en una prueba oral o escrita: no repetir el dato, sino explicar por qué cambia la comprensión del tema y qué aporta.`
        : `${text} This part shows why the topic matters. Focus on the consequence, impact or application of what was explained before.`;
    }

    return {
      titulo: title,
      explicacion: formatStudyText(explicacion),
      ejemplo: shortExplain(item, 220),
      checkpoint: isEs
        ? `Explícalo sin mirar: ¿cuál es la idea central de esta parte y cómo se conecta con el resto?`
        : `Explain it without looking: what is the central idea and how does it connect?`,
    };
  };

  const kinds: Array<'context' | 'problem' | 'solution' | 'process' | 'formula' | 'impact'> = [
    'context',
    'problem',
    'solution',
    'process',
    'process',
    'process',
    'process',
    formulaItem ? 'formula' : 'process',
    formulaItem ? 'formula' : 'impact',
    formulaItem ? 'formula' : 'impact',
    'impact',
    'impact',
    'impact',
    'impact',
  ];

  let clase_narrativa = chapterItems.map((item: string, i: number) => {
    const kind = kinds[i] || 'impact';
    const c = chapter(kind, item, i);
    // Título dinámico basado en el contenido real
    const dynamicTitle = titleFromItem(item, c.titulo);
    const prefix = kind === 'context' ? 'Contexto: '
      : kind === 'problem' ? 'Problema: '
      : kind === 'solution' ? 'Solución: '
      : kind === 'process' ? 'Proceso: '
      : kind === 'formula' ? 'Fórmula: '
      : 'Importancia: ';
    return {
      ...c,
      titulo: i === 0 ? c.titulo : `${prefix}${dynamicTitle.slice(0, 60)}`,
    };
  });

  clase_narrativa = dedupeNarrativeSections(
    clase_narrativa.filter((c: any) => goodText(c.titulo, 4) && goodText(c.explicacion, 80)),
  ).slice(0, 6);

  const cobertura_material = uniqueByText(
    base
      .filter((x: string) => !bioRe.test(x))
      .slice(0, 14)
      .map((x: string) => ({
        elemento: titleFromItem(x, x),
        por_que_importa: shortExplain(x, 260),
      })),
    (x: any) => `${x.elemento} ${x.por_que_importa}`,
  );

  const conexiones_clave = uniqueByText(
    relaciones.slice(0, 4).map((x: string) => ({
      titulo: titleFromItem(x, isEs ? 'Conexión clave' : 'Key connection'),
      explicacion: shortExplain(x, 360),
    })),
    (x: any) => `${x.titulo} ${x.explicacion}`,
  );

  const errores_comunes = uniqueByText(
    confusiones.slice(0, 4).map((x: string) => ({
      error: titleFromItem(x, isEs ? 'Confusión común' : 'Common confusion'),
      correccion: shortExplain(x, 260),
      mini_ejemplo: shortExplain(x, 160),
    })),
    (x: any) => `${x.error} ${x.correccion}`,
  );

  const preguntas_profesor = uniqueByText(
    preguntas.slice(0, 6).map((x: string) => {
      const [pregunta, respuesta] = x.split(/Respuesta esperada:/i);
      return {
        pregunta: goodText(pregunta, 10) || x,
        que_evalua: isEs ? 'Comprensión real: problema, explicación y consecuencia' : 'Real understanding: problem, explanation and consequence',
        respuesta_esperada: goodText(respuesta, 20) || shortExplain(x, 280),
      };
    }),
    (x: any) => x.pregunta,
  );

  const para_examen = uniqueByText(
    [
      problemItem,
      solutionItem,
      processItem,
      formulaItem,
      impactItem,
      ...base.filter((x: string) => !bioRe.test(x)),
    ]
      .filter((x: string) => goodText(x, 20))
      .map((x: string) => ({
        punto: titleFromItem(x, x),
        por_que: shortExplain(x, 260),
      })),
    (x: any) => x.punto,
  ).slice(0, 8);

  // ── Textos dinámicos basados en el contenido real extraído ──
  const temasTxt = (compact.temas || []).slice(0, 2).map((t: string) => shortExplain(t, 180)).filter(Boolean).join('. ');
  const causas = uniqueStrings(compact.causas || []);
  const ejemplos = uniqueStrings(compact.ejemplos || []);

  const si_no_sabes_nada = (() => {
    const partes: string[] = [];
    if (temasTxt) partes.push(`El tema central de este material es: ${temasTxt}.`);
    if (ideas[0]) partes.push(`La primera idea clave que debes entender es: ${shortExplain(ideas[0], 240)}.`);
    if (procesos[0]) partes.push(`Un proceso importante que aparece es: ${shortExplain(procesos[0], 220)}.`);
    if (formulas[0]) partes.push(`También aparece esta fórmula o relación: ${shortExplain(formulas[0], 180)}.`);
    partes.push(isEs
      ? 'Antes de memorizar cualquier dato, pregúntate: ¿qué problema intenta resolver este material? Cuando tienes esa respuesta, el resto del contenido empieza a organizarse solo.'
      : 'Before memorizing anything, ask yourself: what problem does this material solve? When you have that answer, everything else starts to make sense.');
    return partes.join(' ');
  })();

  const mapa_inicial = (() => {
    const pasos: string[] = [];
    if (contextItem) pasos.push(`Tema: ${shortExplain(contextItem, 160)}`);
    if (problemItem && problemItem !== contextItem) pasos.push(`Problema: ${shortExplain(problemItem, 160)}`);
    if (solutionItem && solutionItem !== problemItem) pasos.push(`Solución: ${shortExplain(solutionItem, 160)}`);
    if (processItem && processItem !== solutionItem) pasos.push(`Proceso: ${shortExplain(processItem, 160)}`);
    if (formulaItem) pasos.push(`Fórmula: ${shortExplain(formulaItem, 140)}`);
    if (impactItem && impactItem !== processItem) pasos.push(`Importancia: ${shortExplain(impactItem, 140)}`);
    const cadena = pasos.length ? pasos.join(' → ') : (all.slice(0, 4).map((x: string) => shortExplain(x, 120)).join(' → '));
    return isEs
      ? `El mapa del material es: ${cadena}. Estudia en ese orden para que cada parte tenga sentido antes de pasar a la siguiente.`
      : `The material map is: ${cadena}. Study in that order so each part makes sense before moving to the next.`;
  })();

  const panorama_completo = (() => {
    const p0 = all[0] ? shortExplain(all[0], 220) : '';
    const p1 = all[1] ? shortExplain(all[1], 200) : '';
    const p2 = procesos[0] ? shortExplain(procesos[0], 200) : '';
    const c0 = causas[0] ? shortExplain(causas[0], 180) : '';
    const r0 = relaciones[0] ? shortExplain(relaciones[0], 180) : '';
    return isEs
      ? `Para unir todo el material: ${p0 ? `Comienza con ${p0}.` : ''} ${p1 ? `Luego: ${p1}.` : ''} ${p2 ? `El proceso principal es: ${p2}.` : ''} ${c0 ? `La causa y consecuencia más importante: ${c0}.` : ''} ${r0 ? `La conexión clave entre conceptos: ${r0}.` : ''} Si puedes narrar esa secuencia con tus propias palabras sin mirar el documento, entendiste el material de verdad.`.replace(/\s+/g, ' ').trim()
      : `To connect the whole material: ${p0 ? `Start with ${p0}.` : ''} ${p1 ? `Then: ${p1}.` : ''} ${p2 ? `The main process is: ${p2}.` : ''} ${c0 ? `The most important cause and effect: ${c0}.` : ''} ${r0 ? `The key connection: ${r0}.` : ''} If you can narrate that sequence in your own words, you truly understood the material.`.replace(/\s+/g, ' ').trim();
  })();

  const resumen_final = (() => {
    const puntos = para_examen.slice(0, 3).map((x: any) => x.punto).filter(Boolean);
    const f0 = formulas[0] ? shortExplain(formulas[0], 160) : '';
    const p0 = procesos[0] ? shortExplain(procesos[0], 160) : '';
    return isEs
      ? `Para dominar este material: ${puntos.length ? `Los puntos clave son: ${puntos.join('; ')}.` : ''} ${p0 ? `El proceso central es: ${p0}.` : ''} ${f0 ? `La fórmula o relación principal es: ${f0}.` : ''} Si puedes explicar todo eso con tus propias palabras sin mirar el documento, aprendiste el tema.`.replace(/\s+/g, ' ').trim()
      : `To master this material: ${puntos.length ? `Key points are: ${puntos.join('; ')}.` : ''} ${p0 ? `The central process is: ${p0}.` : ''} ${f0 ? `The main formula or relationship is: ${f0}.` : ''} If you can explain all that in your own words, you learned the topic.`.replace(/\s+/g, ' ').trim();
  })();

  return {
    titulo: ok(cA.titulo, 3) ? formatStudyText(cA.titulo) : (isEs ? 'Profesor ALAI' : 'Professor ALAI'),
    objetivos: [
      isEs ? 'Identificar el tema principal del material' : 'Identify the main topic',
      isEs ? 'Entender el problema o pregunta central' : 'Understand the central problem or question',
      isEs ? 'Explicar la idea principal con tus palabras' : 'Explain the main idea in your own words',
      isEs ? 'Conectar conceptos, fórmulas y consecuencias' : 'Connect concepts, formulas and consequences',
    ],
    si_no_sabes_nada,
    mapa_inicial,
    cobertura_material,
    clase_narrativa,
    panorama_completo,
    conexiones_clave,
    errores_comunes,
    preguntas_profesor,
    para_examen,
    ya_puedes_explicar: para_examen.map((x: any) => x.punto).slice(0, 6),
    resumen_final_profesor: resumen_final,
    preguntas_sugeridas: preguntas_profesor.map((x: any) => x.pregunta).slice(0, 5),
    preguntale_alai: isEs ? 'Puedes preguntarme cualquier duda sobre este material.' : 'You can ask me anything about this material.',
    idioma: detectedLang,
    docNames,
    coverage: {
      detected: all.length,
      taught: Math.min(all.length, clase_narrativa.length * 4),
      percent: all.length ? Math.min(100, Math.round((Math.min(all.length, clase_narrativa.length * 4) / all.length) * 100)) : 0,
    },

    historia_completa: panorama_completo,
    clases: clase_narrativa.map((c: any) => ({
      titulo: c.titulo,
      idea_central: c.explicacion.slice(0, 220),
      explicacion: c.explicacion,
      ejemplo_guiado: c.ejemplo,
      pregunta_reflexion: c.checkpoint,
    })),
    vocabulario_base: cobertura_material.map((x: any) => ({
      termino: x.elemento,
      explicacion: x.por_que_importa,
      por_que_aparece: x.por_que_importa,
    })),
    comprobacion: preguntas_profesor,
    desde_cero: [si_no_sabes_nada, mapa_inicial],
    ensenanza_guiada: clase_narrativa.map((c: any) => ({
      concepto: c.titulo,
      explicacion_simple: c.explicacion.slice(0, 220),
      explicacion_profunda: c.explicacion,
      ejemplo: c.ejemplo,
      por_que_importa: c.checkpoint,
    })),
    conexiones: conexiones_clave,
    confusiones: errores_comunes.map((e: any) => ({
      error: e.error,
      correccion: e.correccion,
      truco: e.mini_ejemplo,
    })),
    examen: para_examen.map((x: any) => x.punto),
    resumen_30s: resumen_final,
    vision_general: [si_no_sabes_nada, mapa_inicial],
    conceptos: clase_narrativa.map((c: any) => ({
      nombre: c.titulo,
      definicion_simple: c.explicacion.slice(0, 220),
      definicion_tecnica: c.explicacion,
      por_que_importa: c.checkpoint,
      ejemplo_concreto: c.ejemplo,
    })),
    resumen_final: para_examen.map((x: any) => x.punto),
    autoevaluacion: preguntas_profesor,
    ejemplos: [],
    analogias: [],
    aplicacion_real: [],
  };
}


// ── Postprocesador: elimina conceptos secundarios del output de síntesis ──
const SECONDARY_RX = /\b(copenhague|copenhagen|interpretaci[oó]n de copenhague|superposici[oó]n|colapso de la funci[oó]n|funci[oó]n de onda|entrelazamiento|dualidad onda|medici[oó]n cu[aá]ntica|muchos mundos|many worlds|probabilidad cu[aá]ntica|naturaleza probabil[ií]stica|semiconductores|semiconductor|transistores|transistor|tecnolog[ií]as modernas|l[aá]seres|laser|computaci[oó]n cu[aá]ntica)\b/i;

function cleanSecondary(text: string): string {
  if (!text || !SECONDARY_RX.test(text)) return text;
  // Si toda la oración gira alrededor de conceptos secundarios, eliminarla
  const sentences = text.split(/(?<=[.!?])\s+/);
  const clean = sentences.filter(s => {
    const words = s.split(/\s+/).length;
    const matches = (s.match(SECONDARY_RX) || []).length;
    // Si más del 30% de las ideas son secundarias, eliminar la oración
    return matches === 0 || (matches / words) < 0.15;
  });
  return clean.join(' ').trim() || text;
}

// Títulos expansivos que indican secciones fuera del objetivo pedagógico
const EXPANSIVE_TITLES_RX = /\b(nueva era|new era|evoluci[oó]n.*cient[ií]f|transformaci[oó]n.*conocimiento|implicaciones.*filos[oó]f|impacto.*tecnol[oó]g.*moderno|herencia.*cient[ií]f|legado.*hist[oó]r|avance.*humanidad|cambio.*paradigma|redefinici[oó]n.*realidad|impacto.*global)\b/i;

function cleanSecondaryFromAnalisis(analisis: any): any {
  if (!analisis) return analisis;

  // Limpiar clase_narrativa: eliminar partes con título secundario o expansivo
  if (Array.isArray(analisis.clase_narrativa)) {
    analisis.clase_narrativa = analisis.clase_narrativa.filter((c: any) => {
      const titulo = c.titulo || '';
      if (SECONDARY_RX.test(titulo)) return false;
      if (EXPANSIVE_TITLES_RX.test(titulo)) return false;
      return true;
    }).map((c: any) => ({
      ...c,
      explicacion: cleanSecondary(c.explicacion || ''),
      checkpoint: (SECONDARY_RX.test(c.checkpoint || '') || EXPANSIVE_TITLES_RX.test(c.checkpoint || ''))
        ? '¿Cómo se conecta esta idea con el problema central y la evidencia experimental?'
        : c.checkpoint,
    }));
  }

  // Limpiar preguntas_profesor
  if (Array.isArray(analisis.preguntas_profesor)) {
    analisis.preguntas_profesor = analisis.preguntas_profesor.filter((q: any) =>
      !SECONDARY_RX.test(q.pregunta || '') && !EXPANSIVE_TITLES_RX.test(q.pregunta || '')
    );
  }

  // Limpiar para_examen
  if (Array.isArray(analisis.para_examen)) {
    analisis.para_examen = analisis.para_examen.filter((x: any) =>
      !SECONDARY_RX.test(x.punto || '') && !EXPANSIVE_TITLES_RX.test(x.punto || '')
    );
  }

  // Limpiar resumen_final_profesor: solo oraciones sobre el mecanismo central
  if (analisis.resumen_final_profesor) {
    analisis.resumen_final_profesor = cleanSecondary(analisis.resumen_final_profesor);
  }

  // Limpiar panorama_completo
  if (analisis.panorama_completo) {
    analisis.panorama_completo = cleanSecondary(analisis.panorama_completo);
  }

  // Limpiar ya_puedes_explicar
  if (Array.isArray(analisis.ya_puedes_explicar)) {
    analisis.ya_puedes_explicar = analisis.ya_puedes_explicar.filter((x: string) =>
      !SECONDARY_RX.test(x) && !EXPANSIVE_TITLES_RX.test(x)
    );
  }

  return analisis;
}

function buildAnalisisFromParts({ cA, cB, lang, detectedLang, docNames }: any) {
  // Siempre priorizar la síntesis estructurada de la IA
  // makeHumanTeachingLesson solo se usa si la síntesis viene completamente vacía
  const hasAnyContent =
    Array.isArray(cA?.clase_narrativa) && cA.clase_narrativa.length >= 1;

  if (!hasAnyContent) {
    const humanLesson = makeHumanTeachingLesson({ cA, cB, lang, detectedLang, docNames });
    if (humanLesson) return humanLesson;
  }

  const objetivos = Array.isArray(cA.objetivos)
    ? cA.objetivos.map((s: any) => goodText(s, 8)).filter(Boolean).slice(0, 5)
    : [];

  
const BIOGRAPHY_RE = /\b(naci[oó]|nacimiento|familia|ciudad|universidad|university|premio nobel|nobel prize|copenhagen|dinamarca)\b/i;

const cobertura_material = uniqueByText(
    (cA.cobertura_material || [])
      .map((x: any) => ({
        elemento: goodText(x?.elemento, 2),
        por_que_importa: goodText(x?.por_que_importa, 8),
      }))
      .filter((x: any) => x.elemento && x.por_que_importa),
    (x: any) => `${x.elemento} ${x.por_que_importa}`,
  ).slice(0, 12);

  // Obtener clase_narrativa de la síntesis IA
  let clase_narrativa_raw = dedupeNarrativeSections(uniqueByText(
    (cA.clase_narrativa || [])
      .map((c: any) => ({
        titulo: goodText(c?.titulo, 3).replace(/^Parte\s*\d+:\s*Parte\s*\d+:\s*/i, 'Parte ').replace(/^Parte\s*\d+:\s*/i, ''),
        explicacion: goodText(c?.explicacion, 80),
        ejemplo: goodText(c?.ejemplo, 10),
        checkpoint: goodText(c?.checkpoint, 10),
      }))
      .filter((c: any) => c.titulo && c.explicacion)
      .filter((c: any, idx: number) => {
        if (idx < 2) return true;
        return !BIOGRAPHY_RE.test(String(c.titulo + ' ' + c.explicacion));
      }),
    (c: any) => `${c.titulo} ${c.explicacion.slice(0, 120)}`,
  )).slice(0, 14);

  // Detectar si la síntesis IA es genérica/mala
  const isGenericSynth = (parts: any[]): boolean => {
    if (parts.length < 3) return true;
    const genericPhrases = [
      'el concepto de', 'el dato de', 'el proceso de', 'la persona de',
      'el síntoma de', 'el mecanismo de', 'es importante porque',
      'se basa en la idea de que los objetos',
      'fue desarrollado por niels bohr y otros',
    ];
    const allText = parts.map((p: any) => (p.explicacion || '').toLowerCase()).join(' ');
    const genericCount = genericPhrases.filter(p => allText.includes(p)).length;
    return genericCount >= 3;
  };

  // Si la síntesis es genérica, construir clase desde compact extraído
  let clase_narrativa: any[];
  if (isGenericSynth(clase_narrativa_raw) && cA.__compact) {
    const comp = cA.__compact;
    const isEs = detectedLang === 'es';
    const allItems = [
      ...(comp.procesos || []),
      ...(comp.ideas || []).filter((x: string) => !/\b(naci[oó]|familia|ciudad)\b/i.test(x)),
      ...(comp.relaciones || []),
      ...(comp.causas || []),
      ...(comp.formulas || []),
      ...(comp.datos || []).filter((x: string) => !/\b(naci[oó]|familia)\b/i.test(x)),
      ...(comp.noOmitir || []).filter((x: string) => !/\b(naci[oó]|familia)\b/i.test(x)),
    ].filter((x: string) => typeof x === 'string' && x.length > 30);

    const uniqueItems = uniqueByText<string>(allItems, (x: string) => x.toLowerCase().slice(0, 60)).slice(0, 14);

    const buildExplicacion = (item: string, idx: number): string => {
      return shortExplain(item, 600); // 0 relleno, solo la información real extraída
    };

    clase_narrativa = uniqueItems.map((item: string, i: number) => ({
      titulo: i === 0
        ? (isEs ? 'De qué trata este material' : 'What this material is about')
        : titleFromItem(item, isEs ? `Parte ${i + 1}` : `Part ${i + 1}`),
      explicacion: buildExplicacion(item, i),
      ejemplo: shortExplain(item, 220),
      checkpoint: isEs
        ? '¿Puedes explicar esta idea con tus propias palabras sin mirar el texto?'
        : 'Can you explain this idea in your own words without looking at the text?',
    }));

    console.log(`🔧 Clase narrativa reconstruida desde compact: ${clase_narrativa.length} partes`);
  } else {
    clase_narrativa = clase_narrativa_raw;
  }

  const conexiones_clave = uniqueByText(
    (cB.conexiones_clave || [])
      .map((c: any) => ({
        titulo: goodText(c?.titulo, 3),
        explicacion: goodText(c?.explicacion, 20),
      }))
      .filter((c: any) => c.titulo && c.explicacion)
      .filter((c: any, idx: number) => {
        if (idx < 2) return true;
        return !BIOGRAPHY_RE.test(String(c.titulo + ' ' + c.explicacion));
      }),
    (c: any) => `${c.titulo} ${c.explicacion}`,
  ).slice(0, 5);

  const errores_comunes = uniqueByText(
    (cB.errores_comunes || [])
      .map((e: any) => ({
        error: goodText(e?.error, 8),
        correccion: goodText(e?.correccion, 8),
        mini_ejemplo: goodText(e?.mini_ejemplo, 8),
      }))
      .filter((e: any) => e.error && e.correccion),
    (e: any) => `${e.error} ${e.correccion}`,
  ).slice(0, 4);

  const preguntas_profesor = uniqueByText(
    (cB.preguntas_profesor || cB.comprobacion || [])
      .map((q: any) => ({
        pregunta: goodText(q?.pregunta, 8),
        que_evalua: goodText(q?.que_evalua, 8),
        respuesta_esperada: goodText(q?.respuesta_esperada, 20),
      }))
      .filter((q: any) => q.pregunta && q.respuesta_esperada),
    (q: any) => q.pregunta,
  ).slice(0, 8);

  const para_examen = uniqueByText(
    (cB.para_examen || [])
      .map((x: any) => ({
        punto: goodText(x?.punto, 8),
        por_que: goodText(x?.por_que, 8),
      }))
      .filter((x: any) => x.punto),
    (x: any) => x.punto,
  ).slice(0, 10);

  const ya_puedes_explicar = Array.isArray(cB.ya_puedes_explicar)
    ? uniqueByText<string>(cB.ya_puedes_explicar.map((s: any) => goodText(s, 8)).filter(Boolean) as string[], (x: string) => x).slice(0, 8)
    : [];

  const preguntas_sugeridas = Array.isArray(cB.preguntas_sugeridas)
    ? uniqueByText<string>(cB.preguntas_sugeridas.map((q: any) => goodText(q, 8)).filter(Boolean) as string[], (x: string) => x).slice(0, 5)
    : [];

  
  // La interpretación de fórmula ya viene incluida en el prompt de M2

const analisis = {
      titulo: ok(cA.titulo, 3) ? formatStudyText(cA.titulo) : (lang === 'es' ? 'Profesor ALAI' : 'Professor ALAI'),
      objetivos,
      si_no_sabes_nada: ok(cA.si_no_sabes_nada, 40) ? formatStudyText(cA.si_no_sabes_nada) : '',
      mapa_inicial: ok(cA.mapa_inicial, 30) ? formatStudyText(cA.mapa_inicial) : '',
      cobertura_material,
      clase_narrativa,
      panorama_completo: ok(cB.panorama_completo, 40) ? formatStudyText(cB.panorama_completo) : '',
      conexiones_clave,
      errores_comunes,
      preguntas_profesor,
      para_examen,
      ya_puedes_explicar,
      resumen_final_profesor: ok(cB.resumen_final, 30) ? formatStudyText(cB.resumen_final) : '',
      preguntas_sugeridas,
      preguntale_alai: ok(cB.preguntale_alai, 8)
        ? formatStudyText(cB.preguntale_alai)
        : (lang === 'es'
          ? 'Puedes preguntarme cualquier duda sobre este material.'
          : 'You can ask me any question about this material.'),
      idioma: detectedLang,
      docNames,
      coverage: {
        detected: cobertura_material.length,
        taught: cobertura_material.filter((item: any) =>
          clase_narrativa.some((c: any) =>
            c.explicacion.toLowerCase().includes(String(item.elemento).toLowerCase().slice(0, 24))
            || c.titulo.toLowerCase().includes(String(item.elemento).toLowerCase().slice(0, 24)),
          ),
        ).length,
        percent: cobertura_material.length
          ? Math.round((cobertura_material.filter((item: any) =>
              clase_narrativa.some((c: any) =>
                c.explicacion.toLowerCase().includes(String(item.elemento).toLowerCase().slice(0, 24))
                || c.titulo.toLowerCase().includes(String(item.elemento).toLowerCase().slice(0, 24)),
              ),
            ).length / cobertura_material.length) * 100)
          : 0,
      },

      historia_completa: ok(cB.panorama_completo, 40) ? formatStudyText(cB.panorama_completo) : '',
      clases: clase_narrativa.map((c: any) => ({
        titulo: c.titulo,
        idea_central: c.explicacion.slice(0, 220),
        explicacion: c.explicacion,
        ejemplo_guiado: c.ejemplo,
        pregunta_reflexion: c.checkpoint,
    })),
      vocabulario_base: cobertura_material.map((x: any) => ({
        termino: x.elemento,
        explicacion: x.por_que_importa,
        por_que_aparece: x.por_que_importa,
    })),
      comprobacion: preguntas_profesor,
      desde_cero: [String(cA.si_no_sabes_nada || ''), String(cA.mapa_inicial || '')].filter(Boolean),
      ensenanza_guiada: clase_narrativa.map((c: any) => ({
        concepto: c.titulo,
        explicacion_simple: c.explicacion.slice(0, 220),
        explicacion_profunda: c.explicacion,
        ejemplo: c.ejemplo,
        por_que_importa: c.checkpoint,
    })),
      conexiones: conexiones_clave,
      confusiones: errores_comunes.map((e: any) => ({
        error: e.error,
        correccion: e.correccion,
        truco: e.mini_ejemplo,
    })),
      examen: para_examen.map((x: any) => x.punto),
      resumen_30s: ok(cB.resumen_final, 30) ? formatStudyText(cB.resumen_final) : '',
      vision_general: [String(cA.si_no_sabes_nada || ''), String(cA.mapa_inicial || '')].filter(Boolean),
      conceptos: clase_narrativa.map((c: any) => ({
        nombre: c.titulo,
        definicion_simple: c.explicacion.slice(0, 220),
        definicion_tecnica: c.explicacion,
        por_que_importa: c.checkpoint,
        ejemplo_concreto: c.ejemplo,
    })),
      resumen_final: para_examen.map((x: any) => x.punto),
      autoevaluacion: preguntas_profesor,
      ejemplos: [],
      analogias: [],
      aplicacion_real: [],
    };

  return cleanSecondaryFromAnalisis(analisis);
}


// ── Handler ────────────────────────────────────────────────────
export async function POST(req: NextRequest) {
  try {
    // ─── Auth NextAuth (opcional pero recomendado) ───
    let userId: string | null = null;
    try {
      const session = await getServerSession(authOptions);
      userId = (session?.user as any)?.id ?? null;
    } catch {}

    // ─── Body ───
    const body = await req.json();

    // ─── MODO BLUEPRINT — análisis estructural del material ───
    // Se usa en modo adaptativo para entender el material completo
    // antes de construir el programa.
    if (body?.mode === 'blueprint_analysis' && body?.blueprintPrompt) {
      try {
        const bpResult = await safeAlaiJson(String(body.blueprintPrompt), 6000);
        return NextResponse.json({
          success: true,
          blueprint: JSON.stringify(bpResult),
          blueprintRaw: JSON.stringify(bpResult),
          analisis: bpResult,
          fromBlueprintMode: true,
        });
      } catch (bpErr: any) {
        console.error('[blueprint_analysis] error:', bpErr?.message || bpErr);
        return NextResponse.json(
          { success: false, error: bpErr?.message || 'Error generando blueprint.' },
          { status: 500 }
        );
      }
    }
    const { documentos, idioma, materialId, nivel, masteryContext } = body as {
      documentos: {
        id: string;
        nombre: string;
        contenido: string;
        tipo: string;
      }[];
      idioma?: 'es' | 'en';
      materialId?: string;
      nivel?: 'secundaria' | 'universidad' | 'medicina' | 'doctorado';
      masteryContext?: any;
    };
    const nivelEstudio = nivel || 'universidad';

    if (!documentos?.length) {
      return NextResponse.json(
        { error: 'No se enviaron documentos' },
        { status: 400 },
      );
    }

    // ─── Cache por material/selección ───
    if (materialId && userId) {
      const cached = await getMaterialResult(materialId, 'teorico', 'analysis')
        .catch(() => null);
      if (cached?.payload) {
        const p = cached.payload;
        // Validar que el cache no sea un análisis genérico o vacío
        const claseOk = Array.isArray(p?.clase_narrativa) && p.clase_narrativa.length >= 3;
        const coberturaOk = Array.isArray(p?.cobertura_material) && p.cobertura_material.length >= 4;
        const siNoSabeOk = typeof p?.si_no_sabes_nada === 'string' && p.si_no_sabes_nada.length >= 80;
        const notGeneric = !String(p?.si_no_sabes_nada || '').includes('este material no es una lista de datos, es una explicación. Primero identifica el tema principal');
        if (claseOk && coberturaOk && siNoSabeOk && notGeneric) {
          console.log(`🚀 Cache HIT análisis válido → ${materialId}`);
          return NextResponse.json({
            success: true,
            analisis: p,
            fromCache: true,
          });
        }
        console.log(`♻️ Cache INVALIDADO análisis genérico → ${materialId}`);
      }
    }

    // ─── Preparar documentos legibles ───
    const validDocs = documentos
      .map((doc) => ({
        id: doc.id,
        nombre: String(doc.nombre || 'Material').trim(),
        contenido: String(doc.contenido || '').trim(),
        tipo: doc.tipo || '',
      }))
      .filter((doc) => doc.contenido.length >= 50);

    if (!validDocs.length) {
      return NextResponse.json(
        { error: 'Los documentos no tienen contenido legible. Asegurate de que el texto fue extraído correctamente.' },
        { status: 400 },
      );
    }

    const allTextForLang = validDocs.map((d) => d.contenido.slice(0, 6000)).join('\n\n');
    const lang: 'es' | 'en' = idioma === 'en' ? 'en' : 'es';
    const detectedLang = detectContentLanguage(allTextForLang, lang) as 'es' | 'en';
    const docNames = validDocs.map((d) => d.nombre);

    const nivelDesc: Record<string, string> = {
      secundaria: 'Secundaria: usa analogías simples, evita tecnicismos, vocabulario básico, ejemplos de la vida cotidiana',
      universidad: 'Universidad: nivel estándar universitario, conceptos completos con terminología técnica básica',
      medicina: 'Medicina/Ciencias avanzadas: terminología técnica completa, mecanismos moleculares detallados, relevancia clínica o científica',
      doctorado: 'Posgrado/Doctorado: máxima profundidad conceptual, mecanismos avanzados, conexiones con literatura especializada',
    };
    const nivelInstruccion = nivelDesc[nivelEstudio] || nivelDesc['universidad'];

    console.log(
      `🧠 Analizando jerárquico: ${validDocs.length} material(es), ${validDocs.reduce((a, d) => a + d.contenido.length, 0)} chars, lang=${detectedLang}, nivel=${nivelEstudio}`,
    );

    // ─── 1) Extraer conocimiento por chunks de cada material ───
    const materialAnalyses: any[] = [];

    for (const doc of validDocs) {
      const chunks = splitIntoChunks(doc.contenido, 4500);
      console.log(`📚 ${doc.nombre}: ${chunks.length} chunk(s)`);

      const extracted: any[] = [];
      const PARALLEL = 2;

      for (let start = 0; start < chunks.length; start += PARALLEL) {
        const batch = chunks.slice(start, start + PARALLEL);

        const results = await Promise.all(
          batch.map(async (chunk, idx) => {
            const chunkIndex = start + idx;
            const raw = await safeAlaiJson(
              extractPrompt(detectedLang, doc.nombre, chunkIndex, chunks.length, chunk),
              5200,
            );
            if (!raw) {
              console.warn(`⚠️ Extract inválido omitido: ${doc.nombre} chunk ${chunkIndex + 1}/${chunks.length}`);
              return null;
            }
            return cleanDeep(raw);
          }),
        );

        extracted.push(...results.filter(Boolean));
        console.log(`🧩 ${doc.nombre}: extraídos ${Math.min(start + PARALLEL, chunks.length)}/${chunks.length}`);
      }

      const compact = compactExtractedKnowledge(extracted);
      console.log(
        `📊 Extract ${doc.nombre}: ideas=${compact.ideas.length}, vocab=${compact.vocabulario.length}, procesos=${compact.procesos.length}, formulas=${compact.formulas.length}, relaciones=${compact.relaciones.length}, datos=${compact.datos.length}, noOmitir=${compact.noOmitir.length}`,
      );
      console.log(
        `🔎 Compact sample ${doc.nombre}:`,
        JSON.stringify({
          ideas: compact.ideas.slice(0, 8),
          procesos: compact.procesos.slice(0, 5),
          formulas: compact.formulas.slice(0, 5),
          relaciones: compact.relaciones.slice(0, 5),
          noOmitir: compact.noOmitir.slice(0, 10),
          preguntas: compact.preguntas.slice(0, 5),
        }, null, 2),
      );

      // ─── 2) Síntesis en micro-llamadas enfocadas ───
      const isEs = detectedLang === 'es';
      const es = isEs;
      const bioRx = /\b(naci[oó]|nacimiento|familia|ciudad|universidad|infancia)\b/i;

      // Sin límites fijos - cada material tiene su propio volumen de contenido
      const secundarioRxR = /\b(copenhague|copenhagen|nobel|instituto|institute|wwii|guerra|world war|semiconduct|láser|laser|transistor|computad|entrelazamiento|superposici|dualidad onda|energía nuclear|nuclear energy)\b/i;
      const secundarioRx = /\b(copenhague|copenhagen|nobel|instituto|institute|wwii|guerra mundial|world war|semiconduct|láser|laser|transistor|computad|entrelazamiento|superposici|dualidad onda)\b/i;

      const procData = compact.procesos.join('\n');
      const ideaData = compact.ideas.filter((x: string) => !bioRx.test(x)).join('\n');
      const formulaData = compact.formulas.join('\n');
      const relacionData = compact.relaciones.filter((x: string) => !secundarioRxR.test(x)).join('\n');
      const noOmitData = compact.noOmitir.filter((x: string) => !bioRx.test(x)).join('\n');
      const confData = compact.confusiones.filter((x: string) => !secundarioRx.test(x)).join('\n');
      const pregData = compact.preguntas.filter((x: string) => !secundarioRx.test(x)).join('\n');

      // Cobertura real del material
      const totalConceptos = compact.ideas.length + compact.procesos.length + compact.formulas.length;
      console.log('📊 Cobertura 100%: ' + compact.procesos.length + ' procesos, ' + compact.ideas.length + ' ideas, ' + compact.formulas.length + ' fórmulas');

      const mkP = (tarea: string, datos: string, schema: string) =>
        tarea + '\n\nDATOS:\n' + datos + '\n\nDevuelve SOLO JSON válido:\n' + schema;

      const mkE = (task: string, data: string, schema: string) =>
        task + '\n\nDATA:\n' + data + '\n\nReturn ONLY valid JSON:\n' + schema;

      // Bloque adaptativo basado en masteryContext
      const masteryBlock = masteryContext ? [
        '',
        'PERFIL DEL ESTUDIANTE (adapta la clase a este perfil):',
        'Dominio actual: ' + (masteryContext.overallMastery ?? 0) + '%',
        'Comprension: ' + (masteryContext.understanding ?? 0) + '% | Memoria: ' + (masteryContext.memory ?? 0) + '%',
        masteryContext.criticalConcepts?.length
          ? 'CONCEPTOS CRITICOS que DEBE dominar (< 20%): ' + masteryContext.criticalConcepts.join(', ')
          : '',
        masteryContext.weakConcepts?.length
          ? 'CONCEPTOS DEBILES (< 40%) - enfoca aqui: ' + masteryContext.weakConcepts.join(', ')
          : '',
        masteryContext.strongConcepts?.length
          ? 'YA DOMINADOS - no repetir basico: ' + masteryContext.strongConcepts.join(', ')
          : '',
        masteryContext.repeatedMistakes?.length
          ? 'ERRORES REPETIDOS - corregir explicitamente: ' + masteryContext.repeatedMistakes.join(', ')
          : '',
        masteryContext.studentProfile === 'beginner'
          ? 'NIVEL: Principiante. Explica desde cero, usa analogias simples.'
          : masteryContext.studentProfile === 'memorizer'
          ? 'NIVEL: Memoriza pero no conecta. Enfoca en relaciones causales.'
          : masteryContext.studentProfile === 'advanced'
          ? 'NIVEL: Avanzado. Sube dificultad, integra conceptos, usa casos complejos.'
          : '',
        '',
      ].filter(Boolean).join('\n') : '';

      // Bloque adaptativo basado en masteryContext

      // M0: clasificar tipo de material para elegir estructura pedagógica correcta
      const m0 = await safeAlaiJson(es
        ? mkP(
            'Eres un clasificador pedagógico. Analiza estos datos y determina el tipo de material para elegir la mejor estructura de enseñanza.',
            'Temas detectados:\n' + compact.temas.slice(0,5).join('\n') + '\n\nIdeas principales:\n' + ideaData.slice(0, 800),
            '{"tipo":"cientifico|historico|argumentativo|matematico|biografico|filosofico|narrativo","nivel":"secundaria|universidad|medicina|doctorado","estructura_pedagogica":"para cientifico: problema→solucion→mecanismo→evidencia | para historico: contexto→evento→consecuencia→impacto | para argumentativo: tesis→argumentos→evidencias→conclusion | para matematico: concepto→procedimiento→aplicacion→verificacion | para biografico: contexto→aporte→mecanismo→legado","razon":"1 oracion explicando tipo y nivel"}'
          )
        : mkP(
            'You are a pedagogical classifier. Analyze this data and determine the material type to choose the best teaching structure.',
            'Detected topics:\n' + compact.temas.slice(0,5).join('\n') + '\n\nMain ideas:\n' + ideaData.slice(0, 800),
            '{"tipo":"scientific|historical|argumentative|mathematical|biographical|philosophical|narrative","estructura_pedagogica":"for scientific: problem→solution→mechanism→evidence | for historical: context→event→consequence→impact | for argumentative: thesis→arguments→evidence→conclusion | for mathematical: concept→procedure→application→verification | for biographical: context→contribution→mechanism→legacy","razon":"1 sentence explaining why this type fits the material"}'
          ),
        600
      );

      const r0 = (cleanDeep(m0) as any) || {};
      const materialTipo = String(r0?.tipo || 'cientifico').toLowerCase();
      const estructuraPedagogica = String(r0?.estructura_pedagogica || 'problema→solucion→mecanismo→evidencia');
      // Nivel detectado automáticamente del material o del M0
      const nivelDetectado = String(r0?.nivel || nivelEstudio || 'universidad').toLowerCase();
      const nivelInstruccionFinal = nivelDesc[nivelDetectado] || nivelDesc['universidad'];
      console.log(`🎓 Tipo de material: ${materialTipo} | Estructura: ${estructuraPedagogica}`);

      // Adaptar instrucción de M1 según el tipo detectado
      const estructuraM1 = materialTipo.includes('argument') || materialTipo.includes('narrat')
        ? (es ? 'tesis central que defiende el documento' : 'central thesis the document defends')
        : materialTipo.includes('histor') || materialTipo.includes('biograf')
        ? (es ? 'situación o contexto previo al evento central' : 'situation or context before the central event')
        : (es ? 'problema o limitación que existía antes de la idea central' : 'problem or limitation before the central idea');

      const estructuraM1Sol = materialTipo.includes('argument') || materialTipo.includes('narrat')
        ? (es ? 'argumento o propuesta central que defiende el documento' : 'central argument or proposal the document defends')
        : materialTipo.includes('histor') || materialTipo.includes('biograf')
        ? (es ? 'evento central y qué cambió' : 'central event and what changed')
        : (es ? 'solución o idea central propuesta' : 'proposed central solution or idea');

      const estructuraM1Mec = materialTipo.includes('argument') || materialTipo.includes('narrat')
        ? (es ? 'evidencias o razones que usa el documento para sostener su tesis' : 'evidence or reasons the document uses to support its thesis')
        : materialTipo.includes('histor') || materialTipo.includes('biograf')
        ? (es ? 'mecanismo causal: por qué ocurrió y qué consecuencias tuvo' : 'causal mechanism: why it happened and what consequences it had')
        : (es ? 'mecanismo exacto de cómo funciona esa solución' : 'exact mechanism of how that solution works');

      const m1 = await safeAlaiJson(es
        ? mkP(
            masteryBlock + masteryBlock + 'Eres un extractor pedagógico. El material es de tipo: ' + materialTipo + '. Estructura pedagógica: ' + estructuraPedagogica + '. Identifica los 3 elementos clave según esta estructura. USA EXCLUSIVAMENTE los datos dados. No inventes nada externo.',
            'Procesos del documento:\n' + procData + '\n\nIdeas del documento:\n' + ideaData,
            '{"problema":"1-2 oraciones sobre: ' + estructuraM1 + '","solucion":"1-2 oraciones sobre: ' + estructuraM1Sol + '","mecanismo":"2-3 oraciones sobre: ' + estructuraM1Mec + '"}'
          )
        : mkE(
            'You are a pedagogical extractor. Material type: ' + materialTipo + '. Pedagogical structure: ' + estructuraPedagogica + '. Identify the 3 key elements according to this structure. USE EXCLUSIVELY the given data.',
            'Document processes:\n' + procData + '\n\nDocument ideas:\n' + ideaData,
            '{"problema":"1-2 sentences about: ' + estructuraM1 + '","solucion":"1-2 sentences about: ' + estructuraM1Sol + '","mecanismo":"2-3 sentences about: ' + estructuraM1Mec + '"}'
          ),
        800
      );

      // Filtrar datos de M2 para eliminar conceptos secundarios
      const m2SecRx = /\b(copenhague|copenhagen|interpretaci|instituto|institute|nobel|wwii|guerra|world war|semiconduct|láser|laser|transistor|computad|entrelazamiento|superposici|dualidad|colapso cuántico|medición cuántica|nuclear)\b/i;
      const procDataM2 = procData.split('\n').filter((x: string) => !m2SecRx.test(x)).join('\n');
      const ideaDataM2 = ideaData.split('\n').filter((x: string) => !m2SecRx.test(x)).join('\n');

      const m2 = await safeAlaiJson(es
        ? mkP(
            masteryBlock + masteryBlock + 'Eres un profesor experto. Escribe 4-7 partes de clase usando EXCLUSIVAMENTE los datos proporcionados. NIVEL DE AUDIENCIA: ' + nivelInstruccionFinal + '. Tipo de material: ' + materialTipo + '. Estructura pedagógica: ' + estructuraPedagogica + '. REGLAS ABSOLUTAS: 1) Si una idea, concepto, fórmula o nombre NO aparece en los datos, NO lo incluyas. 2) Adapta vocabulario, profundidad y ejemplos al nivel de audiencia. 3) Para cada fórmula: explica cada variable, el signo y qué pasa cuando cambian, al nivel apropiado. 4) Causalidad profunda obligatoria: no solo QUÉ ocurre, sino POR QUÉ ocurre y QUÉ consecuencia tiene. 5) Permanece fiel al dominio del material.',
            'Procesos del documento:\n' + procDataM2 + '\n\nIdeas del documento:\n' + ideaDataM2 + '\n\nFórmulas del documento:\n' + formulaData,
            '{"partes":[{"titulo":"título específico de qué enseña esta parte (no genérico)","explicacion":"5-8 oraciones: situación previa → idea nueva → mecanismo causal → qué resolvió. Incluye: POR QUÉ ocurre, no solo QUÉ ocurre","checkpoint":"pregunta de causa→mecanismo→consecuencia"}]}'
          )
        : mkE(
            'You are an expert teacher. Write 4-7 class parts using EXCLUSIVELY the provided data. ABSOLUTE RULES: 1) If an idea, concept, formula or name does NOT appear in the data, do NOT include it. 2) Each part teaches ONE idea: prior situation → new idea → how it works → what problem it solved. 3) For each formula in the data: explain each variable, the sign meaning, and what happens when variables change. 4) Causal depth is mandatory: explain WHY it happens and WHAT consequence it has. 5) Do not make analogies with other fields.',
            'Document processes:\n' + procDataM2 + '\n\nDocument ideas:\n' + ideaDataM2 + '\n\nDocument formulas:\n' + formulaData,
            '{"partes":[{"titulo":"specific non-generic title of what this part teaches","explicacion":"5-8 sentences: prior situation → new idea → causal mechanism → what it solved. Include: WHY it happens, not just WHAT happens","checkpoint":"cause→mechanism→consequence question"}]}'
          ),
        2500
      );

      const m3 = await safeAlaiJson(es
        ? mkP(
            masteryBlock + masteryBlock + 'Eres un profesor. NIVEL DE AUDIENCIA: ' + nivelInstruccionFinal + '. Genera errores comunes, preguntas de examen, probabilidad de examen y resumen. REGLAS: 1) Las preguntas deben evaluar comprensión causal del tema central, adaptadas al nivel. 2) Los errores comunes deben ser confusiones reales del nivel de audiencia. 3) Para probabilidad_examen: marca "alta" si el concepto aparece repetido, es un mecanismo central o tiene fórmula; "media" si aparece explicado; "baja" si solo se menciona. 4) USA SOLO la información proporcionada.',
            'Confusiones del documento:\n' + confData + '\n\nPreguntas posibles del documento:\n' + pregData + '\n\nProcesos centrales del documento:\n' + procData,
            '{"errores":[{"error":"confusión realista de un estudiante sobre el mecanismo o concepto central","correccion":"corrección precisa y causal en 1-2 oraciones"}],"preguntas_examen":[{"pregunta":"pregunta que obliga a explicar causa→mecanismo→consecuencia del tema central","respuesta":"respuesta causal en 2-3 oraciones"}],"probabilidad_examen":[{"concepto":"nombre del concepto","probabilidad":"alta|media|baja","razon":"1 oración explicando por qué tiene esa probabilidad"}],"para_examen":["concepto o mecanismo clave que un profesor preguntaría"],"resumen":"3-4 oraciones causales: problema → solución → mecanismo → evidencia"}'
          )
        : mkE(
            'You are a teacher. Generate common errors, exam questions and a summary. RULES: 1) Questions must evaluate causal understanding of the central document topic. 2) Common errors must be real student confusions about the central mechanism. 3) Summary must narrate: problem → solution → mechanism → evidence. 4) USE ONLY provided information.',
            'Document confusions:\n' + confData + '\n\nDocument possible questions:\n' + pregData + '\n\nDocument core processes:\n' + procData,
            '{"errores":[{"error":"realistic student confusion about the central document mechanism","correccion":"precise causal correction in 1-2 sentences"}],"preguntas_examen":[{"pregunta":"question requiring cause→mechanism→consequence explanation of central topic","respuesta":"causal answer in 2-3 sentences"}],"para_examen":["key concept or mechanism from the document a professor would ask about"],"resumen":"3-4 causal sentences: document problem → proposed solution → explaining mechanism → evidence or result"}'
          ),
        2000
      );

      const r1 = (cleanDeep(m1) as any) || {};
      const r2 = (cleanDeep(m2) as any) || {};
      const r3 = (cleanDeep(m3) as any) || {};

      const partesMicro: any[] = Array.isArray(r2?.partes) ? r2.partes : [];

      if (r3?.evidencia) partesMicro.push({
        titulo: es ? 'La evidencia que lo demostró' : 'The evidence that proved it',
        explicacion: String(r3.evidencia),
        ejemplo: '',
        checkpoint: es ? '¿Por qué esta evidencia confirma la idea central?' : 'Why does this evidence confirm the central idea?',
      });

      if (r3?.consecuencias) partesMicro.push({
        titulo: es ? 'Impacto y consecuencias' : 'Impact and consequences',
        explicacion: String(r3.consecuencias),
        ejemplo: '',
        checkpoint: es ? '¿Qué cambió gracias a esta idea?' : 'What changed because of this idea?',
      });

      const si_no_sabes = [r1?.problema, r1?.solucion].filter(Boolean).join(' ') || compact.temas.slice(0, 2).join('. ');
      const mapa = [r1?.problema, r1?.solucion, r1?.mecanismo].filter(Boolean).join(' → ') || compact.procesos.slice(0, 2).join(' → ');

      // Objetivos adaptativos desde M1 según el material real
      const objetivosM1 = Array.isArray(r1?.objetivos) && r1.objetivos.length >= 2
        ? r1.objetivos
        : [
            es ? 'Explicar la idea central del material con tus propias palabras' : 'Explain the central idea in your own words',
            es ? 'Describir el mecanismo principal que presenta el documento' : 'Describe the main mechanism in the document',
            es ? 'Conectar los conceptos clave con su contexto y consecuencias' : 'Connect key concepts with their context and consequences',
          ];

      let cA: any = {
        titulo: es ? 'Profesor ALAI' : 'Professor ALAI',
        nivel_detectado: nivelDetectado,
        material_tipo: materialTipo,
        objetivos: objetivosM1,
        si_no_sabes_nada: si_no_sabes,
        mapa_inicial: mapa,
        cobertura_material: compact.noOmitir
          .filter((x: string) => !bioRx.test(x))
          .slice(0, 8)
          .map((x: string) => ({ elemento: x.split(':')[0].trim(), por_que_importa: x.split(':').slice(1).join(':').trim() || x })),
        clase_narrativa: partesMicro.map((p: any) => ({
          titulo: p.titulo || '',
          explicacion: p.explicacion || '',
          ejemplo: p.ejemplo || '',
          checkpoint: p.checkpoint || '',
        })),
        __compact: compact,
      };

      let cB: any = {
        panorama_completo: [r1?.problema, r1?.solucion, r1?.mecanismo, r3?.consecuencias].filter(Boolean).join(' '),
        conexiones_clave: relacionData.split('\n').filter(Boolean).slice(0, 3).map((x: string) => ({
          titulo: x.split(':')[0].trim(),
          explicacion: x.split(':').slice(1).join(':').trim() || x,
        })),
        errores_comunes: Array.isArray(r3?.errores) ? r3.errores.map((e: any) => ({
          error: e.error || '',
          correccion: e.correccion || '',
          mini_ejemplo: '',
        })) : [],
        preguntas_profesor: Array.isArray(r3?.preguntas_examen) ? r3.preguntas_examen.map((q: any) => ({
          pregunta: q.pregunta || '',
          que_evalua: es ? 'Comprensión causal' : 'Causal understanding',
          respuesta_esperada: q.respuesta || '',
        })) : [],
        para_examen: Array.isArray(r3?.para_examen) ? r3.para_examen.map((p: string) => ({ punto: p, por_que: '' })) : [],
        probabilidad_examen: Array.isArray(r3?.probabilidad_examen) ? r3.probabilidad_examen : [],
        ya_puedes_explicar: partesMicro.slice(0, 5).map((p: any) => p.titulo).filter(Boolean),
        resumen_final: r3?.resumen || '',
        preguntas_sugeridas: pregData.split('\n').slice(0, 3).map((x: string) => x.split('Respuesta')[0].trim()).filter(Boolean),
        preguntale_alai: es ? 'Puedes preguntarme cualquier duda sobre este material.' : 'You can ask me any question about this material.',
        __compact: compact,
      };

      console.log(`🎯 Micro-síntesis: ${partesMicro.length} partes generadas para ${doc.nombre}`);

      if (!cA || !cB) {
        console.warn(`⚠️ No se pudo sintetizar material: ${doc.nombre}`);

        const compact = compactExtractedKnowledge(extracted);

        cA = cA || {
          titulo: `Profesor ALAI — ${doc.nombre}`,
          objetivos: compact.ideas.slice(0, 20),
          si_no_sabes_nada: compact.temas.join('. '),
          mapa_inicial: compact.ideas.slice(0, 10).join('. '),
          cobertura_material: compact.noOmitir.map((x:any) => ({
            elemento: x,
            por_que_importa: x,
          })),
          clase_narrativa: compact.ideas.slice(0, 20).map((x:any, i:number) => ({
            titulo: `Parte ${i + 1}`,
            explicacion: x,
            ejemplo: compact.ejemplos[i] || x,
            checkpoint: x,
          })),
        };

        cB = cB || {
          panorama_completo: compact.ideas.join('. '),
          conexiones_clave: compact.relaciones.map((x:any) => ({
            titulo: x,
            explicacion: x,
          })),
          errores_comunes: compact.confusiones.map((x:any) => ({
            error: x,
            correccion: x,
            mini_ejemplo: x,
          })),
          preguntas_profesor: compact.preguntas.map((x:any) => ({
            pregunta: x,
            que_evalua: x,
            respuesta_esperada: x,
          })),
          para_examen: compact.noOmitir.slice(0,30).map((x:any) => ({
            punto: x,
            por_que: x,
          })),
          ya_puedes_explicar: compact.ideas.slice(0,30),
          preguntas_sugeridas: compact.preguntas.slice(0,20),
          resumen_final: compact.temas.join('. '),
          preguntale_alai: 'Pregunta cualquier punto del material.',
        };
      }

      materialAnalyses.push({
        materialId: doc.id,
        materialName: doc.nombre,
        cA,
        cB,
        extracted,
      });
    }

    if (!materialAnalyses.length) {
      return NextResponse.json(
        { error: 'No se pudo construir una clase clara con los materiales enviados.' },
        { status: 500 },
      );
    }

    let cA = materialAnalyses[0].cA;
    let cB = materialAnalyses[0].cB;

    // ─── 3) Si hay varios materiales, NO usar otra compresión LLM:
    //       se conserva la clase completa de cada material y se evita mezclar temas.
    if (materialAnalyses.length > 1) {
      const perMaterial = materialAnalyses.map((m) =>
        buildAnalisisFromParts({
          cA: m.cA,
          cB: m.cB,
          lang,
          detectedLang,
          docNames: [m.materialName],
        }),
      );

      const analisis = buildMultiMaterialAnalisis({
        perMaterial,
        materialNames: materialAnalyses.map((m) => m.materialName),
        detectedLang,
      });

      console.log(
        `👨‍🏫 Profesor ALAI multi-material directo: ${analisis.clase_narrativa.length} partes, ${analisis.cobertura_material.length} elementos, coverage=${analisis.coverage.percent}%`,
      );

      if (materialId && userId) {
        saveMaterialResult({
          material_id: materialId,
          enfoque: 'teorico',
          result_type: 'analysis',
          payload: analisis,
        }).catch(e => console.warn('Cache write error:', e?.message));
      }

      return NextResponse.json({ success: true, analisis });
    }

    // ─── 4) Construir resultado final desde partes sintetizadas ───
    const analisis = buildAnalisisFromParts({ cA, cB, lang, detectedLang, docNames });

    if (analisis.clase_narrativa.length === 0 || (!analisis.si_no_sabes_nada && !analisis.mapa_inicial)) {
      console.warn('⚠️ Analisis vacío, construyendo fallback final compacto');

      const compact = compactExtractedKnowledge(
        materialAnalyses.flatMap((m) => m.extracted || [])
      );

      const fallback = makeHumanTeachingLesson({
        cA: { __compact: compact, titulo: 'Profesor ALAI' },
        cB: { __compact: compact },
        lang,
        detectedLang,
        docNames,
      });

      return NextResponse.json({ success: true, analisis: fallback });
    }

    console.log(
      `👨‍🏫 Profesor ALAI chunked: ${analisis.clase_narrativa.length} partes, ${analisis.cobertura_material.length} elementos, docs=${docNames.length}`,
    );

    // ─── Guardar en cache ───
    if (materialId && userId) {
      saveMaterialResult({
        material_id: materialId,
        enfoque: 'teorico',
        result_type: 'analysis',
        payload: analisis,
      }).catch(e => console.warn('Cache write error:', e?.message));
    }

    return NextResponse.json({ success: true, analisis });

  } catch (error: any) {
    console.error('analizar-teorico error:', error);
    return NextResponse.json(
      { error: error?.message || 'Error generando análisis' },
      { status: 500 },
    );
  }
}