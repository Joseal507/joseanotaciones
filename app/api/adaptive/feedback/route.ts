import { NextRequest, NextResponse } from 'next/server'
import { alaiRequest } from '../../../../lib/alai'
import { designConversation, buildConversationPrompt, type Move } from '../../../../lib/adaptive/conversationStrategy'
import { getPreset } from '../../../../lib/adaptive/teachingManual'
import { getCriticalAntiPatterns } from '../../../../lib/adaptive/antiPatterns'
import { findRelevantMemory, formatMemoryForPrompt } from '../../../../lib/adaptive/teachingMemory'

export const maxDuration = 30

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()

    // Stub mínimo del model si no viene
    const model = body.studentModel || {
      comprehension: { level: 50, stability: 30 },
      motivation: { energy: 70, engagement: 60 },
      memory: { analogiesTried: [], failedApproaches: [], successfulApproaches: [], masteredConcepts: [] },
      concepts: {},
      microObjectives: [],
      currentMicroObjectiveIdx: 0,
      topicId: 'x',
      topicTitle: body.topicTitle || '',
      evidence: {
        avgResponseTimeMs: 0, fastestResponseMs: 0, slowestResponseMs: 0,
        shortAnswersCount: 0, detailedAnswersCount: 0, optionsChangedCount: 0,
        abandonedQuestions: 0, multipleEditsCount: 0, sessionStartMs: 0,
      },
    }

    // ═══ DISEÑAR LA CONVERSACIÓN ═══
    const plan = designConversation({
      studentAnswer: body.studentAnswer || '',
      score: body.score ?? 50,
      questionType: body.questionType || 'open_essay',
      conceptTested: body.conceptTested,
      model,
      recentMoves: (body.recentMoves || []) as Move[],
      topicCarrera: body.userCarrera,
      topicTitle: body.topicTitle || 'el tema',
    })

    console.log(`[Conversation] Intention: ${plan.intention} | Strategy: ${plan.strategy}`)
    console.log(`[Conversation] Moves: ${plan.moveSequence.join(' → ')}`)
    console.log(`[Conversation] Why: ${plan.whyThisPlan}`)

    // ═══ CONSTRUIR EL PROMPT DESDE EL PLAN ═══
    // Cargar solo la guía que aplica al caso
    const isFailure = (body.score ?? 50) < 50
    const isSuccess = (body.score ?? 50) >= 70
    const presetKey = isFailure ? 'after_failure' : isSuccess ? 'after_success' : 'after_partial'
    const guidance = getPreset(presetKey as any, {
      carrera: body.userCarrera,
      materia: body.materia,
      objetivo: body.userObjetivo,
    })

    // Anti-patterns críticos
    const antiPatterns = getCriticalAntiPatterns({
      studentKnowsNothing: body.studentKnowsNothing,
    })

    // 2 ejemplos relevantes (few-shot)
    const examples = formatMemoryForPrompt(
      findRelevantMemory({
        situation: isFailure ? 'failure' : isSuccess ? 'success' : 'curiosity',
        subject: body.materia,
        career: body.userCarrera,
        count: 2,
      })
    )

    const prompt = guidance + '\n\n' + antiPatterns + '\n\n' + examples + '\n\n' + buildConversationPrompt({
      plan,
      question: body.question || '',
      studentAnswer: body.studentAnswer || '',
      correctAnswer: body.correctAnswer,
      expectedIdea: body.expectedIdea,
      conceptTested: body.conceptTested,
      topicTitle: body.topicTitle || 'el tema',
      materialContext: body.materialContext,
      studentCarrera: body.userCarrera,
      studentKnowsNothing: body.studentKnowsNothing === true,
      score: body.score ?? 50,
    })

    const rawText = await alaiRequest(async (client: any, modelFn: (m?: string) => string) => {
      const res = await client.chat.completions.create({
        model: modelFn(),
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.7,
        max_tokens: 900,
      })
      return res.choices?.[0]?.message?.content || ''
    })

    let result: any = null
    try {
      result = JSON.parse(String(rawText).trim())
    } catch {
      const match = String(rawText).match(/\{[\s\S]*\}/)
      if (match) try { result = JSON.parse(match[0]) } catch {}
    }

    if (!result || !result.content) {
      return NextResponse.json({
        success: true,
        feedback: {
          content: body.score >= 60
            ? 'Tu respuesta capta lo principal. Vamos a profundizar en el siguiente paso.'
            : 'Te fuiste por otro ángulo. Vamos a reconstruirlo juntos.',
          rememberThis: `Lo clave: entender el porqué, no solo el qué.`,
          continueButton: 'Continuar →',
        },
        plan,
        movesUsed: plan.moveSequence,
      })
    }

    return NextResponse.json({
      success: true,
      feedback: result,
      plan,
      movesUsed: plan.moveSequence,
    })

  } catch (err: any) {
    console.error('[Feedback Conversation]', err.message)
    return NextResponse.json({ success: false, error: err.message }, { status: 500 })
  }
}
