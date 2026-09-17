import assert from 'node:assert/strict'
import { buildMultipleChoiceOptions, mcqHasLengthLeak } from '../../app/api/alai-studyal-exam/route'

function authority(canonicalValue: string, distractorPool: string[]) {
  return { kind: 'single_text' as const, canonicalValue, distractorPool }
}

function main() {
  // 1. Visible options are always complete — no artificial ellipsis,
  // even when the canonical value is very long (a full paragraph).
  {
    const longCanonical = 'La constante de equilibrio Kc relaciona las concentraciones molares de productos y reactivos en el equilibrio, elevadas a sus coeficientes estequiométricos, y depende únicamente de la temperatura para una reacción dada, siendo independiente de las concentraciones iniciales o de la presencia de un catalizador.'
    const comparableDistractors = [
      'La constante de equilibrio Kc relaciona las presiones parciales de productos y reactivos en el equilibrio, elevadas a sus coeficientes estequiométricos, y depende del volumen del recipiente además de la temperatura de la reacción.',
      'La constante de equilibrio Kc relaciona las concentraciones molares de productos y reactivos antes del equilibrio, elevadas a sus coeficientes estequiométricos, y varía con las concentraciones iniciales del sistema.',
      'La constante de equilibrio Kc relaciona las concentraciones molares de reactivos y productos en el equilibrio, sin considerar los coeficientes estequiométricos, y depende de la presencia de un catalizador.',
    ]
    const built = buildMultipleChoiceOptions(
      authority(longCanonical, comparableDistractors),
      [], 'seed-1',
    )
    assert.equal(built, null, 'a long canonical proposition must use a short-response slot, never truncate or force MCQ')
  }

  // 2. Correct answer is not required to be the longest — a short
  // correct answer next to longer distractors must still succeed.
  {
    const shortCanonical = 'Se aumenta la presión total del sistema.'
    const longerDistractors = [
      'Se disminuye la temperatura del sistema en equilibrio.',
      'Se reduce el volumen del recipiente de reacción.',
      'Se añade un catalizador que acelera la reacción.',
    ]
    const built = buildMultipleChoiceOptions(authority(shortCanonical, []), longerDistractors, 'seed-2')
    assert.ok(built, 'a short correct answer next to longer distractors still builds')
    const correctText = built!.options[built!.correctAnswer]
    assert.equal(correctText, shortCanonical)
    const isLongest = built!.options.every(option => option.length <= correctText.length)
    assert.ok(!isLongest, 'the short correct answer is not the longest option')
  }

  // 3. Natural length variation (not identical, not extreme) is allowed.
  {
    const canonical = 'X'.repeat(120)
    const distractors = ['Y'.repeat(90), 'Z'.repeat(105), 'W'.repeat(125)]
    const built = buildMultipleChoiceOptions(authority(canonical, []), distractors, 'seed-3')
    assert.ok(built, 'natural length variation (90/105/120/125 chars) is accepted, not normalized')
    assert.deepEqual(new Set(built!.options), new Set([canonical, ...distractors]), 'options are used verbatim, no length normalization')
  }

  // 4. Extreme/systematic correct-answer length giveaways are rejected.
  {
    const canonical = 'A'.repeat(260)
    const distractors = ['b'.repeat(70), 'c'.repeat(68), 'd'.repeat(72)]
    const built = buildMultipleChoiceOptions(authority(canonical, []), distractors, 'seed-4')
    assert.equal(built, null, 'an extreme length outlier correct answer is rejected, not silently accepted')
    // Direct heuristic confirmation on the same shape.
    assert.equal(mcqHasLengthLeak([canonical, ...distractors], 0), true)
  }

  // 5. Plausible distractors (conceptually related, not gibberish) are
  // preserved as-is — the composer never mutates distractor content.
  {
    const canonical = 'La reacción es endotérmica y absorbe calor del entorno.'
    const plausible = [
      'La reacción es exotérmica y absorbe calor del entorno.', // reversed exo/endo — plausible conceptual mistake
      'La reacción es endotérmica y libera calor al entorno.', // confuses absorb/release
      'La reacción es exotérmica y libera calor al entorno.',
    ]
    const built = buildMultipleChoiceOptions(authority(canonical, []), plausible, 'seed-5')
    assert.ok(built)
    for (const distractor of plausible) assert.ok(built!.options.includes(distractor), 'plausible conceptual-mistake distractors are preserved verbatim')
  }

  // 6. Grouped/multi-target MCQs (groupSize > 1) remain readable —
  // joined text is complete, no truncation, still passes the leak
  // check when specificity is comparable across the join.
  {
    const canonical = ['Kc es la constante de equilibrio en concentraciones.', 'Kp es la constante de equilibrio en presiones parciales.'].join('\n')
    const pool = [
      'Δn es la diferencia de moles gaseosos entre productos y reactivos.',
      'R es la constante universal de los gases ideales.',
      'T es la temperatura absoluta en Kelvin.',
      'Kp = Kc(RT)^Δn relaciona ambas constantes de equilibrio.',
    ]
    const built = buildMultipleChoiceOptions(authority(canonical, []), pool, 'seed-6')
    assert.equal(built, null, 'a multi-proposition canonical answer cannot be forced into a single MCQ decision')
  }

  // 7. No systematic "longest answer = correct" pattern across a
  // generated fixture set with naturally varied content lengths.
  {
    const cases: Array<{ correctIsLongest: boolean }> = []
    for (let i = 0; i < 20; i++) {
      // Alternate which side is verbose so real content naturally varies —
      // mirrors how canonical Enjoyer targets differ in length from topic
      // to topic, not a fixed short-correct/long-distractor rule.
      const verboseCorrect = i % 2 === 0
      const canonical = verboseCorrect
        ? `Explicación número ${i} con desarrollo académico sobre el concepto evaluado en este caso.`
        : `Concepto ${i} correcto y suficiente.`
      const distractors = verboseCorrect
        ? [
          `Idea ${i}a relacionada pero incorrecta en este caso concreto.`,
          `Idea ${i}b que invierte la relación causal esperada.`,
          `Idea ${i}c que confunde una condición distinta del fenómeno.`,
        ]
        : [
          `Concepto ${i}a alternativo pero incorrecto en este caso.`,
          `Concepto ${i}b que aplica la regla en la condición equivocada.`,
          `Concepto ${i}c que confunde causa y consecuencia aquí.`,
        ]
      const built = buildMultipleChoiceOptions(authority(canonical, []), distractors, `seed-batch-${i}`)
      if (!built) continue
      const correctText = built.options[built.correctAnswer]
      const isLongest = built.options.every(option => option.length <= correctText.length)
      cases.push({ correctIsLongest: isLongest })
    }
    assert.ok(cases.length >= 15, 'enough generated questions survived to evaluate the pattern')
    const longestCount = cases.filter(c => c.correctIsLongest).length
    const longestRate = longestCount / cases.length
    assert.ok(longestRate > 0.05 && longestRate < 0.95,
      `correct-is-longest rate (${(longestRate * 100).toFixed(0)}%) must not be a systematic pattern in either direction`)
  }

  console.log('mcq-quality-contracts: ALL PASS')
}

main()
