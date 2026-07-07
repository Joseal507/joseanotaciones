// ═══════════════════════════════════════════════════════════════
// /api/adaptive/v2/decide-next
// 
// EL CEREBRO PEDAGÓGICO — Estilo Chap
// 
// Un solo prompt maestro. ALAI decide TODO.
// No hay reglas hardcodeadas. No hay if/else pedagógicos.
// ALAI recibe todo el contexto y actúa como tutor humano real.
// ═══════════════════════════════════════════════════════════════

import { NextRequest, NextResponse } from 'next/server'
import { alaiRequest, safeParseJson } from '../../../../../lib/alai'
import type {
  DecideNextRequest,
  DecideNextResponse,
} from '../../../../../lib/adaptive/v2/contracts'
import type {
  BookPage,
  PedagogicalDecision,
  EvidenceRecord,
  TopicMastery,
  PedagogicalState,
  Interaction,
  MasteryDimension,
} from '../../../../../lib/adaptive/v2/types'

export const maxDuration = 90

const genId = (prefix = 'id') => `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`

// ═══════════════════════════════════════════════════════════════
// EVALUACIÓN DE RESPUESTA (se mantiene, es útil)
// ═══════════════════════════════════════════════════════════════
async function evaluateResponse(
  interaction: Interaction,
  studentAnswer: any,
  responseTimeSeconds: number,
  confidence: string,
  materialText: string,
  concept: string,
): Promise<any> {
  const formatted = formatAnswerForEval(interaction, studentAnswer)

  const evalPrompt = `Evalúa esta respuesta como tutor experto. Sé JUSTO.

CONCEPTO: "${concept}"
TIPO: ${interaction.interactionType}
PREGUNTA: "${interaction.prompt}"
RESPUESTA CORRECTA: ${formatted.expected}
RESPUESTA ESTUDIANTE: ${formatted.student}
CONFIANZA: ${confidence}
TIEMPO: ${responseTimeSeconds}s

MATERIAL:
${materialText.slice(0, 1500)}

REGLAS:
- Si respondió LITERALMENTE lo correcto (opción, orden, matching correcto) → score 95-100, correct: true
- Si mencionó los conceptos correctos aunque incompleto → score 70-85, correct: true
- Si respondió parcialmente → score 50-70, correct: true
- Solo correct: false si score < 50

Devuelve SOLO este JSON:
{
  "correct": true|false,
  "score": 0-100,
  "whatWasCorrect": "qué estuvo bien (1 oración)",
  "whatWasMissing": "qué faltó (o vacío si perfecto)",
  "correctExplanation": "la respuesta correcta explicada (1-2 oraciones)",
  "identifiedConcepts": ["concepto1"],
  "missedConcepts": ["concepto2"]
}`

  try {
    const result = await alaiRequest(async (client: any, modelFn: any) => {
      const res = await client.chat.completions.create({
        model: modelFn(),
        messages: [
          { role: 'system', content: 'Eres evaluador pedagógico. Solo JSON válido.' },
          { role: 'user', content: evalPrompt },
        ],
        temperature: 0.1,
        max_tokens: 600,
      })
      const raw = res?.choices?.[0]?.message?.content || ''
      if (!raw.trim()) throw new Error('Empty response')
      return { text: raw, provider: 'unknown', model: 'unknown' }
    })

    const parsed = safeParseJson(result.text) || {}
    const correct = Boolean(parsed.correct)
    const score = Math.min(100, Math.max(0, Number(parsed.score) || 0))

    const isFast = responseTimeSeconds < 15
    let strength: any = 'neutral'
    if (correct && confidence === 'high' && !isFast) strength = 'strong_positive'
    else if (correct) strength = 'weak_positive'
    else if (!correct && confidence === 'high') strength = 'strong_negative'
    else if (!correct) strength = 'weak_negative'

    return {
      correct, score, strength,
      whatWasCorrect: parsed.whatWasCorrect || '',
      whatWasMissing: parsed.whatWasMissing || '',
      correctExplanation: parsed.correctExplanation || '',
      identifiedConcepts: parsed.identifiedConcepts || [],
      missedConcepts: parsed.missedConcepts || [],
    }
  } catch (err) {
    return {
      correct: true, score: 60, strength: 'neutral',
      whatWasCorrect: 'Respuesta recibida', whatWasMissing: '', correctExplanation: '',
      identifiedConcepts: [], missedConcepts: [],
    }
  }
}

function formatAnswerForEval(interaction: Interaction, answer: any): { student: string; expected: string } {
  const data = interaction.data as any
  switch (interaction.interactionType) {
    case 'multiple_choice':
      return {
        student: String(data.options?.[answer] ?? answer),
        expected: String(data.options?.[data.correctIndex] ?? data.correctIndex),
      }
    case 'true_false':
      return {
        student: answer === true ? 'Verdadero' : 'Falso',
        expected: data.correctAnswer ? 'Verdadero' : 'Falso',
      }
    case 'matching': {
      if (typeof answer !== 'object' || !answer) return { student: 'sin respuesta', expected: '' }
      const pairs = data.pairs || []
      const studentMatches = Object.entries(answer).map(([l, r]: any) =>
        `"${pairs[Number(l)]?.left}" → "${pairs[Number(r)]?.right}"`
      ).join(' | ')
      const expected = pairs.map((p: any) => `"${p.left}" → "${p.right}"`).join(' | ')
      return { student: studentMatches, expected }
    }
    case 'ordering': {
      const items = data.items || []
      const studentOrder = Array.isArray(answer) ? answer.map(i => items[i]).join(' → ') : 'sin respuesta'
      const correctOrder = (data.correctOrder || items.map((_: any, i: number) => i))
        .map((i: number) => items[i]).join(' → ')
      return { student: studentOrder, expected: correctOrder }
    }
    default:
      return {
        student: typeof answer === 'string' ? answer : JSON.stringify(answer),
        expected: (data.correctAnswers || [data.correctAnswer || data.answer || ''])[0] || '',
      }
  }
}

// ═══════════════════════════════════════════════════════════════
// EL CEREBRO — Un solo prompt maestro
// ═══════════════════════════════════════════════════════════════
async function callTutorBrain(context: {
  student: any
  topic: any
  material: any
  sessionHistory: any
  currentTopicMastery: number
  evaluation: any
  lastPage: BookPage | null
  isFirstInteraction: boolean
  isLastTopic: boolean
  sessionMinutes: number
  allTopicsInSession: any[]
  topicsCoveredCount: number
}): Promise<{ page: BookPage; reasoning: string; shouldAdvance: boolean; shouldClose: boolean }> {

  const {
    student, topic, material, sessionHistory,
    currentTopicMastery, evaluation, lastPage,
    isFirstInteraction, isLastTopic, sessionMinutes,
    allTopicsInSession, topicsCoveredCount,
  } = context

  const profile = student.profile || {}
  const setup = student.setup || {}
  const daysMap: Record<string, number> = {
    today: 0, tomorrow: 1, in_3_days: 3, in_1_week: 7, in_2_weeks: 14, in_1_month: 30, no_exam: 90,
  }
  const daysToExam = daysMap[setup.examDate] ?? 14

  // Construir historial reciente en formato conversacional
  const historyText = sessionHistory.pagesShown.slice(-6).map((p: any, i: number) => {
    const idx = sessionHistory.pagesShown.length - 6 + i
    const evidence = sessionHistory.evidenceCollected[idx]
    const evidenceInfo = evidence
      ? ` [ESTUDIANTE ${evidence.correct ? 'ACERTÓ' : 'FALLÓ'} - score ${evidence.score}]`
      : ''
    const pageText = p.content?.blocks?.map((b: any) => b.text || b.description || b.plain || '').join(' ').slice(0, 200)
    const questionText = p.interaction?.prompt || ''
    return `[Turno ${idx + 1}${evidenceInfo}]
Tipo: ${p.pageType}
${pageText ? 'Contenido: ' + pageText : ''}
${questionText ? 'Pregunta: ' + questionText : ''}`
  }).join('\n\n')

  const evaluationText = evaluation ? `
ÚLTIMA RESPUESTA DEL ESTUDIANTE:
- Correcta: ${evaluation.correct}
- Score: ${evaluation.score}/100
- Lo que dijo bien: ${evaluation.whatWasCorrect || 'nada notable'}
- Lo que faltó: ${evaluation.whatWasMissing || 'nada, respondió bien'}
- La respuesta correcta era: ${evaluation.correctExplanation}
` : ''

  // Construir contexto del material
  const topicText = topic.rawText || topic.rawTextReference || ''
  const keyFacts = (topic.keyFacts || []).join('\n- ')
  const learningObjectives = (topic.learningObjectives || []).join('\n- ')

  // Otros topics de la sesión (para contexto de dónde estamos)
  const topicsOverview = allTopicsInSession.map((t: any, i: number) => {
    const marker = t.id === topic.id ? '👉 ACTUAL' : (i < topicsCoveredCount ? '✓' : '○')
    return `${marker} ${t.title}`
  }).join('\n')

  const prompt = `Eres ALAI, un tutor experto que enseña 1-a-1 como un profesor humano brillante. Actúas exactamente como Chap: enseñas, verificas, corriges, adaptas, y decides TÚ qué hacer a continuación.

═══════════════════════════════════════════════════════════════
CONTEXTO DEL ESTUDIANTE
═══════════════════════════════════════════════════════════════
${profile.nombre ? `Nombre: ${profile.nombre}` : ''}
${profile.carrera ? `Carrera: ${profile.carrera}` : ''}
${profile.tipoEstudiante ? `Nivel: ${profile.tipoEstudiante}` : ''}
${profile.universidad ? `Universidad: ${profile.universidad}` : ''}

Nivel inicial autodeclarado en este material: ${setup.initialKnowledgeLevel || 'some'}
Objetivo: sacar ${setup.targetScore || 80}/100 en el examen
Días hasta examen: ${daysToExam}
Duración de esta sesión: ${sessionMinutes} minutos transcurridos

═══════════════════════════════════════════════════════════════
DÓNDE ESTAMOS EN LA SESIÓN
═══════════════════════════════════════════════════════════════
Topics de esta sesión:
${topicsOverview}

TOPIC ACTUAL: "${topic.title}"
Tu dominio actual de este topic: ${currentTopicMastery}/100
Interacciones ya hechas: ${sessionHistory.interactionsCompleted}
Es el último topic de la sesión: ${isLastTopic ? 'SÍ' : 'NO'}

═══════════════════════════════════════════════════════════════
MATERIAL DEL TOPIC (usa SOLO esta información, no inventes)
═══════════════════════════════════════════════════════════════
${topicText}

Hechos clave:
- ${keyFacts}

Objetivos de aprendizaje de este topic:
- ${learningObjectives}

═══════════════════════════════════════════════════════════════
HISTORIAL DE ESTA SESIÓN (últimas interacciones)
═══════════════════════════════════════════════════════════════
${historyText || 'Es la primera interacción de la sesión.'}
${evaluationText}

═══════════════════════════════════════════════════════════════
TU MISIÓN
═══════════════════════════════════════════════════════════════
Actúa como un tutor humano REAL. TÚ decides qué hacer ahora:

1. Si es la primera interacción del topic → PRESÉNTALO y enseña la base
2. Si el estudiante respondió BIEN → felicítalo brevemente y avanza (siguiente concepto o profundizar)
3. Si respondió MAL → NO REPITAS LA PREGUNTA. En su lugar:
   - Muéstrale la RESPUESTA CORRECTA COMPLETA con explicación clara
   - Enseña de forma DIFERENTE (analogía, ejemplo concreto, paso a paso)
   - Solo después de enseñar, verifica con OTRA pregunta diferente
4. Si ya llevas muchos intentos fallidos → RESUME lo importante y AVANZA
5. Si el estudiante ya domina el topic → transiciona al siguiente
6. Si es el último topic y ya lo domina → cierra la sesión

REGLAS ABSOLUTAS:
- NUNCA repitas exactamente la misma pregunta que hiciste antes
- NUNCA hagas 3 preguntas seguidas del mismo tipo
- SÍ debes enseñar cuando el estudiante no sabe (no solo preguntar)
- USA los hechos y ejemplos del material real
- Habla como profesor humano, no como robot
- Cortito y directo, no párrafos gigantes

═══════════════════════════════════════════════════════════════
FORMATO DE RESPUESTA (JSON exacto)
═══════════════════════════════════════════════════════════════

Devuelve una PÁGINA del libro con:

{
  "pageType": "theory | example | practice | error | checkpoint | insight | rescue | summary | session_close | challenge",
  "title": "Título breve (opcional)",
  "reasoning": "Por qué elegiste esta acción (para debug, 1 oración)",
  "shouldAdvance": true|false,  // ¿Este topic ya está dominado?
  "shouldClose": true|false,  // ¿Cerrar sesión ahora?
  "content": {
    "tutorMessage": "Tu voz de tutor hablándole al estudiante (1-2 oraciones)",
    "blocks": [
      { "type": "text", "text": "..." },
      { "type": "heading", "text": "...", "level": 2 },
      { "type": "formula", "plain": "pH = -log[H+]", "explanation": "..." },
      { "type": "example", "description": "...", "solution": "..." },
      { "type": "steps", "steps": [{"label":"1","content":"...","explanation":"..."}] },
      { "type": "callout", "variant": "info|warning|success|insight", "text": "..." },
      { "type": "list", "ordered": true, "items": ["..."] },
      { "type": "tutor_note", "text": "..." }
    ],
    "keyIdea": "Idea clave para recordar (opcional, 1 oración)"
  },
  "interaction": null | {
    "interactionType": "multiple_choice | true_false | fill_blank | fill_blank_bank | open_response | matching | ordering | step_by_step_solver | find_the_error | choose_best_procedure | explain_why | quick_check | teach_back",
    "prompt": "Pregunta o instrucción clara",
    "data": {
      "type": "coincide con interactionType",
      // Para multiple_choice: options (array de 4), correctIndex (0-3), explanation
      // Para true_false: statement, correctAnswer (bool), explanation
      // Para fill_blank: template ("El _____ es..."), correctAnswers (array de strings)
      // Para fill_blank_bank: template, bank (array de opciones), correctAnswers
      // Para matching: pairs (array de {left, right}) — 3-4 pares
      // Para ordering: items (array), correctOrder (array de índices)
      // Para step_by_step_solver: problem, expectedSteps (array), finalAnswer
      // Para find_the_error: workedSolution (array de pasos), errorStepIndex, explanation
      // Para choose_best_procedure: scenario, options (array), correctIndex
      // Para explain_why: phenomenon, expectedFactors (array)
      // Para open_response: acceptedAnswers (opcional)
      // Para quick_check: acceptedAnswers
      // Para teach_back: concept, rubric (array)
    },
    "requiresConfidence": true|false
  }
}

IMPORTANTE:
- Si SOLO vas a enseñar sin preguntar, pon "interaction": null
- Si el estudiante acaba de fallar, la página debe MOSTRAR la respuesta correcta antes de preguntar de nuevo
- pageType "error" es para mostrar y corregir un error
- pageType "rescue" es para reexplicar de forma totalmente distinta
- pageType "session_close" es para cerrar la sesión (con shouldClose: true)`

  const result = await alaiRequest(async (client: any, modelFn: any) => {
    const res = await client.chat.completions.create({
      model: modelFn(),
      messages: [
        {
          role: 'system',
          content: 'Eres ALAI, un tutor humano brillante que enseña como Chap. Respondes SOLO con JSON válido siguiendo el schema exacto. Nunca repites preguntas. Siempre enseñas cuando el estudiante no sabe.',
        },
        { role: 'user', content: prompt },
      ],
      temperature: 0.6,
      max_tokens: 2500,
    })
    const raw = res?.choices?.[0]?.message?.content || ''
    if (!raw.trim()) throw new Error('Empty tutor response')
    return { text: raw, provider: 'unknown', model: 'unknown' }
  })

  const parsed = safeParseJson(result.text)
  if (!parsed || !parsed.content) {
    return buildFallbackPage(topic, evaluation)
  }

  const page: BookPage = {
    id: genId('page'),
    pageType: parsed.pageType || 'theory',
    title: parsed.title || undefined,
    content: {
      blocks: Array.isArray(parsed.content?.blocks) ? parsed.content.blocks : [
        { type: 'text', text: 'Contenido' }
      ],
      tutorMessage: parsed.content?.tutorMessage,
      keyIdea: parsed.content?.keyIdea,
    },
    interaction: parsed.interaction ? buildInteraction(parsed.interaction) : undefined,
    topicId: topic.id,
    createdAt: Date.now(),
    isReteach: parsed.pageType === 'rescue' || parsed.pageType === 'error',
    isRescue: parsed.pageType === 'rescue',
  }

  return {
    page,
    reasoning: parsed.reasoning || 'Decisión del tutor',
    shouldAdvance: Boolean(parsed.shouldAdvance),
    shouldClose: Boolean(parsed.shouldClose),
  }
}

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

function buildFallbackPage(topic: any, evaluation: any): any {
  return {
    page: {
      id: genId('page'),
      pageType: 'theory',
      title: topic.title,
      content: {
        blocks: [
          { type: 'text', text: (topic.rawText || 'Continuemos aprendiendo.').slice(0, 400) }
        ],
        tutorMessage: evaluation && !evaluation.correct
          ? 'Vamos a revisar esto juntos.'
          : 'Continuemos.',
      },
      interaction: undefined,
      topicId: topic.id,
      createdAt: Date.now(),
    },
    reasoning: 'Fallback',
    shouldAdvance: false,
    shouldClose: false,
  }
}

// ═══════════════════════════════════════════════════════════════
// ENDPOINT PRINCIPAL
// ═══════════════════════════════════════════════════════════════
export async function POST(request: NextRequest) {
  try {
    const body: DecideNextRequest = await request.json()
    const { state, student, material, sessionBlueprint, sessionHistory, lastResponse } = body

    // 1. Determinar topic actual
    const currentTopicId = state.currentTopicId || sessionBlueprint.targetTopics[0]
    const currentTopic = material.topics.find(t => t.id === currentTopicId) || material.topics[0]

    if (!currentTopic) {
      return NextResponse.json({ success: false, error: 'No hay topics disponibles' })
    }

    // 2. Evaluar respuesta si hubo
    let evaluation: any = null
    let updatedEvidence = [...(sessionHistory.evidenceCollected || [])]

    if (lastResponse && sessionHistory.pagesShown.length > 0) {
      const lastPage = sessionHistory.pagesShown[sessionHistory.pagesShown.length - 1]
      if (lastPage.interaction) {
        evaluation = await evaluateResponse(
          lastPage.interaction,
          lastResponse.studentAnswer,
          lastResponse.responseTimeSeconds,
          lastResponse.confidence || 'medium',
          currentTopic.rawText || '',
          currentTopic.title,
        )

        const evidenceRecord: EvidenceRecord = {
          id: genId('ev'),
          timestamp: Date.now(),
          topicId: currentTopic.id,
          sessionId: state.sessionId,
          pageId: lastPage.id,
          interactionId: lastPage.interaction.id,
          dimension: 'comprehension',
          interactionType: lastPage.interaction.interactionType,
          correct: evaluation.correct,
          score: evaluation.score,
          strength: evaluation.strength,
          weight: evaluation.correct ? 0.8 : 0.6,
          studentResponse: lastResponse.studentAnswer,
          expectedResponse: null,
          responseTimeSeconds: lastResponse.responseTimeSeconds,
          studentConfidence: lastResponse.confidence as any,
          conceptsIdentified: evaluation.identifiedConcepts,
          conceptsMissed: evaluation.missedConcepts,
        }

        updatedEvidence.push(evidenceRecord)
        evaluation.evidenceRecord = evidenceRecord
      }
    }

    // 3. Calcular mastery del topic actual
    const topicEvidence = updatedEvidence.filter(e => e.topicId === currentTopic.id)
    const currentTopicMastery = topicEvidence.length > 0
      ? Math.round(topicEvidence.reduce((sum, e) => sum + e.score, 0) / topicEvidence.length)
      : 0

    // 4. Contexto de topics
    const allTopicsInSession = sessionBlueprint.targetTopics
      .map(id => material.topics.find(t => t.id === id))
      .filter(Boolean)
    const currentIdx = sessionBlueprint.targetTopics.indexOf(currentTopicId)
    const isLastTopic = currentIdx === sessionBlueprint.targetTopics.length - 1

    // 5. LLAMAR AL CEREBRO — Un solo prompt, ALAI decide todo
    const brainResult = await callTutorBrain({
      student,
      topic: currentTopic,
      material,
      sessionHistory,
      currentTopicMastery,
      evaluation,
      lastPage: sessionHistory.pagesShown[sessionHistory.pagesShown.length - 1] || null,
      isFirstInteraction: sessionHistory.pagesShown.length === 0,
      isLastTopic,
      sessionMinutes: Math.round((Date.now() - state.startedAt) / 60000),
      allTopicsInSession,
      topicsCoveredCount: state.topicsCoveredThisSession.length,
    })

    console.log(`[decide-next v2 CHAP] Topic: "${currentTopic.title}" | Mastery: ${currentTopicMastery} | Reasoning: ${brainResult.reasoning}`)

    // 6. Determinar próximo topic si avanzamos
    let nextTopicId = currentTopicId
    let nextTopicTitle = currentTopic.title
    let newCoveredTopics = state.topicsCoveredThisSession

    if (brainResult.shouldAdvance && !isLastTopic) {
      const nextIdx = currentIdx + 1
      nextTopicId = sessionBlueprint.targetTopics[nextIdx]
      const nextTopic = material.topics.find(t => t.id === nextTopicId)
      nextTopicTitle = nextTopic?.title || 'siguiente topic'
      newCoveredTopics = [...state.topicsCoveredThisSession, currentTopicId]
    } else if (brainResult.shouldAdvance && isLastTopic) {
      newCoveredTopics = [...state.topicsCoveredThisSession, currentTopicId]
    }

    // 7. Actualizar estado
    const updatedState: PedagogicalState = {
      ...state,
      currentTopicId: nextTopicId,
      currentTopicTitle: nextTopicTitle,
      loopPhase: 'teaching',
      loopIteration: nextTopicId === currentTopicId ? state.loopIteration + 1 : 0,
      recentPages: [...state.recentPages, brainResult.page].slice(-10),
      recentInteractions: brainResult.page.interaction
        ? [...state.recentInteractions, brainResult.page.interaction].slice(-10)
        : state.recentInteractions,
      recentEvidence: updatedEvidence.slice(-10),
      studentEnergy: state.totalInteractions > 20 ? 'tired' : 'engaged',
      streakCount: evaluation?.correct ? state.streakCount + 1 : 0,
      strugglingCount: evaluation && !evaluation.correct ? state.strugglingCount + 1 : 0,
      totalPagesShown: state.totalPagesShown + 1,
      totalInteractions: state.totalInteractions + (lastResponse ? 1 : 0),
      elapsedMinutes: Math.round((Date.now() - state.startedAt) / 60000),
      topicsCoveredThisSession: newCoveredTopics,
      topicsRemaining: sessionBlueprint.targetTopics.filter(id =>
        !newCoveredTopics.includes(id) && id !== nextTopicId
      ),
    }

    // 8. Mastery actualizado
    const updatedMastery: TopicMastery = {
      topicId: currentTopic.id,
      topicTitle: currentTopic.title,
      dimensions: {
        comprehension: currentTopicMastery,
        application: currentTopicMastery,
        memory: currentTopicMastery,
        transfer: 0, speed: 0, confidence: 0, retention: 0,
      },
      overallMastery: currentTopicMastery,
      status: currentTopicMastery >= 75 ? 'mastered' : currentTopicMastery > 40 ? 'learning' : 'introduced',
      evidenceCount: topicEvidence.length,
      lastPracticed: Date.now(),
      firstIntroduced: topicEvidence[0]?.timestamp || Date.now(),
      studentSelfReported: null,
      hasFalseConfidence: false,
      specificMistakes: [],
    }

    const decision: PedagogicalDecision = {
      action: 'explain_concept',
      reasoning: brainResult.reasoning,
      page: brainResult.page,
      targetTopicId: nextTopicId,
      targetDimension: null,
      expectedNewPhase: 'teaching',
      estimatedNextActions: [],
    }

    const response: DecideNextResponse = {
      success: true,
      decision,
      evaluation: evaluation ? {
        correct: evaluation.correct,
        score: evaluation.score,
        dimension: 'comprehension',
        feedback: {
          whatWasCorrect: evaluation.whatWasCorrect,
          whatWasMissing: evaluation.whatWasMissing,
          correctExplanation: evaluation.correctExplanation,
          identifiedConcepts: evaluation.identifiedConcepts,
          missedConcepts: evaluation.missedConcepts,
        },
        evidenceRecord: evaluation.evidenceRecord,
      } : undefined,
      updatedState,
      updatedMastery,
      shouldCloseSession: brainResult.shouldClose,
    }

    return NextResponse.json(response)

  } catch (err: any) {
    console.error('[decide-next v2 CHAP]', err.message, err.stack)
    return NextResponse.json({ success: false, error: err.message })
  }
}
