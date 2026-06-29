import { NextRequest, NextResponse } from 'next/server'
import { alaiRequest } from '../../../../lib/alai'
import {
  createStudentModel,
  updateModel,
  getSessionSummary,
  detectKnowledgeMismatch,
  type StudentModel,
} from '../../../../lib/adaptive/adaptiveBrain'

export const maxDuration = 45

// ═══════════════════════════════════════════════════════════════
// ORQUESTADOR
//
// Misión: que el estudiante DOMINE el tema de esta sesión.
// La sesión termina cuando todos los conceptos del topic están dominados,
// no cuando se cumple un número fijo de pasos.
// ═══════════════════════════════════════════════════════════════

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const ctx = body.adaptiveContext || body

    let model: StudentModel = body.studentModel
    const topic = body.topic || {
      id: ctx.topicId || 'unknown',
      title: ctx.topicTitle || 'el tema',
      concepts: (ctx.targetConcepts || []).map((n: string) => ({
        name: n, definition: '', importance: 'major', difficulty: 50, practiceType: 'recall',
      })),
      difficulty: 50,
      importance: 70,
    }

    if (!model) {
      model = createStudentModel({
        topic,
        topicMastery: ctx.topicScore || 0,
        weakConcepts: ctx.weakConcepts || [],
        criticalConcepts: ctx.criticalConcepts || [],
      })
    }

    if (body.lastInteraction) {
      model = updateModel(model, body.lastInteraction)
    }

    const blocksCompleted = body.blocksCompleted || 0
    const history: any[] = body.history || []

    if (body.initialKnowledgeLevel && !model.declaredKnowledge) {
      model.declaredKnowledge = body.initialKnowledgeLevel
    }
    model = detectKnowledgeMismatch(model, blocksCompleted)

    // ═══════════════════════════════════════════════════════════════
    // CRITERIO DE DOMINIO DEL TEMA
    // ═══════════════════════════════════════════════════════════════
    const concepts = topic.concepts || []
    const conceptScores = concepts.map((c: any) => ({
      name: c.name,
      score: model.concepts[c.name] ?? 0,
      dominated: (model.concepts[c.name] ?? 0) >= 75,
    }))

    const dominatedCount = conceptScores.filter((c: any) => c.dominated).length
    const totalConcepts = concepts.length
    const undominatedConcepts = conceptScores.filter((c: any) => !c.dominated)

    // Tema DOMINADO cuando: todos los conceptos >= 75% Y mínimo 3 interacciones
    const topicMastered = totalConcepts > 0 && dominatedCount === totalConcepts && blocksCompleted >= 3

    // Safety: max 12 pasos para evitar loops infinitos
    const safetyMax = blocksCompleted >= 12

    if (topicMastered || safetyMax) {
      const summary = getSessionSummary(model)
      return NextResponse.json({
        success: true,
        sessionComplete: true,
        model,
        summary: {
          ...summary,
          masteredConcepts: conceptScores.filter((c: any) => c.dominated).map((c: any) => c.name),
          dominatedCount,
          totalConcepts,
          reason: topicMastered ? 'topic_mastered' : 'safety_max',
        },
      })
    }

    // ═══════════════════════════════════════════════════════════════
    // DECISIÓN: ¿qué hacer ahora para que el estudiante DOMINE?
    // ═══════════════════════════════════════════════════════════════

    const conceptsList = conceptScores.map((c: any) =>
      `- ${c.name}: ${c.score}% ${c.dominated ? '✓ DOMINADO' : c.score >= 40 ? '⚠ en progreso' : '○ pendiente'}`
    ).join('\n')

    const historyText = history.length > 0
      ? history.slice(-5).map((h, i) =>
          `${history.length - 4 + i}. ${h.type}${h.score !== undefined ? ` → ${h.score}%` : ''}${h.concept ? ` (${h.concept})` : ''}`
        ).join('\n')
      : 'Inicio de sesión.'

    const lastScore = body.lastInteraction?.score
    const lastType = history.length > 0 ? history[history.length - 1].type : null
    const lastConcept = history.length > 0 ? history[history.length - 1].concept : null

    const prompt = `Eres el cerebro de StudyAL. Tu misión: que el estudiante DOMINE este tema completamente.

═══ TEMA DE ESTA SESIÓN ═══
"${topic.title}"

═══ CONCEPTOS QUE DEBE DOMINAR ═══
${conceptsList}

Dominados: ${dominatedCount}/${totalConcepts}
Pendientes: ${undominatedConcepts.map((c: any) => c.name).join(', ') || 'ninguno'}

═══ ESTADO DEL ESTUDIANTE ═══
Nivel inicial: ${model.declaredKnowledge || 'no especificado'}
Comprensión general: ${model.comprehension?.level || 0}%
Energía: ${model.motivation?.energy || 70}/100
Engagement: ${model.motivation?.engagement || 60}/100

═══ HISTORIAL DE LA SESIÓN ═══
${historyText}
${lastType ? `\nÚltima acción: ${lastType}${lastScore !== undefined ? ` (${lastScore}%)` : ''}` : ''}

═══ TU MISIÓN ═══

Decide la SIGUIENTE acción que más ayude al estudiante a dominar el tema.

La sesión termina SOLO cuando todos los conceptos estén ≥ 75%.
Si un concepto está en 40-74%, todavía no lo domina — necesita más práctica o repaso.
Si un concepto está en 0-39%, necesita explicación o reparación.

═══ HERRAMIENTAS DISPONIBLES ═══

- **explain** — Explicación de un concepto (úsala al inicio o cuando hay un concepto en 0-30%)
- **flashcards** — Para anclar terminología/datos en memoria
- **quiz_multiple_choice** — Verificación rápida de comprensión
- **quiz_true_false** — Verificar relaciones o reglas
- **quiz_apply** — Caso de aplicación (requiere ya tener base)
- **quiz_open** — Pregunta abierta para razonamiento profundo
- **comparison** — Comparar dos conceptos relacionados
- **recall** — Recall activo sin opciones (consolidar memoria)
- **repair** — Reexplicar con ángulo nuevo (después de fallo concreto)
- **deepen** — Profundizar concepto que ya entiende parcialmente

═══ REGLAS ═══

1. Si un concepto está en 0-30% → empezar con **explain** de ESE concepto
2. Si acabas de explicar → siguiente debería ser práctica (flashcards, quiz_multiple_choice o recall)
3. Si falló quiz (<50%) → **repair** del concepto que falló
4. Si entendió bien (>70%) → **deepen** o pasar a otro concepto pendiente
5. Si todos los conceptos están en 50-70% → ronda de **quiz_apply** o **quiz_open** para consolidar
6. NO repitas la misma herramienta 2 veces seguidas (excepto repair tras fallo)
7. NO uses "Imagina..." como hook recurrente
8. Adapta al estudiante: si está cansado (energy<40), usa herramientas más livianas (flashcards en vez de quiz_open)

═══ DECISIÓN ═══

Devuelve SOLO JSON:
{
  "tool": "explain|flashcards|quiz_multiple_choice|quiz_true_false|quiz_apply|quiz_open|comparison|recall|repair|deepen",
  "focus": "concepto específico a trabajar (de la lista de pendientes/en progreso)",
  "reason": "por qué esta herramienta AHORA (1 frase visible al usuario)",
  "expectedOutcome": "qué espero que cambie en el estudiante después de esto"
}`

    const rawText = await alaiRequest(async (client: any, modelFn: (m?: string) => string) => {
      const res = await client.chat.completions.create({
        model: modelFn(),
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.6,
        max_tokens: 400,
      })
      return res.choices?.[0]?.message?.content || ''
    })

    let decision: any = null
    try {
      decision = JSON.parse(String(rawText).trim())
    } catch {
      const match = String(rawText).match(/\{[\s\S]*\}/)
      if (match) try { decision = JSON.parse(match[0]) } catch {}
    }

    // Fallback inteligente
    if (!decision || !decision.tool) {
      const firstUndominated = undominatedConcepts[0]?.name || topic.title
      const hasExplained = history.some(h => h.type === 'explain' && h.concept === firstUndominated)

      decision = {
        tool: !hasExplained ? 'explain' : (firstUndominated && (model.concepts[firstUndominated] ?? 0) < 50) ? 'flashcards' : 'quiz_multiple_choice',
        focus: firstUndominated,
        reason: 'Continuando con el siguiente concepto pendiente.',
        expectedOutcome: 'Avance hacia el dominio del concepto.',
      }
    }

    console.log(`[Orchestrator] Tool: ${decision.tool} | Focus: ${decision.focus}`)
    console.log(`[Orchestrator] Progress: ${dominatedCount}/${totalConcepts} dominados`)

    return NextResponse.json({
      success: true,
      action: {
        type: decision.tool,
        topic: topic.title,
        concept: decision.focus,
        concepts: [decision.focus],  // foco específico, no todos
        reason: decision.reason,
        expectedOutcome: decision.expectedOutcome,
      },
      model,
      sessionComplete: false,
      progress: {
        dominatedCount,
        totalConcepts,
        currentConcept: decision.focus,
        conceptScores,
      },
    })

  } catch (err: any) {
    console.error('[Orchestrator]', err.message)
    return NextResponse.json({ success: false, error: err.message }, { status: 500 })
  }
}
