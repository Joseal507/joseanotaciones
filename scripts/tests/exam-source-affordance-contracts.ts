import assert from 'node:assert/strict'
import {
  buildExamEnjoyerUniverse,
  composeEnjoyerExamBlueprint,
  classifySourceAffordances,
  hasVerifiedOperandsOrWorkedCase,
  hasWorkedMathChain,
  skillFor,
  operationForSkill,
  ExamEnjoyerTarget,
} from '../../lib/materialBrain/examEnjoyerContext'
import { buildSourceSelectionSnapshot } from '../../lib/adaptive/sourceSelection'
import { authorSlotQuestionWithDiagnostics, examTaskMatchesOperation } from '../../app/api/alai-studyal-exam/route'

let count = 0
async function test(name: string, fn: () => void | Promise<void>) {
  await fn()
  console.log(`PASS ${++count}: ${name}`)
}

async function main() {
  console.log('\n── EXAM_SOURCE_AFFORDANCE contracts ──\n')

  const selection = { ...buildSourceSelectionSnapshot(['bohr'], { bohr: [4] }), fingerprint: 'fp-bohr-affordance' }

  const bohrNegativeItem = {
    id: 'formula_ecuacion_de_energia_del_modelo_de_bohr',
    name: 'Ecuación de energía del modelo de Bohr',
    content: 'E_n = -13.6 eV / n² describe los niveles de energía del electrón en el átomo de hidrógeno, donde n es el número cuántico principal (n = 1, 2, 3...)',
    kind: 'formula',
    importance: 'high',
    difficulty: 'medium',
    examTypes: ['problem', 'open'],
    bloomLevel: 'apply',
    topicId: 'bohr-model',
    materialId: 'bohr',
    pages: [4],
    sourceSpans: [{ page: 4, quote: 'E_n = -13.6 eV / n² describe los niveles de energía' }],
  }

  const bohrPositiveItem = {
    id: 'calculo_energia_nivel_2_bohr',
    name: 'Cálculo de energía para el nivel n=2 en el modelo de Bohr',
    content: 'Para el nivel n = 2 del átomo de hidrógeno, aplicando la ecuación de Bohr E_n = -13.6 eV / n², se sustituye n=2 obteniendo E_2 = -13.6 eV / 4 = -3.4 eV.',
    kind: 'formula',
    importance: 'high',
    difficulty: 'medium',
    examTypes: ['problem', 'open'],
    bloomLevel: 'apply',
    topicId: 'bohr-model',
    materialId: 'bohr',
    pages: [4],
    sourceSpans: [{ page: 4, quote: 'se sustituye n=2 obteniendo E_2 = -13.6 eV / 4 = -3.4 eV.' }],
  }

  const payload = {
    sourceSelectionFingerprint: selection.fingerprint,
    materialIds: ['bohr'],
    selectedPages: selection.selectedPages,
    materialLanguage: 'es',
    topicsIndex: [{ id: 'bohr-model', title: 'Modelo atómico de Bohr' }],
    uniqueConceptsIndex: [],
    globalOrderedAnalysis: [bohrNegativeItem, bohrPositiveItem],
  }

  const universe = buildExamEnjoyerUniverse(payload, selection)

  await test('1. Bohr page 4 negative fixture has NO worked operands and affords recall/interpret/explain, NOT concrete application', () => {
    const target = universe.targets.find(t => t.sourceItemId === bohrNegativeItem.id)!
    assert.ok(target, 'target must exist in universe')
    assert.equal(hasWorkedMathChain(target.content), false)
    assert.equal(hasVerifiedOperandsOrWorkedCase(target), false)

    const affordances = classifySourceAffordances(target)
    assert.equal(affordances.canRecall, true)
    assert.equal(affordances.canInterpret, true)
    assert.equal(affordances.canExplain, true)
    assert.equal(affordances.canApplyConcreteCase, false)

    const resolvedSkill = skillFor(target)
    assert.notEqual(resolvedSkill, 'application', 'formula without worked operands cannot be application')
    assert.equal(resolvedSkill, 'comprehension')

    const op = operationForSkill(resolvedSkill)
    assert.notEqual(op, 'use', 'operation must downgrade from use')
    assert.equal(op, 'interpret')
  })

  await test('2. Bohr positive fixture with concrete operands/evaluation chain affords canApplyConcreteCase === true', () => {
    const target = universe.targets.find(t => t.sourceItemId === bohrPositiveItem.id)!
    assert.ok(target, 'positive target must exist in universe')
    assert.equal(hasWorkedMathChain(target.content), true)
    assert.equal(hasVerifiedOperandsOrWorkedCase(target), true)

    const affordances = classifySourceAffordances(target)
    assert.equal(affordances.canApplyConcreteCase, true)

    const resolvedSkill = skillFor(target)
    assert.equal(resolvedSkill, 'application')
    assert.equal(operationForSkill(resolvedSkill), 'use')
  })

  await test('3. Blueprint composition assigns operation !== "use" to Bohr page 4; authored conceptual question is accepted without OPERATION_MISMATCH', () => {
    const blueprint = composeEnjoyerExamBlueprint(universe, 30, 'bohr-exam', 'seed-bohr')
    const negativeSlot = blueprint.slots.find(s => s.sourceItemIds.includes(bohrNegativeItem.id))!
    assert.ok(negativeSlot, 'negative slot must be present in blueprint')

    assert.notEqual(negativeSlot.cognitiveOperation, 'use')
    assert.equal(negativeSlot.cognitiveOperation, 'interpret')
    assert.equal(negativeSlot.skill, 'comprehension')
    assert.equal(negativeSlot.assessmentCriteria![0].operation, 'interpret')
    assert.equal(negativeSlot.assessmentCriteria![0].skill, 'comprehension')

    // Conceptual interpretation prompt (the exact prompt shape rejected with OPERATION_MISMATCH when operation was "use")
    const authoringResult = authorSlotQuestionWithDiagnostics(
      'bohr-exam',
      blueprint,
      negativeSlot,
      {
        type: negativeSlot.type,
        prompt: 'Explica qué relación describe la ecuación de Bohr E_n = -13.6 eV / n² respecto a los niveles de energía del átomo de hidrógeno y qué indica el valor de n.',
      }
    )

    assert.ok(authoringResult.question, `question must be accepted, got rejection: ${authoringResult.rejectionReason}`)
    assert.equal(authoringResult.rejectionReason, undefined)
    assert.equal(authoringResult.question!.skill, 'comprehension')
  })

  await test('4. Positive fixture slot with operation === "use" strictly enforces calculation and rejects recall-only prompts', () => {
    const blueprint = composeEnjoyerExamBlueprint(universe, 30, 'bohr-exam-pos', 'seed-bohr-pos')
    const positiveSlot = blueprint.slots.find(s => s.sourceItemIds.includes(bohrPositiveItem.id))!
    assert.ok(positiveSlot, 'positive slot must be present')
    assert.equal(positiveSlot.cognitiveOperation, 'use')
    assert.equal(positiveSlot.skill, 'application')

    // Recall-only prompt must be rejected by OPERATION_MISMATCH
    const recallResult = authorSlotQuestionWithDiagnostics(
      'bohr-exam-pos',
      blueprint,
      positiveSlot,
      {
        type: positiveSlot.type,
        prompt: '¿Cuál es la fórmula para la energía de Bohr en el nivel n=2?',
      }
    )
    assert.equal(recallResult.question, null)
    assert.match(recallResult.rejectionReason!, /OPERATION_MISMATCH/)

    // Valid application prompt with calculation and concrete case operands is accepted
    const validAppResult = authorSlotQuestionWithDiagnostics(
      'bohr-exam-pos',
      blueprint,
      positiveSlot,
      {
        type: positiveSlot.type,
        prompt: 'Calcula la energía del electrón para el nivel n = 2 usando la ecuación de Bohr y muestra el procedimiento del cálculo.',
      }
    )
    assert.ok(validAppResult.question, `valid application question must be accepted, got: ${validAppResult.rejectionReason}`)
    assert.equal(validAppResult.question!.skill, 'application')
  })

  await test('5. Pure formula and definition targets without problem context never fabricate application affordance', () => {
    const pureFormulas = [
      { label: 'Segunda Ley de Newton', content: 'F = m * a establece que la fuerza es el producto de la masa por la aceleración.' },
      { label: 'Ley de los gases ideales', content: 'PV = nRT donde R = 0.0821 atm L / mol K es la constante universal.' },
      { label: 'Energía libre de Gibbs', content: 'ΔG = ΔH - TΔS define el criterio de espontaneidad a temperatura y presión constantes.' },
      { label: 'Relación de equivalencia masa-energía', content: 'E = mc² expresa que la masa y la energía son manifestaciones equivalentes de la misma entidad física.' },
    ]

    for (const item of pureFormulas) {
      assert.equal(hasVerifiedOperandsOrWorkedCase(item), false, `${item.label} must not have verified operands`)
      const affordances = classifySourceAffordances({ ...item, kind: 'formula' })
      assert.equal(affordances.canApplyConcreteCase, false, `${item.label} must not afford concrete application`)
      assert.equal(affordances.canInterpret, true, `${item.label} must afford interpretation`)
    }
  })

  await test('6. Deterministic reproducibility: same universe and seed produce identical affordances and slot operations', () => {
    const b1 = composeEnjoyerExamBlueprint(universe, 30, 'det-1', 'seed-det')
    const b2 = composeEnjoyerExamBlueprint(universe, 30, 'det-2', 'seed-det')

    assert.equal(b1.slots.length, b2.slots.length)
    for (let i = 0; i < b1.slots.length; i++) {
      assert.equal(b1.slots[i].id, b2.slots[i].id)
      assert.equal(b1.slots[i].skill, b2.slots[i].skill)
      assert.equal(b1.slots[i].cognitiveOperation, b2.slots[i].cognitiveOperation)
      assert.deepEqual(b1.slots[i].sourceAffordances, b2.slots[i].sourceAffordances)
    }
  })

  console.log(`\nexam-source-affordance-contracts: ALL ${count} PASS\n`)
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
