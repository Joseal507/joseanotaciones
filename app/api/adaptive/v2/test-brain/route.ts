// ═══════════════════════════════════════════════════════════════
// /api/adaptive/v2/test-brain
// 
// Endpoint de prueba para verificar el cerebro pedagógico
// Simula una sesión completa con material fake de pH
// ═══════════════════════════════════════════════════════════════

import { NextRequest, NextResponse } from 'next/server'
import type {
  StudentModel,
  MaterialIntelligence,
  PedagogicalState,
  SessionBlueprint,
  StudyGoal,
} from '../../../../../lib/adaptive/v2/types'
import {
  buildInitialStudentModel,
  buildInitialPedagogicalState,
  buildStudyGoal,
} from '../../../../../lib/adaptive/v2/contracts'

// ═══════════════════════════════════════════════════════════════
// MATERIAL FAKE: pH y ácidos/bases (para testing)
// ═══════════════════════════════════════════════════════════════
const fakeMaterial: MaterialIntelligence = {
  materialId: 'test_ph',
  materialTitle: 'pH y Ácidos-Bases (Test)',
  subjectArea: 'chemistry',
  difficultyLevel: 'intermediate',
  totalPages: 5,
  analyzedAt: Date.now(),
  topics: [
    {
      id: 'topic_ph',
      title: 'pH y concentración de H+',
      rawText: 'El pH mide la acidez de una solución. Se calcula como pH = -log[H+]. Cuando [H+] aumenta, el pH baja. Una solución con pH = 7 es neutra. pH < 7 es ácida, pH > 7 es básica. Ejemplo: si [H+] = 1×10⁻⁶, entonces pH = 6.',
      keyFacts: [
        'pH = -log[H+]',
        'pH < 7 es ácido, pH > 7 es básico, pH = 7 es neutro',
        'Cuando [H+] aumenta, el pH baja',
        'El pH se mide de 0 a 14',
      ],
      keyIdeas: [
        'El logaritmo invierte la escala: más H+ = menos pH',
        'Cada unidad de pH representa 10 veces más o menos H+',
      ],
      topicType: 'mathematical',
      cognitiveLoad: 'medium',
      prerequisites: [],
      relatedTopics: ['topic_poh', 'topic_ka'],
      subtopics: [],
      formulaIds: ['formula_ph'],
      procedureIds: [],
      exampleIds: ['example_ph_1'],
      mistakeIds: ['mistake_log_direction'],
      learningObjectives: [
        'El estudiante podrá calcular pH desde [H+]',
        'El estudiante podrá identificar si una solución es ácida o básica',
        'El estudiante podrá explicar por qué más H+ significa menor pH',
      ],
      importance: 'critical',
      estimatedMinutes: 8,
      sourcePage: 1,
    },
    {
      id: 'topic_poh',
      title: 'pOH y relación con pH',
      rawText: 'El pOH mide la concentración de OH-. pOH = -log[OH-]. La relación fundamental es: pH + pOH = 14 (a 25°C). Esto significa que si conoces pH puedes calcular pOH y viceversa. Ejemplo: si pH = 3, entonces pOH = 11.',
      keyFacts: [
        'pOH = -log[OH-]',
        'pH + pOH = 14 (a 25°C)',
        'Kw = [H+][OH-] = 1×10⁻¹⁴',
      ],
      keyIdeas: [
        'pH y pOH son inversos complementarios',
        'Conocer uno te da el otro',
      ],
      topicType: 'mathematical',
      cognitiveLoad: 'medium',
      prerequisites: ['topic_ph'],
      relatedTopics: ['topic_ph', 'topic_ka'],
      subtopics: [],
      formulaIds: ['formula_poh', 'formula_kw'],
      procedureIds: [],
      exampleIds: ['example_ph_poh'],
      mistakeIds: [],
      learningObjectives: [
        'El estudiante podrá calcular pOH desde pH',
        'El estudiante podrá usar Kw para relacionar [H+] y [OH-]',
      ],
      importance: 'high',
      estimatedMinutes: 6,
      sourcePage: 2,
    },
    {
      id: 'topic_ka',
      title: 'Ka de ácidos débiles',
      rawText: 'Ka es la constante de disociación de un ácido débil. Ka = [H+][A-]/[HA]. Un Ka más grande significa un ácido más fuerte. Para calcular pH de un ácido débil, se usa una tabla ICE (Initial-Change-Equilibrium).',
      keyFacts: [
        'Ka = [H+][A-]/[HA]',
        'Ka más grande = ácido más fuerte',
        'Ka de ácidos fuertes es muy grande (>1)',
        'Ka típico de ácidos débiles: 10⁻³ a 10⁻⁹',
      ],
      keyIdeas: [
        'Ka mide qué tanto se disocia un ácido',
        'Se usa tabla ICE para resolver equilibrios',
      ],
      topicType: 'mathematical',
      cognitiveLoad: 'heavy',
      prerequisites: ['topic_ph', 'topic_poh'],
      relatedTopics: [],
      subtopics: [],
      formulaIds: ['formula_ka'],
      procedureIds: ['procedure_ice'],
      exampleIds: ['example_ka_1'],
      mistakeIds: ['mistake_ka_kb'],
      learningObjectives: [
        'El estudiante podrá escribir la expresión de Ka',
        'El estudiante podrá calcular pH de un ácido débil con tabla ICE',
        'El estudiante podrá distinguir ácidos fuertes de débiles',
      ],
      importance: 'critical',
      estimatedMinutes: 12,
      sourcePage: 3,
    },
  ],
  formulas: [
    {
      id: 'formula_ph',
      name: 'pH',
      formula: 'pH = -log[H+]',
      variables: [
        { symbol: 'pH', meaning: 'potencial de hidrógeno' },
        { symbol: '[H+]', meaning: 'concentración de iones hidrógeno', unit: 'M' },
      ],
      whenToUse: 'Cuando conoces [H+] y quieres calcular pH',
      commonErrors: ['Olvidar el signo negativo', 'Confundir log con ln'],
    },
    {
      id: 'formula_poh',
      name: 'pOH',
      formula: 'pOH = -log[OH-]',
      variables: [
        { symbol: 'pOH', meaning: 'potencial de hidróxido' },
        { symbol: '[OH-]', meaning: 'concentración de iones hidróxido', unit: 'M' },
      ],
      whenToUse: 'Cuando trabajas con bases o quieres pH desde pOH',
      commonErrors: [],
    },
    {
      id: 'formula_ka',
      name: 'Constante de acidez',
      formula: 'Ka = [H+][A-]/[HA]',
      variables: [
        { symbol: 'Ka', meaning: 'constante de disociación ácida' },
        { symbol: '[H+]', meaning: 'concentración de iones hidrógeno', unit: 'M' },
        { symbol: '[A-]', meaning: 'concentración de base conjugada', unit: 'M' },
        { symbol: '[HA]', meaning: 'concentración de ácido no disociado', unit: 'M' },
      ],
      whenToUse: 'Para calcular equilibrios de ácidos débiles',
      commonErrors: ['Confundir Ka con Kb', 'No usar tabla ICE', 'Usar concentración inicial en lugar de equilibrio'],
    },
  ],
  procedures: [
    {
      id: 'procedure_ice',
      name: 'Tabla ICE',
      steps: [
        'Escribir la ecuación de equilibrio',
        'Poner concentraciones Iniciales',
        'Definir el Cambio en términos de x',
        'Escribir las concentraciones en el Equilibrio',
        'Sustituir en la expresión de Ka',
        'Resolver para x',
      ],
      whenToUse: 'Para resolver problemas de equilibrio con Ka o Kb',
      commonErrors: ['No usar aproximación cuando x es pequeño', 'Confundir signos'],
    },
  ],
  keyExamples: [
    {
      id: 'example_ph_1',
      description: 'Calcula el pH de una solución con [H+] = 1×10⁻⁶ M',
      solution: 'pH = -log(1×10⁻⁶) = 6. Es levemente ácida.',
      relatedTopicIds: ['topic_ph'],
    },
  ],
  commonMistakes: [
    {
      id: 'mistake_log_direction',
      description: 'Pensar que más H+ significa mayor pH',
      correction: 'Al contrario: más H+ significa menor pH. El logaritmo negativo invierte la escala.',
      relatedTopicIds: ['topic_ph'],
      errorType: 'concept_confusion',
    },
    {
      id: 'mistake_ka_kb',
      description: 'Usar Ka cuando se debería usar Kb (o viceversa)',
      correction: 'Ka es para ácidos, Kb para bases. Si te dan una base, usa Kb.',
      relatedTopicIds: ['topic_ka'],
      errorType: 'concept_confusion',
    },
  ],
}

// ═══════════════════════════════════════════════════════════════
// ESTUDIANTE FAKE
// ═══════════════════════════════════════════════════════════════
function makeFakeStudent(): StudentModel {
  const profile = {
    userId: 'test_user',
    nombre: 'Estudiante Test',
    tipoEstudiante: 'universitario',
    universidad: 'Universidad Test',
    carrera: 'Medicina',
    academicLevel: 'intermedio' as const,
    studyContext: 'exam_prep' as const,
    languagePreference: 'es' as const,
  }
  
  const setup = {
    initialKnowledgeLevel: 'some' as const,
    sessionLength: 'medium' as const,
    targetScore: 90,
    examDate: 'in_1_week',
    dailyMinutes: 30,
  }
  
  return buildInitialStudentModel(profile, setup)
}

// ═══════════════════════════════════════════════════════════════
// SESSION BLUEPRINT FAKE
// ═══════════════════════════════════════════════════════════════
function makeFakeSession(): SessionBlueprint {
  return {
    sessionId: 'test_session_1',
    sessionNumber: 1,
    mission: 'Dominar pH y su relación con [H+]',
    targetTopics: ['topic_ph', 'topic_poh'],
    estimatedMinutes: 20,
    learningObjectives: [
      {
        objective: 'Calcular pH desde [H+]',
        verificationCriteria: 'Resolver 2 ejercicios correctamente',
        priority: 'must_have',
      },
      {
        objective: 'Explicar por qué más H+ significa menor pH',
        verificationCriteria: 'Respuesta abierta con lógica del logaritmo',
        priority: 'should_have',
      },
    ],
    sessionKind: 'first_contact',
    createdAt: Date.now(),
    status: 'ready',
  }
}

// ═══════════════════════════════════════════════════════════════
// ENDPOINT DE TEST
// ═══════════════════════════════════════════════════════════════
export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}))
    const action = body.action || 'first_call'    // first_call | with_answer
    const previousResponse = body.previousResponse
    const previousState = body.previousState
    const previousHistory = body.previousHistory

    const student = makeFakeStudent()
    const sessionBlueprint = makeFakeSession()
    const goal = buildStudyGoal(student.setup)
    
    const state = previousState || {
      ...buildInitialPedagogicalState(sessionBlueprint.sessionId),
      currentTopicId: sessionBlueprint.targetTopics[0],
      currentTopicTitle: fakeMaterial.topics[0].title,
      topicsRemaining: sessionBlueprint.targetTopics.slice(1),
    }
    
    const sessionHistory = previousHistory || {
      pagesShown: [],
      evidenceCollected: [],
      interactionsCompleted: 0,
    }
    
    // Simular una respuesta si es un test con respuesta
    let lastResponse = undefined
    if (action === 'with_answer' && previousResponse) {
      lastResponse = previousResponse
    }
    
    // Llamar al cerebro
    const decideNextRequest = {
      state,
      student,
      material: fakeMaterial,
      sessionBlueprint,
      goal,
      sessionHistory,
      lastResponse,
    }
    
    const brainRes = await fetch(new URL('/api/adaptive/v2/decide-next', request.url).toString(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(decideNextRequest),
    })
    
    if (!brainRes.ok) {
      const err = await brainRes.text()
      return NextResponse.json({
        success: false,
        error: `Brain returned ${brainRes.status}: ${err}`,
      })
    }
    
    const brainResponse = await brainRes.json()
    
    return NextResponse.json({
      success: true,
      test: {
        student: {
          nombre: student.profile.nombre,
          carrera: student.profile.carrera,
          nivel: student.setup.initialKnowledgeLevel,
          objetivo: student.setup.targetScore,
        },
        goal: {
          primaryObjective: goal.primaryObjective,
          urgency: goal.urgency,
          daysUntilDeadline: goal.daysUntilDeadline,
        },
        currentTopic: fakeMaterial.topics.find(t => t.id === state.currentTopicId)?.title,
        state: {
          loopPhase: state.loopPhase,
          totalPagesShown: state.totalPagesShown,
          streakCount: state.streakCount,
          strugglingCount: state.strugglingCount,
        },
      },
      brainResponse,
      nextTestCall: {
        instruction: 'Para simular una respuesta del estudiante, hacer POST con:',
        example: {
          action: 'with_answer',
          previousState: brainResponse.updatedState,
          previousHistory: {
            pagesShown: [...sessionHistory.pagesShown, brainResponse.decision?.page],
            evidenceCollected: brainResponse.evaluation 
              ? [...sessionHistory.evidenceCollected, brainResponse.evaluation.evidenceRecord]
              : sessionHistory.evidenceCollected,
            interactionsCompleted: sessionHistory.interactionsCompleted + (lastResponse ? 1 : 0),
          },
          previousResponse: {
            interactionId: brainResponse.decision?.page?.interaction?.id || 'test_int',
            studentAnswer: 'respuesta de prueba',
            responseTimeSeconds: 15,
            confidence: 'medium',
          },
        },
      },
    })
    
  } catch (err: any) {
    return NextResponse.json({
      success: false,
      error: err.message,
      stack: err.stack,
    })
  }
}

export async function GET(request: NextRequest) {
  return NextResponse.json({
    message: 'Test endpoint del cerebro pedagógico v2',
    usage: 'POST con { action: "first_call" } para arrancar',
    docs: 'https://studyal.dev/adaptive-v2',
  })
}
