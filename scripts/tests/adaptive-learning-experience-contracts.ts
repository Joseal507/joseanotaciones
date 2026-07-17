import assert from 'node:assert/strict'
import {
  buildProgressiveHelp,
  nextAssistanceLevel,
  type HelpUsage,
} from '../../lib/adaptive/v3/engine/helpContract'
import { evaluatePedagogicalQuality } from '../../lib/adaptive/v3/engine/interactionContract'

const interaction = {
  id: 'interaction-a',
  questionId: 'question-a',
  interactionType: 'multiple_choice',
  prompt: '¿Qué describe mejor la relación entre energía y transición?',
  data: {
    options: ['La energía cambia entre estados permitidos', 'La energía permanece continua', 'La transición elimina el átomo'],
    correctIndex: 0,
  },
}

const context = {
  microName: 'Estados de energía',
  materialReminder: 'Los estados permitidos tienen energías definidas y una transición intercambia radiación.',
  keyIdea: 'Una transición conecta dos estados permitidos.',
}

const first = buildProgressiveHelp(interaction, context, 'hint', 1)
assert.equal(first.assistanceLevel, 'minimal_hint')
assert.ok(first.text.includes('estados'))
assert.ok(!first.text.includes(interaction.data.options[0]), 'la primera pista no revela la respuesta')

const discarded = buildProgressiveHelp(interaction, context, 'discard_option', 2)
assert.equal(discarded.assistanceLevel, 'guided')
assert.equal(discarded.eliminatedOptionIndex, 2)
assert.notEqual(discarded.eliminatedOptionIndex, interaction.data.correctIndex)

const steps = buildProgressiveHelp({ ...interaction, interactionType: 'numeric_short' }, context, 'break_into_steps', 2)
assert.match(steps.text, /paso/i)

assert.equal(nextAssistanceLevel('guided', 'minimal_hint'), 'guided', 'la ayuda nunca retrocede')
assert.equal(nextAssistanceLevel('minimal_hint', 'assisted'), 'assisted')

const usage: HelpUsage = { kind: 'hint', level: 1, assistanceLevel: first.assistanceLevel, text: first.text }
assert.equal(usage.assistanceLevel, 'minimal_hint')

const placeholderQuality = evaluatePedagogicalQuality({
  ...interaction,
  data: { ...interaction.data, options: [interaction.data.options[0], 'Concepto no relacionado', 'Información externa'] },
}, { microId: 'm1', microName: 'Estados de energía', objective: 'discriminate', sourceText: context.materialReminder })
assert.ok(placeholderQuality.qualityScore < 65)
assert.ok(placeholderQuality.rejectedReasons.includes('PLACEHOLDER_DISTRACTOR'))

const groundedQuality = evaluatePedagogicalQuality(interaction, { microId: 'm1', microName: 'Estados de energía', objective: 'discriminate', sourceText: context.materialReminder })
assert.ok(groundedQuality.qualityScore >= 65)

console.log('✅ Adaptive learning experience contracts')
