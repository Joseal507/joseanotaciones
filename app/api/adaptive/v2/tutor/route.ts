// ═══════════════════════════════════════════════════════════════
// /api/adaptive/v2/tutor
// 
// El endpoint principal del tutor v2.
// 
// Flujo:
// 1. Recibe estado + última respuesta del estudiante
// 2. Evalúa la respuesta (si hubo)
// 3. Actualiza estado de microconceptos
// 4. Teacher Brain decide QUÉ NECESITA el estudiante
// 5. Content Generator genera el contenido + widget
// 6. Devuelve página lista para mostrar
// ═══════════════════════════════════════════════════════════════

import { NextRequest, NextResponse } from 'next/server'
import { alaiRequest, safeParseJson } from '../../../../../lib/alai'
import {
  decidePedagogicalNeed,
  extractMicroConcepts,
  type MicroConcept,
  type TeachingContext,
} from '../../../../../lib/adaptive/v2/agents/teacherBrain'
import { generateContentFromDecision } from '../../../../../lib/adaptive/v2/agents/contentGenerator'
import type { BookPage, Interaction } from '../../../../../lib/adaptive/v2/types'

export const maxDuration = 90

// ═══════════════════════════════════════════════════════════════
// EVALUAR RESPUESTA DEL ESTUDIANTE
// ═══════════════════════════════════════════════════════════════
async function evaluateStudentResponse(params: {
  lastPage: BookPage
  studentAnswer: any
  topic: any
  microConceptId: string | null
}): Promise<{
  outcome: 'correct' | 'incorrect' | 'partial'
  score: number
  whatWasCorrect: string
  whatWasMissing: string
  correctAnswer: string
  misunderstood: string
}> {
  const interaction = params.lastPage.interaction
  if (!interaction) {
    return {
      outcome: 'correct', score: 100,
      whatWasCorrect: '', whatWasMissing: '',
      correctAnswer: '', misunderstood: '',
    }
  }

  const formatted = formatAnswer(interaction, params.studentAnswer)

  const prompt = `Evalúa la respuesta como tutor humano. Sé JUSTO.

PREGUNTA: ${interaction.prompt}
RESPUESTA CORRECTA: ${formatted.expected}
RESPUESTA DEL ESTUDIANTE: ${formatted.student}

TOPIC: ${params.topic.title}
MATERIAL: ${params.topic.rawText.slice(0, 800)}

Reglas:
- Si respondió literalmente lo correcto (opción, orden, matching) → outcome: "correct", score 90-100
- Si mencionó conceptos correctos aunque incompleto → outcome: "partial", score 60-80
- Solo "incorrect" si score < 50

Devuelve SOLO JSON:
{
  "outcome": "correct|incorrect|partial",
  "score": 0-100,
  "whatWasCorrect": "qué estuvo bien",
  "whatWasMissing": "qué faltó (vacío si perfecto)",
  "correctAnswer": "la respuesta correcta explicada en 1-2 oraciones",
  "misunderstood": "qué específicamente no entendió (vacío si respondió bien)"
}`

  try {
    const result = await alaiRequest(async (client: any, modelFn: any) => {
      const res = await client.chat.completions.create({
        model: modelFn(),
        messages: [
          { role: 'system', content: 'Evaluador pedagógico. Solo JSON.' },
          { role: 'user', content: prompt },
        ],
        temperature: 0.1,
        max_tokens: 500,
      })
      const raw = res?.choices?.[0]?.message?.content || ''
      if (!raw.trim()) throw new Error('Empty')
      return { text: raw, provider: 'unknown', model: 'unknown' }
    })

    const parsed = safeParseJson(result.text) || {}
    return {
      outcome: parsed.outcome || 'partial',
      score: Math.min(100, Math.max(0, Number(parsed.score) || 60)),
      whatWasCorrect: parsed.whatWasCorrect || '',
      whatWasMissing: parsed.whatWasMissing || '',
      correctAnswer: parsed.correctAnswer || '',
      misunderstood: parsed.misunderstood || '',
    }
  } catch {
    return {
      outcome: 'partial', score: 60,
      whatWasCorrect: '', whatWasMissing: '',
      correctAnswer: '', misunderstood: '',
    }
  }
}

function formatAnswer(interaction: Interaction, answer: any): { student: string; expected: string } {
  const data = interaction.data as any
  switch (interaction.interactionType) {
    case 'multiple_choice':
      return {
        student: String(data.options?.[answer] ?? answer),
        expected: String(data.options?.[data.correctIndex] ?? ''),
      }
    case 'true_false':
      return {
        student: answer === true ? 'Verdadero' : 'Falso',
        expected: data.correctAnswer ? 'Verdadero' : 'Falso',
      }
    case 'matching': {
      if (typeof answer !== 'object' || !answer) return { student: 'sin respuesta', expected: '' }
      const pairs = data.pairs || []
      const s = Object.entries(answer).map(([l, r]: any) =>
        `"${pairs[Number(l)]?.left}" → "${pairs[Number(r)]?.right}"`
      ).join(' | ')
      const e = pairs.map((p: any) => `"${p.left}" → "${p.right}"`).join(' | ')
      return { student: s, expected: e }
    }
    case 'ordering': {
      const items = data.items || []
      const s = Array.isArray(answer) ? answer.map(i => items[i]).join(' → ') : 'sin respuesta'
      const e = (data.correctOrder || items.map((_: any, i: number) => i)).map((i: number) => items[i]).join(' → ')
      return { student: s, expected: e }
    }
    default:
      return {
        student: typeof answer === 'string' ? answer : JSON.stringify(answer),
        expected: (data.correctAnswers || [data.correctAnswer || data.answer || ''])[0] || '',
      }
  }
}

// ═══════════════════════════════════════════════════════════════
// ACTUALIZAR MICROCONCEPTO SEGÚN OUTCOME
// ═══════════════════════════════════════════════════════════════
function updateMicroConcept(
  micros: MicroConcept[],
  microId: string | null,
  outcome: 'correct' | 'incorrect' | 'partial',
  misunderstood: string,
): MicroConcept[] {
  if (!microId) return micros

  return micros.map(m => {
    if (m.id !== microId) return m
    const attempts = m.attemptCount + 1

    let newState = m.state
    if (outcome === 'correct') {
      if (m.state === 'not_introduced' || m.state === 'introduced' || m.state === 'partially_grasped') {
        newState = 'understood'
      } else if (m.state === 'understood') {
        newState = 'applied'
      } else if (m.state === 'applied') {
        newState = 'mastered'
      }
    } else if (outcome === 'partial') {
      newState = 'partially_grasped'
    } else if (outcome === 'incorrect') {
      if (attempts >= 3) {
        newState = 'blocked'
      } else if (m.state === 'not_introduced') {
        newState = 'confused'
      } else {
        newState = 'confused'
      }
    }

    return {
      ...m,
      state: newState,
      attemptCount: attempts,
      lastError: outcome !== 'correct' ? misunderstood : undefined,
    }
  })
}

// ═══════════════════════════════════════════════════════════════
// ENDPOINT PRINCIPAL
// ═══════════════════════════════════════════════════════════════
export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const {
      state,
      student,
      material,
      sessionBlueprint,
      sessionHistory,
      lastResponse,
      microConcepts: existingMicros,
    } = body

    // 1. Determinar topic actual
    const currentTopicId = state.currentTopicId || sessionBlueprint.targetTopics[0]
    const currentTopic = material.topics.find((t: any) => t.id === currentTopicId) || material.topics[0]

    if (!currentTopic) {
      return NextResponse.json({ success: false, error: 'No hay topics' })
    }

    // 2. Extraer microconceptos si no existen
    let microConcepts: MicroConcept[] = existingMicros?.[currentTopicId] || []
    let microsExtracted = false
    if (microConcepts.length === 0) {
      microConcepts = await extractMicroConcepts(currentTopic)
      microsExtracted = true
      console.log(`[tutor] ${microConcepts.length} microconceptos extraídos para "${currentTopic.title}"`)
    }

    // 3. Evaluar respuesta si hubo
    let evaluation: any = null
    let conversationHistory = state.conversationHistory || []

    if (lastResponse && sessionHistory.pagesShown?.length > 0) {
      const lastPage = sessionHistory.pagesShown[sessionHistory.pagesShown.length - 1]
      if (lastPage.interaction) {
        evaluation = await evaluateStudentResponse({
          lastPage,
          studentAnswer: lastResponse.studentAnswer,
          topic: currentTopic,
          microConceptId: state.currentMicroConceptId || null,
        })

        // Actualizar microconcepto
        microConcepts = updateMicroConcept(
          microConcepts,
          state.currentMicroConceptId,
          evaluation.outcome,
          evaluation.misunderstood,
        )

        // Agregar a historia conversacional
        conversationHistory = [
          ...conversationHistory,
          {
            role: 'student' as const,
            what: typeof lastResponse.studentAnswer === 'string'
              ? lastResponse.studentAnswer.slice(0, 200)
              : JSON.stringify(lastResponse.studentAnswer).slice(0, 200),
            outcome: evaluation.outcome,
            misunderstood: evaluation.misunderstood || undefined,
            timestamp: Date.now(),
          },
        ]
      }
    }

    // 3b. Marcar microconcepto como introducido si estamos enseñando y no hay respuesta previa
    // Esto asegura que después de que el estudiante lea la explicación, avancemos
    if (state.currentMicroConceptId && !lastResponse) {
      microConcepts = microConcepts.map((m: MicroConcept) => {
        if (m.id === state.currentMicroConceptId && m.state === 'not_introduced') {
          return { ...m, state: 'introduced' as any }
        }
        return m
      })
    }

    // 3c. IMPORTANTE: Si el microconcepto actual ya está 'introduced' o superior,
    // y el estudiante hizo "continuar" sin responder, marcarlo como 'understood'
    // para forzar avance al siguiente microconcepto
    if (state.currentMicroConceptId && !lastResponse) {
      const currentMicro = microConcepts.find((m: MicroConcept) => m.id === state.currentMicroConceptId)
      if (currentMicro && currentMicro.state === 'introduced') {
        microConcepts = microConcepts.map((m: MicroConcept) => {
          if (m.id === state.currentMicroConceptId) {
            return { ...m, state: 'understood' as any }
          }
          return m
        })
      }
    }

    // 4. Calcular contadores
    const recentStudent = conversationHistory.filter((c: any) => c.role === 'student').slice(-5)
    const consecutiveErrors = countConsecutive(recentStudent, 'incorrect')
    const consecutiveCorrect = countConsecutive(recentStudent, 'correct')

    const timeInTopic = Math.round(
      (Date.now() - (state.currentTopicStartedAt || state.startedAt)) / 60000
    )
    const sessionMinutesElapsed = Math.round((Date.now() - state.startedAt) / 60000)

    // 5. Detectar energía
    let studentEnergy: any = 'engaged'
    if (sessionMinutesElapsed > 25) studentEnergy = 'tired'
    if (consecutiveErrors >= 3) studentEnergy = 'frustrated'
    if (sessionMinutesElapsed < 3) studentEnergy = 'fresh'

    // 6. LLAMAR AL TEACHER BRAIN
    const currentIdx = sessionBlueprint.targetTopics.indexOf(currentTopicId)
    const isLastTopicInSession = currentIdx === sessionBlueprint.targetTopics.length - 1

    const teachingContext: TeachingContext = {
      currentTopic,
      currentTopicMicroConcepts: microConcepts,
      student,
      material,
      conversationHistory: conversationHistory.slice(-10),
      studentEnergy,
      consecutiveErrors,
      consecutiveCorrect,
      timeInTopic,
      isLastTopicInSession,
      sessionMinutesElapsed,
      sessionMinutesTarget: sessionBlueprint.estimatedMinutes || 20,
    }

    const teacherDecision = await decidePedagogicalNeed(teachingContext)

    console.log(`[tutor] Necesidad: ${teacherDecision.need} | Foco: ${teacherDecision.contentGuidance.focus.slice(0, 60)}`)
    console.log(`[tutor] Razón: ${teacherDecision.reasoning}`)

    // 7. GENERAR CONTENIDO
    let page = await generateContentFromDecision(teacherDecision, currentTopic, student)

    // Agregar la enseñanza a la conversación
    conversationHistory = [
      ...conversationHistory,
      {
        role: 'teacher' as const,
        what: page.content.blocks.map((b: any) => b.text || b.description || b.plain || '').join(' ').slice(0, 300),
        timestamp: Date.now(),
      },
    ].slice(-20)

    // 8. Determinar próximo topic si se avanza
    let nextTopicId = currentTopicId
    let nextTopicTitle = currentTopic.title
    let newCoveredTopics = state.topicsCoveredThisSession || []
    let currentTopicStartedAt = state.currentTopicStartedAt || Date.now()

    // FORZAR AVANCE: si todos los microconceptos están al menos 'understood', avanzar topic
    const allMicrosIntroduced = microConcepts.length > 0 && microConcepts.every(
      (m: MicroConcept) => ['introduced', 'understood', 'partially_grasped', 'applied', 'mastered'].includes(m.state as string)
    )
    const forceAdvance = allMicrosIntroduced && !teacherDecision.shouldAdvanceTopic

    if (forceAdvance) {
      console.log(`[tutor] ⚡ FORZANDO avance: todos los microconceptos introducidos`)
    }

    if ((teacherDecision.shouldAdvanceTopic || forceAdvance) && !isLastTopicInSession) {
      const nextIdx = currentIdx + 1
      nextTopicId = sessionBlueprint.targetTopics[nextIdx]
      const nextTopic = material.topics.find((t: any) => t.id === nextTopicId)
      nextTopicTitle = nextTopic?.title || 'siguiente topic'
      if (!newCoveredTopics.includes(currentTopicId)) {
        newCoveredTopics = [...newCoveredTopics, currentTopicId]
      }
      currentTopicStartedAt = Date.now()
    } else if ((teacherDecision.shouldAdvanceTopic || forceAdvance) && isLastTopicInSession) {
      if (!newCoveredTopics.includes(currentTopicId)) {
        newCoveredTopics = [...newCoveredTopics, currentTopicId]
      }
    }

    // 9. Estado actualizado
    const updatedState = {
      ...state,
      currentTopicId: nextTopicId,
      currentTopicTitle: nextTopicTitle,
      currentTopicStartedAt,
      currentMicroConceptId: teacherDecision.targetMicroConceptId,
      conversationHistory,
      topicsCoveredThisSession: newCoveredTopics,
      totalInteractions: (state.totalInteractions || 0) + (lastResponse ? 1 : 0),
      totalPagesShown: (state.totalPagesShown || 0) + 1,
      elapsedMinutes: sessionMinutesElapsed,
      studentEnergy,
      recentEvidence: [
        ...(state.recentEvidence || []),
        ...(evaluation ? [{ topicId: currentTopic.id, correct: evaluation.outcome === 'correct', score: evaluation.score }] : []),
      ].slice(-10),
    }

    // 10. Actualizar microConcepts persistido
    const updatedMicroConceptsMap = {
      ...(existingMicros || {}),
      [currentTopicId]: microConcepts,
    }

    return NextResponse.json({
      success: true,
      page,
      teacherDecision: {
        need: teacherDecision.need,
        reasoning: teacherDecision.reasoning,
        focus: teacherDecision.contentGuidance.focus,
      },
      evaluation: evaluation ? {
        outcome: evaluation.outcome,
        score: evaluation.score,
        whatWasCorrect: evaluation.whatWasCorrect,
        whatWasMissing: evaluation.whatWasMissing,
        correctAnswer: evaluation.correctAnswer,
      } : null,
      updatedState,
      microConcepts: updatedMicroConceptsMap,
      microsExtracted,
      shouldCloseSession: teacherDecision.shouldCloseSession,
    })

  } catch (err: any) {
    console.error('[tutor v2]', err.message, err.stack)
    return NextResponse.json({ success: false, error: err.message })
  }
}

function countConsecutive(entries: any[], outcome: string): number {
  let count = 0
  for (let i = entries.length - 1; i >= 0; i--) {
    if (entries[i].outcome === outcome) count++
    else break
  }
  return count
}
