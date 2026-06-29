import { NextRequest, NextResponse } from 'next/server'
import { alaiRequest } from '../../../../lib/alai'
import { reason, designLessonPrompt } from '../../../../lib/adaptive/reasoningEngine'
import type { ReasoningContext } from '../../../../lib/adaptive/reasoningEngine'

export const maxDuration = 60

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const ctx = body.adaptiveContext || body

    const topicTitle: string = ctx.topicTitle || body.topicTitle || 'el tema'
    const targetConcepts: string[] = ctx.targetConcepts || body.targetConcepts || []
    const materialSlice: string = ctx.materialSlice || body.contenido || body.content || ''
    const weakConcepts: string[] = ctx.weakConcepts || body.weakConcepts || []
    const criticalConcepts: string[] = ctx.criticalConcepts || body.criticalConcepts || []
    const overallMastery: number = ctx.overallMastery ?? 0
    const userProfile = ctx.userProfile || body.userProfile || null
    const learningMemory = body.learningMemory || null
    const isFirstSession = body.isFirstSession === true
    const isFirstSessionForTopic = body.isFirstSessionForTopic !== false
    const sessionNumber: number = body.sessionNumber || ctx.sessionNumber || 1
    const totalSessions: number = body.totalSessions || 1
    const daysToExam: number | null = body.daysToExam ?? null
    const targetScore: number = body.targetScore || 80
    const topicAttempts: number = body.topicAttempts || 0
    const recentFailures: number = body.recentFailures || 0
    const lastSessionFormat: string | undefined = body.lastSessionFormat
    const lastSessionScore: number | undefined = body.lastSessionScore

    // Construir contexto de razonamiento
    const reasoningCtx: ReasoningContext = {
      topic: {
        id: ctx.topicId || 'unknown',
        title: topicTitle,
        description: '',
        concepts: targetConcepts.map(name => ({
          name, definition: '', importance: 'major' as const, difficulty: 50, practiceType: 'recall' as const,
        })),
        difficulty: ctx.difficulty || 50,
        importance: 70,
        estimatedMinutes: 20,
        practiceNeeds: ['understand' as const],
        commonMistakes: [],
      } as any,
      topicMastery: ctx.topicScore || 0,
      topicAttempts,
      recentFailures,
      blueprint: { topics: [] } as any,
      relatedDominatedTopics: body.relatedDominatedTopics || [],
      relatedWeakTopics: body.relatedWeakTopics || [],
      userProfile,
      learningMemory,
      weakConcepts,
      criticalConcepts,
      overallMastery,
      daysToExam,
      targetScore,
      sessionNumber,
      totalSessions,
      isFirstSessionEver: isFirstSession,
      isFirstSessionForTopic,
      lastSessionFormat,
      lastSessionScore,
    }

    // RAZONAR
    const reasoning = reason(reasoningCtx)
    console.log(`[Reasoning] "${topicTitle}" → intent: ${reasoning.intent}`)
    console.log(`[Reasoning] Variance:`, reasoning.sessionVariance)

    // DISEÑAR el prompt según el reasoning
    const prompt = designLessonPrompt({
      reasoning,
      ctx: reasoningCtx,
      materialSlice,
    })

    const rawText = await alaiRequest(async (client: any, model: (m?: string) => string) => {
      const res = await client.chat.completions.create({
        model: model(),
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.75, // más alta para más variabilidad
        max_tokens: 2800,
      })
      return res.choices?.[0]?.message?.content || ''
    })

    // Parsear
    let lesson: any = null
    try {
      lesson = JSON.parse(String(rawText).trim())
    } catch {
      const match = String(rawText).match(/\{[\s\S]*\}/)
      if (match) {
        try { lesson = JSON.parse(match[0]) } catch {}
      }
    }

    if (!lesson || !lesson.hook) {
      return NextResponse.json({
        success: true,
        lesson: null,
        reasoning: reasoning,
        content: `Vamos a trabajar "${topicTitle}". ${reasoning.reasoning}`,
        topicTitle,
      })
    }

    console.log(`[Reasoning] Lesson generada: ${lesson.explanationBlocks?.length || 0} bloques, ${lesson.checkpoints?.length || 0} checkpoints`)

    return NextResponse.json({
      success: true,
      lesson,
      reasoning,  // ← el frontend puede mostrar la decisión pedagógica
      analysis: lesson.hook,
      content: lesson.hook,
      topicTitle,
    })

  } catch (err: any) {
    console.error('[Adaptive Explain]', err.message)
    return NextResponse.json({ success: false, error: err.message }, { status: 500 })
  }
}
