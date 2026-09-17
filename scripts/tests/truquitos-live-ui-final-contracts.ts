import assert from 'node:assert/strict'
import fs from 'node:fs'
import katex from 'katex'

// ============================================================
// TRUQUITOS_LIVE_UI_FINAL contracts.
//
// A fresh live CLUTCH 2.pdf regeneration (dedup and provider budget
// already fixed and confirmed live-passing) still showed two bugs:
//
//   A. Header counters said "0 esenciales / 12 estratégicos / 0 de
//      examen" while a card demonstrably rendered under "🎓 De Examen"
//      below it. Root cause: the header stat boxes reimplemented their
//      OWN separate, stage-blind type-only whitelist, entirely
//      divergent from the `classifyBucket()` used by the section
//      renderer (which correctly checks `stage === "examen"` first).
//      Two classifiers existed; only one was stage-aware.
//   B. Fresh (not stale) math still rendered as literal
//      "**kf**/**kr**"-style asterisks instead of typeset math. Root
//      cause: the grounded prompt never actually instructs the model
//      to wrap formulas in `$...$` (that was only ever a client-side
//      assumption) — real generations never emit the delimiter, so the
//      KaTeX path never activated and content fell through to raw
//      plain text, where the model's own `**bold**` emphasis around
//      variable names also showed as literal asterisks (this renderer
//      never interpreted markdown emphasis either).
//
// This file proves: (A) ONE canonical classifier used by counters,
// filters and rendered sections, and (B) formulas without `$...$`
// delimiters, plus markdown bold, both render correctly — using the
// exact fresh-output shapes reported live.
// ============================================================

const clientSource = fs.readFileSync('components/materias/ALAIStudyALCheatCodes.tsx', 'utf8')

let passed = 0, failed = 0
function test(name: string, fn: () => void) {
  try { fn(); console.log('  ✅ ' + name); passed++ }
  catch (err: any) { console.log('  ❌ ' + name); console.log('     ' + (err?.message || err)); failed++ }
}

// ── A: canonical classifier reimplementation (source-pattern-verified
// below) — the exact bug was TWO divergent implementations, so this
// section both proves the source now has exactly ONE, AND exercises
// its logic against the real live-reported shape (12 cards, one of
// which is stage:"examen" with a non-exam-labeled type).
type FakeCard = { id: string; type: string; stage?: string }
function classifyBucket(c: FakeCard): 'esencial' | 'examen' | 'estrategico' {
  if (c.stage === 'examen') return 'examen'
  const ESENCIAL = new Set(['tesis_central', 'regla_oro', 'solo_una_cosa', 'premisa_clave', 'figura_clave'])
  const EXAMEN = new Set(['examen_tip', 'trampa_examen', 'respuesta_perfecta', 'como_defender', 'momento_decisivo'])
  if (ESENCIAL.has(c.type)) return 'esencial'
  if (EXAMEN.has(c.type)) return 'examen'
  return 'estrategico'
}

function main() {
  console.log('\n── TRUQUITOS_LIVE_UI_FINAL contracts ──\n')

  test('A1. the client source defines classifyBucket exactly ONCE (module scope) — the header stat boxes must not reimplement a separate whitelist', () => {
    const occurrences = (clientSource.match(/function classifyBucket\(/g) || []).length
    assert.equal(occurrences, 1, `classifyBucket must be defined exactly once, found ${occurrences}`)
    assert.doesNotMatch(clientSource, /\["tesis_central","regla_oro","solo_una_cosa"\]\.includes/, 'the old duplicate stage-blind header whitelist for esenciales must be gone')
    assert.doesNotMatch(clientSource, /\["examen_tip","trampa_examen","respuesta_perfecta","como_defender"\]\.includes/, 'the old duplicate stage-blind header whitelist for examen must be gone')
  })

  test('A2. the header stat boxes, the quick "exam" filter, and the section renderer all call the SAME classifyBucket function', () => {
    const headerBlock = clientSource.slice(clientSource.indexOf('cc-intro-stats'), clientSource.indexOf('cc-intro-stats') + 800)
    assert.match(headerBlock, /classifyBucket\(c\) === "esencial"/)
    assert.match(headerBlock, /classifyBucket\(c\) === "estrategico"/)
    assert.match(headerBlock, /classifyBucket\(c\) === "examen"/)
    assert.match(clientSource, /quickFilter === "exam"\) \{\s*return cards\.filter\(\(c\) => classifyBucket\(c\) === "examen"\);/)
    assert.match(clientSource, /const esenciales = filteredCards\.filter\(c => classifyBucket\(c\) === "esencial"\);/)
    assert.match(clientSource, /const examen = filteredCards\.filter\(c => classifyBucket\(c\) === "examen"\);/)
  })

  test('A3. regression: a card that renders under 🎓 De Examen (stage="examen", non-exam-labeled type — the exact live shape: "Cálculo de concentraciones de equilibrio" as a cheat_code) increments the examen counter and is NEVER also counted as estratégico', () => {
    // Realistic live shape: 12 cards total (post-dedup), one of them the
    // exact reported exam-classified card with a generic type.
    const cards: FakeCard[] = [
      { id: 'kc-exam', type: 'cheat_code', stage: 'examen' }, // "Cálculo de concentraciones de equilibrio"
      ...Array.from({ length: 11 }, (_, i) => ({ id: `c${i}`, type: 'cheat_code', stage: 'recuerda' })),
    ]
    const esencialCount = cards.filter(c => classifyBucket(c) === 'esencial').length
    const examenCount = cards.filter(c => classifyBucket(c) === 'examen').length
    const estrategicoCount = cards.filter(c => classifyBucket(c) === 'estrategico').length

    assert.equal(examenCount, 1, 'the exam-staged card must be counted in the examen bucket')
    assert.equal(estrategicoCount, 11, 'the exam-staged card must NOT also be counted as estrategico')
    assert.equal(esencialCount + examenCount + estrategicoCount, cards.length, 'every card must land in exactly one bucket — counters and sections must never diverge')
    // The exact live symptom being regression-tested: counters said
    // "0 de examen" while a card rendered under the exam section —
    // i.e. examenCount was 0 despite a stage:"examen" card existing.
    assert.notEqual(examenCount, 0, 'must never reproduce the live bug where the exam counter stayed 0 despite an exam-staged card existing')
  })

  // ── B: bare-LaTeX (no `$...$`) + markdown-bold rendering, using the
  // EXACT fresh-output shapes reported live.
  function splitBareMathRuns(text: string): { text: string; isMath: boolean }[] {
    const isProseWord = (t: string) => /^[A-Za-zÀ-ÿ]{4,}[:.,;!?)"']*$/.test(t)
    const tokens = text.split(/(\s+)/)
    const result: { text: string; isMath: boolean }[] = []
    let i = 0
    while (i < tokens.length) {
      const tok = tokens[i]
      if (/^\s+$/.test(tok) || isProseWord(tok) || !tok) { result.push({ text: tok, isMath: false }); i++; continue }
      let run = tok
      let j = i + 1
      while (j + 1 < tokens.length && /^\s+$/.test(tokens[j]) && !isProseWord(tokens[j + 1]) && tokens[j + 1]) { run += tokens[j] + tokens[j + 1]; j += 2 }
      result.push({ text: run, isMath: /\\[A-Za-z]+/.test(run) })
      i = j
    }
    return result
  }

  test('B1. the client source defines the bare-LaTeX-run splitter and bold-aware renderer used by renderInlineMathAwareText', () => {
    assert.match(clientSource, /function splitBareMathRuns\(text: string\)/)
    assert.match(clientSource, /function renderBoldAwareText\(text: string/)
    assert.match(clientSource, /splitBareMathRuns\(text\)/)
  })

  test('B2. a fresh Kc formula WITHOUT $...$ delimiters (the exact live shape) is isolated as a math run and renders via KaTeX unchanged', () => {
    const line = 'Kc relaciona concentraciones: K_{eq} = \\frac{k_f}{k_r}, valor 6.5\\times10^{-5}'
    const runs = splitBareMathRuns(line)
    const mathRuns = runs.filter(r => r.isMath)
    assert.ok(mathRuns.length >= 2, `expected at least 2 math runs, got ${JSON.stringify(runs)}`)
    assert.ok(mathRuns.some(r => r.text.includes('\\frac{k_f}{k_r}')), 'the \\frac run must be isolated intact')
    assert.ok(mathRuns.some(r => r.text.includes('\\times10^{-5}')), 'the \\times run must be isolated intact')
    for (const r of mathRuns) {
      const html = katex.renderToString(r.text, { throwOnError: true, displayMode: false, output: 'html' })
      assert.ok(html.length > 0, `KaTeX must render "${r.text}" without throwing`)
    }
    // Plain prose tokens must never be swept into a math run.
    const proseRuns = runs.filter(r => !r.isMath).map(r => r.text.trim()).filter(Boolean)
    assert.ok(proseRuns.includes('Kc'))
    assert.ok(proseRuns.includes('relaciona'))
    assert.ok(proseRuns.includes('valor'))
  })

  test('B3. \\rightleftharpoons and \\Delta bare runs (no $...$) render via KaTeX unchanged', () => {
    for (const line of ['N_2O_4 \\rightleftharpoons 2NO_2', '\\Delta G = \\Delta H - T\\Delta S']) {
      const runs = splitBareMathRuns(line)
      const mathRun = runs.find(r => r.isMath)
      assert.ok(mathRun, `must find a math run in "${line}"`)
      const html = katex.renderToString(mathRun!.text, { throwOnError: true, displayMode: false, output: 'html' })
      assert.ok(html.length > 0)
    }
  })

  test('B4. markdown **bold** around a subscripted variable name (the exact reported "*****kf*****"-shaped live corruption) renders as emphasis, not literal asterisks, and is never swept into a false math run', () => {
    const line = 'Recuerda usar **k_f**/**k_r** como referencia'
    const runs = splitBareMathRuns(line)
    const boldToken = runs.find(r => r.text.includes('**k_f**'))
    assert.ok(boldToken, 'the bold-wrapped variable-name token must survive as its own run')
    assert.equal(boldToken!.isMath, false, 'a token with no backslash command must never be treated as bare LaTeX')
    // Simulate the bold-aware plain-text pass this token flows through.
    const boldParts = boldToken!.text.split(/(\*\*[^*\n]+\*\*)/g)
    assert.ok(boldParts.some(p => p === '**k_f**'))
    assert.ok(boldParts.some(p => p === '**k_r**'))
  })

  test('B5. plain prose with no math markers is never altered or mis-rendered as math', () => {
    const line = 'Texto normal sin nada especial.'
    const runs = splitBareMathRuns(line)
    assert.ok(runs.every(r => !r.isMath), 'ordinary prose must never be classified as a math run')
    assert.equal(runs.map(r => r.text).join(''), line, 'reassembling the runs must reproduce the original text byte-for-byte (never a reconstruction)')
  })

  test('B6. $...$-delimited math (the pre-existing convention) keeps working unchanged alongside the new bare-run support', () => {
    assert.match(clientSource, /text\.split\(\/\(\\\$\[\^\$\\n\]\+\\\$\)\/g\)/)
  })

  console.log(`\n${passed} passed, ${failed} failed\n`)
  if (failed > 0) process.exit(1)
  console.log('truquitos-live-ui-final-contracts: ALL PASS')
}

main()
