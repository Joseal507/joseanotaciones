// ═══════════════════════════════════════════════════════════════
// MasteryContract — Define qué significa dominar un concepto
// No es una pregunta. Es un contrato de evidencia.
// ═══════════════════════════════════════════════════════════════

export type CognitiveDimension =
  | 'recognition'    // ¿recuerda el nombre/concepto?
  | 'comprehension'  // ¿entiende qué significa y por qué?
  | 'application'    // ¿puede usarlo en un caso concreto?
  | 'transfer'       // ¿puede aplicarlo en contexto nuevo?

export type QuestionVariant =
  // Selección
  | 'mcq_best_answer'        // MCQ clásico: elige la correcta
  | 'mcq_except'             // ¿Cuál NO es correcto? (inverso)
  | 'mcq_all_that_apply'     // Selecciona TODAS las correctas
  | 'mcq_most_likely'        // ¿Cuál es MÁS probable?
  | 'mcq_least_likely'       // ¿Cuál es MENOS probable?
  | 'mcq_cause'              // ¿Cuál es la CAUSA?
  | 'mcq_consequence'        // ¿Cuál es la CONSECUENCIA?
  | 'mcq_next_step'          // ¿Cuál es el SIGUIENTE PASO?
  | 'mcq_best_explanation'   // ¿Cuál EXPLICA MEJOR?
  | 'mcq_analogy'            // ¿Cuál es ANÁLOGO a esto?
  | 'mcq_application' | 'mcq_compare' | 'mcq_rule_example' | 'mcq_example_rule'
  | 'multi_select_correct' | 'multi_select_incorrect' | 'multi_select_causes'
  | 'multi_select_consequences' | 'multi_select_features' | 'multi_select_required_steps'
  | 'multi_select_valid_statements'
  // Completar
  | 'word_bank_fill'         // Completar blancos con banco
  | 'word_bank_formula'      // Completar una fórmula
  | 'word_bank_definition'   // Completar una definición
  | 'word_bank_equation' | 'word_bank_process'
  // Relacionar
  | 'matching_concept_def'   // Concepto ↔ Definición
  | 'matching_cause_effect'  // Causa ↔ Efecto
  | 'matching_formula_name'  // Fórmula ↔ Nombre
  | 'matching_example_rule'  // Ejemplo ↔ Regla
  | 'matching_term_function' | 'matching_structure_function'
  | 'matching_problem_method' | 'matching_error_correction'
  // Ordenar
  | 'ordering_steps'         // Ordenar pasos de un procedimiento
  | 'ordering_events'        // Ordenar eventos cronológicos
  | 'ordering_magnitude'     // Ordenar por magnitud/importancia
  | 'ordering_process' | 'ordering_priority' | 'ordering_chronology'
  // Verdadero/Falso (solo factual)
  | 'true_false_factual'     // Afirmación sobre un dato concreto
  | 'true_false_negation'    // Afirmación con negación (trampa)
  | 'true_false_relationship' | 'true_false_application'
  // Escenario
  | 'scenario_predict'       // Dado este escenario, ¿qué ocurre?
  | 'scenario_diagnose'      // ¿Qué problema tiene este sistema?
  | 'scenario_choose_action' // ¿Qué harías?
  | 'scenario_compare'       // Dos situaciones, ¿cuál y por qué?
  | 'scenario_apply_rule' | 'scenario_transfer' | 'scenario_what_if'
  | 'scenario_clinical' | 'scenario_experimental'
  // Error
  | 'find_error_calculation' // Encuentra el error en este cálculo
  | 'find_error_reasoning'   // Encuentra el error en este razonamiento
  | 'find_error_definition'  // Esta definición tiene un error, ¿cuál?
  | 'find_error_procedure' | 'find_error_formula' | 'find_error_interpretation'
  // Clasificar
  | 'classify_category'      // ¿A qué categoría pertenece?
  | 'classify_valid_invalid'  // ¿Cuáles son válidos?
  | 'classify_affected_not'  // ¿Cuáles se ven afectados?
  | 'classify_examples' | 'classify_causes' | 'classify_structures' | 'classify_processes'
  // Escritura (write_explain)
  | 'short_answer_define'    // Define con tus palabras
  | 'short_answer_compare'   // Compara X con Y
  | 'short_answer_summarize' | 'justify_answer'
  | 'explain_why_cause'      // Explica por qué ocurre
  | 'explain_why_consequence' // Explica la consecuencia de
  | 'problem_solve'          // Resuelve este problema (con datos)
  | 'numeric_missing_value' | 'numeric_compare' | 'numeric_estimate' | 'numeric_intermediate_step'
  | 'problem_setup'          // Plantea la ecuación/fórmula
  | 'teach_back'             // Explica como si enseñaras a alguien

export interface DimensionRequirement {
  dimension: CognitiveDimension
  evidencesNeeded: number          // cuántas correctas necesita esta dimensión
  allowedVariants: QuestionVariant[] // tipos de pregunta válidos para esta dimensión
  forbiddenVariants: QuestionVariant[] // tipos PROHIBIDOS para esta dimensión
}

export interface MasteryContract {
  conceptId: string
  conceptLabel: string
  conceptKind: string
  bloomLevel: string

  // Dimensiones requeridas en orden pedagógico
  // El sistema las trabaja en orden — no puede pasar a aplicación sin comprensión
  requiredDimensions: DimensionRequirement[]

  // Estado actual de evidencias
  evidence: Record<CognitiveDimension, {
    confirmed: boolean
    evidencesGot: number
    evidencesNeeded: number
    lastScore: number
    attempts: number
    usedVariants: QuestionVariant[]
  }>

  // Resultado final
  mastered: boolean
  currentDimensionIndex: number // en qué dimensión estamos ahora
}

// ─────────────────────────────────────────────────────────────
// MAPEO: kind + bloomLevel → dimensiones requeridas
// Esto es lo que reemplaza toda la lógica hardcodeada anterior
// ─────────────────────────────────────────────────────────────

export function buildMasteryContract(concept: {
  id: string
  label: string
  kind?: string
  bloomLevel?: string
  importance?: number
  difficulty?: string
  misconceptions?: string[]
}): MasteryContract {
  const kind = concept.kind || 'concept'
  const bloom = concept.bloomLevel || 'understand'
  const importance = concept.importance || 50
  const difficulty = concept.difficulty || 'basic'

  const requiredDimensions = decideDimensions(kind, bloom, importance, difficulty)

  const evidence: MasteryContract['evidence'] = {} as any
  for (const dim of requiredDimensions) {
    evidence[dim.dimension] = {
      confirmed: false,
      evidencesGot: 0,
      evidencesNeeded: dim.evidencesNeeded,
      lastScore: 0,
      attempts: 0,
      usedVariants: [],
    }
  }

  return {
    conceptId: concept.id,
    conceptLabel: concept.label,
    conceptKind: kind,
    bloomLevel: bloom,
    requiredDimensions,
    evidence,
    mastered: false,
    currentDimensionIndex: 0,
  }
}

function decideDimensions(
  kind: string,
  bloom: string,
  importance: number,
  difficulty: string
): DimensionRequirement[] {
  // ─── DATOS FACTUALES: fecha, nombre, lugar, número específico ───
  if (kind === 'fact' || kind === 'entity') {
    return [{
      dimension: 'recognition',
      evidencesNeeded: 1,
      allowedVariants: [
        'word_bank_fill',
        'mcq_best_answer',
        'true_false_factual',
        'matching_concept_def',
      ],
      forbiddenVariants: ['true_false_negation', 'scenario_predict', 'problem_solve'],
    }]
  }

  // ─── DEFINICIONES SIMPLES ───
  if (kind === 'definition' && (difficulty === 'basic' || bloom === 'remember')) {
    return [
      {
        dimension: 'recognition',
        evidencesNeeded: 1,
        allowedVariants: [
          'mcq_best_answer',
          'word_bank_definition',
          'matching_concept_def',
          'true_false_factual',
        ],
        forbiddenVariants: ['problem_solve', 'explain_why_cause'],
      },
      {
        dimension: 'comprehension',
        evidencesNeeded: 1,
        allowedVariants: [
          'mcq_best_explanation',
          'mcq_except',
          'scenario_predict',
          'short_answer_define',
          'find_error_definition',
        ],
        forbiddenVariants: ['true_false_factual', 'word_bank_fill'],
      },
    ]
  }

  // ─── FÓRMULAS MATEMÁTICAS ───
  if (kind === 'formula') {
    const dims: DimensionRequirement[] = [
      {
        dimension: 'recognition',
        evidencesNeeded: 1,
        allowedVariants: [
          'word_bank_formula',
          'matching_formula_name',
          'mcq_best_answer',
        ],
        forbiddenVariants: ['true_false_factual', 'ordering_steps'],
      },
      {
        dimension: 'comprehension',
        evidencesNeeded: 1,
        allowedVariants: [
          'mcq_best_explanation',
          'mcq_consequence',
          'word_bank_fill',
          'explain_why_cause',
        ],
        forbiddenVariants: ['true_false_factual', 'true_false_negation'],
      },
      {
        dimension: 'application',
        evidencesNeeded: difficulty === 'advanced' ? 2 : 1,
        allowedVariants: [
          'problem_solve',    // resolver con datos concretos
          'scenario_predict', // dado este caso, ¿cuál es el resultado?
          'mcq_next_step',    // ¿cuál es el siguiente paso para resolver?
          'find_error_calculation',
        ],
        forbiddenVariants: ['true_false_factual', 'true_false_negation', 'word_bank_definition'],
      },
    ]

    if (difficulty === 'advanced' || importance >= 85) {
      dims.push({
        dimension: 'transfer',
        evidencesNeeded: 1,
        allowedVariants: [
          'scenario_compare',
          'scenario_diagnose',
          'problem_solve',
          'mcq_analogy',
        ],
        forbiddenVariants: ['true_false_factual', 'true_false_negation', 'word_bank_fill'],
      })
    }

    return dims
  }

  // ─── CONCEPTOS CAUSALES / MECANISMOS ───
  if (kind === 'concept' && (bloom === 'analyze' || bloom === 'evaluate')) {
    return [
      {
        dimension: 'comprehension',
        evidencesNeeded: 1,
        allowedVariants: [
          'mcq_best_explanation',
          'mcq_cause',
          'mcq_consequence',
          'mcq_except',
          'word_bank_fill',
          'explain_why_cause',
        ],
        forbiddenVariants: ['true_false_factual', 'ordering_steps'],
      },
      {
        dimension: 'application',
        evidencesNeeded: importance >= 75 ? 2 : 1,
        allowedVariants: [
          'scenario_predict',
          'scenario_diagnose',
          'mcq_most_likely',
          'mcq_least_likely',
          'find_error_reasoning',
          'explain_why_consequence',
        ],
        forbiddenVariants: ['true_false_factual', 'true_false_negation', 'word_bank_definition'],
      },
    ]
  }

  // ─── PROCEDIMIENTOS / PASOS ───
  if (kind === 'concept' && bloom === 'apply') {
    return [
      {
        dimension: 'comprehension',
        evidencesNeeded: 1,
        allowedVariants: [
          'ordering_steps',
          'mcq_next_step',
          'matching_example_rule',
          'word_bank_fill',
        ],
        forbiddenVariants: ['true_false_factual', 'scenario_predict'],
      },
      {
        dimension: 'application',
        evidencesNeeded: 1,
        allowedVariants: [
          'problem_solve',
          'scenario_choose_action',
          'find_error_calculation',
          'mcq_best_answer',
        ],
        forbiddenVariants: ['true_false_factual', 'true_false_negation'],
      },
    ]
  }

  // ─── CONCEPTOS COMPARATIVOS / RELACIONALES ───
  if (kind === 'concept' && bloom === 'understand') {
    const dims: DimensionRequirement[] = [
      {
        dimension: 'comprehension',
        evidencesNeeded: 1,
        allowedVariants: [
          'mcq_best_answer',
          'mcq_best_explanation',
          'mcq_except',
          'word_bank_fill',
          'matching_concept_def',
          'classify_category',
        ],
        forbiddenVariants: ['true_false_factual', 'problem_solve'],
      },
    ]

    if (importance >= 70) {
      dims.push({
        dimension: 'application',
        evidencesNeeded: 1,
        allowedVariants: [
          'scenario_predict',
          'mcq_consequence',
          'mcq_most_likely',
          'short_answer_compare',
          'classify_affected_not',
        ],
        forbiddenVariants: ['true_false_factual', 'true_false_negation'],
      })
    }

    return dims
  }

  // ─── EJEMPLOS DEL MATERIAL ───
  if (kind === 'example') {
    return [{
      dimension: 'comprehension',
      evidencesNeeded: 1,
      allowedVariants: [
        'mcq_best_answer',
        'mcq_best_explanation',
        'scenario_predict',
        'matching_example_rule',
      ],
      forbiddenVariants: ['true_false_factual', 'problem_solve'],
    }]
  }

  // ─── ERRORES COMUNES ───
  if (kind === 'common_mistake') {
    return [{
      dimension: 'comprehension',
      evidencesNeeded: 1,
      allowedVariants: [
        'find_error_reasoning',
        'find_error_definition',
        'mcq_except',
        'true_false_negation',
        'classify_valid_invalid',
      ],
      forbiddenVariants: ['problem_solve', 'ordering_steps'],
    }]
  }

  // ─── FALLBACK: concepto genérico ───
  return [
    {
      dimension: 'comprehension',
      evidencesNeeded: 1,
      allowedVariants: [
        'mcq_best_answer',
        'mcq_best_explanation',
        'word_bank_fill',
        'matching_concept_def',
        'scenario_predict',
      ],
      forbiddenVariants: ['true_false_factual'],
    },
  ]
}

// ─────────────────────────────────────────────────────────────
// Avanzar el contrato con una nueva evidencia
// ─────────────────────────────────────────────────────────────

export function recordEvidence(
  contract: MasteryContract,
  dimension: CognitiveDimension,
  variant: QuestionVariant,
  score: number,
  correct: boolean,
): MasteryContract {
  const updated = { ...contract }
  const dim = updated.requiredDimensions[updated.currentDimensionIndex]

  if (!dim || dim.dimension !== dimension) return updated

  const ev = { ...updated.evidence[dimension] }
  ev.attempts++
  ev.lastScore = score

  if (correct) {
    ev.evidencesGot++
    ev.usedVariants = [...ev.usedVariants, variant]

    if (ev.evidencesGot >= ev.evidencesNeeded) {
      ev.confirmed = true
      updated.currentDimensionIndex++
    }
  }

  updated.evidence = { ...updated.evidence, [dimension]: ev }

  // Verificar si todas las dimensiones requeridas están confirmadas
  updated.mastered = updated.requiredDimensions.every(
    d => updated.evidence[d.dimension]?.confirmed === true
  )

  return updated
}

// ─────────────────────────────────────────────────────────────
// Qué variante pedir ahora
// ─────────────────────────────────────────────────────────────

export function getNextVariantHint(contract: MasteryContract): {
  dimension: CognitiveDimension
  allowedVariants: QuestionVariant[]
  forbiddenVariants: QuestionVariant[]
  usedVariants: QuestionVariant[]
  evidencesGot: number
  evidencesNeeded: number
} | null {
  const dim = contract.requiredDimensions[contract.currentDimensionIndex]
  if (!dim) return null

  const ev = contract.evidence[dim.dimension]

  return {
    dimension: dim.dimension,
    allowedVariants: dim.allowedVariants,
    forbiddenVariants: [
      ...dim.forbiddenVariants,
      ...(ev?.usedVariants || []), // no repetir variantes ya usadas
    ],
    usedVariants: ev?.usedVariants || [],
    evidencesGot: ev?.evidencesGot || 0,
    evidencesNeeded: dim.evidencesNeeded,
  }
}

// ─────────────────────────────────────────────────────────────
// Serialización simple para persistencia
// ─────────────────────────────────────────────────────────────

export function serializeContract(contract: MasteryContract): object {
  return {
    conceptId: contract.conceptId,
    conceptLabel: contract.conceptLabel,
    mastered: contract.mastered,
    currentDimensionIndex: contract.currentDimensionIndex,
    evidence: contract.evidence,
  }
}

export function isMastered(contract: MasteryContract): boolean {
  return contract.mastered
}

export function getCurrentDimension(contract: MasteryContract): CognitiveDimension | null {
  return contract.requiredDimensions[contract.currentDimensionIndex]?.dimension ?? null
}
