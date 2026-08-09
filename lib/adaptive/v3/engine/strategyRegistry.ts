// ═══════════════════════════════════════════════════════════════
// STRATEGY REGISTRY
//
// Biblioteca extensible de estrategias pedagógicas.
// Cada estrategia es un objeto registrable con metadatos completos.
//
// Ventaja sobre TeachingObjective union type:
// - Cientos de estrategias sin agrandar el tipo
// - Cada estrategia tiene criterios de cuándo usarla
// - Cada estrategia tiene contraindicaciones
// - El selector puede buscar por compatibilidad, no solo por nombre
// ═══════════════════════════════════════════════════════════════

import type { EvidenceType } from './evidenceEngine'
import type { ErrorType } from './answerEvaluator'
import type { CognitiveType } from '../types'

// ═══════════════════════════════════════════════════════════════
// TIPOS
// ═══════════════════════════════════════════════════════════════

export type StrategyFamily =
  | 'activation'      // Activar conocimiento previo
  | 'explanation'     // Explicar el concepto
  | 'scaffolding'     // Andamiaje — reducir carga cognitiva
  | 'repair'          // Reparar error o misconception
  | 'memory'          // Consolidar en memoria
  | 'application'     // Aplicar a casos
  | 'transfer'        // Transferir a contexto nuevo
  | 'metacognition'   // Desarrollar metacognición
  | 'synthesis'       // Sintetizar múltiples conceptos
  | 'assessment'      // Evaluar comprensión

export interface TeachingStrategy {
  id: string
  name: string
  family: StrategyFamily
  description: string

  // Cuándo es apropiada
  suitableFor: {
    errorTypes?: ErrorType[]
    evidenceGaps?: EvidenceType[]     // qué evidencia falta
    cognitiveTypes?: CognitiveType[]
    difficultyRange?: [number, number]
    consecutiveFails?: [number, number]  // [min, max] fallos consecutivos
    masteryScoreRange?: [number, number]
  }

  // Cuándo NO usarla
  contraindications: string[]

  // Qué produce
  expectedEvidence: EvidenceType[]
  expectedOutcome: string

  // Control de uso
  maxUsesPerMicro: number
  cooldownTurns: number              // esperar N turnos antes de volver a usar
  requiresContext: string[]          // qué debe existir para poder usarla

  // Plantilla de prompt para el LLM
  promptTemplate: string

  // Si falla, qué intentar después
  fallbackStrategyIds: string[]
}

// ═══════════════════════════════════════════════════════════════
// REGISTRO DE ESTRATEGIAS
// ═══════════════════════════════════════════════════════════════

const STRATEGIES: TeachingStrategy[] = [

  // ═══ FAMILIA: ACTIVATION ════════════════════════════════════

  {
    id: 'activate_prior',
    name: 'Activar conocimiento previo',
    family: 'activation',
    description: 'Conectar con algo que el estudiante ya conoce antes de introducir algo nuevo.',
    suitableFor: {
      cognitiveTypes: ['conceptual', 'causal', 'analytical'],
      masteryScoreRange: [0, 20],
    },
    contraindications: ['El concepto es completamente nuevo sin anclaje posible'],
    expectedEvidence: ['recognized'],
    expectedOutcome: 'El estudiante conecta el nuevo concepto con uno familiar',
    maxUsesPerMicro: 1,
    cooldownTurns: 0,
    requiresContext: [],
    promptTemplate: 'Antes de explicar {microName}, conéctalo con algo que el estudiante probablemente ya conoce. Empieza con "Seguramente ya sabes que..." o "Esto es como cuando..."',
    fallbackStrategyIds: ['direct_explanation'],
  },

  {
    id: 'elicit_prediction',
    name: 'Elicitar predicción',
    family: 'activation',
    description: 'Pedir al estudiante que prediga el resultado antes de revelarlo.',
    suitableFor: {
      cognitiveTypes: ['causal', 'applicative', 'analytical'],
      evidenceGaps: ['applied', 'transferred'],
    },
    contraindications: ['Primera vez con el concepto', 'Estudiante muy frustrado'],
    expectedEvidence: ['applied'],
    expectedOutcome: 'El estudiante formula una hipótesis y la contrasta',
    maxUsesPerMicro: 2,
    cooldownTurns: 3,
    requiresContext: ['already_introduced'],
    promptTemplate: 'Antes de explicar el resultado, pide al estudiante que prediga: "¿Qué crees que pasa cuando...?" Luego revela y discute la diferencia.',
    fallbackStrategyIds: ['direct_example'],
  },

  // ═══ FAMILIA: EXPLANATION ═══════════════════════════════════

  {
    id: 'direct_explanation',
    name: 'Explicación directa',
    family: 'explanation',
    description: 'Explicar el concepto de forma clara y directa.',
    suitableFor: {
      masteryScoreRange: [0, 40],
    },
    contraindications: [],
    expectedEvidence: ['recognized', 'recalled'],
    expectedOutcome: 'El estudiante entiende la definición básica',
    maxUsesPerMicro: 1,
    cooldownTurns: 0,
    requiresContext: [],
    promptTemplate: 'Explica {microName} de forma clara y directa en 2-3 oraciones usando las citas exactas del material.',
    fallbackStrategyIds: ['analogy'],
  },

  {
    id: 'analogy',
    name: 'Analogía',
    family: 'explanation',
    description: 'Usar una analogía con algo familiar para explicar el concepto.',
    suitableFor: {
      errorTypes: ['knowledge_gap', 'random_guess'],
      cognitiveTypes: ['conceptual', 'causal', 'comparative'],
      consecutiveFails: [2, 10],
    },
    contraindications: ['El concepto es tan específico que la analogía puede confundir más'],
    expectedEvidence: ['recognized', 'explained'],
    expectedOutcome: 'El estudiante entiende por comparación con algo conocido',
    maxUsesPerMicro: 2,
    cooldownTurns: 2,
    requiresContext: [],
    promptTemplate: 'Explica {microName} usando una analogía con algo cotidiano. Empieza con "Es como cuando..." o "Imagina que...". La analogía debe iluminar exactamente la parte que el estudiante no entiende.',
    fallbackStrategyIds: ['worked_example', 'simplify'],
  },

  {
    id: 'counterexample',
    name: 'Contraejemplo',
    family: 'explanation',
    description: 'Mostrar qué NO es el concepto para delimitarlo.',
    suitableFor: {
      errorTypes: ['confused_similar_concept', 'misconception'],
      cognitiveTypes: ['definitional', 'classificatory', 'comparative'],
    },
    contraindications: ['Primera vez con el concepto'],
    expectedEvidence: ['recognized', 'connected'],
    expectedOutcome: 'El estudiante distingue el concepto de lo que NO es',
    maxUsesPerMicro: 2,
    cooldownTurns: 2,
    requiresContext: ['already_introduced'],
    promptTemplate: 'Para aclarar {microName}, muestra un contraejemplo: algo que parece correcto pero no lo es. Explica por qué ese caso específico queda FUERA del concepto.',
    fallbackStrategyIds: ['contrast_comparison'],
  },

  {
    id: 'contrast_comparison',
    name: 'Contraste directo',
    family: 'explanation',
    description: 'Comparar explícitamente el concepto con otro con el que se confunde.',
    suitableFor: {
      errorTypes: ['confused_similar_concept', 'inverted_relationship'],
      cognitiveTypes: ['comparative', 'definitional'],
      consecutiveFails: [1, 10],
    },
    contraindications: [],
    expectedEvidence: ['recognized', 'connected'],
    expectedOutcome: 'El estudiante distingue claramente los dos conceptos',
    maxUsesPerMicro: 3,
    cooldownTurns: 1,
    requiresContext: [],
    promptTemplate: 'El estudiante confunde {microName} con otro concepto. Crea una tabla mental o una comparación directa: "A diferencia de X, {microName} es/hace..." Resalta la diferencia clave con un ejemplo.',
    fallbackStrategyIds: ['address_misconception'],
  },

  {
    id: 'simplify',
    name: 'Simplificar al núcleo',
    family: 'explanation',
    description: 'Reducir el concepto a su esencia más simple. Una sola frase.',
    suitableFor: {
      errorTypes: ['incomplete_understanding', 'random_guess'],
      consecutiveFails: [3, 10],
      masteryScoreRange: [0, 35],
    },
    contraindications: [],
    expectedEvidence: ['recognized', 'recalled'],
    expectedOutcome: 'El estudiante entiende la idea central aunque sea simple',
    maxUsesPerMicro: 1,
    cooldownTurns: 0,
    requiresContext: [],
    promptTemplate: 'El estudiante está confundido. Reduce {microName} a su esencia en UNA sola frase corta y memorable. Luego da un solo ejemplo concreto. No añadas más información.',
    fallbackStrategyIds: ['analogy'],
  },

  {
    id: 'causal_chain',
    name: 'Cadena causal',
    family: 'explanation',
    description: 'Explicar paso a paso la cadena causa-efecto.',
    suitableFor: {
      errorTypes: ['inverted_relationship', 'incomplete_understanding'],
      cognitiveTypes: ['causal', 'procedural'],
    },
    contraindications: [],
    expectedEvidence: ['explained', 'connected'],
    expectedOutcome: 'El estudiante entiende por qué A lleva a B lleva a C',
    maxUsesPerMicro: 2,
    cooldownTurns: 2,
    requiresContext: [],
    promptTemplate: 'Explica {microName} como una cadena de eventos: Paso 1 → Paso 2 → Resultado. Usa flechas o numeración. Muestra por qué cada paso provoca el siguiente.',
    fallbackStrategyIds: ['direct_example'],
  },

  {
    id: 'address_misconception',
    name: 'Confrontar misconception',
    family: 'repair',
    description: 'Confrontar directamente la creencia incorrecta del estudiante.',
    suitableFor: {
      errorTypes: ['misconception', 'inverted_relationship', 'misconception'],
      consecutiveFails: [2, 10],
    },
    contraindications: ['Estudiante muy frustrado — puede ser contraproducente'],
    expectedEvidence: ['recognized', 'explained'],
    expectedOutcome: 'El estudiante reconoce y abandona la creencia incorrecta',
    maxUsesPerMicro: 2,
    cooldownTurns: 3,
    requiresContext: [],
    promptTemplate: 'El estudiante tiene una creencia incorrecta específica. Confronta directamente: "Parece que crees que X, pero en realidad Y porque Z [cita del material]." Explica por qué la creencia incorrecta parece razonable pero está equivocada.',
    fallbackStrategyIds: ['counterexample', 'contrast_comparison'],
  },

  {
    id: 'guided_discovery',
    name: 'Descubrimiento guiado',
    family: 'repair',
    description: 'Guiar al estudiante a descubrir su propio error mediante preguntas.',
    suitableFor: {
      errorTypes: ['inverted_relationship', 'misconception'],
      consecutiveFails: [1, 3],
    },
    contraindications: ['Estudiante con muy bajo mastery — no tiene base para razonar'],
    expectedEvidence: ['explained', 'connected'],
    expectedOutcome: 'El estudiante descubre el error por sí mismo → más memorable',
    maxUsesPerMicro: 2,
    cooldownTurns: 2,
    requiresContext: ['already_introduced'],
    promptTemplate: 'En vez de corregir directamente, guía al estudiante con preguntas: "¿Qué pasaría si...?" o "¿Puedes pensar en un caso donde eso no funcione?" Ayúdalo a llegar a la corrección por su cuenta.',
    fallbackStrategyIds: ['address_misconception'],
  },

  // ═══ FAMILIA: SCAFFOLDING ════════════════════════════════════

  {
    id: 'worked_example',
    name: 'Ejemplo resuelto',
    family: 'scaffolding',
    description: 'Resolver un ejemplo completo paso a paso antes de pedir que lo haga.',
    suitableFor: {
      errorTypes: ['calculation_error', 'calculation_error', 'incomplete_understanding'],
      cognitiveTypes: ['procedural', 'mathematical', 'applicative'],
      consecutiveFails: [2, 10],
    },
    contraindications: [],
    expectedEvidence: ['applied'],
    expectedOutcome: 'El estudiante ve el procedimiento correcto antes de intentarlo',
    maxUsesPerMicro: 2,
    cooldownTurns: 0,
    requiresContext: [],
    promptTemplate: 'Resuelve un ejemplo de {microName} paso a paso, mostrando cada operación y su razón. Luego di "Ahora intenta uno similar". El ejemplo debe ser del mismo nivel que los que fallará el estudiante.',
    fallbackStrategyIds: ['step_decomposition'],
  },

  {
    id: 'step_decomposition',
    name: 'Descomposición en pasos',
    family: 'scaffolding',
    description: 'Dividir el concepto en subcomponentes más simples.',
    suitableFor: {
      cognitiveTypes: ['procedural', 'mathematical', 'applicative'],
      consecutiveFails: [2, 10],
    },
    contraindications: [],
    expectedEvidence: ['recalled', 'applied'],
    expectedOutcome: 'El estudiante puede seguir el proceso dividido',
    maxUsesPerMicro: 1,
    cooldownTurns: 0,
    requiresContext: [],
    promptTemplate: 'El estudiante no puede manejar {microName} completo. Divídelo en 3-5 pasos más simples. Enseña y practica cada paso por separado antes de combinarlos.',
    fallbackStrategyIds: ['worked_example'],
  },

  {
    id: 'mnemonic',
    name: 'Mnemotecnia',
    family: 'memory',
    description: 'Crear un truco mental para recordar datos precisos.',
    suitableFor: {
      errorTypes: ['knowledge_gap', 'knowledge_gap'],
      evidenceGaps: ['recalled'],
      cognitiveTypes: ['definitional', 'chronological', 'classificatory'],
    },
    contraindications: ['El concepto es demasiado complejo para una mnemotecnia útil'],
    expectedEvidence: ['recalled', 'retained'],
    expectedOutcome: 'El estudiante puede recordar el dato con el truco mental',
    maxUsesPerMicro: 1,
    cooldownTurns: 0,
    requiresContext: [],
    promptTemplate: 'Crea una mnemotecnia, acrónimo o regla de memoria para {microName}. El truco debe ser fácil de recordar y hacer referencia al hecho exacto. Explica cómo el truco conecta con la información real.',
    fallbackStrategyIds: ['spaced_recall'],
  },

  {
    id: 'spaced_recall',
    name: 'Repaso espaciado',
    family: 'memory',
    description: 'Verificar retención después de que haya pasado tiempo.',
    suitableFor: {
      evidenceGaps: ['retained'],
      masteryScoreRange: [40, 100],
    },
    contraindications: ['El micro no ha sido aprendido aún'],
    expectedEvidence: ['retained'],
    expectedOutcome: 'Confirmar que el estudiante recuerda sin refuerzo reciente',
    maxUsesPerMicro: 5,
    cooldownTurns: 10,
    requiresContext: ['already_mastered'],
    promptTemplate: 'Sin dar contexto adicional, pide al estudiante que recuerde {microName}. Si tiene dificultad, da un pequeño recordatorio. El objetivo es verificar retención, no re-enseñar.',
    fallbackStrategyIds: ['direct_explanation'],
  },

  // ═══ FAMILIA: APPLICATION ════════════════════════════════════

  {
    id: 'direct_example',
    name: 'Ejemplo concreto',
    family: 'explanation',
    description: 'Mostrar un ejemplo real y concreto del concepto.',
    suitableFor: {
      masteryScoreRange: [0, 60],
    },
    contraindications: [],
    expectedEvidence: ['recognized', 'applied'],
    expectedOutcome: 'El estudiante ve el concepto en acción',
    maxUsesPerMicro: 3,
    cooldownTurns: 1,
    requiresContext: [],
    promptTemplate: 'Muestra UN ejemplo concreto de {microName} tomado directamente del material. El ejemplo debe ser específico, no genérico. Explica por qué ese ejemplo ilustra exactamente el concepto.',
    fallbackStrategyIds: ['analogy'],
  },

  {
    id: 'near_transfer',
    name: 'Transferencia cercana',
    family: 'transfer',
    description: 'Aplicar el concepto en un contexto similar pero diferente.',
    suitableFor: {
      evidenceGaps: ['transferred'],
      cognitiveTypes: ['applicative', 'procedural', 'mathematical'],
      masteryScoreRange: [50, 100],
    },
    contraindications: ['Mastery bajo — aún no dominó el contexto original'],
    expectedEvidence: ['transferred'],
    expectedOutcome: 'El estudiante aplica el concepto en un contexto parecido',
    maxUsesPerMicro: 2,
    cooldownTurns: 2,
    requiresContext: ['already_applied'],
    promptTemplate: 'El estudiante ya aplicó {microName} en el contexto original. Ahora presenta un caso similar pero con pequeñas diferencias. Verifica que puede adaptarse sin necesitar re-explicación.',
    fallbackStrategyIds: ['direct_example'],
  },

  {
    id: 'far_transfer',
    name: 'Transferencia lejana',
    family: 'transfer',
    description: 'Aplicar el concepto en un contexto completamente diferente.',
    suitableFor: {
      evidenceGaps: ['transferred'],
      cognitiveTypes: ['conceptual', 'causal', 'analytical'],
      masteryScoreRange: [65, 100],
    },
    contraindications: ['Mastery bajo', 'Concepto no dominado'],
    expectedEvidence: ['transferred', 'connected'],
    expectedOutcome: 'El estudiante generaliza el principio a un contexto nuevo',
    maxUsesPerMicro: 1,
    cooldownTurns: 5,
    requiresContext: ['already_mastered'],
    promptTemplate: 'El estudiante domina {microName} en su contexto original. Presenta un caso completamente diferente donde el mismo principio aplica. El objetivo es verificar que entiende el principio, no solo el caso.',
    fallbackStrategyIds: ['near_transfer'],
  },

  // ═══ FAMILIA: METACOGNITION ══════════════════════════════════

  {
    id: 'inverse_teaching',
    name: 'Enseñanza inversa',
    family: 'metacognition',
    description: 'Pedir al estudiante que explique el concepto como si enseñara.',
    suitableFor: {
      evidenceGaps: ['explained'],
      masteryScoreRange: [40, 100],
    },
    contraindications: ['Mastery muy bajo — no tiene base para enseñar'],
    expectedEvidence: ['explained', 'connected'],
    expectedOutcome: 'El estudiante verbaliza su comprensión y detecta sus propias brechas',
    maxUsesPerMicro: 2,
    cooldownTurns: 3,
    requiresContext: ['already_introduced'],
    promptTemplate: 'Pide al estudiante: "Explica {microName} como si tuvieras que enseñárselo a alguien que nunca lo ha visto." Evalúa si su explicación es correcta, completa y usa el vocabulario correcto.',
    fallbackStrategyIds: ['verify_explanation'],
  },

  {
    id: 'verify_explanation',
    name: 'Verificar explicación',
    family: 'assessment',
    description: 'Pedir al estudiante que explique con sus propias palabras.',
    suitableFor: {
      evidenceGaps: ['explained'],
    },
    contraindications: [],
    expectedEvidence: ['explained'],
    expectedOutcome: 'El estudiante demuestra comprensión verbal',
    maxUsesPerMicro: 3,
    cooldownTurns: 1,
    requiresContext: ['already_introduced'],
    promptTemplate: 'Pide al estudiante que explique {microName} con sus propias palabras en 2-3 oraciones. No permitas que copie la definición del material. Evalúa si captura la idea esencial.',
    fallbackStrategyIds: ['inverse_teaching'],
  },

  {
    id: 'error_detection',
    name: 'Detección de errores',
    family: 'assessment',
    description: 'Presentar una explicación con un error para que lo detecte.',
    suitableFor: {
      cognitiveTypes: ['procedural', 'mathematical', 'causal'],
      masteryScoreRange: [35, 100],
    },
    contraindications: ['Primera vez con el concepto'],
    expectedEvidence: ['applied', 'explained'],
    expectedOutcome: 'El estudiante identifica el error y explica por qué es incorrecto',
    maxUsesPerMicro: 2,
    cooldownTurns: 3,
    requiresContext: ['already_introduced'],
    promptTemplate: 'Muestra una explicación o solución de {microName} que contiene UN error específico. Pide al estudiante que lo encuentre y explique por qué es incorrecto. El error debe ser plausible, no obvio.',
    fallbackStrategyIds: ['direct_example'],
  },
]

// ═══════════════════════════════════════════════════════════════
// ÍNDICE POR ID
// ═══════════════════════════════════════════════════════════════

const STRATEGY_INDEX: Record<string, TeachingStrategy> = {}
for (const s of STRATEGIES) {
  STRATEGY_INDEX[s.id] = s
}

// ═══════════════════════════════════════════════════════════════
// BUSCAR ESTRATEGIAS COMPATIBLES
// ═══════════════════════════════════════════════════════════════

export function findCompatibleStrategies(params: {
  errorType?: ErrorType | null
  evidenceGap?: EvidenceType | null
  cognitiveType?: CognitiveType
  masteryScore?: number
  consecutiveFails?: number
  usedStrategyIds?: string[]
  excludeFamilies?: StrategyFamily[]
}): TeachingStrategy[] {
  const {
    errorType,
    evidenceGap,
    cognitiveType,
    masteryScore = 50,
    consecutiveFails = 0,
    usedStrategyIds = [],
    excludeFamilies = [],
  } = params

  return STRATEGIES.filter(s => {
    // Excluir familias no deseadas
    if (excludeFamilies.includes(s.family)) return false

    // No repetir estrategias recientemente usadas
    if (usedStrategyIds.slice(-s.cooldownTurns * 2).includes(s.id)) return false

    const sf = s.suitableFor

    // Verificar tipo de error
    if (errorType && sf.errorTypes && sf.errorTypes.length > 0) {
      if (!sf.errorTypes.includes(errorType)) return false
    }

    // Verificar brecha de evidencia
    if (evidenceGap && sf.evidenceGaps && sf.evidenceGaps.length > 0) {
      if (!sf.evidenceGaps.includes(evidenceGap)) return false
    }

    // Verificar tipo cognitivo
    if (cognitiveType && sf.cognitiveTypes && sf.cognitiveTypes.length > 0) {
      if (!sf.cognitiveTypes.includes(cognitiveType)) return false
    }

    // Verificar rango de mastery
    if (sf.masteryScoreRange) {
      const [min, max] = sf.masteryScoreRange
      if (masteryScore < min || masteryScore > max) return false
    }

    // Verificar rango de fallos consecutivos
    if (sf.consecutiveFails) {
      const [min, max] = sf.consecutiveFails
      if (consecutiveFails < min || consecutiveFails > max) return false
    }

    return true
  })
}

// ═══════════════════════════════════════════════════════════════
// SELECCIONAR LA MEJOR ESTRATEGIA
// ═══════════════════════════════════════════════════════════════

export function selectBestStrategy(params: {
  errorType?: ErrorType | null
  evidenceGap?: EvidenceType | null
  cognitiveType?: CognitiveType
  masteryScore?: number
  consecutiveFails?: number
  usedStrategyIds?: string[]
  preferFamily?: StrategyFamily
}): TeachingStrategy | null {
  const compatible = findCompatibleStrategies(params)

  if (compatible.length === 0) {
    // Fallback: siempre devolver una estrategia básica
    return STRATEGY_INDEX['direct_explanation'] || STRATEGIES[0]
  }

  // Priorizar familia preferida
  if (params.preferFamily) {
    const inFamily = compatible.filter(s => s.family === params.preferFamily)
    if (inFamily.length > 0) return inFamily[0]
  }

  // Priorizar estrategias de reparación si hay fallos
  const fails = params.consecutiveFails || 0
  if (fails >= 3) {
    const repair = compatible.filter(s => s.family === 'repair')
    if (repair.length > 0) return repair[0]
  }

  return compatible[0]
}

// ═══════════════════════════════════════════════════════════════
// ACCESO AL REGISTRO
// ═══════════════════════════════════════════════════════════════

export function getStrategy(id: string): TeachingStrategy | null {
  return STRATEGY_INDEX[id] || null
}

export function getAllStrategies(): TeachingStrategy[] {
  return STRATEGIES
}

export function getStrategiesByFamily(family: StrategyFamily): TeachingStrategy[] {
  return STRATEGIES.filter(s => s.family === family)
}
