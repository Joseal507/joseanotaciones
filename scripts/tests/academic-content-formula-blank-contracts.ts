import assert from 'node:assert/strict'
import { normalizeAcademicContent } from '../../lib/academic-content/validation'
import { canonicalizeGeneratedSession } from '../../lib/adaptive/evaluation/sessionEvaluation'
import { validateQuestion, normalizeGeneratedQuestion, type GenerationContext } from '../../lib/adaptive/evaluation/questionContract'
import {
  diagnoseEvaluationBlock,
  runSessionPreparationFactory,
  type PreparedTeachingContent,
  type EvaluationPlan,
  type PreparedEvaluationQuestion,
  type PreparedEvaluationBlock,
  type SessionPreparationState,
} from '../../lib/ai/sessionPreparationFactory'

// BUG REAL (primera prueba manual de producto) — chapter_6 "Ácidos y Bases
// Fuertes": POST /api/adaptive/session-teach -> 503 tras 81858ms/12 remote
// calls. Teaching generado y validado, evaluation_generation produjo 7
// bloques, 3 con partial coverage repararon a EVALUATION_COMPLETE — pero
// session_assembly_validation (canonicalizeGeneratedSession) rechazó 2
// preguntas (eval_4_3, eval_6_1, ambas fórmulas de Ka) con
// invalid_academic_content, tumbando coverage a 18/20 y disparando el
// STRICT COVERAGE BLOCKER → 503.
//
// CAUSA RAÍZ #1 (reproducida con generación REAL vía OpenRouter, ver
// scripts/_repro_ka_temp.ts durante la investigación — no committeado):
// preguntas word_bank_formula legítimas escriben el hueco DENTRO de la
// expresión matemática, p.ej. "$pH = -log[___]$" (contrato documentado en
// session-teach/route.ts: "El prompt incluye ___ para cada término
// faltante"). El tokenizador de lib/academic-content/parser.ts (INLINE_TOKEN)
// usaba "cualquier carácter" para el contenido entre $...$/\(...\)/\[...\]/
// $$...$$, así que ___ quedaba DENTRO del nodo math. KaTeX rechaza "___"
// (un _ exige un grupo de subíndice) → invalid_math → requiresRegeneration.
// Fix: los 4 patrones de math en INLINE_TOKEN ahora usan (?!___) para nunca
// cruzar el sentinel de blank — ___ se tokeniza aparte como blank real y el
// texto alrededor queda como texto plano (pierde render matemático de esa
// porción, pero nunca se rechaza la pregunta).
//
// CAUSA RAÍZ #2 (el "invariante roto" que pedía la auditoría): diagnoseEvaluationBlock
// (sessionPreparationFactory.ts — gobierna generación e incremental repair)
// NUNCA llamaba normalizeAcademicContent/validateQuestion — su "structurallyValid"
// no comprobaba contenido académico en absoluto. Por eso una pregunta con
// LaTeX roto podía contar como EVALUATION_COMPLETE en generación/repair y
// solo ser descubierta inválida en el assembly final (canonicalizeGeneratedSession,
// que SÍ llama validateQuestion), después de agotar el presupuesto de
// repair. Fix: diagnoseEvaluationBlock ahora llama la MISMA
// normalizeAcademicContent (vía academicContentOk) — una sola fuente de
// verdad para validez académica en ambas capas.

const kaGeneral = '$Ka = [H_3O^+][A^-]/[HA]$'
const kaFormico = '$Ka = [H_3O^+][HCOO^-]/[HCOOH]$'
const phBlankFormula = 'Completa la fórmula para calcular el pH: $pH = -log[___]$'
const genuinelyBroken = 'Fórmula rota de verdad: $\\frac{1}{$' // delimitador $ desbalanceado — broken_delimiter

// ═══ A — fórmula general de Ka válida ═══
{
  const r = normalizeAcademicContent(kaGeneral)
  assert.equal(r.requiresRegeneration, false, 'A: Ka = [H3O+][A-]/[HA] es contenido académico válido')
  assert.equal(r.validation.valid, true)
}

// ═══ B — fórmula Ka del ácido fórmico válida ═══
{
  const r = normalizeAcademicContent(kaFormico)
  assert.equal(r.requiresRegeneration, false, 'B: Ka del ácido fórmico es contenido académico válido')
  assert.equal(r.validation.valid, true)
}

// ═══ C — pregunta word_bank/formula válida no se convierte en
// invalid_academic_content en canonicalización ═══
{
  const rawSession = {
    sessionIntro: 'Ácidos y bases', sessionClosing: 'Continúa.',
    steps: [{
      id: 'step_1', type: 'formula', title: 'Cálculo de pH',
      content: 'El pH se calcula con la concentración de iones hidronio.',
      keyPoints: ['Fórmula del pH'], keyPointIds: ['step_1:kp:1'],
      importance: 'critical', relatedBlockIds: ['ph-calculo'], factKeys: ['ph-calculo:fact:1'],
    }],
    evaluationBlocks: [{
      id: 'block_1', afterStepId: 'step_1', coveredStepIds: ['step_1'],
      coveredKeyPoints: ['Fórmula del pH'], coveredKeyPointIds: ['step_1:kp:1'],
      questions: [{
        questionId: 'eval_1_1', format: 'word_bank', coveredStepIds: ['step_1'],
        targetKeyPointIds: ['step_1:kp:1'], targetFactKeys: ['ph-calculo:fact:1'],
        coveredKeyPoints: ['Fórmula del pH'], cognitiveTarget: 'comprehension',
        prompt: phBlankFormula,
        options: [{ id: 'h3o', text: '$H_3O^+$' }, { id: 'oh', text: '$OH^-$' }],
        correctAnswer: ['h3o'], feedback: 'El pH es -log de la concentración de H3O+.',
      }],
    }],
  }
  const canonical = canonicalizeGeneratedSession(rawSession, { sessionId: 'chapter_x', kind: 'learning', evaluationMode: 'quick_test' })
  assert(canonical.session, `C: la sesión con word_bank_formula (blank dentro de math) debe canonicalizar — errores: ${canonical.errors.join('\n')}`)
  assert.ok(!canonical.errors.some(error => error.includes('invalid_academic_content')), 'C: no debe haber ningún error invalid_academic_content')
  const restored = canonical.session!.evaluationBlocks[0].questions.find(q => q.id === 'eval_1_1')
  assert(restored, 'C: la pregunta word_bank_formula debe sobrevivir a la canonicalización, no desaparecer silenciosamente')
}

// ═══ D — una pregunta realmente académicamente inválida sigue siendo
// rechazada (el fix no debilita el validador) ═══
{
  const r = normalizeAcademicContent(genuinelyBroken)
  assert.equal(r.requiresRegeneration, true, 'D: delimitador $ desbalanceado sigue siendo inválido')

  const rawSession = {
    sessionIntro: 'i', sessionClosing: 'c',
    steps: [{
      id: 'step_1', type: 'formula', title: 'T', content: 'C',
      keyPoints: ['KP1'], keyPointIds: ['step_1:kp:1'],
      importance: 'critical', relatedBlockIds: ['b1'], factKeys: ['f1'],
    }],
    evaluationBlocks: [{
      id: 'block_1', afterStepId: 'step_1', coveredStepIds: ['step_1'],
      coveredKeyPoints: ['KP1'], coveredKeyPointIds: ['step_1:kp:1'],
      questions: [{
        questionId: 'eval_1_1', format: 'true_false', coveredStepIds: ['step_1'],
        targetKeyPointIds: ['step_1:kp:1'], targetFactKeys: ['f1'],
        coveredKeyPoints: ['KP1'], cognitiveTarget: 'comprehension',
        prompt: genuinelyBroken, correctAnswer: true, feedback: 'x',
      }],
    }],
  }
  const canonical = canonicalizeGeneratedSession(rawSession, { sessionId: 'chapter_y', kind: 'learning', evaluationMode: 'quick_test' })
  assert.equal(canonical.session, null, 'D: una sesión cuya única pregunta es académicamente inválida debe seguir siendo rechazada')
  assert.ok(canonical.errors.some(error => error.includes('invalid_academic_content')), 'D: el error debe mencionar invalid_academic_content')
}

// ═══ E — si una pregunta queda inválida después de generation, el bloque
// NO puede declararse EVALUATION_COMPLETE sin repair ═══
{
  const teaching: PreparedTeachingContent = {
    sessionId: 'sess-e', title: 'T', introduction: 'i', closing: 'c',
    steps: [{
      stepId: 'step_1', id: 'step_1', microId: 'm1', title: 'T', type: 'concept',
      content: 'c', keyPoints: ['KP1'], keyPointIds: ['step_1:kp:1'],
      factKeys: ['f1'], importance: 'critical', cognitiveTarget: 'comprehension', sourceReferences: [],
    }],
  }
  const block: PreparedEvaluationBlock = {
    blockId: 'b1', afterStepId: 'step_1', coveredStepIds: ['step_1'], coveredKeyPointIds: ['step_1:kp:1'],
    coveredFactKeys: ['f1'], targetObjectiveIds: ['step_1:objective:comprehension'], cognitiveTargets: ['comprehension'],
    recommendedQuestionCount: 1, recommendedFormats: ['true_false'], difficulty: 'medium',
    questions: [{
      questionId: 'q-broken', blockId: 'b1', targetStepIds: ['step_1'], targetKeyPointIds: ['step_1:kp:1'],
      targetFactKeys: ['f1'], targetObjectiveIds: ['step_1:objective:comprehension'], cognitiveTarget: 'comprehension',
      format: 'true_false', prompt: genuinelyBroken, correctAnswer: true, feedback: 'x', difficulty: 'medium',
    }],
  }
  const diagnosis = diagnoseEvaluationBlock(block, block.questions, teaching, 'mix_everything')
  assert.deepEqual(diagnosis.invalidQuestionIds, ['q-broken'], 'E: diagnoseEvaluationBlock debe marcar la pregunta académicamente rota como inválida en generación, no solo en canonicalización')
  assert.equal(diagnosis.code, 'PARTIAL_EVALUATION_COVERAGE', 'E: con la única pregunta inválida, el bloque NO puede declararse EVALUATION_COMPLETE')
  assert.equal(diagnosis.acceptedQuestionIds.includes('q-broken'), false)
}

// ═══ F — generation validator (diagnoseEvaluationBlock) y final canonicalizer
// (validateQuestion) mantienen el MISMO contrato para el mismo texto ═══
{
  const context: GenerationContext = {
    activeConceptId: 'step_1', activeConceptLabel: 'L', teachingBlockId: 'step_1',
    targetDimension: 'comprehension', questionFamily: 'word_bank', allowedConceptIds: ['step_1'],
    forbiddenConceptIds: [], factKeys: ['f1'], targetObjectiveIds: ['obj-1'], evaluationMode: 'mix_everything',
  }
  const samples = [
    { text: phBlankFormula, expectValid: true, label: 'blank dentro de fórmula matemática' },
    { text: kaGeneral, expectValid: true, label: 'fórmula de Ka sin blank' },
    { text: genuinelyBroken, expectValid: false, label: 'delimitador desbalanceado' },
  ]
  for (const sample of samples) {
    const preparedQuestion: PreparedEvaluationQuestion = {
      questionId: 'q1', blockId: 'b1', targetStepIds: ['step_1'], targetKeyPointIds: ['step_1:kp:1'],
      targetFactKeys: ['f1'], targetObjectiveIds: ['obj-1'], cognitiveTarget: 'comprehension',
      format: 'true_false', prompt: sample.text, correctAnswer: true, feedback: 'ok', difficulty: 'medium',
    }
    const genValid = academicContentOkForTest(preparedQuestion)
    const canonical = normalizeGeneratedQuestion({
      conceptId: 'step_1', variant: 'true_false_factual', targetDimension: 'comprehension',
      difficulty: 'medium', questionText: sample.text, correctAnswer: true, explanation: 'ok', hint: 'h',
    }, context, 'q1')
    assert(canonical, `F: ${sample.label} debe normalizarse a CanonicalQuestion`)
    const finalValid = !validateQuestion(canonical!, context).errors.includes('invalid_academic_content')
    assert.equal(genValid, sample.expectValid, `F: generation validator para "${sample.label}" debe dar ${sample.expectValid}`)
    assert.equal(finalValid, sample.expectValid, `F: final canonicalizer para "${sample.label}" debe dar ${sample.expectValid}`)
    assert.equal(genValid, finalValid, `F: generation validator y final canonicalizer DEBEN coincidir para "${sample.label}" (mismo contrato académico)`)
  }
}
// Réplica local de la comprobación interna de diagnoseEvaluationBlock — no
// se exporta directamente, así que se reconstruye con la MISMA función real
// (normalizeAcademicContent) para comparar veredictos, no una reimplementación.
function academicContentOkForTest(q: PreparedEvaluationQuestion): boolean {
  const texts = [q.prompt, q.feedback].filter((t): t is string => typeof t === 'string' && t.trim().length > 0)
  return texts.every(text => !normalizeAcademicContent(text).requiresRegeneration)
}

// ═══ G/H/I — pipeline completo (runSessionPreparationFactory, el mismo
// orquestador real de producto) alcanza 'ready' con 100% required steps,
// 100% keyPoints importantes/críticos y 100% factKeys, incluso con una
// pregunta word_bank_formula cuyo blank vive dentro de una expresión
// matemática — reproduce estructuralmente el bug real sin depender de un
// proveedor de IA (determinista). ═══
async function testGHI() {
  const teaching: PreparedTeachingContent = {
    sessionId: 'sess-ghi', title: 'Ácidos y bases', introduction: 'i', closing: 'c',
    steps: [
      {
        stepId: 'step_1', id: 'step_1', microId: 'm1', title: 'Ácidos fuertes', type: 'concept',
        content: 'Los ácidos fuertes se disocian completamente.', keyPoints: ['Disociación completa'],
        keyPointIds: ['step_1:kp:1'], factKeys: ['acidos-fuertes:fact:1'],
        importance: 'critical', cognitiveTarget: 'comprehension', sourceReferences: [],
      },
      {
        stepId: 'step_2', id: 'step_2', microId: 'm2', title: 'Cálculo de pH', type: 'formula',
        content: 'El pH se calcula con la concentración de H3O+.', keyPoints: ['Fórmula del pH'],
        keyPointIds: ['step_2:kp:1'], factKeys: ['ph-calculo:fact:1'],
        importance: 'critical', cognitiveTarget: 'comprehension', sourceReferences: [],
      },
    ],
  }
  const plan: EvaluationPlan = {
    blocks: [{
      blockId: 'sess-ghi:evaluation:1', afterStepId: 'step_2', coveredStepIds: ['step_1', 'step_2'],
      coveredKeyPointIds: ['step_1:kp:1', 'step_2:kp:1'], coveredFactKeys: ['acidos-fuertes:fact:1', 'ph-calculo:fact:1'],
      targetObjectiveIds: ['step_1:objective:comprehension', 'step_2:objective:comprehension'],
      cognitiveTargets: ['comprehension'], recommendedQuestionCount: 2, recommendedFormats: ['true_false', 'word_bank'], difficulty: 'medium',
    }],
  }
  const normalQuestion: PreparedEvaluationQuestion = {
    questionId: 'q-normal', blockId: plan.blocks[0].blockId, targetStepIds: ['step_1'],
    targetKeyPointIds: ['step_1:kp:1'], targetFactKeys: ['acidos-fuertes:fact:1'],
    targetObjectiveIds: ['step_1:objective:comprehension'], cognitiveTarget: 'comprehension',
    format: 'true_false', prompt: 'Los ácidos fuertes se disocian completamente en agua.', correctAnswer: true,
    feedback: 'Correcto.', difficulty: 'easy',
  }
  const formulaBlankQuestion: PreparedEvaluationQuestion = {
    questionId: 'q-formula-blank', blockId: plan.blocks[0].blockId, targetStepIds: ['step_2'],
    targetKeyPointIds: ['step_2:kp:1'], targetFactKeys: ['ph-calculo:fact:1'],
    targetObjectiveIds: ['step_2:objective:comprehension'], cognitiveTarget: 'comprehension',
    format: 'word_bank', prompt: phBlankFormula,
    options: [{ id: 'h3o', text: '$H_3O^+$' }, { id: 'oh', text: '$OH^-$' }],
    correctAnswer: ['h3o'], feedback: 'El pH es -log de la concentración de H3O+.', difficulty: 'medium',
  }

  let persisted: SessionPreparationState | null = null
  const state = await runSessionPreparationFactory({
    sessionKind: 'learning', generationKey: 'test:ka-ph-formula-blank', evalPreference: 'mix_everything',
    load: async () => persisted,
    persist: async s => { persisted = s },
    generateTeaching: async () => teaching,
    planEvaluations: async () => plan,
    generateEvaluationBlock: async (block): Promise<PreparedEvaluationBlock> => ({
      ...block, questions: [normalQuestion, formulaBlankQuestion],
    }),
    repairEvaluationBlock: async () => { throw new Error('G/H/I: no debería requerirse repair — ambas preguntas ya son académicamente válidas') },
  })

  assert.equal(state.preparationStatus, 'ready', 'G/H/I: el pipeline debe llegar a ready sin necesitar repair')
  assert.equal(state.missingCoverage?.code, 'EVALUATION_COMPLETE')
  assert.deepEqual(state.missingCoverage?.missingRequiredStepIds, [], 'G: 100% required steps')
  assert.deepEqual(state.missingCoverage?.missingCriticalKeyPoints, [], 'H: 100% required critical keyPoints')
  assert.deepEqual(state.missingCoverage?.missingImportantKeyPoints, [], 'H: 100% required important keyPoints')
  assert.deepEqual(state.missingCoverage?.missingFactKeys, [], 'I: 100% required factKeys')

  // Confirma también a nivel de canonicalización final (el mismo camino que
  // ejecuta session-teach/route.ts vía canonicalizeGeneratedSession) —
  // ambas capas deben coincidir en aceptar esta sesión completa.
  const keyPointText = new Map([['step_1:kp:1', 'Disociación completa'], ['step_2:kp:1', 'Fórmula del pH']])
  const rawSession = {
    sessionIntro: teaching.introduction, sessionClosing: teaching.closing,
    steps: teaching.steps.map(step => ({ ...step, id: step.stepId })),
    evaluationBlocks: state.generatedEvaluationBlocks.map(block => ({
      id: block.blockId, ...block,
      coveredKeyPoints: block.coveredKeyPointIds.map(id => keyPointText.get(id)).filter(Boolean),
      questions: block.questions.map(q => ({
        ...q, id: q.questionId, type: q.format, coveredStepIds: q.targetStepIds,
        coveredKeyPoints: q.targetKeyPointIds.map(id => keyPointText.get(id)).filter(Boolean),
        questionText: q.prompt, explanation: q.feedback, targetDimension: q.cognitiveTarget,
      })),
    })),
  }
  const canonical = canonicalizeGeneratedSession(rawSession, { sessionId: 'sess-ghi', kind: 'learning', evaluationMode: 'mix_everything' })
  assert(canonical.session, `G/H/I: la canonicalización final también debe aceptar la sesión completa — errores: ${canonical.errors.join('\n')}`)
}

testGHI().then(() => {
  console.log('academic-content-formula-blank-contracts: A-I PASS')
}).catch(error => { console.error(error); process.exitCode = 1 })
