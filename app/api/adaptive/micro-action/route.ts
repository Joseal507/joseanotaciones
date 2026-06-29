import { NextRequest, NextResponse } from 'next/server'
import { alaiRequest } from '../../../../lib/alai'
import {
  createStudentModel,
  formulateInitialHypothesis,
  updateModelFromResponse,
  reformulateHypothesis,
  decideNextAction,
  buildMicroActionPrompt,
} from '../../../../lib/adaptive/diagnosticEngine'

export const maxDuration = 45

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()

    // 1. Estado del student model (si viene del cliente) o crear nuevo
    let studentModel = body.studentModel
    let hypothesis = body.hypothesis

    const ctx = body.adaptiveContext || body
    const topic = body.topic || {
      id: ctx.topicId || 'unknown',
      title: ctx.topicTitle || 'el tema',
      concepts: (ctx.targetConcepts || []).map((n: string) => ({
        name: n, definition: '', importance: 'major', difficulty: 50, practiceType: 'recall',
      })),
    }

    // 2. Si no hay modelo, inicializar
    if (!studentModel) {
      studentModel = createStudentModel({
        topic,
        topicMastery: ctx.topicScore || 0,
        weakConcepts: ctx.weakConcepts || [],
        criticalConcepts: ctx.criticalConcepts || [],
      })
    }

    // 3. Si hay respuesta nueva, actualizar modelo + reformular hipótesis
    let diagnosis = ''
    if (body.lastResponse) {
      const update = updateModelFromResponse(studentModel, body.lastResponse)
      studentModel = update.updatedModel
      diagnosis = update.diagnosis

      if (update.shouldReformulate && hypothesis) {
        hypothesis = reformulateHypothesis(hypothesis, studentModel, body.lastResponse)
      }
    }

    // 4. Si no hay hipótesis, formular una
    if (!hypothesis) {
      hypothesis = formulateInitialHypothesis(studentModel, topic)
    }

    // 5. Decidir próxima acción
    const stagesCompleted = body.stagesCompleted || 0
    const totalStagesPlanned = body.totalStagesPlanned || 6
    const action = decideNextAction(studentModel, hypothesis, stagesCompleted, totalStagesPlanned)

    console.log(`[Diagnostic] Action: ${action.type} | Hypothesis: ${hypothesis.belief.slice(0, 60)}...`)

    // 6. Generar el contenido para esa acción
    const prompt = buildMicroActionPrompt({
      action,
      model: studentModel,
      hypothesis,
      materialSlice: ctx.materialSlice || body.materialSlice || '',
      userCarrera: ctx.userProfile?.carrera,
    })

    const rawText = await alaiRequest(async (client: any, model: (m?: string) => string) => {
      const res = await client.chat.completions.create({
        model: model(),
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.7,
        max_tokens: 1200,
      })
      return res.choices?.[0]?.message?.content || ''
    })

    // 7. Parsear
    let microAction: any = null
    try {
      microAction = JSON.parse(String(rawText).trim())
    } catch {
      const match = String(rawText).match(/\{[\s\S]*\}/)
      if (match) try { microAction = JSON.parse(match[0]) } catch {}
    }

    if (!microAction) {
      return NextResponse.json({
        success: false,
        error: 'No se pudo generar micro-acción',
        rawText: String(rawText).slice(0, 300),
      })
    }

    // 8. Actualizar memoria pedagógica del modelo
    if (microAction.analogyUsedHere) {
      studentModel.analogiesUsed = [...(studentModel.analogiesUsed || []), microAction.analogyUsedHere].slice(-5)
    }
    if (microAction.exampleUsedHere) {
      studentModel.examplesUsed = [...(studentModel.examplesUsed || []), microAction.exampleUsedHere].slice(-5)
    }
    if (action.type === 'change_angle') {
      studentModel.approachesTriedAndFailed = [
        ...(studentModel.approachesTriedAndFailed || []),
        action.abandonApproach,
      ].slice(-3)
    }

    return NextResponse.json({
      success: true,
      microAction,
      action,
      hypothesis,
      studentModel,
      diagnosis,
    })

  } catch (err: any) {
    console.error('[Micro Action]', err.message)
    return NextResponse.json({ success: false, error: err.message }, { status: 500 })
  }
}
