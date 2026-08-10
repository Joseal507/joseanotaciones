import {
  missingRequiredFactKeys,
  normalizeGeneratedQuestion,
  questionSimilarity,
  validateQuestion,
  type CanonicalQuestion,
  type CanonicalUserAnswer,
  type GenerationContext,
} from './questionContract'
import { validateQuestionTypeForMode } from './evaluationModeContract'
import type { VisualEvidenceKind, VisualSpec } from '../visual/visualContract'

export type StepImportance = 'supporting' | 'important' | 'critical'
export type SessionEvaluationKind = 'introduction' | 'learning' | 'final_review'

// Umbral único de duplicado semántico para todo el assembly final — usado tanto
// al construir cada bloque (canonicalizeGeneratedSession) como en el escaneo
// completo posterior (validateGeneratedSessionEvaluation). Debe ser el mismo
// valor en ambos puntos: un mismatch entre ellos permite que un duplicado
// sobreviva a la construcción del bloque y solo sea detectado por el hard
// blocker final, después de pagar todos los provider calls.
const DUPLICATE_QUESTION_SIMILARITY_THRESHOLD = 0.8

export interface SessionStep {
  id: string
  type: string
  title: string
  content: string
  keyPoints: string[]
  keyPointIds?: string[]
  importance: StepImportance
  relatedBlockIds: string[]
  microId?: string
  factKeys?: string[]
  cognitiveTarget?: CanonicalQuestion['targetDimension']
  objectiveIds?: string[]
  // Adjuntado deterministamente por factoryTeaching (session-teach/route.ts) — nunca
  // proviene del JSON generado por el LLM. Preservado tal cual a través de la
  // canonicalización final para llegar íntegro al cliente.
  visualSpec?: VisualSpec
  visualEvidenceKind?: VisualEvidenceKind
}

export type SessionEvaluationQuestion = CanonicalQuestion & {
  coveredKeyPoints: string[]
  coveredKeyPointIds?: string[]
  coveredStepIds: string[]
  // Los factKeys REALES declarados por la pregunta cruda (targetFactKeys en
  // el dato de entrada), capturados ANTES de normalizeGeneratedQuestion —
  // esa función sobreescribe CanonicalQuestion.targetFactKeys con
  // context.factKeys, que aquí es texto de keyPoints, no factKeys (campo ya
  // existente reusado con otro significado; no se toca para no romper #9 ni
  // otros consumidores). sourceFactKeys es la única fuente confiable para
  // exigir cobertura por factKey en el STRICT COVERAGE BLOCKER.
  sourceFactKeys: string[]
}

export interface EvaluationBlock {
  id: string
  afterStepId: string
  coveredStepIds: string[]
  coveredKeyPoints: string[]
  coveredKeyPointIds?: string[]
  questions: SessionEvaluationQuestion[]
}

export interface GeneratedSessionEvaluation {
  steps: SessionStep[]
  evaluationBlocks: EvaluationBlock[]
}

export interface QuestionAnswerRecord {
  questionId: string
  answer: CanonicalUserAnswer
  correct: boolean
  failedKeyPoints: string[]
  answeredAt: string
}

export type EvaluationBlockStatus =
  | 'answering'
  | 'waiting_for_recovery'
  | 'recovering'
  | 'completed'

export interface EvaluationBlockProgress {
  blockId: string
  currentQuestionIndex: number
  answers: QuestionAnswerRecord[]
  failedQuestionIds: string[]
  pendingRecoveryIds: string[]
  readyRecoveryIds: string[]
  status: EvaluationBlockStatus
}

export interface SessionEvaluationValidation {
  valid: boolean
  errors: string[]
  coverageRatio: number
  coveredRequiredStepIds: string[]
  uncoveredRequiredStepIds: string[]
  coveredCriticalKeyPoints: string[]
  uncoveredCriticalKeyPoints: string[]
  uncoveredImportantKeyPoints: string[]
  coverageFailures: Array<{
    blockId: string
    missingRequiredStepIds: string[]
    missingCriticalKeyPoints: string[]
    missingImportantKeyPoints: string[]
  }>
}

type UnknownRecord = Record<string, unknown>

const isRecord = (value: unknown): value is UnknownRecord =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const text = (value: unknown): string =>
  typeof value === 'string' || typeof value === 'number' ? String(value).trim() : ''

const textArray = (value: unknown): string[] =>
  Array.isArray(value) ? [...new Set(value.map(text).filter(Boolean))] : []

const importance = (value: unknown): StepImportance =>
  value === 'critical' || value === 'important' || value === 'supporting'
    ? value
    : 'important'

const typeToVariant: Record<string, string> = {
  multiple_choice: 'mcq_best_answer',
  mcq_single: 'mcq_best_answer',
  scenario: 'scenario_choose_action',
  scenario_based_mcq: 'scenario_choose_action',
  choose_best_explanation: 'mcq_best_explanation',
  multi_select: 'mcq_all_that_apply',
  mcq_multiple: 'mcq_all_that_apply',
  true_false: 'true_false_factual',
  word_bank: 'word_bank_fill',
  fill_blank_select: 'word_bank_fill',
  matching: 'matching_concept_def',
  ordering: 'ordering_steps',
  classify: 'classify_valid_invalid',
  classification: 'classify_valid_invalid',
  find_the_error: 'find_error_reasoning',
  numeric_problem: 'problem_solve',
  short_response: 'short_answer_define',
}

const dimensionFor = (value: unknown): GenerationContext['targetDimension'] => {
  const candidate = text(value)
  return candidate === 'recognition' || candidate === 'comprehension' ||
    candidate === 'application' || candidate === 'transfer'
    ? candidate
    : 'comprehension'
}

export function canonicalizeGeneratedSession(
  raw: unknown,
  input: {
    sessionId: string
    kind: SessionEvaluationKind
    evaluationMode: unknown
  },
): { session: GeneratedSessionEvaluation | null; errors: string[] } {
  if (!isRecord(raw) || !Array.isArray(raw.steps)) {
    return { session: null, errors: ['SESSION_EVALUATION_INVALID:steps'] }
  }

  const steps: SessionStep[] = raw.steps
    .filter(isRecord)
    .map((step, index) => {
      const id=text(step.id)||`step_${index+1}`;const keyPoints=textArray(step.keyPoints ?? (step.keyPoint ? [step.keyPoint] : []));const declaredIds=textArray(step.keyPointIds);return{
      id,
      type: text(step.type) || 'concept',
      title: text(step.title),
      content: text(step.content),
      keyPoints,
      keyPointIds:keyPoints.map((_,pointIndex)=>declaredIds[pointIndex]||`${id}:kp:${pointIndex+1}`),
      importance: importance(step.importance),
      relatedBlockIds: textArray(step.relatedBlockIds),
      microId: text(step.microId) || undefined,
      factKeys: textArray(step.factKeys),
      cognitiveTarget: dimensionFor(step.cognitiveTarget),
      objectiveIds: textArray(step.objectiveIds),
      visualSpec: isRecord(step.visualSpec) ? (step.visualSpec as unknown as VisualSpec) : undefined,
      visualEvidenceKind: typeof step.visualEvidenceKind === 'string' ? step.visualEvidenceKind as VisualEvidenceKind : undefined,
    }})
    .filter(step => step.title && step.content)

  if (!steps.length) return { session: null, errors: ['SESSION_EVALUATION_INVALID:no_steps'] }

  const stepByModelId = new Map<string, SessionStep>()
  raw.steps.filter(isRecord).forEach((step, index) => {
    const canonical = steps[index]
    if (canonical) stepByModelId.set(text(step.id) || `step_${index + 1}`, canonical)
  })

  const errors: string[] = []
  const evaluationBlocks: EvaluationBlock[] = []
  const rawBlocks = Array.isArray(raw.evaluationBlocks) ? raw.evaluationBlocks : []

  if (input.kind !== 'learning') {
    if (rawBlocks.length > 0) {
      return {
        session: null,
        errors: [`SESSION_KIND_CONTRACT:evaluation_forbidden:sessionId=${input.sessionId}:kind=${input.kind}`],
      }
    }
    return { session: { steps, evaluationBlocks: [] }, errors: [] }
  }

  rawBlocks.filter(isRecord).forEach((block, blockIndex) => {
    const declaredCoveredStepIds = textArray(block.coveredStepIds)
    // Mapear IDs del modelo a IDs canónicos — tolerante con nombres alternativos
    const coveredSteps = declaredCoveredStepIds
      .map(id => stepByModelId.get(id)?.id || id)
      .filter(id => steps.some(step => step.id === id))

    const unknownCoveredStepIds = declaredCoveredStepIds.filter(id => !stepByModelId.has(id) && !steps.some(step => step.id === id))
    if (!declaredCoveredStepIds.length || unknownCoveredStepIds.length) {
      errors.push(`SESSION_EVALUATION_INVALID:covered_steps:${blockIndex}:${unknownCoveredStepIds.join('|') || 'missing'}`)
    }
    const effectiveCoveredSteps = coveredSteps

    // afterStepId: buscar en el mapa, luego en steps directamente, luego último step
    const afterStepId = stepByModelId.get(text(block.afterStepId))?.id ||
      steps.find(s => s.id === text(block.afterStepId))?.id ||
      effectiveCoveredSteps[effectiveCoveredSteps.length - 1] ||
      steps[steps.length - 1]?.id ||
      ''
    // Recalcular blockKeyPoints desde los steps efectivos si el bloque no declara ninguno
    const declaredBlockKeyPoints = textArray(block.coveredKeyPoints)
    const stepsDerivedKeyPoints = effectiveCoveredSteps
      .flatMap(stepId => steps.find(s => s.id === stepId)?.keyPoints || [])
    const unknownBlockKeyPoints = declaredBlockKeyPoints.filter(point => !stepsDerivedKeyPoints.includes(point))
    if (!declaredBlockKeyPoints.length || unknownBlockKeyPoints.length) {
      errors.push(`SESSION_EVALUATION_INVALID:covered_key_points:${blockIndex}:${unknownBlockKeyPoints.join('|') || 'missing'}`)
    }
    const blockKeyPoints = declaredBlockKeyPoints
    const derivedPointIdByText=new Map(effectiveCoveredSteps.flatMap(stepId=>{const step=steps.find(item=>item.id===stepId);return step?step.keyPoints.map((point,index)=>[point,step.keyPointIds[index]] as const):[]}))
    const blockKeyPointIds=textArray(block.coveredKeyPointIds).length?textArray(block.coveredKeyPointIds):blockKeyPoints.map(point=>derivedPointIdByText.get(point)||'').filter(Boolean)

    const questions: SessionEvaluationQuestion[] = []
    const rawQuestions = Array.isArray(block.questions) ? block.questions : []

    rawQuestions.filter(isRecord).forEach((question, questionIndex) => {
      const coveredKeyPoints = textArray(question.coveredKeyPoints)
      const coveredKeyPointIds=textArray(question.targetKeyPointIds ?? question.coveredKeyPointIds).length?textArray(question.targetKeyPointIds ?? question.coveredKeyPointIds):coveredKeyPoints.map(point=>derivedPointIdByText.get(point)||'').filter(Boolean)
      const declaredQuestionStepIds = textArray(question.coveredStepIds)
      const questionStepIds = declaredQuestionStepIds
        .map(id => stepByModelId.get(id)?.id || id)
        .filter(id => effectiveCoveredSteps.includes(id))

      const invalidQuestionStepIds = declaredQuestionStepIds.filter(id => !stepByModelId.has(id) && !effectiveCoveredSteps.includes(id))
      if (!declaredQuestionStepIds.length || invalidQuestionStepIds.length || questionStepIds.length !== declaredQuestionStepIds.length) {
        errors.push(`SESSION_EVALUATION_INVALID:question_steps:${blockIndex}:${questionIndex}`)
        return
      }
      const effectiveStepIds = questionStepIds
      if (!coveredKeyPointIds.length || coveredKeyPointIds.some(point => !blockKeyPointIds.includes(point))) {
        errors.push(`SESSION_EVALUATION_INVALID:question_key_points:${blockIndex}:${questionIndex}`)
        return
      }
      const effectiveKeyPoints = coveredKeyPoints
      const rawType = text(question.type ?? question.format ?? question.variant)
      const variant = typeToVariant[rawType] || text(question.variant)

      // Normalizar word_bank: si options son strings sueltos, convertir a {id, text}
      if (rawType === 'word_bank' || rawType === 'fill_blank_select') {
        if (Array.isArray(question.options) && question.options.length > 0 && typeof question.options[0] === 'string') {
          ;(question as any).options = (question.options as string[]).map((text: string, i: number) => ({
            id: `w${i + 1}`,
            text,
          }))
        }
        // Si correctAnswer es string (no array), convertir al id correspondiente
        if (typeof question.correctAnswer === 'string' && Array.isArray(question.options)) {
          const normalizedOptions = question.options as Array<{id: string; text: string}>
          const matchById = normalizedOptions.find(o => o.id === question.correctAnswer)
          const matchByText = normalizedOptions.find(o => o.text === question.correctAnswer)
          const matched = matchById || matchByText
          if (matched) {
            ;(question as any).correctAnswer = [matched.id]
          }
        }
      }

      // HARD BLOCKER INMEDIATO:
      // nunca aceptar preguntas que hagan referencia a pasos ("Paso 2", "Step 3", etc.).
      const rawQuestionText = text(question.prompt ?? question.questionText)
      if (/\b(?:paso|step)\s+\d+\b/i.test(rawQuestionText)) {
        errors.push(`SESSION_EVALUATION_INVALID:invented_step_reference:${blockIndex}:${questionIndex}`)
        return
      }

      const primaryStep = steps.find(step => effectiveStepIds.includes(step.id)) ||
        steps.find(step => coveredSteps.includes(step.id))
      const objectiveIds = effectiveKeyPoints.flatMap(point => effectiveStepIds.flatMap(stepId => {
        const targetStep = steps.find(step => step.id === stepId)
        if (!targetStep?.keyPoints.includes(point)) return []
        const pointIndex = targetStep.keyPoints.indexOf(point)
        return [targetStep.objectiveIds?.[pointIndex] || `${input.sessionId}:${stepId}:${point}`]
      }))
      const context: GenerationContext = {
        activeConceptId: primaryStep?.id || afterStepId,
        activeConceptLabel: primaryStep?.title || 'Contenido de la sesión',
        teachingBlockId: primaryStep?.id || afterStepId,
        targetDimension: dimensionFor(question.cognitiveTarget ?? question.targetDimension),
        questionFamily: rawType || variant,
        allowedConceptIds: [primaryStep?.id || afterStepId],
        forbiddenConceptIds: [],
        evaluationMode: input.evaluationMode,
        sessionId: input.sessionId,
        factKeys: effectiveKeyPoints,
        targetObjectiveIds: objectiveIds,
      }
      const canonical = normalizeGeneratedQuestion(
        {
          ...question,
          variant,
          conceptId: context.activeConceptId,
          conceptLabel: context.activeConceptLabel,
          targetDimension: context.targetDimension,
          questionText: question.prompt ?? question.questionText,
        },
        context,
        `eval_${blockIndex + 1}_${questionIndex + 1}`,
      )
      if (!canonical) {
        errors.push(`SESSION_EVALUATION_INVALID:question:${blockIndex}:${questionIndex}`)
        return
      }
      // No rechazar preguntas sin keyPoints — usar keyPoints del step como fallback
      const finalKeyPoints = effectiveKeyPoints.length > 0
        ? effectiveKeyPoints
        : (primaryStep?.keyPoints?.slice(0, 1) || blockKeyPoints.slice(0, 1))
      if (!finalKeyPoints.length) {
        // Solo rechazar si realmente no hay ningún keyPoint en toda la sesión
        console.warn(`[sessionEvaluation] pregunta sin keyPoints: ${canonical.id}`)
      }
      const validation = validateQuestion(canonical, context, questions)
      // validateQuestion marca repeated_question a partir de 0.92 (umbral interno,
      // reusado también en generación en vivo). El guard final de esta misma
      // función (validateGeneratedSessionEvaluation, más abajo) escanea el bloque
      // completo a DUPLICATE_QUESTION_SIMILARITY_THRESHOLD (0.8) y es un hard
      // blocker que descarta la sesión entera. Si aquí solo se filtrara por el
      // 0.92 de validateQuestion, una pregunta entre 0.8 y 0.92 de similitud
      // pasaría esta construcción sin ser excluida y solo sería detectada por el
      // guard final — después de gastar todos los provider calls. Se revalida
      // aquí al mismo 0.8 para excluirla en el punto donde se construye el
      // bloque, sin depender del umbral interno de validateQuestion.
      const isDuplicateInBlock = questions.some(previous =>
        questionSimilarity(previous, canonical) >= DUPLICATE_QUESTION_SIMILARITY_THRESHOLD,
      )
      const relevantErrors = validation.errors.filter(error => error !== 'repeated_question')
      if (isDuplicateInBlock) relevantErrors.push('repeated_question')
      if (relevantErrors.length) {
        errors.push(...relevantErrors.map(error => `SESSION_EVALUATION_INVALID:${canonical.id}:${error}`))
        return
      }
      const safeKeyPoints = (typeof finalKeyPoints !== 'undefined' && finalKeyPoints.length > 0)
        ? finalKeyPoints
        : effectiveKeyPoints.length > 0 ? effectiveKeyPoints : blockKeyPoints.slice(0, 1)
      questions.push({ ...canonical, coveredKeyPoints: safeKeyPoints, coveredKeyPointIds, coveredStepIds: effectiveStepIds, sourceFactKeys: textArray(question.targetFactKeys) })
    })

    evaluationBlocks.push({
      id: text(block.id) || `evaluation_block_${blockIndex + 1}`,
      afterStepId,
      coveredStepIds: effectiveCoveredSteps,
      coveredKeyPoints: blockKeyPoints,
      coveredKeyPointIds:blockKeyPointIds,
      questions,
    })
  })

  const session = { steps, evaluationBlocks }

  // Siempre validar la sesión completa antes de decidir si se acepta.
  // Esto permite que errores estructurales como "Según el Paso 2" sigan bloqueando.
  const coverage = validateGeneratedSessionEvaluation(session, input.evaluationMode, input.kind)
  errors.push(...coverage.errors.filter(e => !e.includes('important_key_points')))

  // HARD BLOCKERS:
  // aunque aceptemos sesiones parciales estructuralmente válidas,
  // estos errores SIEMPRE deben invalidar la sesión completa.
  const structuralHardBlockers = errors.filter(error =>
    error.includes('SESSION_EVALUATION_INVALID:invented_step_reference') ||
    error.includes('SESSION_EVALUATION_INVALID:mode:') ||
    error.includes('SESSION_EVALUATION_INVALID:duplicate_question') ||
    error.includes('SESSION_EVALUATION_INVALID:question_outside_block') ||
    error.includes('SESSION_EVALUATION_INVALID:question:')
  )

  if (structuralHardBlockers.length > 0) {
    return { session: null, errors: [...new Set(errors)] }
  }

  // STRICT COVERAGE BLOCKER:
  // Solo aplica cuando la IA declaró evaluationBlocks pero los dejó sin preguntas.
  // Si evaluationBlocks está vacío ([]), la evaluación se genera on-demand en el cliente.
  if (input.kind === 'learning' && evaluationBlocks.length > 0) {
    const allRequiredSteps = steps.map(step => step.id)
    const coveredStepIds = new Set(
      evaluationBlocks.flatMap(block =>
        block.questions.flatMap(question => question.coveredStepIds || [])
      )
    )
    const uncoveredSteps = allRequiredSteps.filter(stepId => !coveredStepIds.has(stepId))

    const allKeyPointIds = steps.flatMap(step => step.keyPointIds || step.keyPoints.map((_,index)=>`${step.id}:kp:${index+1}`))
    const coveredKeyPointIds = new Set(
      evaluationBlocks.flatMap(block =>
        block.questions.flatMap(question => question.coveredKeyPointIds || [])
      )
    )
    const uncoveredKeyPointIds = allKeyPointIds.filter(point => !coveredKeyPointIds.has(point))
    const pointDetails=new Map(steps.flatMap(step=>(step.keyPointIds||step.keyPoints.map((_,index)=>`${step.id}:kp:${index+1}`)).map((id,index)=>[id,step.keyPoints[index]] as const)))

    // COBERTURA POR factKey (question coverage, B): requiredFactKeys sale del
    // contenido enseñado real (steps[].factKeys), NUNCA del modelo de
    // objectives del assessment blueprint — esa era justo la fuente que
    // permitía que un factKey desapareciera sin dejar rastro (factKeys.length
    // > keyPoints.length). coveredFactKeys sale de sourceFactKeys de
    // preguntas ya aceptadas (pasaron todos los checks de validez/duplicado
    // más arriba) — misma función missingRequiredFactKeys que usa
    // diagnoseEvaluationBlock (sessionPreparationFactory.ts), una sola
    // definición de "missing factKeys" para ambas capas.
    const allFactKeys = [...new Set(steps.flatMap(step => step.factKeys || []))]
    const uncoveredFactKeys = missingRequiredFactKeys(
      allFactKeys,
      evaluationBlocks.flatMap(block => block.questions.map(question => question.sourceFactKeys || [])),
    )

    if (uncoveredSteps.length > 0 || uncoveredKeyPointIds.length > 0 || uncoveredFactKeys.length > 0) {
      const strictErrors = [
        ...(uncoveredSteps.length > 0
          ? [
              'SESSION_EVALUATION_COVERAGE:required_steps',
              `SESSION_EVALUATION_COVERAGE:required_steps:blockId=unassigned:missing=${uncoveredSteps.join('|')}`,
            ]
          : []),
        ...(uncoveredKeyPointIds.length > 0
          ? [
              'SESSION_EVALUATION_COVERAGE:important_key_points',
              `SESSION_EVALUATION_COVERAGE:important_key_point_ids:blockId=unassigned:missing=${uncoveredKeyPointIds.join('|')}:details=${uncoveredKeyPointIds.map(id=>`${id}=${pointDetails.get(id)||''}`).join('|')}`,
            ]
          : []),
        ...(uncoveredFactKeys.length > 0
          ? [
              'SESSION_EVALUATION_COVERAGE:required_fact_keys',
              `SESSION_EVALUATION_COVERAGE:required_fact_keys:blockId=unassigned:missing=${uncoveredFactKeys.join('|')}`,
            ]
          : []),
      ]
      return {
        session: null,
        errors: [...new Set([...errors, ...strictErrors])],
      }
    }
  }

  // Para sesiones learning, el contrato interno vuelve a ser estricto:
  // si la evaluación no cubre el bloque completo o tiene errores estructurales,
  // la sesión canónica debe invalidarse. El producto real ya maneja esto con fallback.
  if (input.kind === 'learning') {
    const strictBlockingErrors = errors.filter(e =>
      !e.includes('important_key_points')
    )
    return {
      session: strictBlockingErrors.length ? null : session,
      errors: [...new Set(errors)],
    }
  }

  return { session: errors.length ? null : session, errors: [...new Set(errors)] }
}

export function validateGeneratedSessionEvaluation(
  session: GeneratedSessionEvaluation,
  evaluationMode: unknown,
  kind: SessionEvaluationKind,
): SessionEvaluationValidation {
  if (kind !== 'learning') {
    const forbidden = session.evaluationBlocks.length > 0
    return {
      valid: !forbidden,
      errors: forbidden ? [`SESSION_KIND_CONTRACT:evaluation_forbidden:kind=${kind}`] : [],
      coverageRatio: 1,
      coveredRequiredStepIds: [],
      uncoveredRequiredStepIds: [],
      coveredCriticalKeyPoints: [],
      uncoveredCriticalKeyPoints: [],
      uncoveredImportantKeyPoints: [],
      coverageFailures: [],
    }
  }
  const errors: string[] = []
  // Evaluation blocks may be generated independently. Their declarations are the
  // contract boundary: never compare a partial block with every step in the session.
  const coverageFailures: SessionEvaluationValidation['coverageFailures'] = []
  const scopedRequiredStepIds: string[] = []
  const questionCoveredRequiredStepIds: string[] = []
  const scopedCriticalKeyPoints: string[] = []
  const questionCoveredCriticalKeyPoints: string[] = []
  const uncoveredImportantKeyPoints: string[] = []
  // Duplicados a lo largo de TODA la sesión, no solo dentro de un bloque — el
  // mismo hecho puede evaluarse dos veces en bloques distintos y eso también
  // debe bloquear el assembly final.
  const questionsSeenAcrossBlocks: SessionEvaluationQuestion[] = []

  for (const block of session.evaluationBlocks) {
    if (!session.steps.some(step => step.id === block.afterStepId)) {
      errors.push(`SESSION_EVALUATION_INVALID:after_step:${block.id}`)
    }
    if (!block.questions.length) errors.push(`SESSION_EVALUATION_INVALID:empty_block:${block.id}`)
    const declaredStepKeyPointIds = new Set(session.steps
      .filter(step => block.coveredStepIds.includes(step.id))
      .flatMap(step => step.keyPointIds||step.keyPoints.map((_,index)=>`${step.id}:kp:${index+1}`)))
    const scopedSteps = session.steps.filter(step => block.coveredStepIds.includes(step.id))
    const questionStepIds = new Set(block.questions.flatMap(question => question.coveredStepIds))
    const questionKeyPointIds = new Set(block.questions.flatMap(question => question.coveredKeyPointIds||[]))
    // CONTRATO PRODUCTO: cada checkpoint debe cubrir el 100% de los pasos enseñados en ese bloque.
    const requiredStepIds = scopedSteps.map(step => step.id)

    // Todos los keyPoints del bloque cuentan como cobertura obligatoria.
    const criticalKeyPoints = scopedSteps
      .flatMap(step => step.keyPointIds||step.keyPoints.map((_,index)=>`${step.id}:kp:${index+1}`))
      .filter(point => (block.coveredKeyPointIds||[]).includes(point))

    // Ya no diferenciamos "important" vs "critical" para la cobertura del bloque;
    // todo lo enseñado debe quedar evaluado.
    const importantKeyPoints: string[] = []
    const missingRequiredStepIds = requiredStepIds.filter(id => !questionStepIds.has(id))
    const missingCriticalKeyPoints = criticalKeyPoints.filter(point => !questionKeyPointIds.has(point))
    const missingImportantKeyPoints = importantKeyPoints.filter(point => !questionKeyPointIds.has(point))
    scopedRequiredStepIds.push(...requiredStepIds)
    questionCoveredRequiredStepIds.push(...requiredStepIds.filter(id => questionStepIds.has(id)))
    scopedCriticalKeyPoints.push(...criticalKeyPoints)
    questionCoveredCriticalKeyPoints.push(...criticalKeyPoints.filter(point => questionKeyPointIds.has(point)))
    uncoveredImportantKeyPoints.push(...missingImportantKeyPoints)
    if (missingRequiredStepIds.length || missingCriticalKeyPoints.length || missingImportantKeyPoints.length) {
      coverageFailures.push({ blockId: block.id, missingRequiredStepIds, missingCriticalKeyPoints, missingImportantKeyPoints })
    }
    // Solo advertir si hay keyPoints desconocidos — no bloquear el pipeline
    if ((block.coveredKeyPointIds||[]).some(point => !declaredStepKeyPointIds.has(point))) {
      console.warn(`[sessionEvaluation] block ${block.id}: algunos coveredKeyPoints no están en los steps — puede ser paráfrasis`)
    }
    for (const question of block.questions) {
      if (!(question.coveredKeyPointIds||[]).some(point => (block.coveredKeyPointIds||[]).includes(point))) {
        errors.push(`SESSION_EVALUATION_INVALID:question_outside_block:${question.id}`)
      }
      if (!validateQuestionTypeForMode(evaluationMode, question.format).valid) {
        errors.push(`SESSION_EVALUATION_INVALID:mode:${question.id}`)
      }
      if (/\b(?:paso|step)\s+\d+\b/i.test(question.questionText)) {
        errors.push(`SESSION_EVALUATION_INVALID:invented_step_reference:${question.id}`)
      }
    }
    for (let index = 0; index < block.questions.length; index += 1) {
      const candidate = block.questions[index]
      const duplicateOfPrevious = [...questionsSeenAcrossBlocks, ...block.questions.slice(0, index)].some(
        previous => questionSimilarity(previous, candidate) >= DUPLICATE_QUESTION_SIMILARITY_THRESHOLD,
      )
      if (duplicateOfPrevious) errors.push(`SESSION_EVALUATION_INVALID:duplicate_question:${candidate.id}`)
    }
    questionsSeenAcrossBlocks.push(...block.questions)
  }
  // NO validar cobertura global — cada bloque evalúa sus propios pasos declarados.
  // La filosofía del modo adaptativo es: evaluar después de cada grupo de pasos,
  // no necesariamente todos los pasos de la sesión en un solo bloque.
  // La cobertura global se logra sumando todos los bloques, no exigiendo que cada uno cubra todo.

  // Solo calcular para la respuesta — sin añadir errores por cobertura global
  const allCoveredStepIds = new Set(session.evaluationBlocks.flatMap(block =>
    block.questions.flatMap(question => question.coveredStepIds)
  ))
  const allCoveredKeyPoints = new Set(session.evaluationBlocks.flatMap(block =>
    block.questions.flatMap(question => question.coveredKeyPoints)
  ))
  // CONTRATO PRODUCTO: la sesión completa debe evaluar el 100% de los pasos enseñados.
  const allRequiredSteps = session.steps.map(step => step.id)
  const coveredRequiredStepIds = allRequiredSteps.filter(id => allCoveredStepIds.has(id))
  const coverageRatio = allRequiredSteps.length === 0
    ? 1
    : coveredRequiredStepIds.length / allRequiredSteps.length

  // Log informativo — no bloquea
  if (coverageRatio < 1) {
    console.log('[sessionEvaluation] cobertura parcial — bloques cubren ' + coveredRequiredStepIds.length + '/' + allRequiredSteps.length + ' pasos requeridos')
  }

  return {
    valid: errors.length === 0,
    errors: [...new Set(errors)],
    coverageRatio,
    coveredRequiredStepIds,
    uncoveredRequiredStepIds: allRequiredSteps.filter(id => !allCoveredStepIds.has(id)),
    coveredCriticalKeyPoints: [...new Set(questionCoveredCriticalKeyPoints)],
    uncoveredCriticalKeyPoints: [...new Set(uncoveredImportantKeyPoints)],
    uncoveredImportantKeyPoints: [...new Set(uncoveredImportantKeyPoints)],
    coverageFailures,
  }
}

export function createEvaluationBlockProgress(block: EvaluationBlock): EvaluationBlockProgress {
  return {
    blockId: block.id,
    currentQuestionIndex: 0,
    answers: [],
    failedQuestionIds: [],
    pendingRecoveryIds: [],
    readyRecoveryIds: [],
    status: block.questions.length ? 'answering' : 'completed',
  }
}

export function recordNormalBlockAnswer(
  progress: EvaluationBlockProgress,
  question: SessionEvaluationQuestion,
  answer: CanonicalUserAnswer,
  correct: boolean,
  recoveryId?: string,
): EvaluationBlockProgress {
  if (progress.answers.some(record => record.questionId === question.id)) return progress
  const failedKeyPoints = correct ? [] : [...question.coveredKeyPoints]
  const nextIndex = progress.currentQuestionIndex + 1
  return {
    ...progress,
    currentQuestionIndex: nextIndex,
    answers: [...progress.answers, {
      questionId: question.id,
      answer,
      correct,
      failedKeyPoints,
      answeredAt: new Date().toISOString(),
    }],
    failedQuestionIds: correct
      ? progress.failedQuestionIds
      : [...progress.failedQuestionIds, question.id],
    pendingRecoveryIds: !correct && recoveryId
      ? [...new Set([...progress.pendingRecoveryIds, recoveryId])]
      : progress.pendingRecoveryIds,
    status: progress.status,
  }
}

export function closeNormalEvaluationBlock(
  block: EvaluationBlock,
  progress: EvaluationBlockProgress,
): EvaluationBlockProgress {
  if (progress.answers.length < block.questions.length) return { ...progress, status: 'answering' }
  if (progress.pendingRecoveryIds.length) {
    return {
      ...progress,
      status: progress.readyRecoveryIds.length ? 'recovering' : 'waiting_for_recovery',
    }
  }
  return { ...progress, status: 'completed' }
}

export function markRecoveryReady(
  progress: EvaluationBlockProgress,
  recoveryId: string,
): EvaluationBlockProgress {
  if (!progress.pendingRecoveryIds.includes(recoveryId)) return progress
  return {
    ...progress,
    readyRecoveryIds: [...new Set([...progress.readyRecoveryIds, recoveryId])],
  }
}

export function resolveBlockRecovery(
  progress: EvaluationBlockProgress,
  recoveryId: string,
): EvaluationBlockProgress {
  const pendingRecoveryIds = progress.pendingRecoveryIds.filter(id => id !== recoveryId)
  const readyRecoveryIds = progress.readyRecoveryIds.filter(id => id !== recoveryId)
  return {
    ...progress,
    pendingRecoveryIds,
    readyRecoveryIds,
    status: pendingRecoveryIds.length ? 'recovering' : 'completed',
  }
}

export function sessionEvaluationCoverage(
  session: GeneratedSessionEvaluation,
  progressByBlock: Record<string, EvaluationBlockProgress>,
): number {
  const requiredBlocks = session.evaluationBlocks.filter(block => block.questions.length > 0)
  if (!requiredBlocks.length) return 1
  return requiredBlocks.filter(block => progressByBlock[block.id]?.status === 'completed').length /
    requiredBlocks.length
}

export class RecoveryGenerationCoordinator<T> {
  private active = 0
  private readonly queued: Array<() => void> = []
  private readonly operations = new Map<string, Promise<T>>()

  constructor(private readonly maxConcurrent = 2) {}

  run(key: string, operation: () => Promise<T>): Promise<T> {
    const existing = this.operations.get(key)
    if (existing) return existing
    const promise = new Promise<T>((resolve, reject) => {
      const start = () => {
        this.active += 1
        void operation().then(resolve, reject).finally(() => {
          this.active -= 1
          this.queued.shift()?.()
        })
      }
      if (this.active < this.maxConcurrent) start()
      else this.queued.push(start)
    })
    this.operations.set(key, promise)
    return promise
  }

  has(key: string): boolean {
    return this.operations.has(key)
  }

  get activeCount(): number {
    return this.active
  }

  get queueDepth(): number {
    return this.queued.length
  }
}
