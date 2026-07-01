import { NextRequest, NextResponse } from 'next/server'
import { alaiRequest } from '../../../../lib/alai'

export const maxDuration = 60

function genId(): string {
  return Math.random().toString(36).slice(2, 10)
}

// ═══════════════════════════════════════════════════════════════
// ESTRATEGIAS POR TIPO DE CONOCIMIENTO
// Cada tipo produce una secuencia diferente de actividades
// ═══════════════════════════════════════════════════════════════
const KNOWLEDGE_STRATEGIES: Record<string, {
  label: string
  sequence: string[]
  explainStyle: string
}> = {
  mathematical: {
    label: 'Matemático — ejemplo resuelto + práctica guiada',
    sequence: ['explain', 'worked_example', 'guided_practice', 'micro_quiz', 'active_recall'],
    explainStyle: 'Empieza con la intuición del concepto. Muestra el mecanismo con un ejemplo numérico del material. No des solo definiciones.',
  },
  medical: {
    label: 'Médico — mecanismo fisiológico + caso clínico',
    sequence: ['context', 'explain', 'cause_effect', 'micro_quiz', 'case_study', 'active_recall'],
    explainStyle: 'Usa el flujo fisiológico: estructura → función → mecanismo → consecuencia → patología. Incluye datos concretos del material.',
  },
  legal: {
    label: 'Jurídico — norma + principio + caso + argumento',
    sequence: ['explain', 'context', 'comparison', 'micro_quiz', 'case_study', 'active_recall'],
    explainStyle: 'Sigue: norma → principio que la sustenta → caso de aplicación → argumento jurídico → consecuencia. No solo definas.',
  },
  argumentative: {
    label: 'Argumentativo — posiciones + contraargumentos',
    sequence: ['context', 'explain', 'position_a', 'position_b', 'micro_quiz', 'active_recall'],
    explainStyle: 'Presenta el argumento, luego el contraargumento, luego la síntesis. Invita a razonar.',
  },
  narrative: {
    label: 'Narrativo — contexto + actores + conflicto + legado',
    sequence: ['context', 'actors', 'explain', 'comparison', 'micro_quiz', 'active_recall'],
    explainStyle: 'Sigue: contexto histórico → actores clave → conflicto o evento central → consecuencias → legado. Cuenta una historia.',
  },
  procedural: {
    label: 'Procedimental — paso a paso + práctica guiada',
    sequence: ['explain', 'step_by_step', 'guided_practice', 'micro_quiz', 'active_recall'],
    explainStyle: 'Numera los pasos. Explica el por qué de cada uno. Luego guía al estudiante a ejecutarlo.',
  },
  memoristic: {
    label: 'Memorístico — identificación + flashcards + recall',
    sequence: ['explain', 'micro_flashcards', 'identify', 'micro_quiz', 'active_recall'],
    explainStyle: 'Agrupa elementos relacionados. Usa patrones y asociaciones. No listes sin estructura.',
  },
  causal: {
    label: 'Causal — causa → mecanismo → efecto → predicción',
    sequence: ['context', 'explain', 'cause_effect', 'micro_quiz', 'case_study', 'active_recall'],
    explainStyle: 'Sigue la cadena: qué causa X → cómo funciona el mecanismo → qué efectos produce → qué predicciones se pueden hacer.',
  },
  conceptual: {
    label: 'Conceptual — intuición + modelo + aplicación',
    sequence: ['explain', 'analogy', 'micro_quiz', 'comparison', 'active_recall'],
    explainStyle: 'Construye la intuición antes de la definición formal. Usa analogía. Luego aplica a caso concreto.',
  },
  visual: {
    label: 'Visual — estructura + identificación + relaciones',
    sequence: ['explain', 'identify', 'micro_flashcards', 'micro_quiz', 'active_recall'],
    explainStyle: 'Describe la estructura visualmente con palabras. Qué está conectado con qué. Qué forma tiene. Qué partes lo componen.',
  },
}

const FALLBACK_STRATEGY = KNOWLEDGE_STRATEGIES.conceptual

function buildTutorPlan(params: {
  concepts: Array<{ concept: string; score: number; status: 'new' | 'weak' | 'medium' | 'strong'; knowledgeType?: string; learningGoal?: string }>
  dominantKnowledgeType: string
  sessionLength: string
  sessionTitle: string
  mustReinforce: string[]
  isLevelZero: boolean
  pedagogicalPlan: {
    learningGoal: string
    commonFailure: string
    masteryEvidence: string
    bestSequence: string[]
    depth: 'low' | 'medium' | 'high'
  }
}): any[] {
  const { concepts, dominantKnowledgeType, sessionLength, sessionTitle, mustReinforce, isLevelZero, pedagogicalPlan } = params
  const steps: any[] = []

  const maxConcepts = sessionLength === 'short' ? 2 : sessionLength === 'long' ? 4 : 3
  const strategy = KNOWLEDGE_STRATEGIES[dominantKnowledgeType] || FALLBACK_STRATEGY

  const activeConcepts = [
    ...concepts.filter(c => mustReinforce.includes(c.concept)),
    ...concepts.filter(c => c.status === 'new' && !mustReinforce.includes(c.concept)),
    ...concepts.filter(c => c.status === 'weak' && !mustReinforce.includes(c.concept)),
    ...concepts.filter(c => c.status === 'medium'),
  ].slice(0, maxConcepts)

  if (activeConcepts.length === 0) return []

  // Secuencia del pedagogicalPlan o fallback a estrategia del tipo
  const baseSequence = pedagogicalPlan.bestSequence.length > 0
    ? pedagogicalPlan.bestSequence
    : strategy.sequence

  const maxPerConcept = pedagogicalPlan.depth === 'low' ? 2 : pedagogicalPlan.depth === 'high' ? 5 : 3

  for (let conceptIdx = 0; conceptIdx < activeConcepts.length; conceptIdx++) {
    const conceptObj = activeConcepts[conceptIdx]
    const c = conceptObj.concept
    const isNew = conceptObj.status === 'new' || conceptObj.status === 'weak'
    const conceptKt = (conceptObj as any).knowledgeType || dominantKnowledgeType
    const conceptLg = (conceptObj as any).learningGoal || pedagogicalPlan.learningGoal

    // Variar secuencia entre conceptos para evitar plantilla repetitiva
    const conceptSequence = conceptIdx === 0
      ? baseSequence.slice(0, maxPerConcept + 1)
      : (() => {
          const teachStep = isNew ? ['explain'] : []
          const rest = baseSequence.filter(a => a !== 'explain' && a !== 'metacognition')
          const rotated = [...rest.slice(conceptIdx % rest.length), ...rest.slice(0, conceptIdx % rest.length)]
          return [...teachStep, ...rotated].slice(0, maxPerConcept)
        })()

    for (const actType of conceptSequence) {
      const meta = { knowledgeType: conceptKt, learningGoal: conceptLg, actType, explainStyle: strategy.explainStyle }

      if (['explain', 'context', 'analogy', 'worked_example', 'step_by_step', 'guided_practice'].includes(actType)) {
        if (isNew || conceptIdx === 0) {
          steps.push({
            id: genId(), type: 'explain', engine: 'analisis',
            title: getStepTitle(actType, c),
            instruction: getExplainInstruction(actType, c, conceptKt, isLevelZero, pedagogicalPlan.commonFailure, strategy.explainStyle),
            conceptsTargeted: [c],
            estimatedMinutes: 3, evidenceRequired: false, status: 'pending',
            metadata: meta,
          })
        }
      } else if (['micro_quiz', 'comparison', 'cause_effect', 'position_a', 'position_b', 'identify', 'case_study', 'actors', 'harder_problem'].includes(actType)) {
        steps.push({
          id: genId(), type: 'micro_quiz', engine: 'quiz',
          title: getStepTitle(actType, c),
          instruction: getQuizInstruction(actType, c, conceptKt, pedagogicalPlan.masteryEvidence),
          conceptsTargeted: [c],
          estimatedMinutes: 2, evidenceRequired: true, status: 'pending',
          metadata: meta,
        })
      } else if (actType === 'micro_flashcards') {
        steps.push({
          id: genId(), type: 'micro_flashcards', engine: 'flashcards',
          title: `Flashcards: ${c}`,
          instruction: `Memoriza los conceptos clave de "${c}".`,
          conceptsTargeted: [c],
          estimatedMinutes: 3, evidenceRequired: false, status: 'pending',
          metadata: meta,
        })
      } else if (actType === 'active_recall') {
        steps.push({
          id: genId(), type: 'active_recall', engine: 'alai',
          title: `Explícalo tú: ${c}`,
          instruction: getRecallInstruction(c, conceptKt, conceptLg),
          conceptsTargeted: [c],
          estimatedMinutes: 3, evidenceRequired: true, status: 'pending',
          metadata: meta,
        })
      }
    }
  }

  // Cierre metacognitivo
  const firstConcept = activeConcepts[0]?.concept || sessionTitle
  steps.push({
    id: genId(), type: 'metacognition', engine: 'alai',
    title: 'Cierre de sesión',
    instruction: getMetacognitionInstruction(dominantKnowledgeType, firstConcept, activeConcepts.map(c => c.concept)),
    conceptsTargeted: activeConcepts.map(c => c.concept),
    estimatedMinutes: 3, evidenceRequired: true, status: 'pending',
    metadata: { knowledgeType: dominantKnowledgeType, learningGoal: pedagogicalPlan.learningGoal },
  })

  return steps
}

function getStepTitle(actType: string, concept: string): string {
  const titles: Record<string, string> = {
    explain: `Aprendiendo: ${concept}`,
    context: `Contexto: ${concept}`,
    analogy: `Analogía: ${concept}`,
    worked_example: `Ejemplo resuelto: ${concept}`,
    step_by_step: `Paso a paso: ${concept}`,
    guided_practice: `Práctica guiada: ${concept}`,
    micro_quiz: `¿Entendiste "${concept}"?`,
    comparison: `Comparación: ${concept}`,
    cause_effect: `Causa y efecto: ${concept}`,
    position_a: `Argumento: ${concept}`,
    position_b: `Contraargumento: ${concept}`,
    identify: `Identifica: ${concept}`,
    case_study: `Caso aplicado: ${concept}`,
    actors: `Actores: ${concept}`,
    harder_problem: `Problema avanzado: ${concept}`,
    active_recall: `Explícalo tú: ${concept}`,
  }
  return titles[actType] || concept
}

function getExplainInstruction(actType: string, concept: string, kt: string, isLevelZero: boolean, commonFailure: string, explainStyle: string): string {
  const base = isLevelZero
    ? `Vamos a aprender "${concept}" desde cero. Lee con atención.`
    : `Profundizamos en "${concept}". Presta atención al mecanismo.`

  const byType: Record<string, string> = {
    context: `Antes de entrar en "${concept}", necesitas el contexto. ¿Qué existía antes? ¿Qué problema resuelve?`,
    analogy: `Para entender "${concept}", lo veremos desde una analogía. Error común: ${commonFailure || 'confundir los términos'}.`,
    worked_example: `Vamos a resolver un ejemplo de "${concept}" paso a paso. Observa el proceso completo. Estilo: ${explainStyle}`,
    step_by_step: `"${concept}" es un proceso. Lo vemos paso a paso. No te saltes ninguno.`,
    guided_practice: `Practicamos "${concept}" juntos. Sigue el razonamiento en cada paso.`,
    explain: `${explainStyle ? explainStyle + ' ' : ''}${base}`,
  }
  return byType[actType] || base
}

function getQuizInstruction(actType: string, concept: string, kt: string, masteryEvidence: string): string {
  const byType: Record<string, string> = {
    micro_quiz: `Basándote en lo que acabas de leer sobre "${concept}", responde.`,
    comparison: `Compara "${concept}" con lo que viste antes. ¿Cuál es la diferencia clave?`,
    cause_effect: `¿Qué causa "${concept}" y qué consecuencias produce?`,
    position_a: `¿Cuál es el primer argumento sobre "${concept}"?`,
    position_b: `¿Cuál es el contraargumento sobre "${concept}"?`,
    identify: `Identifica "${concept}" en el siguiente contexto.`,
    case_study: `Aplica "${concept}" a este caso concreto.`,
    actors: `¿Quiénes son los actores clave en "${concept}" y qué rol tiene cada uno?`,
    harder_problem: `Ahora un problema más difícil sobre "${concept}". Requiere aplicar lo aprendido.`,
  }
  return byType[actType] || `Demuestra que entendiste "${concept}".`
}

function getRecallInstruction(concept: string, kt: string, learningGoal: string): string {
  const byGoal: Record<string, string> = {
    solve_problem: `Describe el proceso para resolver un problema con "${concept}". ¿Qué pasos seguirías?`,
    explain_concept: `Explica "${concept}" con tus propias palabras, como si se lo enseñaras a alguien que no sabe nada.`,
    apply_to_case: `¿Cómo aplicarías "${concept}" en un caso real? Da un ejemplo concreto.`,
    argue_position: `¿Cuál es el argumento más fuerte sobre "${concept}"? Defiéndelo.`,
    analyze_cause_effect: `¿Qué causa "${concept}" y qué consecuencias produce? Explica la cadena.`,
    memorize_terms: `Lista y define los términos más importantes de "${concept}".`,
    follow_procedure: `Describe el procedimiento de "${concept}" paso a paso.`,
    compare_models: `Compara "${concept}" con lo que existía antes. ¿Qué cambió?`,
  }
  const byKt: Record<string, string> = {
    mathematical: `Sin mirar el material, resuelve un ejemplo de "${concept}" y explica cada paso.`,
    medical: `Explica el mecanismo de "${concept}": ¿qué estructura está involucrada, qué función cumple y qué pasa si falla?`,
    legal: `Aplica "${concept}" a un caso concreto: ¿qué norma aplica, qué principio la sustenta y cuál sería la conclusión jurídica?`,
    narrative: `Cuenta la historia de "${concept}" con tus palabras: contexto, actores, conflicto y legado.`,
  }
  return byGoal[learningGoal] || byKt[kt] || `Explica "${concept}" con tus propias palabras.`
}

function getMetacognitionInstruction(kt: string, firstConcept: string, allConcepts: string[]): string {
  const byKt: Record<string, string> = {
    mathematical: `Para cerrar:\n1. ¿Puedes resolver un ejercicio de "${firstConcept}" sin ayuda?\n2. ¿Qué parte del proceso todavía te confunde?\n3. ¿Cuándo usarías esto en la práctica?`,
    medical: `Para cerrar:\n1. ¿Puedes explicar el mecanismo de "${firstConcept}" sin mirar el material?\n2. ¿Qué pasa clínicamente si este mecanismo falla?\n3. ¿Qué todavía no tienes claro?`,
    legal: `Para cerrar:\n1. ¿Puedes aplicar "${firstConcept}" a un caso concreto?\n2. ¿Cuál es el argumento más difícil de refutar?\n3. ¿Qué principio jurídico lo sustenta?`,
    narrative: `Para cerrar:\n1. ¿Puedes contar la historia de "${firstConcept}" con tus palabras?\n2. ¿Qué fue lo más sorprendente?\n3. ¿Qué conexión tiene con lo que ya sabías?`,
  }
  return byKt[kt] || `Para cerrar:\n1. ¿Qué fue lo más importante que aprendiste sobre "${allConcepts.join('", "')}"?\n2. ¿Qué todavía no tienes claro?\n3. ¿Puedes explicarlo con tus propias palabras?`
}

// ═══════════════════════════════════════════════════════════════
// MAIN HANDLER
// ═══════════════════════════════════════════════════════════════
export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const sessionBlueprint = body.sessionBlueprint
    const topicsData = body.topics || []
    const sessionLength = body.sessionLength || 'medium'
    const previousEvidence = body.previousEvidence || {}
    const userProfile = body.userProfile || null
    const handoffNote: string = body.handoffNote || ''
    const mustStartWith: string[] = body.mustStartWith || []
    const mustReinforce: string[] = body.mustReinforce || []
    const canSkip: string[] = body.canSkip || []
    const sessionNumber: number = body.sessionNumber || 1

    if (!sessionBlueprint || topicsData.length === 0) {
      return NextResponse.json({ success: false, error: 'sessionBlueprint y topics requeridos' }, { status: 400 })
    }

    // Nivel del estudiante
    const allScores = Object.values(previousEvidence) as number[]
    const avgScore = allScores.length > 0
      ? allScores.reduce((a: number, b: number) => a + b, 0) / allScores.length : -1
    const isLevelZero = avgScore < 0 || (avgScore < 15 && sessionNumber <= 2)

    // Detectar knowledgeType dominante
    const knowledgeTypeCounts: Record<string, number> = {}
    for (const t of topicsData) {
      const kt = t.primaryKnowledgeType || t.knowledgeType || 'conceptual'
      knowledgeTypeCounts[kt] = (knowledgeTypeCounts[kt] || 0) + 1
      for (const kt2 of (t.knowledgeTypes || [])) {
        knowledgeTypeCounts[kt2] = (knowledgeTypeCounts[kt2] || 0) + 0.5
      }
    }
    const dominantKnowledgeType = Object.entries(knowledgeTypeCounts)
      .sort((a, b) => b[1] - a[1])[0]?.[0] || 'conceptual'

    // Clasificar conceptos
    const allConcepts: Array<{ name: string; score: number; knowledgeType?: string; learningGoal?: string }> = []
    for (const topic of topicsData) {
      const topicKt = topic.primaryKnowledgeType || topic.knowledgeType || 'conceptual'
      for (const concept of (topic.concepts || [])) {
        allConcepts.push({
          name: concept.name,
          score: previousEvidence[concept.name] ?? -1,
          knowledgeType: concept.knowledgeType || topicKt,
          learningGoal: concept.learningGoal || 'explain_concept',
        })
      }
    }

    const conceptGroups = allConcepts.map(c => ({
      concept: c.name,
      score: c.score,
      knowledgeType: c.knowledgeType,
      learningGoal: c.learningGoal,
      status: (
        canSkip.includes(c.name) && c.score >= 75 ? 'strong' :
        mustStartWith.includes(c.name) || mustReinforce.includes(c.name) ? 'weak' :
        c.score < 0 ? 'new' :
        c.score < 40 ? 'weak' :
        c.score < 70 ? 'medium' : 'strong'
      ) as 'new' | 'weak' | 'medium' | 'strong',
    }))

    // ALAI genera el pedagogicalPlan
    const strategy = KNOWLEDGE_STRATEGIES[dominantKnowledgeType] || FALLBACK_STRATEGY
    const newConcepts = conceptGroups.filter(c => c.status === 'new' || c.status === 'weak').map(c => c.concept)
    const profileNote = userProfile ? [
      userProfile.carrera ? `Carrera: ${userProfile.carrera}` : '',
      userProfile.academicLevel ? `Nivel: ${userProfile.academicLevel}` : '',
    ].filter(Boolean).join(' | ') : ''

    const planPrompt = `Eres un diseñador pedagógico experto. Antes de generar cualquier actividad, RAZONA como un profesor experto que analiza cómo enseñar este topic específico.

═══ INFORMACIÓN DEL TOPIC ═══
SESIÓN: "${sessionBlueprint.title}"
OBJETIVO: ${sessionBlueprint.objective || 'dominar el topic'}
TIPO DE CONOCIMIENTO: ${dominantKnowledgeType}
CONTEXTO DEL TIPO: ${strategy.label}
CONCEPTOS: ${newConcepts.slice(0, 5).join(', ') || conceptGroups.slice(0, 3).map(c => c.concept).join(', ')}

═══ ESTUDIANTE ═══
NIVEL: ${isLevelZero ? 'CERO — nunca vio esto' : `Promedio previo: ${Math.round(avgScore)}%`}
SESIÓN #: ${sessionNumber}
${profileNote ? `PERFIL: ${profileNote}` : ''}
${handoffNote ? `SESIÓN ANTERIOR: ${handoffNote}` : ''}

═══ RAZONA PRIMERO — responde estas 5 preguntas antes de diseñar ═══

PREGUNTA 1 — learningGoal:
¿Qué debe poder HACER el estudiante al terminar esta sesión?
No "aprender X" sino un verbo de acción observable: explicar, calcular, identificar, argumentar, aplicar, comparar, predecir.
Elige: build_intuition | explain_concept | interpret_formula | solve_problem | compare_models | memorize_terms | identify_structure | apply_to_case | argue_position | analyze_cause_effect | follow_procedure | synthesize_topic

PREGUNTA 2 — commonFailure:
¿Por qué la gente normalmente falla en ESTE topic específico?
No genérico. Ejemplo real:
- Funciones: "confunden dominio con rango y no entienden por qué f(x) tiene un único valor"
- Bohr: "memorizan la fórmula pero no entienden por qué existe, no pueden usarla en contexto"
- Contratos: "no distinguen cuándo aplica cada tipo de cláusula en un caso real"

PREGUNTA 3 — masteryEvidence:
¿Qué demostraría que el estudiante realmente dominó este topic?
Observable y concreto. Ejemplo:
- "puede calcular la derivada de una función sin ver el material"
- "puede explicar por qué el corazón en insuficiencia no bombea bien"
- "puede argumentar cuál parte del contrato protege al comprador"

PREGUNTA 4 — bestSequence:
¿Cuál es la secuencia de actividades que mejor enseña ESTE topic?
NO copies plantillas. Razona desde el tipo de conocimiento:

Si es MATEMÁTICO (funciones, derivadas, integrales):
→ El estudiante necesita ver el mecanismo antes de practicarlo
→ Ejemplo: ["explain", "worked_example", "guided_practice", "micro_quiz", "active_recall"]

Si es MÉDICO/FISIOLÓGICO (ciclo cardíaco, metabolismo):
→ El estudiante necesita el mecanismo + consecuencia clínica
→ Ejemplo: ["context", "explain", "cause_effect", "case_study", "micro_quiz", "active_recall"]

Si es JURÍDICO (normas, contratos, derechos):
→ El estudiante necesita norma → caso → argumento
→ Ejemplo: ["explain", "context", "case_study", "comparison", "micro_quiz", "active_recall"]

Si es NARRATIVO/HISTÓRICO (eventos, personajes, legado):
→ El estudiante necesita contexto + actores + consecuencias
→ Ejemplo: ["context", "actors", "explain", "comparison", "micro_quiz", "active_recall"]

Si es MEMORÍSTICO (anatomía, taxonomías, vocabulario):
→ El estudiante necesita ver + identificar + recordar
→ Ejemplo: ["explain", "micro_flashcards", "identify", "micro_quiz", "active_recall"]

Si es CONCEPTUAL (modelos, teorías):
→ El estudiante necesita intuición antes que definición
→ Ejemplo: ["explain", "analogy", "comparison", "micro_quiz", "active_recall"]

ACTIVIDADES DISPONIBLES:
explain, context, analogy, worked_example, step_by_step, guided_practice,
micro_quiz, comparison, cause_effect, position_a, position_b, identify,
case_study, actors, harder_problem, micro_flashcards, active_recall, metacognition

Máximo ${sessionLength === 'short' ? 3 : sessionLength === 'long' ? 6 : 5} actividades. Solo las necesarias.

PREGUNTA 5 — depth:
¿Qué profundidad necesita este topic?
- low: concepto simple, una explicación basta
- medium: concepto moderado, necesita explicación + práctica
- high: concepto complejo, necesita múltiples aproximaciones

═══ AHORA GENERA EL DISEÑO PEDAGÓGICO ═══
Devuelve SOLO JSON:
{
  "learningGoal": "explain_concept" (usa SIEMPRE inglés: build_intuition|explain_concept|interpret_formula|solve_problem|compare_models|memorize_terms|identify_structure|apply_to_case|argue_position|analyze_cause_effect|follow_procedure|synthesize_topic),
  "commonFailure": "error específico y concreto de este topic",
  "masteryEvidence": "qué demuestra dominio real y observable",
  "bestSequence": ["actividad1", "actividad2", "actividad3"],
  "depth": "low|medium|high",
  "reason": "En 1-2 oraciones: por qué esta secuencia específica para ESTE topic con ESTE estudiante"
}`

    let pedagogicalPlan = {
      learningGoal: 'explain_concept',
      commonFailure: 'memorizar sin entender',
      masteryEvidence: 'puede explicarlo con sus palabras',
      bestSequence: strategy.sequence,
      depth: 'medium' as 'low' | 'medium' | 'high',
      reason: 'estrategia base por tipo de conocimiento',
    }

    try {
      const rawPlan = await alaiRequest(async (client: any, modelFn: (m?: string) => string) => {
        const res = await client.chat.completions.create({
          model: modelFn('llama-3.3-70b-versatile'),
          messages: [{ role: 'user', content: planPrompt }],
          temperature: 0.4,
          max_tokens: 800,
        })
        return res.choices?.[0]?.message?.content || ''
      })

      let parsedPlan: any = null
      try { parsedPlan = JSON.parse(String(rawPlan).trim()) } catch {}
      if (!parsedPlan) {
        const m = String(rawPlan).match(/\{[\s\S]*\}/)
        if (m) try { parsedPlan = JSON.parse(m[0]) } catch {}
      }

      if (parsedPlan?.bestSequence?.length) {
        const validDepths = ['low', 'medium', 'high']
        pedagogicalPlan = {
          learningGoal: parsedPlan.learningGoal || pedagogicalPlan.learningGoal,
          commonFailure: parsedPlan.commonFailure || pedagogicalPlan.commonFailure,
          masteryEvidence: parsedPlan.masteryEvidence || pedagogicalPlan.masteryEvidence,
          bestSequence: Array.isArray(parsedPlan.bestSequence) ? parsedPlan.bestSequence : strategy.sequence,
          depth: (validDepths.includes(parsedPlan.depth) ? parsedPlan.depth : 'medium') as 'low' | 'medium' | 'high',
          reason: parsedPlan.reason || pedagogicalPlan.reason,
        }
        console.log(`[plan-session] 🧠 ${dominantKnowledgeType} | ${pedagogicalPlan.learningGoal} | seq: ${pedagogicalPlan.bestSequence.join('→')}`)
      }
    } catch (err) {
      console.warn('[plan-session] pedagogicalPlan LLM falló, usando estrategia base')
    }

    const steps = buildTutorPlan({
      concepts: conceptGroups,
      dominantKnowledgeType,
      sessionLength,
      sessionTitle: sessionBlueprint.title,
      mustReinforce,
      isLevelZero,
      pedagogicalPlan,
    })

    const levelLabel = isLevelZero ? 'NIVEL CERO' : `avg ${Math.round(avgScore)}%`
    console.log(`[plan-session] ✅ ${steps.length} pasos | "${sessionBlueprint.title}" | ${dominantKnowledgeType} | ${levelLabel}`)

    return NextResponse.json({
      success: true,
      pedagogicalPlan,
      rationale: pedagogicalPlan.reason,
      steps,
    })

  } catch (err: any) {
    console.error('[plan-session] Error:', err?.message)
    return NextResponse.json({ success: false, error: 'ALAI está ocupado.' }, { status: 503 })
  }
}
