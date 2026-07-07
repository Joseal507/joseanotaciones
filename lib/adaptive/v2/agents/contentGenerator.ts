// ═══════════════════════════════════════════════════════════════
// CONTENT GENERATOR
// 
// Recibe la NECESIDAD PEDAGÓGICA del Teacher Brain.
// Genera el CONTENIDO REAL + el WIDGET apropiado.
// 
// El Teacher decidió QUÉ necesita el estudiante.
// Este agente decide CÓMO presentárselo visualmente.
// ═══════════════════════════════════════════════════════════════

import { alaiRequest, safeParseJson } from '../../../alai'
import type { TeacherDecision, PedagogicalNeed } from './teacherBrain'
import type { TopicNode, MaterialIntelligence, StudentModel } from '../types'
import type { BookPage, Interaction } from '../types'

const genId = (prefix = 'id') => `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`

// ═══════════════════════════════════════════════════════════════
// MAPEO NECESIDAD → TIPO DE INTERACCIÓN SUGERIDO
// (esto es sugerencia, ALAI puede cambiarlo si tiene sentido)
// ═══════════════════════════════════════════════════════════════
const NEED_TO_INTERACTION: Record<PedagogicalNeed, string[]> = {
  introduce_concept: ['none'],                              // Solo enseñar, sin pregunta
  explain_with_context: ['none'],
  show_concrete_example: ['none'],
  break_into_microconcepts: ['none'],
  visualize_mentally: ['none'],
  connect_to_known: ['none'],
  reconstruct_from_error: ['none'],                         // Reexplicar sin preguntar
  reveal_correct_answer: ['none'],                          // Mostrar respuesta
  guided_practice: ['open_response', 'step_by_step_solver'],
  verify_understanding: ['open_response', 'quick_check', 'multiple_choice'],
  test_transfer: ['open_response', 'practical_case'],
  consolidate_topic: ['open_response', 'teach_back'],
  transition_to_next_topic: ['none'],
  close_session: ['none'],
}

// ═══════════════════════════════════════════════════════════════
// FUNCIÓN PRINCIPAL
// ═══════════════════════════════════════════════════════════════
export async function generateContentFromDecision(
  decision: TeacherDecision,
  topic: TopicNode,
  student: StudentModel,
): Promise<BookPage> {

  const profile = student.profile as any
  const carrera = profile?.carrera ? ` (${profile.carrera})` : ''
  const suggestedInteractions = NEED_TO_INTERACTION[decision.need] || ['none']
  const needsInteraction = !suggestedInteractions.includes('none')

  // Página del libro que corresponde
  const pageType = mapNeedToPageType(decision.need)

  const prompt = `Eres ALAI, un profesor humano brillante. Genera contenido real para enseñar.

═══════════════════════════════════════════════════════════════
NECESIDAD PEDAGÓGICA DECIDIDA
═══════════════════════════════════════════════════════════════
Necesidad: ${decision.need}
Por qué: ${decision.reasoning}
Foco: ${decision.contentGuidance.focus}
Tono: ${decision.contentGuidance.tone}
Profundidad: ${decision.contentGuidance.depth}

MATERIAL A USAR:
${decision.contentGuidance.useMaterial.join('\n') || 'Todo el topic'}

NO REPETIR (ya se dijo):
${decision.contentGuidance.avoidRepeating.join('\n') || '(nada específico)'}

═══════════════════════════════════════════════════════════════
CONTEXTO
═══════════════════════════════════════════════════════════════
Topic: "${topic.title}"
Estudiante${carrera}
Verificación esperada: ${decision.verificationCriteria}
Respuesta esperada: ${decision.expectedResponse}

Material completo del topic:
${topic.rawText.slice(0, 1500)}

═══════════════════════════════════════════════════════════════
GENERAR
═══════════════════════════════════════════════════════════════

Según la necesidad "${decision.need}":

${getGenerationInstructions(decision.need, decision.contentGuidance.depth)}

${needsInteraction
  ? `Incluye UNA interacción. Sugerencia: ${suggestedInteractions.join(' o ')}. Puedes elegir otra si tiene más sentido pedagógico.`
  : 'NO incluyas interacción. Solo enseña. La pregunta viene después.'}

Devuelve SOLO este JSON:
{
  "title": "Título breve o null",
  "content": {
    "tutorMessage": "Voz personal del tutor al estudiante (1-2 oraciones, natural)",
    "blocks": [
      { "type": "text", "text": "..." },
      { "type": "heading", "text": "...", "level": 2 },
      { "type": "formula", "plain": "...", "explanation": "..." },
      { "type": "example", "description": "...", "solution": "..." },
      { "type": "steps", "steps": [{"label":"1","content":"...","explanation":"..."}] },
      { "type": "callout", "variant": "info|warning|success|insight", "text": "..." },
      { "type": "list", "ordered": true, "items": ["..."] }
    ],
    "keyIdea": "Frase corta para recordar (opcional)"
  },
  ${needsInteraction ? `"interaction": {
    "interactionType": "multiple_choice | true_false | fill_blank | open_response | matching | ordering | step_by_step_solver | practical_case | teach_back | quick_check | explain_why",
    "prompt": "Pregunta clara",
    "data": {
      "type": "coincide con interactionType",
      // Para multiple_choice: options (4), correctIndex, explanation
      // Para true_false: statement, correctAnswer (bool), explanation
      // Para fill_blank: template, correctAnswers (array)
      // Para open_response: acceptedAnswers (opcional)
      // Para matching: pairs (array de {left, right}) 3-4 pares
      // Para ordering: items (array), correctOrder
      // Para step_by_step_solver: problem, expectedSteps, finalAnswer
      // Para practical_case: scenario, question, expectedElements
      // Para teach_back: concept, rubric
      // Para quick_check: acceptedAnswers
      // Para explain_why: phenomenon, expectedFactors
    }
  }` : `"interaction": null`}
}

REGLAS ABSOLUTAS:
- NUNCA repitas literalmente lo del bloque "avoidRepeating"
- USA información REAL del material
- Habla como profesor humano, natural, directo
- Si es reconstruction/reveal → muestra la RESPUESTA CORRECTA y explícala
- Si es introduce_concept → NO hagas pregunta, solo enseña
- Si es verify_understanding → pregunta simple y clara
- Máximo 4 bloques de contenido`

  try {
    const result = await alaiRequest(async (client: any, modelFn: any) => {
      const res = await client.chat.completions.create({
        model: modelFn(),
        messages: [
          {
            role: 'system',
            content: 'Eres ALAI, tutor humano. Generas contenido pedagógico natural. Solo JSON válido.',
          },
          { role: 'user', content: prompt },
        ],
        temperature: 0.5,
        max_tokens: 2000,
      })
      const raw = res?.choices?.[0]?.message?.content || ''
      if (!raw.trim()) throw new Error('Empty content generator response')
      return { text: raw, provider: 'unknown', model: 'unknown' }
    })

    const parsed = safeParseJson(result.text)
    if (!parsed?.content) {
      return buildFallbackPage(decision, topic, pageType)
    }

    const page: BookPage = {
      id: genId('page'),
      pageType,
      title: parsed.title || undefined,
      content: {
        blocks: Array.isArray(parsed.content?.blocks) ? parsed.content.blocks : [
          { type: 'text', text: 'Continuemos aprendiendo.' }
        ],
        tutorMessage: parsed.content?.tutorMessage,
        keyIdea: parsed.content?.keyIdea,
      },
      interaction: parsed.interaction ? buildInteraction(parsed.interaction) : undefined,
      topicId: topic.id,
      createdAt: Date.now(),
      isReteach: ['reconstruct_from_error', 'reveal_correct_answer'].includes(decision.need),
      isRescue: decision.need === 'reconstruct_from_error',
    }

    return page
  } catch (err: any) {
    console.error('[ContentGenerator]', err.message)
    return buildFallbackPage(decision, topic, pageType)
  }
}

// ═══════════════════════════════════════════════════════════════
// INSTRUCCIONES POR TIPO DE NECESIDAD
// ═══════════════════════════════════════════════════════════════
function getGenerationInstructions(need: PedagogicalNeed, depth: string): string {
  const instructions: Record<PedagogicalNeed, string> = {
    introduce_concept: `Presenta el concepto de forma clara y directa. 2-3 bloques máximo. Sin pregunta.`,

    explain_with_context: `Explica CON CONTEXTO: por qué existe, qué problema resuelve. 3-4 bloques.`,

    show_concrete_example: `Muestra UN ejemplo específico del material. Presenta el caso → resuelve → señala la lección.`,

    break_into_microconcepts: `Divide el concepto en pasos pequeños. Cada paso = un bloque de steps.`,

    visualize_mentally: `Ayuda a visualizar. Usa analogías cotidianas, comparaciones, "imagina que...".`,

    connect_to_known: `Conecta con algo que el estudiante YA sabe. "Es como... pero...".`,

    reconstruct_from_error: `El estudiante FALLÓ. NO hagas otra pregunta. RECONSTRUYE el concepto desde otro ángulo. Muestra dónde estuvo el error. Enseña la forma correcta con un ejemplo. TERMINA sin pregunta.`,

    reveal_correct_answer: `El estudiante NO SABE la respuesta. REVELA la respuesta correcta y EXPLICA POR QUÉ es correcta usando el material. Termina con una frase clave para recordar. SIN pregunta.`,

    guided_practice: `Guía un ejercicio paso a paso. El estudiante debe participar.`,

    verify_understanding: `Verifica comprensión con UNA pregunta clara. Nada más.`,

    test_transfer: `Presenta situación NUEVA que requiera aplicar el concepto. Pregunta abierta o caso práctico.`,

    consolidate_topic: `Cierre del topic. Resumen breve + pregunta de síntesis (teach_back u open_response).`,

    transition_to_next_topic: `Celebra brevemente lo aprendido y anuncia el siguiente topic. SIN pregunta.`,

    close_session: `Cierre de sesión. Muestra qué puede hacer ahora que antes no podía. Motivacional. SIN pregunta.`,
  }

  return instructions[need] || 'Continúa enseñando de forma clara.'
}

// ═══════════════════════════════════════════════════════════════
// MAPEO NECESIDAD → PAGE TYPE
// ═══════════════════════════════════════════════════════════════
function mapNeedToPageType(need: PedagogicalNeed): any {
  const map: Record<PedagogicalNeed, string> = {
    introduce_concept: 'warmup',
    explain_with_context: 'theory',
    show_concrete_example: 'example',
    break_into_microconcepts: 'guided_solution',
    visualize_mentally: 'insight',
    connect_to_known: 'connection',
    reconstruct_from_error: 'rescue',
    reveal_correct_answer: 'error',
    guided_practice: 'practice',
    verify_understanding: 'checkpoint',
    test_transfer: 'challenge',
    consolidate_topic: 'summary',
    transition_to_next_topic: 'summary',
    close_session: 'session_close',
  }
  return map[need] || 'theory'
}

// ═══════════════════════════════════════════════════════════════
// CONSTRUIR INTERACCIÓN VÁLIDA
// ═══════════════════════════════════════════════════════════════
function buildInteraction(raw: any): Interaction {
  const data = raw.data || {}
  const type = raw.interactionType || 'quick_check'
  if (!data.type) data.type = type

  return {
    id: genId('int'),
    interactionType: type,
    prompt: raw.prompt || '',
    data: data as any,
    requiresConfidence: Boolean(raw.requiresConfidence),
  }
}

// ═══════════════════════════════════════════════════════════════
// FALLBACK PAGE
// ═══════════════════════════════════════════════════════════════
function buildFallbackPage(decision: TeacherDecision, topic: TopicNode, pageType: any): BookPage {
  return {
    id: genId('page'),
    pageType,
    title: topic.title,
    content: {
      blocks: [
        { type: 'text', text: (topic.rawText || 'Continuemos.').slice(0, 400) }
      ],
      tutorMessage: 'Continuemos aprendiendo.',
    },
    interaction: undefined,
    topicId: topic.id,
    createdAt: Date.now(),
  }
}
