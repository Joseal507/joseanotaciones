import { NextRequest, NextResponse } from 'next/server'
import { alaiRequest, safeParseJson } from '../../../../lib/alai'

export const maxDuration = 60

// ── Assessment Strategy Engine ───────────────────────────────────
// Decide el mejor tipo de evaluación según el objetivo cognitivo
function selectAssessmentTypes(
  knowledgeType: string,
  learningObjectives: string[],
  subjectArea: string,
): string[] {
  // Por tipo de conocimiento
  const byKnowledge: Record<string, string[]> = {
    memorization: ['fill_blank', 'matching', 'multiple_choice', 'true_false', 'micro_flashcards'],
    conceptual: ['multiple_choice', 'true_false', 'open_explanation', 'comparison', 'active_recall'],
    narrative: ['ordering', 'matching', 'multiple_choice', 'true_false', 'actors', 'comparison'],
    causal: ['cause_effect', 'ordering', 'multiple_choice', 'true_false', 'case_study'],
    procedural: ['ordering', 'fill_blank', 'step_by_step', 'worked_example', 'error_detection'],
    application: ['case_study', 'harder_problem', 'comparison', 'active_recall'],
    analysis: ['comparison', 'cause_effect', 'error_detection', 'case_study', 'open_explanation'],
    mathematical: ['fill_blank', 'worked_example', 'harder_problem', 'error_detection', 'ordering'],
    medical: ['case_study', 'cause_effect', 'comparison', 'ordering', 'true_false'],
    legal: ['case_study', 'matching', 'multiple_choice', 'comparison', 'true_false'],
    historical: ['ordering', 'matching', 'cause_effect', 'comparison', 'true_false'],
    argumentative: ['comparison', 'true_false', 'open_explanation', 'case_study'],
    visual: ['matching', 'multiple_choice', 'ordering', 'identify'],
  }

  const base = byKnowledge[knowledgeType] || byKnowledge.conceptual

  // Por área del material — override si aplica
  const bySubject: Record<string, string[]> = {
    math: ['fill_blank', 'worked_example', 'harder_problem', 'error_detection'],
    medical: ['case_study', 'cause_effect', 'comparison', 'ordering'],
    legal: ['case_study', 'matching', 'comparison'],
    history: ['ordering', 'matching', 'cause_effect', 'comparison'],
    science: ['fill_blank', 'ordering', 'cause_effect', 'worked_example'],
  }

  const subjectTypes = bySubject[subjectArea] || []

  // Combinar sin duplicar, priorizando los del área
  const combined = [...new Set([...subjectTypes, ...base])]
  return combined.slice(0, 5)
}

// ── Generar secuencia pedagógica por unidad ──────────────────────
// Para cada unidad de cobertura, generar la secuencia correcta de actividades
function buildUnitSequence(
  unit: any,
  studentLevel: string,
  subjectArea: string,
  isFirstUnit: boolean,
): string {
  const kt = unit.knowledgeType || 'conceptual'
  const objectives = unit.learningObjectives || []
  const assessTypes = selectAssessmentTypes(kt, objectives, subjectArea)

  const level = studentLevel === 'zero' || studentLevel === 'some' ? 'beginner' : 'intermediate'

  let sequence = ''

  if (isFirstUnit) {
    sequence = `
UNIDAD: "${unit.title}"
OBJETIVOS DE APRENDIZAJE:
${objectives.map((o: string) => `- ${o}`).join('\n')}

TEXTO DEL MATERIAL PARA ESTA UNIDAD:
"${unit.rawTextReference}"

HECHOS CLAVE A ENSEÑAR:
${(unit.keyFacts || []).map((f: string) => `- ${f}`).join('\n')}

SECUENCIA RECOMENDADA:
1. explain — Presentar el concepto usando el texto exacto del material
2. ${assessTypes[0] || 'true_false'} — Verificar reconocimiento básico
3. analogy o worked_example — Si el concepto es difícil, dar analogía o ejemplo
4. ${assessTypes[1] || 'multiple_choice'} — Verificar comprensión
5. active_recall — El estudiante explica con sus palabras`
  } else {
    sequence = `
UNIDAD: "${unit.title}"
OBJETIVOS:
${objectives.map((o: string) => `- ${o}`).join('\n')}

TEXTO: "${unit.rawTextReference}"

HECHOS: ${(unit.keyFacts || []).slice(0, 3).map((f: string) => f).join(' | ')}

EVALUACIÓN RECOMENDADA: ${assessTypes.join(', ')}`
  }

  return sequence
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const {
      sessionBlueprint,
      topics,
      coverageUnits,          // NUEVO — unidades reales del análisis
      materialTextForSession, // NUEVO — texto del material para esta sesión
      sessionLength = 'medium',
      previousEvidence = {},
      userProfile = null,
      sessionNumber = 1,
      subjectArea = 'general',
      studentLevel = 'some',
    } = body

    const targetMinutes = { short: 12, medium: 22, long: 35 }[sessionLength as string] || 22
    const maxActs = { short: 5, medium: 8, long: 12 }[sessionLength as string] || 8
    const depth = sessionLength === 'short' ? 'concise' : sessionLength === 'long' ? 'deep' : 'balanced'

    // ── Construir contexto REAL del material ─────────────────────
    // Prioridad: coverageUnits del análisis > topics del blueprint
    let unitsContext = ''
    let assessmentStrategyContext = ''

    if (coverageUnits && coverageUnits.length > 0) {
      // Usar las unidades del análisis profundo — tienen texto real
      unitsContext = coverageUnits.map((unit: any, i: number) =>
        buildUnitSequence(unit, studentLevel, subjectArea, i === 0)
      ).join('\n\n---\n\n')

      // Estrategias de evaluación por unidad
      assessmentStrategyContext = coverageUnits.map((unit: any) => {
        const types = selectAssessmentTypes(unit.knowledgeType || 'conceptual', unit.learningObjectives || [], subjectArea)
        return `• "${unit.title}" → mejor evaluado con: ${types.join(', ')}`
      }).join('\n')

    } else if (topics && topics.length > 0) {
      // Fallback: usar topics del blueprint
      unitsContext = topics.map((t: any) => {
        const concepts = (t.concepts || []).map((c: any) => {
          const evidence = previousEvidence?.[c.name]
          const level = evidence !== undefined
            ? evidence < 30 ? 'NO SABE' : evidence < 60 ? 'SABE POCO' : 'SABE'
            : 'SIN DATOS'
          return `  • ${c.name} (${level})`
        }).join('\n')
        return `TEMA: ${t.title}\n${concepts}`
      }).join('\n\n')
    }

    // Texto del material para esta sesión específica
    const materialContext = materialTextForSession
      ? `\nTEXTO DEL MATERIAL PARA USAR EN ESTA SESIÓN:\n${materialTextForSession.slice(0, 4000)}`
      : ''

    const prompt = `Eres un tutor experto diseñando una sesión de estudio. Tu trabajo es enseñar el material REAL del documento al estudiante.

SESIÓN #${sessionNumber} | ${targetMinutes} minutos | ${depth} | max ${maxActs} actividades
OBJETIVO: ${sessionBlueprint?.objective || 'Aprender el contenido'}
PROPÓSITO: ${sessionBlueprint?.purpose || 'understand'}
ÁREA: ${subjectArea}

═══════════════════════════════════════════
UNIDADES DE ESTA SESIÓN (con texto real del material):
═══════════════════════════════════════════
${unitsContext}
${materialContext}

═══════════════════════════════════════════
ESTRATEGIAS DE EVALUACIÓN POR UNIDAD:
═══════════════════════════════════════════
${assessmentStrategyContext}

═══════════════════════════════════════════
REGLAS ABSOLUTAS:
═══════════════════════════════════════════
1. TODA explicación debe basarse en el texto real del material. No inventar.
2. TODA pregunta debe usar información específica del documento (nombres, fechas, eventos reales).
3. Usar el tipo de evaluación correcto para cada objetivo cognitivo — NO siempre multiple_choice.
4. La secuencia correcta por unidad es:
   - explain (con texto real) → mini evaluación → [si falla: reexplicar] → recall
5. Si hay múltiples unidades, cada una tiene su propia explicación + evaluación.
6. Progresión de dificultad: reconocimiento → comprensión → aplicación → análisis.
7. NUNCA hacer 3 explicaciones seguidas sin una evaluación.
8. El recall final debe ser diferente al recall del medio — pedir síntesis completa.

TIPOS DE ACTIVIDAD DISPONIBLES:
explain, context, analogy, worked_example, step_by_step,
micro_quiz, mini_exam, active_recall, micro_flashcards,
case_study, comparison, cause_effect, ordering, matching,
fill_blank, true_false, error_detection, actors, identify,
harder_problem, inverse_teaching, metacognition

REGLA DE SELECCIÓN:
- Para hechos/personas/fechas → ordering, matching, fill_blank, true_false
- Para causas/consecuencias → cause_effect, ordering, case_study
- Para comparaciones → comparison, matching, true_false
- Para procesos → ordering, step_by_step, error_detection
- Para conceptos abstractos → analogy, comparison, active_recall
- Para aplicación → case_study, harder_problem
- NUNCA usar solo multiple_choice — es el tipo menos eficiente para aprender

Devuelve SOLO este JSON:
{
  "steps": [
    {
      "id": "step_1",
      "type": "explain",
      "conceptsTargeted": ["Nombre exacto del concepto del material"],
      "instruction": "Instrucción MUY ESPECÍFICA para ALAI: qué enseñar, qué citar del material, qué aspecto priorizar. Incluir hechos específicos del material que DEBE mencionar.",
      "assessmentObjective": "recognition|comprehension|application|transfer|retention",
      "metadata": {
        "knowledgeType": "conceptual",
        "learningGoal": "explain_concept",
        "difficulty": 30,
        "estimatedMinutes": 4,
        "usesRealMaterial": true
      }
    }
  ],
  "sessionObjectives": [
    "Al terminar esta sesión el estudiante podrá..."
  ],
  "sessionSummary": "Qué aprenderá el estudiante en esta sesión"
}`

    const result = await alaiRequest(async (client: any, modelFn: (m?: string) => string) => {
      const res = await client.chat.completions.create({
        model: modelFn(),
        messages: [
        {
          role: 'system',
          content: 'Diseñas sesiones pedagógicas usando el texto real del material. Nunca inventas información. Siempre basas las explicaciones y preguntas en el documento.',
        },
        { role: 'user', content: prompt },
      ],
        temperature: 0.35,
        max_tokens: 3500,
      })
      const rawText = res?.choices?.[0]?.message?.content || ''
      if (!rawText.trim()) throw new Error('ALAI_EMPTY_RESPONSE')
      return { text: rawText, provider: 'unknown', model: 'unknown' }
    })

    let parsed = safeParseJson(result.text)
    if (!parsed?.steps) {
      const match = result.text.match(/\{[\s\S]*\}/)
      if (match) parsed = safeParseJson(match[0])
    }

    if (!parsed?.steps || !Array.isArray(parsed.steps) || parsed.steps.length === 0) {
      console.error('[plan-session] Sin steps. Usando fallback.')
      return NextResponse.json({
        success: true,
        steps: buildFallbackSteps(coverageUnits || topics || [], subjectArea, sessionLength),
        sessionSummary: sessionBlueprint?.objective || 'Sesión de estudio',
        isFallback: true,
      })
    }

    // Validar que hay evaluación
    const hasEval = parsed.steps.some((s: any) =>
      ['micro_quiz', 'mini_exam', 'active_recall', 'case_study', 'harder_problem',
       'comparison', 'cause_effect', 'ordering', 'matching', 'fill_blank',
       'true_false', 'error_detection'].includes(s.type)
    )

    if (!hasEval) {
      const lastConcept = parsed.steps[parsed.steps.length - 1]?.conceptsTargeted?.[0]
      parsed.steps.push({
        id: `auto_recall_${Date.now()}`,
        type: 'active_recall',
        conceptsTargeted: lastConcept ? [lastConcept] : [],
        instruction: 'El estudiante explica con sus propias palabras los conceptos principales de esta sesión sin mirar el material.',
        assessmentObjective: 'recall',
        metadata: { knowledgeType: 'conceptual', learningGoal: 'explain_concept', difficulty: 50, estimatedMinutes: 4, usesRealMaterial: true },
      })
    }

    // Garantizar cierre distinto si hay recall + metacognición
    const recallIdx = parsed.steps.findIndex((s: any) => s.type === 'active_recall')
    const metaIdx = parsed.steps.findIndex((s: any) => s.type === 'metacognition')
    if (recallIdx >= 0 && metaIdx >= 0 && metaIdx > recallIdx) {
      parsed.steps[metaIdx].instruction = `Cierre de sesión. Sin mirar el material responde: (1) ¿Qué fue lo más importante que aprendiste? (2) ¿Qué todavía no tienes claro? (3) Explica el tema completo en 3 oraciones.`
    }

    const trimmed = parsed.steps.slice(0, maxActs + 3)

    console.log(`[plan-session] #${sessionNumber} | ${trimmed.length} steps | ${subjectArea} | ${depth}`)

    return NextResponse.json({
      success: true,
      steps: trimmed,
      sessionObjectives: parsed.sessionObjectives || [],
      sessionSummary: parsed.sessionSummary || '',
      estimatedMinutes: targetMinutes,
      isFallback: false,
    })

  } catch (err: any) {
    console.error('[plan-session]', err.message)
    return NextResponse.json({ success: false, error: err.message }, { status: 500 })
  }
}

function buildFallbackSteps(units: any[], subjectArea: string, sessionLength: string): any[] {
  const id = () => `fb_${Math.random().toString(36).slice(2, 8)}`
  const maxActs = { short: 4, medium: 6, long: 8 }[sessionLength as string] || 6
  const steps: any[] = []

  for (let i = 0; i < Math.min(units.length, 3); i++) {
    const unit = units[i]
    const title = unit?.title || unit?.topicTitle || 'el tema'

    steps.push({
      id: id(), type: 'explain',
      conceptsTargeted: [title],
      instruction: `Explica "${title}" usando el texto exacto del material. Cita hechos específicos.`,
      metadata: { knowledgeType: unit?.knowledgeType || 'conceptual', learningGoal: 'explain_concept', difficulty: 40, estimatedMinutes: 5 },
    })

    const assessType = subjectArea === 'history' ? 'ordering' :
      subjectArea === 'math' ? 'fill_blank' :
      subjectArea === 'medical' ? 'cause_effect' : 'true_false'

    steps.push({
      id: id(), type: assessType,
      conceptsTargeted: [title],
      instruction: `Verifica comprensión de "${title}" con una pregunta específica del material.`,
      metadata: { knowledgeType: unit?.knowledgeType || 'conceptual', learningGoal: 'explain_concept', difficulty: 45, estimatedMinutes: 4 },
    })
  }

  if (steps.length < maxActs) {
    steps.push({
      id: id(), type: 'active_recall',
      conceptsTargeted: units.slice(0, 3).map((u: any) => u?.title || 'el tema'),
      instruction: 'Explica todo lo que aprendiste en esta sesión con tus propias palabras.',
      metadata: { knowledgeType: 'conceptual', learningGoal: 'explain_concept', difficulty: 55, estimatedMinutes: 5 },
    })
  }

  return steps.slice(0, maxActs)
}
