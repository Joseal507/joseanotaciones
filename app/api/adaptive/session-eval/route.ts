import { sanitizeLatex } from '../../../../lib/adaptive/sanitizeLatex';
import { buildCheckpointAnalysis } from '../../../../lib/adaptive/evaluation/checkpointAnalysis';
import { NextRequest, NextResponse } from 'next/server'
import { alai, safeParseJson } from '../../../../lib/alai'
import { normalizeGeneratedQuestion, questionSimilarity, validateQuestion } from '../../../../lib/adaptive/evaluation/questionContract'
import type { EvaluationMode } from '../../../../lib/adaptive/evaluation/assessmentPlanner'
import type { CanonicalQuestion } from '../../../../lib/adaptive/evaluation/questionContract'
import {
  runGenerationPipeline,
  validateExpectedItemCount,
  type GenerationAttemptContext,
} from '../../../../lib/ai/generationPipeline'
import { runIdempotentGeneration } from '../../../../lib/ai/generationIdempotency'
import {
  validateRecoveryAlignment,
  type AssessmentBlueprint,
  type AssessmentQuestionPlan,
  type AssessmentQuestionTarget,
} from '../../../../lib/adaptive/evaluation/assessmentBlueprint'
import {
  EVALUATION_MODE_VIOLATION,
  evaluationModeContract,
  normalizeEvaluationMode,
  validateQuestionTypeForMode,
} from '../../../../lib/adaptive/evaluation/evaluationModeContract'
import {
  detectContentSignal,
  selectPedagogicalFormat,
  type FormatSelectionInput,
} from '../../../../lib/adaptive/evaluation/pedagogicalFormatSelector'
import { signQuestionsInPlace } from '../../../../lib/adaptive/evaluation/questionIntegrity'

export const maxDuration = 120
export const dynamic = 'force-dynamic'

interface TaughtStep {
  id: string
  type: string
  title: string
  content: string
  keyPoint: string | null
}

interface SessionEvalRequest {
  taughtSteps: TaughtStep[]
  mode: EvaluationMode
  sessionTitle: string
  materialTitle: string
  previousQuestions?: Array<{ id?: string; factKey?: string; questionText: string; format: string }>
  isReevaluation?: boolean
  failedConcepts?: string[]
  activeConceptId?: string
  activeConceptLabel?: string
  requiredQuestionCount?: number
  recoveryAttempt?: number
  generationKey?: string
  recoveryId?: string
  roundId?: string
  assessmentBlueprint?: AssessmentBlueprint
  assessmentQuestionPlan?: AssessmentQuestionPlan
  sourceRecoveryTarget?: {
    targetObjectiveIds: string[]
    microId: string
    factKeys: string[]
    cognitiveTarget: CanonicalQuestion['targetDimension']
  }
  academicDomain?: string
}

function buildAnalyzeAndGeneratePrompt(
  taughtSteps: TaughtStep[],
  mode: EvaluationMode,
  sessionTitle: string,
  materialTitle: string,
  previousQuestions: Array<{ id?: string; factKey?: string; questionText: string; format: string }>,
  isReevaluation: boolean = false,
  failedConcepts: string[] = [],
  requiredQuestionCount = 2,
  activeConceptLabel = '',
  checkpointAnalysis?: {
    summary: string
    objectives: Array<{
      id: string
      label: string
      kind: string
      coveredStepIds: string[]
      coveredKeyPoints: string[]
      cognitiveTarget: string
      weight: number
    }>
  },
  formatGuidance = '',
): string {
  const modeInstructions: Record<string, string> = {
    quick_test: `MODO: EVALUACIONES RÁPIDAS SIN ESCRIBIR — CONTRATO ESTRICTO

El estudiante eligió no escribir. Ninguna actividad puede requerir teclado,
input de texto, textarea, respuesta numérica escrita, explicación ni redacción.

FORMATOS PERMITIDOS: multiple_choice, multi_select, true_false, word_bank,
ordering, matching, classify, scenario y find_the_error con respuesta seleccionable.
FORMATOS PROHIBIDOS: short_response, numeric_problem, open_response,
fill_blank_text y cualquier formato que requiera composición por teclado.
Para producción o explicación transforma el objetivo en selección de la mejor
explicación, discriminación o reconocimiento. Conserva targetDimension como el
nivel realmente medido; no declares producción libre.`,

    write_explain: `MODO: QUIERO ESCRIBIR

El estudiante quiere demostrar comprensión escribiendo.
Eso significa formatos que le pidan expresar ideas con sus propias palabras.
Pero TÚ decides qué tipo de pregunta escrita conviene más para cada idea enseñada.

Guía del modo:
- Prioriza formatos donde el estudiante redacta, explica, compara o justifica.
- Evita formatos puramente de selección sin elaboración.
- La cantidad de preguntas y el tipo exacto dependen de lo enseñado, no de una cuota.`,

    mix_everything: `MODO: MIXTO

El estudiante acepta cualquier formato.
TÚ decides libremente qué mezcla de formatos conviene para evaluar mejor lo enseñado.

Guía del modo:
- Usa el formato que mejor evalúe cada idea específica.
- Puedes combinar formatos rápidos y formatos escritos según lo que necesite el contenido.
- La cantidad de preguntas y el tipo exacto dependen de lo enseñado, no de una cuota.`,

    read_only: `NO hay evaluación.`
  }

  const stepsText = taughtSteps.map((s, i) => `
═══ PASO ${i + 1} ═══
TIPO: ${s.type}
TÍTULO: ${s.title}
CONTENIDO:
${s.content}
${s.keyPoint ? `IDEA CLAVE: ${s.keyPoint}` : ''}
`).join('\n')

  const previousQText = previousQuestions.length > 0
    ? `\nPREGUNTAS YA HECHAS (NO REPETIR ni hacer similares):
${previousQuestions.map(q => `- [${q.format}] ${q.questionText}`).join('\n')}`
    : ''

  return `Eres un experto en evaluación pedagógica adaptativa.

MATERIAL: "${materialTitle}"
SESIÓN: "${sessionTitle}"

${modeInstructions[mode] || modeInstructions.mix_everything}

${isReevaluation ? `═══════════════════════════════════════════════════════════════
⚠️ RE-EVALUACIÓN POST-RETEACH
═══════════════════════════════════════════════════════════════

El estudiante FALLÓ conceptos de estos pasos y acaba de recibir una reenseñanza.
Necesitas verificar que REALMENTE aprendió y no fue suerte.

CONCEPTOS FALLADOS:
${failedConcepts.map((c: string, i: number) => (i + 1) + '. ' + c).join('\n')}
CONCEPTO ACTIVO ÚNICO: ${activeConceptLabel || failedConcepts[0] || 'el concepto reenseñado'}

HISTORIAL DE PREGUNTAS FALLADAS (lo que ya respondió mal):
${previousQuestions.filter(q => failedConcepts.some(c => q.questionText.toLowerCase().includes(c.toLowerCase().slice(0, 20)))).map(q => '- [' + q.format + '] ' + q.questionText).join('\n') || 'No disponible'}

TU TAREA:
1. Lee el contenido reenseñado (los pasos de abajo).
2. Para el concepto activo genera MÍNIMO ${requiredQuestionCount} preguntas desde ángulos diferentes.
   Esto es obligatorio para confirmar que aprendió y no fue suerte.
3. Si el concepto es complejo (fórmula, procedimiento, relación entre ideas) genera 3 o más.
   Tú decides cuántas más según la complejidad real del contenido.
4. Usa tipos de pregunta DIFERENTES a los que falló antes — tú decides cuáles convienen.
5. Cada pregunta debe evaluar el mismo concepto desde un ángulo distinto:
   reconocimiento, comprensión, aplicación, causa, consecuencia, ejemplo, etc.
6. NO hagas preguntas idénticas ni muy similares a las previas.
7. CRÍTICO — Si el concepto fallado involucra un cálculo, fórmula o procedimiento matemático:
   - DEBES generar al menos 1 pregunta de aplicación con un valor numérico DIFERENTE al original.
   - Ejemplo: si falló calcular E para n=2, genera una pregunta con n=3 o n=4.
   - La pregunta puede ser multiple_choice con 4 opciones numéricas calculadas correctamente.
   - Verifica que tu respuesta correcta sea matemáticamente exacta antes de incluirla.
   - Esto es obligatorio — confirmar comprensión procedimental requiere un problema nuevo, no solo reconocimiento.
` : ''}═══════════════════════════════════════════════════════════════
PASOS QUE SE ACABAN DE ENSEÑAR${isReevaluation ? ' (REENSEÑADOS)' : ''}
═══════════════════════════════════════════════════════════════
${stepsText}
${previousQText}

═══════════════════════════════════════════════════════════════
ANÁLISIS DEL CHECKPOINT (NO EVALÚES PASO POR PASO)
═══════════════════════════════════════════════════════════════
${checkpointAnalysis ? checkpointAnalysis.summary : ''}

OBJETIVOS EMERGENTES DEL BLOQUE:
${checkpointAnalysis ? checkpointAnalysis.objectives.map((o, i) =>
`${i + 1}. ${o.label}
   - kind: ${o.kind}
   - cognitiveTarget: ${o.cognitiveTarget}
   - coveredStepIds: ${o.coveredStepIds.join(', ')}
   - coveredKeyPoints: ${o.coveredKeyPoints.join(' | ')}`
).join('\n') : 'No disponible'}

REGLA FUNDAMENTAL:
- NO generes preguntas “por paso”.
- Genera preguntas “por análisis del bloque”.
- Un checkpoint puede tener 2 o 3 preguntas que cubran 4 o 5 pasos si esas preguntas integran bien las ideas.
- coveredStepIds se usa como trazabilidad, NO como obligación de una pregunta por paso.

═══════════════════════════════════════════════════════════════
TU TAREA (DOS FASES)
═══════════════════════════════════════════════════════════════

FASE 1 — ANÁLISIS DE COBERTURA REAL:
Lee todo el contenido enseñado y construye un inventario preciso de ideas evaluables. No listes frases del texto. Identifica conceptos, relaciones, causas, consecuencias, definiciones, procedimientos, distinciones y aplicaciones reales.

Para cada idea pregúntate:
- ¿Es central o periférica?
- ¿Qué evidencia real demostraría comprensión (no solo memorización)?
- ¿Qué formato de pregunta rápida permite comprobarla mejor?
- ¿Ya fue evaluada antes con suficiente calidad?

GUÍA DE FORMATOS PEDAGÓGICOS PARA ESTE BLOQUE:
El selector determinístico eligió estos formatos como óptimos para el contenido detectado.
Úsalos como punto de partida, pero puedes ajustar si el contenido específico lo requiere.
${formatGuidance}

FORMATOS DISPONIBLES Y CUÁNDO USAR CADA UNO:
- multiple_choice: para definiciones, causalidad, comparaciones — siempre útil
- true_false: SOLO para afirmaciones binarias muy claras. Evitar en conceptos con matices.
- multi_select: para enumerar características o causas múltiples
- word_bank: para completar fórmulas, definiciones o procedimientos con términos clave
- ordering: para secuencias, procedimientos, cronologías
- matching: para relacionar conceptos con definiciones, causas con efectos
- classify: para categorizar elementos según criterios explícitos
- scenario: para aplicar conceptos a situaciones concretas (nivel application/transfer)
- find_the_error: para identificar errores en razonamientos o cálculos
- short_response: para explicar, comparar o justificar (solo en modo write_explain o mix_everything)
- numeric_problem: para cálculos con fórmulas (solo en matemáticas/ciencias, modo write_explain)

REGLA DE VARIEDAD:
- NO uses el mismo formato más de 2 veces seguidas en el mismo bloque
- Si la pregunta anterior fue true_false, la siguiente NO debe ser true_false
- Si ya hay 2 multiple_choice, la siguiente debe ser otro formato
- Varía el ángulo cognitivo: recognition → comprehension → application en ese orden cuando sea posible

GUÍA DE FORMATOS PEDAGÓGICOS PARA ESTE BLOQUE:
El selector determinístico eligió estos formatos como óptimos para el contenido detectado.
Úsalos como punto de partida, pero puedes ajustar si el contenido específico lo requiere.
${formatGuidance}

FORMATOS DISPONIBLES Y CUÁNDO USAR CADA UNO:
- multiple_choice: para definiciones, causalidad, comparaciones — siempre útil
- true_false: SOLO para afirmaciones binarias muy claras. Evitar en conceptos con matices.
- multi_select: para enumerar características o causas múltiples
- word_bank: para completar fórmulas, definiciones o procedimientos con términos clave
- ordering: para secuencias, procedimientos, cronologías
- matching: para relacionar conceptos con definiciones, causas con efectos
- classify: para categorizar elementos según criterios explícitos
- scenario: para aplicar conceptos a situaciones concretas (nivel application/transfer)
- find_the_error: para identificar errores en razonamientos o cálculos
- short_response: para explicar, comparar o justificar (solo en modo write_explain o mix_everything)
- numeric_problem: para cálculos con fórmulas (solo en matemáticas/ciencias, modo write_explain)

REGLA DE VARIEDAD:
- NO uses el mismo formato más de 2 veces seguidas en el mismo bloque
- Si la pregunta anterior fue true_false, la siguiente NO debe ser true_false
- Si ya hay 2 multiple_choice, la siguiente debe ser otro formato
- Varía el ángulo cognitivo: recognition → comprehension → application en ese orden cuando sea posible

FASE 2 — GENERAR PREGUNTAS DE ALTA CALIDAD:
Tu objetivo es obtener evidencia sólida del 100% de las ideas importantes enseñadas, con la menor cantidad posible de preguntas redundantes.

Reglas estrictas de calidad:
- NUNCA hagas preguntas literales ("El texto dice que... ¿es verdadero?").
- Cada pregunta debe requerir comprensión o aplicación, no mera repetición.
- No conviertas cada paso en una pregunta separada. Evalúa ideas integradas del bloque.
- Varía el ángulo cognitivo: reconocimiento, distinción, causa/consecuencia, aplicación, ejemplo nuevo, predicción, comparación.
- Si dos ideas están relacionadas, intenta una pregunta integradora de alta calidad antes de hacer dos separadas.
- NO repitas el mismo tipo de pregunta sobre la misma idea (ej: dos true/false seguidos sobre lo mismo).
- En modo quick_test: solo formatos sin escritura (multiple_choice, true_false, word_bank, ordering, matching, scenario, find_the_error).
- En re-evaluación: mínimo 2 preguntas por concepto fallado, desde ángulos completamente distintos a las que falló antes. Deben ser de mayor calidad que las anteriores.

Calidad > Cantidad.
Es mejor 2-3 preguntas excelentes que 8 preguntas repetitivas.

CONTRATO PEDAGÓGICO DEL CHECKPOINT:

TÚ DECIDES LA CANTIDAD DE PREGUNTAS.
No hay mínimo ni máximo fijo.
La cantidad correcta depende del contenido enseñado, no de una regla.

Piensa así:
- ¿Cuántos objetivos de aprendizaje distintos tiene este bloque?
- ¿Cuánta evidencia necesito para estar seguro de que el estudiante los entendió?
- ¿Puedo combinar 2 objetivos en 1 pregunta integradora?

Ejemplos:
- 1 concepto simple → 1 o 2 preguntas
- 1 fórmula matemática compleja → 3 o 4 preguntas (intuición, cálculo, aplicación)
- 3 conceptos relacionados y simples → 2 preguntas integradoras
- 2 conceptos difíciles e independientes → 4 preguntas (2 por concepto)

REGLAS:
- Cubre el 100% del contenido enseñado en este bloque.
- No preguntes lo mismo dos veces aunque sea con formato distinto.
- No conviertas cada paso en una pregunta separada — evalúa ideas del bloque.
- Prioriza comprensión, relación, aplicación, comparación, inferencia, causa-efecto.
- Usa verdadero/falso solo para contrastes binarios muy claros.
- Si puedes evaluar A+B+C con 2 preguntas integradoras, hazlo. No infles.
- Si el contenido es difícil o tiene matices, añade preguntas. No recortes arbitrariamente.

LA CANTIDAD JUSTA ES LA QUE GARANTIZA COMPRENSIÓN REAL SIN REDUNDANCIA.

REGLAS CRÍTICAS:
1. Cobertura real del 100% de las ideas importantes enseñadas.
2. Cero redundancia: cada pregunta debe aportar evidencia nueva o desde un ángulo distinto.
3. Alta exigencia cognitiva: prioriza comprensión y aplicación sobre reconocimiento puro.
4. En quick_test nunca generes preguntas que requieran escribir.
5. conceptLabel debe ser la idea específica que se está evaluando.
6. explanation debe explicar por qué la respuesta es correcta usando el contenido real.
7. LaTeX obligatorio y correcto: $...$ inline, $$...$$ display. Usa siempre \frac, \rightleftharpoons, \Delta n, etc.

REGLA DE FIDELIDAD AL MATERIAL:
- Solo evalúa lo que el material AFIRMA EXPLÍCITAMENTE.
- No inventes causalidades, consecuencias ni relaciones que el texto no establece.
- Si el texto dice "A atrajo la atención de B", puedes evaluar que A atrajo la atención de B.
- Pero NO puedes evaluar que "las colaboraciones de A fueron determinantes para el impacto de A" si el texto solo dice "A colaboró con B".
- La diferencia: el texto dice X → puedes evaluar X. El texto no dice Y → no puedes evaluar Y como si fuera un hecho.
- Puedes evaluar comprensión preguntando si el estudiante identifica qué dice el texto, pero no tratar inferencias como hechos.
- Si una idea es ambigua o una inferencia razonable pero no explícita, evalúa si el estudiante la identifica como tal, no como un hecho confirmado.

FORMATO DE CADA PREGUNTA:

Para multiple_choice/scenario/find_the_error:
{
  "variant": "mcq_best_answer",
  "conceptLabel": "idea específica evaluada",
  "questionText": "pregunta clara",
  "options": [{"id":"a","text":"..."},{"id":"b","text":"..."},{"id":"c","text":"..."},{"id":"d","text":"..."}],
  "correctAnswer": "a",
  "explanation": "por qué es correcta, usando el contenido enseñado",
  "hint": "pista útil sin dar la respuesta",
  "difficulty": "easy|medium|hard",
  "targetDimension": "recognition|comprehension|application|transfer",
  "estimatedSeconds": 30,
  "evidencesNeeded": 1
}

Para true_false:
{
  "variant": "true_false_factual",
  "conceptLabel": "...",
  "questionText": "afirmación para evaluar",
  "options": null,
  "correctAnswer": true,
  "explanation": "...",
  "hint": "...",
  "difficulty": "easy",
  "targetDimension": "recognition",
  "estimatedSeconds": 15,
  "evidencesNeeded": 1
}

Para short_answer/explain_why:
{
  "variant": "short_answer_define",
  "conceptLabel": "...",
  "questionText": "pregunta abierta",
  "options": null,
  "correctAnswer": "respuesta esperada resumida",
  "explanation": "...",
  "hint": "...",
  "difficulty": "medium",
  "targetDimension": "comprehension",
  "estimatedSeconds": 60,
  "evidencesNeeded": 1
}

Para word_bank:
{
  "variant": "word_bank_fill",
  "conceptLabel": "...",
  "questionText": "Texto con ___ para completar y ___ más blancos",
  "options": [{"id":"w1","text":"palabra1"},{"id":"w2","text":"palabra2"},{"id":"w3","text":"distractor1"},{"id":"w4","text":"distractor2"}],
  "correctAnswer": ["palabra1","palabra2"],
  "explanation": "...",
  "hint": "...",
  "difficulty": "medium",
  "targetDimension": "recognition",
  "estimatedSeconds": 30,
  "evidencesNeeded": 1
}

Para ordering:
{
  "variant": "ordering_steps",
  "conceptLabel": "...",
  "questionText": "Ordena estos pasos correctamente",
  "options": [{"id":"s1","text":"paso 1"},{"id":"s2","text":"paso 2"},{"id":"s3","text":"paso 3"}],
  "correctAnswer": ["s1","s2","s3"],
  "explanation": "...",
  "hint": "...",
  "difficulty": "medium",
  "targetDimension": "comprehension",
  "estimatedSeconds": 45,
  "evidencesNeeded": 1
}

Para matching:
{
  "variant": "matching_concept_def",
  "matchingSemantics": "bijective",
  "conceptLabel": "...",
  "questionText": "Empareja cada concepto con su definición",
  "options": [{"id":"p1","left":"concepto1","rightId":"r1","right":"def1"},{"id":"p2","left":"concepto2","rightId":"r2","right":"def2"}],
  "correctAnswer": {"p1":"def1","p2":"def2"},
  "explanation": "...",
  "hint": "...",
  "difficulty": "medium",
  "targetDimension": "recognition",
  "estimatedSeconds": 45,
  "evidencesNeeded": 1
}

Usa "matchingSemantics":"many_to_one" únicamente cuando el objetivo permita
legítimamente que varias filas compartan la misma respuesta y asigna el mismo
rightId a esas respuestas. En cualquier otro caso usa "bijective".

Devuelve SOLO JSON válido:
{
  "analysis": "Breve resumen de qué se enseñó y cuántas ideas evaluables encontraste",
  "questions": [ ... ]
}`
}

export async function POST(req: NextRequest) {
  let recoveryRequest = false
  let recoveryRemainingChecks = 0
  try {
    const body = await req.json() as SessionEvalRequest
    const {
      taughtSteps,
      mode: requestedMode,
      sessionTitle,
      materialTitle,
      previousQuestions = [],
      isReevaluation = false,
      failedConcepts = [],
      activeConceptId,
      activeConceptLabel,
      requiredQuestionCount = 2,
      generationKey,
      assessmentBlueprint,
      assessmentQuestionPlan,
      sourceRecoveryTarget,
    } = body
    const mode = normalizeEvaluationMode(requestedMode)
    evaluationModeContract(mode)
    console.info('[adaptive-evaluation]', JSON.stringify({
      event: 'evaluation_mode_contract_applied',
      mode,
      sessionId: body.sessionTitle,
      recoveryStatus: isReevaluation ? 'verification_generation' : 'normal',
    }))
    recoveryRequest = isReevaluation && Boolean(activeConceptId)
    recoveryRemainingChecks = Math.max(0, requiredQuestionCount)

    if (!taughtSteps || taughtSteps.length === 0) {
      return NextResponse.json({ success: false, error: 'No hay pasos para evaluar' }, { status: 400 })
    }

    if (mode === 'read_only') {
      return NextResponse.json({ success: true, questions: [], analysis: 'Modo lectura, sin evaluación.' })
    }

    const checkpointAnalysis = buildCheckpointAnalysis(taughtSteps)

    // ── Selección pedagógica de formatos para este bloque ────────
    // Determinístico: misma entrada → mismo resultado
    // No cambia el contrato de generación, solo enriquece el prompt
    const blockContentSignal = detectContentSignal(
      taughtSteps.map(s => `${s.title}: ${s.content}`).join(' ')
    )
    const resolvedAcademicDomain = (body.academicDomain as import('../../../../lib/adaptive/evaluation/pedagogicalFormatSelector').FormatSelectionInput['academicDomain']) || 'general_conceptual'
    const recentFormats = previousQuestions.map(q => q.format).filter(Boolean)
    const formatSuggestions: Array<ReturnType<typeof selectPedagogicalFormat>> = []
    for (let idx = 0; idx < 3; idx++) {
      const input: FormatSelectionInput = {
        cognitiveLevel: 'comprehension',
        contentSignal: blockContentSignal,
        academicDomain: resolvedAcademicDomain,
        evaluationMode: mode,
        recentFormats: idx === 0
          ? recentFormats
          : [...recentFormats, ...formatSuggestions.map(item => item.format)].filter(Boolean) as string[],
        consecutiveFailures: 0,
        isRecovery: isReevaluation,
        questionIndex: idx,
        totalQuestionsInBlock: 3,
      }
      formatSuggestions.push(selectPedagogicalFormat(input))
    }
    const formatGuidance = formatSuggestions.map((s, i) =>
      `  Pregunta ${i + 1}: formato="${s.format}", variante="${s.variant}", objetivo="${s.cognitiveObjective}"`
    ).join('\n')

    const prompt = buildAnalyzeAndGeneratePrompt(
      taughtSteps,
      mode,
      sessionTitle,
      materialTitle,
      previousQuestions,
      isReevaluation,
      failedConcepts,
      isReevaluation
        ? Math.max(1, Math.min(2, requiredQuestionCount))
        : checkpointAnalysis.recommendedQuestionCount,
      activeConceptLabel || '',
      checkpointAnalysis,
      formatGuidance,
    )

    type QuestionBatch = { analysis: string; questions: CanonicalQuestion[]; driftErrors: string[] }
    const assessmentDirective = assessmentQuestionPlan?.plannedQuestions.length
      ? `\n\nASSESSMENT BLUEPRINT — CONTRATO ESTRICTO:\n${assessmentQuestionPlan.plannedQuestions.map((planned, index) => {
          const objectives = assessmentBlueprint?.objectives.filter(objective =>
            planned.targetObjectiveIds.includes(objective.objectiveId),
          ) || []
          return `${index + 1}. targetObjectiveIds=${JSON.stringify(planned.targetObjectiveIds)}; microId=${objectives[0]?.microId || activeConceptId || ''}; factKeys=${JSON.stringify(objectives.flatMap(objective => objective.factKeys))}; cognitiveTarget=${objectives[0]?.cognitiveTarget || 'comprehension'}; tipos=${planned.preferredTypes.join(',')}`
        }).join('\n')}\nCada pregunta debe devolver exactamente targetObjectiveIds y exigir realmente esos objetivos. No inventes referencias a números de pasos.`
      : ''
    const stageInstruction = (context: GenerationAttemptContext): string => {
      const feedback = context.validationErrors.length
        ? `ERRORES DEL INTENTO ANTERIOR:\n${context.validationErrors.map(error => `- ${error}`).join('\n')}`
        : ''
      if (context.stage === 'format_repair') {
        return `${feedback}\nDevuelve exclusivamente JSON válido, sin fences ni comentarios. Conserva el contenido académico y reduce campos opcionales.`
      }
      if (context.stage === 'targeted_repair') {
        return `${feedback}\nRegenera solo los elementos rechazados. Corrige específicamente la causa indicada, usa únicamente el material fuente y no repitas preguntas del historial.`
      }
      if (context.stage === 'simplified') {
        return `${feedback}\nTarea simplificada: genera un esquema JSON mínimo con preguntas autosuficientes. Una idea, una operación cognitiva y un formato compatible por pregunta.`
      }
      if (context.stage === 'split_individual') {
        const accepted = context.acceptedItemSummaries.length
          ? `\nPREGUNTAS YA ACEPTADAS Y CONSERVADAS:\n${context.acceptedItemSummaries.map(item => `- ${item}`).join('\n')}`
          : ''
        return `${feedback}${accepted}\nGenera EXACTAMENTE UNA pregunta: la ${Number(context.partIndex) + 1} de ${context.partCount}. Debe cubrir un objetivo cognitivo distinto de las preguntas aceptadas.`
      }
      if (context.stage === 'alternate_provider') {
        return `${feedback}\nÚltima estrategia IA: reconstruye la salida desde el material con un prompt compacto. No reutilices estructuras rechazadas.`
      }
      return ''
    }
    const normalizeBatch = (raw: unknown, context: GenerationAttemptContext): QuestionBatch => {
      const record = raw && typeof raw === 'object' && !Array.isArray(raw)
        ? raw as Record<string, unknown>
        : {}
      const rawQuestions = Array.isArray(record.questions) ? record.questions : []
      const allConceptLabels = rawQuestions
        .map(question => question && typeof question === 'object' && !Array.isArray(question)
          ? String((question as Record<string, unknown>).conceptLabel || '')
          : '')
        .filter(Boolean)
      const driftErrors: string[] = []
      const questions = rawQuestions.flatMap((rawQuestion, index) => {
        const modelQuestion = rawQuestion && typeof rawQuestion === 'object' && !Array.isArray(rawQuestion)
          ? rawQuestion as Record<string, unknown>
          : {}
        // Validar el target REAL producido por el modelo — ANTES de derivar conceptId/
        // targetDimension/factKeys del target canónico más abajo. Validar después de esa
        // derivación es tautológico: compara el target contra una copia de sí mismo.
        if (isReevaluation && sourceRecoveryTarget) {
          const generatedTarget = {
            targetObjectiveIds: Array.isArray(modelQuestion.targetObjectiveIds) ? modelQuestion.targetObjectiveIds.map(String) : [],
            microId: String(modelQuestion.conceptId || ''),
            factKeys: Array.isArray(modelQuestion.factKeys) ? modelQuestion.factKeys.map(String) : [],
            cognitiveTarget: (String(modelQuestion.targetDimension || '') || 'comprehension') as AssessmentQuestionTarget['cognitiveTarget'],
            questionText: typeof modelQuestion.questionText === 'string' ? modelQuestion.questionText : undefined,
          }
          const alignment = validateRecoveryAlignment(sourceRecoveryTarget, generatedTarget)
          if (!alignment.valid) {
            console.warn('[adaptive-recovery]', JSON.stringify({
              event: 'recovery_target_drift_detected',
              stage: 'session_eval_normalize',
              recoveryId: body.recoveryId,
              roundId: body.roundId,
              errors: alignment.errors,
              generated: generatedTarget,
              expected: sourceRecoveryTarget,
            }))
            driftErrors.push(`question_${index + 1}:${alignment.errors.join(',')}`)
            return []
          }
        }
        const planned = assessmentQuestionPlan?.plannedQuestions[context.partIndex ?? index]
        const targetObjectiveIds = Array.isArray(modelQuestion.targetObjectiveIds)
          ? modelQuestion.targetObjectiveIds.map(String).filter(id => planned?.targetObjectiveIds.includes(id))
          : planned?.targetObjectiveIds || sourceRecoveryTarget?.targetObjectiveIds || []
        const objective = assessmentBlueprint?.objectives.find(candidate =>
          targetObjectiveIds.includes(candidate.objectiveId),
        )
        const conceptLabel = activeConceptLabel ||
          (typeof modelQuestion.conceptLabel === 'string' ? modelQuestion.conceptLabel : `concept_${index}`)
        const conceptId = sourceRecoveryTarget?.microId || objective?.microId || activeConceptId || conceptLabel
        const targetDimension = sourceRecoveryTarget?.cognitiveTarget || objective?.cognitiveTarget || 'comprehension'
        const factKeys = sourceRecoveryTarget?.factKeys || objective?.factKeys || []
        const question = normalizeGeneratedQuestion({ ...modelQuestion, conceptId, conceptLabel }, {
          activeConceptId: conceptId,
          activeConceptLabel: conceptLabel,
          teachingBlockId: taughtSteps[0]?.id || 'step',
          targetDimension,
          questionFamily: isReevaluation ? 'recovery_question' : 'session_eval',
          allowedConceptIds: activeConceptId ? [activeConceptId] : allConceptLabels.length ? allConceptLabels : [conceptLabel],
          forbiddenConceptIds: [],
          evaluationMode: mode,
          sessionId: body.sessionTitle,
          targetObjectiveIds,
          factKeys,
        }, `q_eval_${context.attempt}_${context.partIndex ?? index}_${Date.now()}`)
        return question ? [question] : []
      })
      return {
        analysis: typeof record.analysis === 'string' ? record.analysis : '',
        questions,
        driftErrors,
      }
    }
    const executePipeline = () => runGenerationPipeline<QuestionBatch>({
      taskType: isReevaluation ? 'recovery_question' : 'evaluation_question',
      totalTimeoutMs: isReevaluation ? 110_000 : 105_000,
      failurePath: isReevaluation ? 'comprehensive' : 'single_repair',
      maxIndividualAttemptsPerPart: isReevaluation ? 2 : 1,
      splitCount: requiredQuestionCount > 1 ? requiredQuestionCount : undefined,
      getItemCount: batch => batch.questions.length,
      describeItems: batch => batch.questions.map(question => question.questionText),
      selectAcceptedPartial: (batch, failure) => {
        if (!batch.questions.length) return null
        if (failure === 'SEMANTIC_DUPLICATION') {
          return { ...batch, questions: [batch.questions[0]] }
        }
        if (batch.questions.length < Math.max(1, requiredQuestionCount)) return batch
        return null
      },
      mergeParts: batches => ({
        analysis: batches.map(batch => batch.analysis).filter(Boolean).join(' '),
        questions: batches.flatMap(batch => batch.questions),
        driftErrors: batches.flatMap(batch => batch.driftErrors),
      }),
      generate: async context => {
        const result = await alai({
          messages: [{ role: 'user', content: `${prompt}${assessmentDirective}\n\n${stageInstruction(context)}` }],
          temperature: context.stage === 'targeted_repair' ? 0.45 : 0.3,
          maxTokens: context.stage === 'split_individual' ? 1800 : 4500,
          json: true,
          fallbackError: context.providerError,
          taskType: isReevaluation ? 'recovery_question' : 'evaluation_question',
          stage: context.stage,
        })
        const parsed = safeParseJson(result.text)
        if (parsed === null) throw new Error('INVALID_JSON')
        return {
          value: normalizeBatch(parsed, context),
          provider: result.provider,
          model: result.model,
        }
      },
      validate: (batch, context) => {
        const errors: string[] = []
        const expected = context.expectedItemCount
        errors.push(...validateExpectedItemCount(batch.questions.length, expected).errors)
        // El alineamiento de target de recovery ya se valida en normalizeBatch, contra el
        // dato crudo del modelo, ANTES de derivar conceptId/targetDimension/factKeys del
        // target canónico. Validar aquí sería tautológico (batch.questions ya normalizado).
        errors.push(...batch.driftErrors)
        for (const question of batch.questions) {
          const plannedQuestion = assessmentQuestionPlan?.plannedQuestions.find(planned =>
            planned.targetObjectiveIds.length === (question.targetObjectiveIds || []).length &&
            planned.targetObjectiveIds.every(id => question.targetObjectiveIds?.includes(id)),
          )
          if (plannedQuestion && !plannedQuestion.preferredTypes.includes(question.format)) {
            errors.push(`INCOMPATIBLE_ACTIVITY:planned_type:${question.format}`)
          }
          const modeValidation = validateQuestionTypeForMode(mode, question.format)
          if (!modeValidation.valid) errors.push(`${EVALUATION_MODE_VIOLATION}:${question.format}`)
          const validation = validateQuestion(question, {
            activeConceptId: question.conceptId,
            activeConceptLabel: question.conceptLabel,
            teachingBlockId: question.teachingBlockId,
            targetDimension: question.targetDimension,
            questionFamily: question.questionFamily,
            allowedConceptIds: activeConceptId ? [activeConceptId] : [question.conceptId],
            forbiddenConceptIds: [],
            evaluationMode: mode,
          }, [])
          errors.push(...validation.errors)
        }
        if (context.generationMode !== 'individual_part') {
          for (let left = 0; left < batch.questions.length; left++) {
            for (let right = left + 1; right < batch.questions.length; right++) {
              if (questionSimilarity(batch.questions[left], batch.questions[right]) >= 0.78) {
                errors.push('SEMANTIC_DUPLICATION:questions_are_equivalent')
              }
            }
          }
        }
        for (const question of batch.questions) {
          if (context.generationMode === 'individual_part') {
            const normalizedCurrent = question.questionText.toLowerCase().replace(/\W+/g, ' ').trim()
            if (context.acceptedItemSummaries.some(summary => {
              const normalizedAccepted = summary.toLowerCase().replace(/\W+/g, ' ').trim()
              return normalizedAccepted === normalizedCurrent
            })) {
              errors.push('SEMANTIC_DUPLICATION:accepted_partial_item')
            }
          }
          for (const previous of previousQuestions) {
            const sameFact = Boolean(question.factKey && previous.factKey && question.factKey === previous.factKey)
            const normalizedText = previous.questionText.toLowerCase().replace(/\W+/g, ' ').trim()
            const currentText = question.questionText.toLowerCase().replace(/\W+/g, ' ').trim()
            if ((!isReevaluation && sameFact) || normalizedText === currentText) errors.push('SEMANTIC_DUPLICATION:recent_question')
          }
        }
        return { valid: errors.length === 0, errors }
      },
      telemetry: (event, payload) => console.info('[ai-generation]', JSON.stringify({
        event,
        sessionId: sessionTitle,
        microId: activeConceptId,
        recoveryStatus: isReevaluation ? 'verification_generation' : 'normal',
        ...payload,
      })),
    })
    const pipelinePromise = runIdempotentGeneration(generationKey, executePipeline, () => {
      console.info('[ai-generation]', JSON.stringify({
        event: 'duplicateRequestSuppressed',
        generationKey,
        sessionId: sessionTitle,
        recoveryId: body.recoveryId,
        roundId: body.roundId,
      }))
    })
    const logicalStartedAt = Date.now()
    const pipeline = await pipelinePromise
    console.info('[ai-generation]', JSON.stringify({
      event: 'logical_generation_completed',
      generationKey,
      successOnFirstAttempt: pipeline.status === 'validated' &&
        pipeline.attempts.length === 1 &&
        pipeline.attempts[0]?.stage === 'normal',
      acceptedPartialItems: pipeline.content?.questions?.length || 0,
      totalLogicalOperationDurationMs: Date.now() - logicalStartedAt,
      nestedPipelineRestartPrevented: true,
    }))
    if (pipeline.status !== 'validated' || !pipeline.content) {
      return NextResponse.json({
        success: false,
        error: 'GENERATION_BUDGET_EXHAUSTED',
        retryable: true,
        nextAction: 'retry_generation',
        recoveryStatus: recoveryRequest ? 'verification_generation' : undefined,
        remainingChecks: recoveryRemainingChecks,
        attempts: pipeline.attempts.length,
        acceptedQuestions: pipeline.content?.questions || [],
      }, { status: 503 })
    }
    const analysis = pipeline.content.analysis
    let normalizedFinal = pipeline.content.questions

    // NO hay cap fijo de preguntas.
    // La cantidad la decide la IA según el contenido analizado.
    // Solo en reevaluación limitamos para no hacer la recuperación interminable.
    if (isReevaluation) {
      normalizedFinal = normalizedFinal.slice(0, Math.max(1, Math.min(2, requiredQuestionCount || 1)))
    }

    if (mode === 'write_explain') {
      const open = normalizedFinal.filter(question => ['short_response', 'numeric_problem'].includes(question.format))
      const closed = normalizedFinal.filter(question => !['short_response', 'numeric_problem'].includes(question.format))
      normalizedFinal = open.length > 0 ? [...open, ...closed] : normalizedFinal
    }
    console.log(`[session-eval] Valid questions after normalization: ${normalizedFinal.length}`)

    // Re-evaluación: logging de cobertura por concepto (sin relleno metacognitivo)
    if (isReevaluation && failedConcepts.length > 0) {
      const byConceptMap = new Map<string, typeof normalizedFinal>()
      for (const q of normalizedFinal) {
        const key = q.conceptLabel || q.conceptId || "unknown"
        if (!byConceptMap.has(key)) byConceptMap.set(key, [])
        byConceptMap.get(key)!.push(q)
      }
      for (const concept of failedConcepts) {
        const count = (byConceptMap.get(concept) || []).length
        console.log(`[session-eval] Re-eval concepto "${concept}": ${count} preguntas generadas`)
      }
      // Si el LLM generó 0 preguntas válidas, el fallback de abajo manejará el caso
      // No generamos preguntas metacognitivas (¿es correcto que X falló?) — nunca
    }

    if (normalizedFinal.length === 0) {
      return NextResponse.json({
        success: false,
        error: 'GENERATION_VALIDATION_EMPTY',
        retryable: true,
        nextAction: 'retry_generation',
        recoveryStatus: recoveryRequest ? 'verification_generation' : undefined,
        remainingChecks: recoveryRemainingChecks,
      }, { status: 503 })
    }

    const sanitizedQuestions = normalizedFinal.map(q => ({
      ...q,
      questionText: sanitizeLatex(q.questionText || ""),
      explanation:  sanitizeLatex(q.explanation  || ""),
      hint:         sanitizeLatex(q.hint         || ""),
      options: Array.isArray(q.options)
        ? q.options.map(option => q.format === 'matching'
          ? { ...option, left: sanitizeLatex(option.left), right: sanitizeLatex(option.right) }
          : { ...option, text: sanitizeLatex(option.text || "") })
        : q.options,
    }))
    // Codex Finding 2 — server-authoritative question contract: firmar cada
    // pregunta ANTES de enviarla al cliente (cubre tanto hidratación lazy
    // normal como generación de verificación de recovery, mismo punto de
    // salida único para ambos casos).
    signQuestionsInPlace(sanitizedQuestions as unknown as CanonicalQuestion[])
    return NextResponse.json({
      success: true,
      questions: sanitizedQuestions,
      analysis,
      ...(recoveryRequest ? {
        nextAction: 'answer_verification',
        recoveryStatus: 'verification_active',
        remainingChecks: recoveryRemainingChecks,
      } : {}),
    })

  } catch (err: any) {
    console.error('[session-eval] Error:', err?.message)
    return NextResponse.json(
      {
        success: false,
        error: err?.message || 'Error generando evaluación',
        ...(recoveryRequest ? {
          nextAction: 'retry_generation',
          recoveryStatus: 'verification_generation',
          remainingChecks: recoveryRemainingChecks,
        } : {}),
      },
      { status: 500 }
    )
  }
}
