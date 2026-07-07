// ═══════════════════════════════════════════════════════════════
// TEACHER BRAIN — El profesor pedagógico
// 
// Este agente NO decide formatos de UI.
// Este agente decide NECESIDADES PEDAGÓGICAS.
// 
// Otra capa traduce esas necesidades a widgets visuales.
// ═══════════════════════════════════════════════════════════════

import { alaiRequest, safeParseJson } from '../../../alai'
import type {
  MaterialIntelligence,
  TopicNode,
  StudentModel,
} from '../types'

// ═══════════════════════════════════════════════════════════════
// NECESIDADES PEDAGÓGICAS (no formatos)
// ═══════════════════════════════════════════════════════════════
export type PedagogicalNeed =
  | 'introduce_concept'         // Presentar algo nuevo
  | 'explain_with_context'      // Explicar con contexto/historia
  | 'show_concrete_example'     // Ejemplo tangible del material
  | 'break_into_microconcepts'  // Dividir en piezas pequeñas
  | 'visualize_mentally'        // Ayudar a visualizar
  | 'connect_to_known'          // Conectar con lo que ya sabe
  | 'reconstruct_from_error'    // Reconstruir después de un error
  | 'reveal_correct_answer'     // Mostrar la respuesta y explicarla
  | 'guided_practice'           // Practicar con guía
  | 'verify_understanding'      // Verificar comprensión
  | 'test_transfer'             // Probar transferencia a contexto nuevo
  | 'consolidate_topic'         // Cierre y síntesis del topic
  | 'transition_to_next_topic'  // Pasar al siguiente
  | 'close_session'             // Cerrar sesión

export type MicroConceptState =
  | 'not_introduced'      // No se ha visto
  | 'introduced'          // Se explicó pero no verificado
  | 'partially_grasped'   // Entendido parcialmente
  | 'understood'          // Entendido pero no aplicado
  | 'applied'             // Aplicado exitosamente
  | 'mastered'            // Dominado con transferencia
  | 'confused'            // Explicado pero no entendido
  | 'blocked'             // Múltiples fallos

export interface MicroConcept {
  id: string
  parentTopicId: string
  name: string
  description: string
  requiredFor: string[]        // Otros micros que dependen de este
  state: MicroConceptState
  attemptCount: number
  lastError?: string           // Qué falló específicamente la última vez
}

export interface TeacherDecision {
  need: PedagogicalNeed
  targetMicroConceptId: string | null
  targetTopicId: string
  reasoning: string             // Por qué eligió esta necesidad
  contentGuidance: {
    focus: string               // Qué debe abordar el contenido
    tone: 'introductory' | 'explanatory' | 'corrective' | 'challenging' | 'closing'
    depth: 'surface' | 'medium' | 'deep'
    useMaterial: string[]       // Qué partes del material usar
    avoidRepeating: string[]    // Qué NO volver a decir
  }
  verificationCriteria: string  // Cómo saber si el estudiante entendió
  expectedResponse: string      // Qué tipo de respuesta esperar (no formato)
  shouldAdvanceTopic: boolean
  shouldCloseSession: boolean
}

// ═══════════════════════════════════════════════════════════════
// CONTEXTO DE ENSEÑANZA (todo lo que el brain necesita saber)
// ═══════════════════════════════════════════════════════════════
export interface TeachingContext {
  currentTopic: TopicNode
  currentTopicMicroConcepts: MicroConcept[]
  student: StudentModel
  material: MaterialIntelligence
  
  // Historial reciente REAL
  conversationHistory: Array<{
    role: 'teacher' | 'student'
    what: string                // Qué se dijo o preguntó (no el formato)
    outcome?: 'correct' | 'incorrect' | 'partial'
    misunderstood?: string      // Qué específicamente no entendió
    timestamp: number
  }>
  
  // Estado emocional/cognitivo
  studentEnergy: 'fresh' | 'engaged' | 'tired' | 'frustrated'
  consecutiveErrors: number
  consecutiveCorrect: number
  timeInTopic: number           // Minutos en el topic actual
  
  // Objetivos
  isLastTopicInSession: boolean
  sessionMinutesElapsed: number
  sessionMinutesTarget: number
}

// ═══════════════════════════════════════════════════════════════
// FUNCIÓN PRINCIPAL: DECIDIR NECESIDAD PEDAGÓGICA
// ═══════════════════════════════════════════════════════════════
export async function decidePedagogicalNeed(
  context: TeachingContext,
): Promise<TeacherDecision> {

  // Construir contexto conversacional real (no lista de widgets)
  const conversationSummary = buildConversationSummary(context.conversationHistory)
  const microConceptStatus = buildMicroConceptStatus(context.currentTopicMicroConcepts)
  const profile = context.student.profile as any
  const setup = context.student.setup as any

  const prompt = `Eres un TUTOR HUMANO expertísimo. Tu única responsabilidad es decidir QUÉ NECESITA PEDAGÓGICAMENTE el estudiante en este momento.

NO piensas en formatos de UI (multiple choice, matching, etc). Eso lo decide otra capa.
Tú piensas en NECESIDADES DE APRENDIZAJE.

═══════════════════════════════════════════════════════════════
QUIÉN ESTÁ ESTUDIANDO
═══════════════════════════════════════════════════════════════
${profile?.nombre || 'Estudiante'}${profile?.carrera ? ' (' + profile.carrera + ')' : ''}
Nivel inicial declarado: ${setup?.initialKnowledgeLevel || 'some'}
Objetivo: ${setup?.targetScore || 80}/100
Energía actual: ${context.studentEnergy}

═══════════════════════════════════════════════════════════════
TOPIC ACTUAL
═══════════════════════════════════════════════════════════════
"${context.currentTopic.title}"
Tipo: ${context.currentTopic.topicType}
Importancia: ${context.currentTopic.importance}
Tiempo en este topic: ${context.timeInTopic} min

CONTENIDO REAL DEL TOPIC:
${context.currentTopic.rawText.slice(0, 1500)}

HECHOS CLAVE:
${context.currentTopic.keyFacts.map(f => '- ' + f).join('\n')}

OBJETIVOS DE APRENDIZAJE:
${context.currentTopic.learningObjectives.map(o => '- ' + o).join('\n')}

═══════════════════════════════════════════════════════════════
MICROCONCEPTOS DEL TOPIC Y SU ESTADO
═══════════════════════════════════════════════════════════════
${microConceptStatus}

═══════════════════════════════════════════════════════════════
QUÉ HA PASADO EN LA CONVERSACIÓN
═══════════════════════════════════════════════════════════════
${conversationSummary || 'Aún no hay conversación. Este es el primer momento con este topic.'}

Errores consecutivos: ${context.consecutiveErrors}
Aciertos consecutivos: ${context.consecutiveCorrect}
Es el último topic de la sesión: ${context.isLastTopicInSession ? 'SÍ' : 'NO'}

═══════════════════════════════════════════════════════════════
TU DECISIÓN
═══════════════════════════════════════════════════════════════

Como TUTOR HUMANO, ¿qué necesita el estudiante AHORA MISMO?

Piensa así:
1. ¿Qué microconcepto específico está trabajándose?
2. ¿En qué estado está ese microconcepto? ¿Introducido? ¿Confundido? ¿Dominado?
3. ¿Cuál es la NECESIDAD PEDAGÓGICA real?
   - ¿Necesita que le PRESENTE algo nuevo?
   - ¿Necesita un EJEMPLO CONCRETO?
   - ¿Necesita que RECONSTRUYA después de un error?
   - ¿Necesita que le REVELE la respuesta correcta con explicación?
   - ¿Necesita PRACTICAR con guía?
   - ¿Necesita que VERIFIQUE su comprensión?
   - ¿Necesita PROBAR TRANSFERENCIA?
   - ¿Es momento de CONSOLIDAR y avanzar?

═══════════════════════════════════════════════════════════════
REGLAS ABSOLUTAS (NO ROMPER)
═══════════════════════════════════════════════════════════════

REGLA #1 — NO REPETIR:
- Si el último turno fue "introduce_concept" y el estudiante hizo "continuar" → JAMÁS elijas "introduce_concept" otra vez para el mismo microconcepto.
- Debes AVANZAR: usa "verify_understanding" (pregunta), "guided_practice" (ejercicio), o pasa al siguiente microconcepto.

REGLA #2 — AVANZAR ENTRE MICROCONCEPTOS:
- Si el microconcepto actual está en estado "introduced" o "understood" → CAMBIA a OTRO microconcepto que esté "not_introduced".
- Si TODOS los microconceptos están al menos "introduced" → shouldAdvanceTopic: true.

REGLA #3 — DESPUÉS DE ENSEÑAR, VERIFICAR:
- Si acabas de introducir un concepto (turno anterior fue enseñar sin pregunta) → el próximo turno DEBE ser una pregunta ("verify_understanding" o "guided_practice").

REGLA #4 — DESPUÉS DE FALLAR:
- Si el estudiante falló → NO repetir la misma pregunta. Usa "reveal_correct_answer" o "reconstruct_from_error".
- Si lleva 2+ errores en el mismo microconcepto → revelar respuesta y AVANZAR al siguiente microconcepto.

REGLA #5 — CIERRE:
- Si es el último topic y todos los microconceptos están al menos "introduced" → shouldCloseSession: true.

REGLA #6 — MIRA EL HISTORIAL:
- Si en los últimos 3 turnos hiciste la misma "need" → cámbiala obligatoriamente.
- Si ves que el estudiante ya continuó 2 veces sin responder preguntas → HAZ UNA PREGUNTA ahora.

Devuelve SOLO este JSON:
{
  "need": "introduce_concept | explain_with_context | show_concrete_example | break_into_microconcepts | visualize_mentally | connect_to_known | reconstruct_from_error | reveal_correct_answer | guided_practice | verify_understanding | test_transfer | consolidate_topic | transition_to_next_topic | close_session",
  "targetMicroConceptId": "id_o_null",
  "reasoning": "En 1-2 oraciones: por qué esto es lo que necesita AHORA (pensando como profesor humano, no como sistema)",
  "contentGuidance": {
    "focus": "Exactamente qué debe abordar (ej: 'Explicar por qué H+ empieza en 0.040M en la segunda ionización')",
    "tone": "introductory | explanatory | corrective | challenging | closing",
    "depth": "surface | medium | deep",
    "useMaterial": ["Cita o parte del material a usar"],
    "avoidRepeating": ["Cosas que ya se dijeron y NO se deben repetir"]
  },
  "verificationCriteria": "Cómo saber si entendió (ej: 'Puede explicar con sus palabras por qué')",
  "expectedResponse": "Qué tipo de respuesta esperamos (ej: 'Una explicación de 2-3 oraciones' o 'Una respuesta corta identificando el valor')",
  "shouldAdvanceTopic": true|false,
  "shouldCloseSession": true|false
}`

  try {
    const result = await alaiRequest(async (client: any, modelFn: any) => {
      const res = await client.chat.completions.create({
        model: modelFn(),
        messages: [
          {
            role: 'system',
            content: 'Eres un tutor humano expertísimo. Decides NECESIDADES PEDAGÓGICAS, no formatos de UI. Respondes SOLO con JSON válido.',
          },
          { role: 'user', content: prompt },
        ],
        temperature: 0.4,
        max_tokens: 1200,
      })
      const raw = res?.choices?.[0]?.message?.content || ''
      if (!raw.trim()) throw new Error('Empty teacher brain response')
      return { text: raw, provider: 'unknown', model: 'unknown' }
    })

    const parsed = safeParseJson(result.text)
    if (!parsed?.need) {
      return buildFallbackDecision(context)
    }

    return {
      need: parsed.need,
      targetMicroConceptId: parsed.targetMicroConceptId || null,
      targetTopicId: context.currentTopic.id,
      reasoning: parsed.reasoning || 'Continuar enseñando',
      contentGuidance: {
        focus: parsed.contentGuidance?.focus || context.currentTopic.title,
        tone: parsed.contentGuidance?.tone || 'explanatory',
        depth: parsed.contentGuidance?.depth || 'medium',
        useMaterial: parsed.contentGuidance?.useMaterial || [],
        avoidRepeating: parsed.contentGuidance?.avoidRepeating || [],
      },
      verificationCriteria: parsed.verificationCriteria || 'El estudiante puede explicar el concepto',
      expectedResponse: parsed.expectedResponse || 'Explicación breve',
      shouldAdvanceTopic: Boolean(parsed.shouldAdvanceTopic),
      shouldCloseSession: Boolean(parsed.shouldCloseSession),
    }
  } catch (err: any) {
    console.error('[TeacherBrain]', err.message)
    return buildFallbackDecision(context)
  }
}

// ═══════════════════════════════════════════════════════════════
// EXTRAER MICROCONCEPTOS DE UN TOPIC
// ═══════════════════════════════════════════════════════════════
export async function extractMicroConcepts(
  topic: TopicNode,
): Promise<MicroConcept[]> {
  const prompt = `Divide este topic en MICROCONCEPTOS enseñables independientemente.

Un microconcepto es la unidad mínima de comprensión: una idea sola que se puede enseñar en 1-2 minutos.

TOPIC: "${topic.title}"
CONTENIDO: ${topic.rawText.slice(0, 1500)}
HECHOS: ${topic.keyFacts.join(', ')}

Devuelve 3-6 microconceptos. Solo JSON:
{
  "microConcepts": [
    {
      "name": "Nombre corto (ej: 'Definición de pH', 'Cálculo cuando [H+] cambia')",
      "description": "1 oración explicando qué es",
      "requiresPreviousMicros": ["names de otros micros que se necesitan antes"]
    }
  ]
}`

  try {
    const result = await alaiRequest(async (client: any, modelFn: any) => {
      const res = await client.chat.completions.create({
        model: modelFn(),
        messages: [
          { role: 'system', content: 'Extraes microconceptos pedagógicos. Solo JSON.' },
          { role: 'user', content: prompt },
        ],
        temperature: 0.3,
        max_tokens: 800,
      })
      const raw = res?.choices?.[0]?.message?.content || ''
      if (!raw.trim()) throw new Error('Empty')
      return { text: raw, provider: 'unknown', model: 'unknown' }
    })

    const parsed = safeParseJson(result.text)
    const items = parsed?.microConcepts || []

    return items.map((m: any, i: number) => ({
      id: `micro_${topic.id}_${i}_${Date.now()}`,
      parentTopicId: topic.id,
      name: m.name || `Microconcepto ${i + 1}`,
      description: m.description || '',
      requiredFor: [],
      state: 'not_introduced' as MicroConceptState,
      attemptCount: 0,
    }))
  } catch {
    // Fallback: convertir hechos clave en microconceptos
    return topic.keyFacts.slice(0, 4).map((fact, i) => ({
      id: `micro_${topic.id}_${i}_${Date.now()}`,
      parentTopicId: topic.id,
      name: fact.slice(0, 50),
      description: fact,
      requiredFor: [],
      state: 'not_introduced' as MicroConceptState,
      attemptCount: 0,
    }))
  }
}

// ═══════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════
function buildConversationSummary(history: TeachingContext['conversationHistory']): string {
  if (history.length === 0) return ''

  return history.slice(-8).map((entry, i) => {
    const marker = entry.role === 'teacher' ? '👨‍🏫 TÚ ENSEÑASTE' : '🎓 ESTUDIANTE RESPONDIÓ'
    const outcome = entry.outcome
      ? entry.outcome === 'correct' ? ' [✓ ACERTÓ]'
      : entry.outcome === 'incorrect' ? ' [✗ FALLÓ]'
      : ' [◐ PARCIAL]'
      : ''
    const misundInfo = entry.misunderstood ? `\n    ⚠ No entendió: ${entry.misunderstood}` : ''
    return `${i + 1}. ${marker}${outcome}\n    ${entry.what.slice(0, 200)}${misundInfo}`
  }).join('\n\n')
}

function buildMicroConceptStatus(micros: MicroConcept[]): string {
  if (micros.length === 0) return 'Aún no se han extraído microconceptos'

  return micros.map(m => {
    const stateEmoji = {
      not_introduced: '○',
      introduced: '◐',
      partially_grasped: '◑',
      understood: '◕',
      applied: '●',
      mastered: '✓',
      confused: '⚠',
      blocked: '✗',
    }[m.state]

    const attempts = m.attemptCount > 0 ? ` (${m.attemptCount} intentos)` : ''
    const lastErr = m.lastError ? `\n    Último error: ${m.lastError}` : ''
    return `${stateEmoji} ${m.name} [${m.state}]${attempts}${lastErr}`
  }).join('\n')
}

function buildFallbackDecision(context: TeachingContext): TeacherDecision {
  const firstMicro = context.currentTopicMicroConcepts.find(m => m.state === 'not_introduced')
    || context.currentTopicMicroConcepts[0]

  return {
    need: firstMicro ? 'introduce_concept' : 'verify_understanding',
    targetMicroConceptId: firstMicro?.id || null,
    targetTopicId: context.currentTopic.id,
    reasoning: 'Continuar enseñando (fallback)',
    contentGuidance: {
      focus: firstMicro?.name || context.currentTopic.title,
      tone: 'explanatory',
      depth: 'medium',
      useMaterial: context.currentTopic.keyFacts.slice(0, 2),
      avoidRepeating: [],
    },
    verificationCriteria: 'El estudiante puede explicar el concepto',
    expectedResponse: 'Explicación breve',
    shouldAdvanceTopic: false,
    shouldCloseSession: false,
  }
}
