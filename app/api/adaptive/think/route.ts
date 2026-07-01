import { NextRequest, NextResponse } from 'next/server'
import { alaiRequest } from '../../../../lib/alai'
import {
  createStudentModel,
  updateModel,
  getSessionSummary,
  detectKnowledgeMismatch,
  computeDominationFromHistory,
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

      // Si el score es alto y hay múltiples conceptos, subir todos
      const allConcepts = body.lastInteraction.allConcepts || []
      if (body.lastInteraction.score >= 70 && allConcepts.length > 0) {
        for (const conceptName of allConcepts) {
          if (model.concepts[conceptName] !== undefined) {
            const current = model.concepts[conceptName]
            const boost = Math.round(body.lastInteraction.score * 0.4)
            model.concepts[conceptName] = Math.min(100, current + boost)
          }
        }
      }
    }

    const blocksCompleted = body.blocksCompleted || 0
    const history: any[] = body.history || []

    if (body.initialKnowledgeLevel && !model.declaredKnowledge) {
      model.declaredKnowledge = body.initialKnowledgeLevel
    }
    model = detectKnowledgeMismatch(model, blocksCompleted)

    // Safety net: reconciliar dominio desde el historial completo
    if (history.length > 0) {
      model = computeDominationFromHistory(model, history)
    }

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
      `- "${c.name}": ${c.score}% ${c.dominated ? '✓ DOMINADO' : c.score >= 40 ? '⚠ en progreso' : '○ pendiente'}`
    ).join('\n')

    // Lista exacta de nombres válidos (el LLM debe usar uno de estos)
    const validConceptNames = conceptScores.map((c: any) => c.name)
    const validNamesStr = validConceptNames.map((n: string) => `"${n}"`).join(', ')

    const historyText = history.length > 0
      ? history.slice(-5).map((h, i) =>
          `${history.length - 4 + i}. ${h.type}${h.score !== undefined ? ` → ${h.score}%` : ''}${h.concept ? ` (${h.concept})` : ''}`
        ).join('\n')
      : 'Inicio de sesión.'

    const lastScore = body.lastInteraction?.score
    const lastType = history.length > 0 ? history[history.length - 1].type : null
    const lastConcept = history.length > 0 ? history[history.length - 1].concept : null

    // ── Detectar concepto sobre-explicado sin práctica ──
    const explainsWithoutPractice: Record<string, number> = {}
    let lastWasExplain = false
    for (const h of history) {
      const isExplain = h.type === 'explain' || h.type === 'synthesis' || h.type === 'comparison' || h.type === 'deepen'
      const isPractice = h.type?.startsWith('quiz_') || h.type === 'flashcards' || h.type === 'recall' || h.type === 'repair'
      if (isExplain && h.concept) {
        explainsWithoutPractice[h.concept] = (explainsWithoutPractice[h.concept] || 0) + 1
      }
      if (isPractice && h.concept) {
        explainsWithoutPractice[h.concept] = 0
      }
      lastWasExplain = isExplain
    }
    const overExplained = Object.entries(explainsWithoutPractice)
      .filter(([_, count]) => count >= 2)
      .map(([name]) => name)

    const forceRule = lastWasExplain
      ? '\n⚠️ AHORA OBLIGATORIO: la última acción fue explain. NO devuelvas explain/synthesis/comparison/deepen. Debes elegir: flashcards, quiz_multiple_choice, quiz_true_false o recall.'
      : overExplained.length > 0
      ? `\n⚠️ AHORA OBLIGATORIO: los conceptos "${overExplained.join(', ')}" ya fueron explicados sin práctica. Debes hacer quiz_multiple_choice sobre uno de ellos.`
      : ''

    const quizCount = history.filter(h => h.type?.startsWith('quiz_') || h.type === 'flashcards' || h.type === 'recall').length
    const forceQuizRule = (blocksCompleted >= 4 && quizCount === 0)
      ? '\n⚠️ AHORA OBLIGATORIO: ya llevas 4+ bloques sin medir nada. Debes hacer quiz_multiple_choice ahora.'
      : ''



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
2. ⚠️ REGLA OBLIGATORIA: Si la última acción fue **explain** → la siguiente DEBE ser práctica activa (flashcards, quiz_multiple_choice, recall o quiz_true_false). NUNCA dos explicaciones seguidas.
3. ⚠️ REGLA OBLIGATORIA: Si ya hubo 2 explicaciones del mismo concepto sin práctica → forzar quiz_multiple_choice de ese concepto.
4. Si la sesión lleva 4+ bloques sin medir nada con quiz/flashcards → forzar quiz_multiple_choice.
5. Si un concepto está dominado (≥75%) → NO volver a tocarlo, pasar al siguiente pendiente.
6. NO repitas la misma herramienta 2 veces seguidas (excepto repair tras fallo)
7. NO uses "Imagina..." como hook recurrente
8. Adapta al estudiante: si está cansado (energy<40), usa herramientas más livianas (flashcards en vez de quiz_open)

═══ DECISIÓN ═══
${forceRule}${forceQuizRule}

Devuelve SOLO JSON:
{
  "tool": "explain|flashcards|quiz_multiple_choice|quiz_true_false|quiz_apply|quiz_open|comparison|recall|repair|deepen",
  "focus": "DEBE SER UNO DE ESTOS NOMBRES EXACTOS (copia literal): ${validNamesStr}",
  "reason": "por qué esta herramienta AHORA (1 frase visible al usuario)",
  "expectedOutcome": "qué espero que cambie en el estudiante después de esto"
}

⚠️ CRÍTICO: "focus" DEBE ser uno de estos nombres EXACTAMENTE como aparecen (sin modificar): ${validNamesStr}
NO inventes nombres. NO uses el título del tema. NO traduzcas. Copia literal uno de la lista.`

    const rawText = await alaiRequest(async (client: any, modelFn: (m?: string) => string) => {
      const res = await client.chat.completions.create({
        model: modelFn('llama-3.3-70b-versatile'),
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.6,
        max_tokens: 600,
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

    // ── Fuzzy match: si el focus del LLM no matchea exactamente, buscar el más parecido
    if (decision?.focus && validConceptNames.length > 0) {
      const focusLower = String(decision.focus).toLowerCase().trim()
      const exactMatch = validConceptNames.find((n: string) => n.toLowerCase() === focusLower)

      if (!exactMatch) {
        // Buscar el concepto cuyo nombre tenga más palabras en común
        const focusWords = focusLower.split(/\s+/).filter((w: string) => w.length >= 4)
        let bestMatch = ''
        let bestScore = 0
        for (const candidate of validConceptNames) {
          const candWords = candidate.toLowerCase().split(/\s+/)
          let score = 0
          for (const fw of focusWords) {
            if (candWords.some((cw: string) => cw.includes(fw) || fw.includes(cw))) score++
          }
          if (score > bestScore) {
            bestScore = score
            bestMatch = candidate
          }
        }

        if (bestMatch && bestScore > 0) {
          console.log(`[Orchestrator] 🔧 Fuzzy match: "${decision.focus}" → "${bestMatch}"`)
          decision.focus = bestMatch
        } else {
          // Sin match: usar el primero pendiente
          const firstPending = conceptScores.find((c: any) => !c.dominated)?.name
          console.log(`[Orchestrator] ⚠️ Sin match para "${decision.focus}", usando "${firstPending}"`)
          decision.focus = firstPending || validConceptNames[0]
        }
      }
    }

    // Fallback inteligente con reglas duras
    if (!decision || !decision.tool) {
      const firstUndominated = undominatedConcepts[0]?.name || topic.title
      const hasExplained = history.some(h => (h.type === 'explain' || h.type === 'synthesis') && h.concept === firstUndominated)

      // Regla 1: si la última fue explain → quiz
      let fallbackTool = 'explain'
      if (lastWasExplain || overExplained.length > 0) {
        fallbackTool = 'quiz_multiple_choice'
      } else if (!hasExplained) {
        fallbackTool = 'explain'
      } else if (firstUndominated && (model.concepts[firstUndominated] ?? 0) < 50) {
        fallbackTool = 'flashcards'
      } else {
        fallbackTool = 'quiz_multiple_choice'
      }

      decision = {
        tool: fallbackTool,
        focus: firstUndominated,
        reason: 'Continuando con el siguiente paso lógico.',
        expectedOutcome: 'Avance hacia el dominio del concepto.',
      }
    }

    // VALIDACIÓN POST-DECISIÓN: si LLM violó las reglas, corregir
    const isExplainTool = ['explain', 'synthesis', 'comparison', 'deepen'].includes(decision.tool)
    if (lastWasExplain && isExplainTool) {
      console.log('[Orchestrator] ⚠️ LLM violó regla anti-doble-explain. Forzando quiz_multiple_choice.')
      decision.tool = 'quiz_multiple_choice'
      decision.reason = 'Comprobemos si entendiste la explicación anterior.'
    }
    if (overExplained.length > 0 && isExplainTool) {
      console.log('[Orchestrator] ⚠️ Concepto sobre-explicado. Forzando quiz_multiple_choice.')
      decision.tool = 'quiz_multiple_choice'
      decision.focus = overExplained[0]
      decision.concepts = [overExplained[0]]
      decision.reason = 'Es hora de probar lo que aprendiste.'
    }
    if (blocksCompleted >= 4 && quizCount === 0 && isExplainTool) {
      console.log('[Orchestrator] ⚠️ Sin evidencia tras 4 bloques. Forzando quiz_multiple_choice.')
      decision.tool = 'quiz_multiple_choice'
      decision.reason = 'Tiempo de medir tu progreso.'
    }

    console.log(`[Orchestrator] Tool: ${decision.tool} | Focus: ${decision.focus}`)
    console.log(`[Orchestrator] Progress: ${dominatedCount}/${totalConcepts} dominados`)

    // Validar que el focus final esté en la lista
    if (!validConceptNames.includes(decision.focus) && validConceptNames.length > 0) {
      decision.focus = validConceptNames.find((n: string) =>
        (model.concepts[n] ?? 0) < 75
      ) || validConceptNames[0]
      console.log(`[Orchestrator] 🛡️ Focus forzado a concepto válido: "${decision.focus}"`)
    }

    return NextResponse.json({
      success: true,
      action: {
        type: decision.tool,
        topic: topic.title,
        concept: decision.focus,
        concepts: [decision.focus],
        // Pasar TODOS los conceptos del topic + slice del material para mejor contexto
        allTopicConcepts: validConceptNames,
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
