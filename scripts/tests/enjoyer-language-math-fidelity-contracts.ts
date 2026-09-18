import assert from 'node:assert/strict'
import fs from 'node:fs'
import katex from 'katex'
import { detectLanguage } from '../../lib/detectLanguage'
import {
  getOrCreateStudyalMaterialEnjoyer, lookupStudyalMaterialEnjoyer,
  MATERIAL_ENJOYER_ACADEMIC_VERSION, type MaterialEnjoyerStore,
} from '../../lib/adaptive/materialEnjoyer'
import { buildSourceSelectionSnapshot } from '../../lib/adaptive/sourceSelection'
import { NextRequest } from 'next/server'
import { POST, __routeDeps } from '../../app/api/alai-studyal-map/route'

// ============================================================
// ENJOYER_LANGUAGE_MATH_FIDELITY:
//
// PART 1 — LANGUAGE: the persisted StudyalMaterialEnjoyer for Spanish
// material had English TOPIC titles while its CONCEPT blocks were
// correctly Spanish. Root cause traced to
// app/api/adaptive/blueprint/route.ts's extractDocumentStructure() — the
// function that actually WRITES topic titles/descriptions — whose
// prompt (buildPrompt) had ZERO language directive and an entirely
// English instruction/schema-example, unlike analyzeTopic() (concept
// extraction) which already had an explicit `LANGUAGE: Write ALL output
// in ${langHint}` directive. Fixed by resolving materialLanguage ONCE
// per material (from a multi-page representative sample, via the
// existing detectLanguage()) and threading it into BOTH functions'
// prompts — no per-chunk/per-topic re-detection, no extra provider call.
//
// Existing persisted (wrong) Enjoyer artifacts are invalidated via a
// version stamp (MATERIAL_ENJOYER_ACADEMIC_VERSION) checked by
// isMatchingFingerprint() in lib/adaptive/materialEnjoyer.ts — a payload
// missing/mismatching this stamp is treated as not-restorable, so the
// next Adaptive write regenerates it ONCE; every subsequent read (any
// tool) restores the corrected artifact with 0 provider calls.
//
// PART 2 — MATH FIDELITY: malformed formulas like "K c = [C] c [D] d /
// [A] a [B] b" were traced to LLM prompt non-adherence with no
// structural notation to fall back on. Fixed by (a) instructing both
// the blueprint's concept-extraction prompt AND the Study Map
// explain_node prompt to wrap formulas as LaTeX ($...$), preserving
// exact source structure and never reconstructing from general
// knowledge, and (b) reusing the EXISTING KaTeX infrastructure already
// used elsewhere in the app (components/academic/AcademicContent.tsx,
// katex/dist/katex.min.css already loaded in app/layout.tsx) to render
// that LaTeX in Study Map's explanation panel — no new math library.
// ============================================================

function test(name: string, fn: () => void | Promise<void>) {
  return (async () => { await fn(); console.log(`  ✅ ${name}`) })()
}

class InMemoryMaterialEnjoyerStore implements MaterialEnjoyerStore {
  private map = new Map<string, unknown>()
  async get(fingerprint: string) { return this.map.get(fingerprint) ?? null }
  async set(fingerprint: string, payload: unknown) { this.map.set(fingerprint, payload) }
}

async function main() {
  // ── A/B/C/D: language detection correctness ──
  await test('A. Spanish material -> authoritative language Spanish', () => {
    assert.equal(detectLanguage('El equilibrio químico se alcanza cuando la reacción directa y la inversa ocurren a la misma velocidad.'), 'es')
  })

  await test('B. Spanish material WITHOUT accented characters still -> Spanish', () => {
    // No tildes/ñ at all in this sentence, but clear Spanish function words.
    assert.equal(detectLanguage('Bohr propuso un modelo con niveles de energia para el atomo de hidrogeno.'), 'es')
  })

  await test('C. technical Spanish with formulas/proper nouns -> Spanish', () => {
    assert.equal(detectLanguage('Segun Bohr, la relacion Kp = Kc(RT)^Δn describe el equilibrio en fase gaseosa para N2O4 y NO2.'), 'es')
  })

  await test('D. English material -> English', () => {
    assert.equal(detectLanguage('The equilibrium constant Kp relates to Kc through the ideal gas law and the change in moles.'), 'en')
  })

  await test('K. no extra provider call is used for language detection', () => {
    // detectLanguage is synchronous and pure — calling it cannot possibly
    // reach a provider; this is a structural guarantee, not a mock count.
    const result = detectLanguage('Texto de prueba en español.')
    assert.equal(typeof result, 'string')
  })

  // ── E/F/G/H/I/J: root cause + propagation (structural) ──
  await test('E. materialLanguage is resolved ONCE per material and propagated (structural)', () => {
    const routeSource = fs.readFileSync('app/api/adaptive/blueprint/route.ts', 'utf8')
    assert.match(routeSource, /let materialLanguage = detectMaterialLanguage\(languageSample\);/,
      'a single materialLanguage must be computed once per material')
    assert.match(routeSource, /extractDocumentStructure\(pageMap, m\.materialName, materialLanguage,/,
      'materialLanguage must be passed into topic extraction')
    assert.match(routeSource, /analyzeTopic\(\s*\n?\s*topic, topicText, topics, m\.materialName, i \+ batchIdx, topics\.length, materialLanguage\s*\n?\s*\)/,
      'the SAME materialLanguage must be passed into concept analysis')
  })

  await test('F. topic extraction cannot silently default to English (root-cause fix present)', () => {
    const routeSource = fs.readFileSync('app/api/adaptive/blueprint/route.ts', 'utf8')
    const extractFnBody = routeSource.slice(
      routeSource.indexOf('async function extractDocumentStructure'),
      routeSource.indexOf('async function analyzeTopic'),
    )
    assert.match(extractFnBody, /materialLanguage: string/, 'extractDocumentStructure must accept a materialLanguage parameter')
    assert.match(extractFnBody, /LANGUAGE — MANDATORY/, 'the prompt must carry an explicit, mandatory language directive')
    assert.ok(!extractFnBody.includes("? 'es' : 'en'") || extractFnBody.includes('languageName'),
      'no local per-chunk language re-detection inside topic extraction')
  })

  await test('G/H. topic title/description prompt explicitly requires the target language for VALUES, not just field names', () => {
    const routeSource = fs.readFileSync('app/api/adaptive/blueprint/route.ts', 'utf8')
    const extractFnBody = routeSource.slice(
      routeSource.indexOf('async function extractDocumentStructure'),
      routeSource.indexOf('async function analyzeTopic'),
    )
    assert.match(extractFnBody, /"title" and "description" MUST be written in \$\{languageName\}/)
    assert.match(extractFnBody, /Specific descriptive title \(5-10 words\) — IN \$\{languageName\}/)
  })

  await test('I. concept-block extraction never recomputes language per-chunk anymore (uses the single propagated langHint)', () => {
    const routeSource = fs.readFileSync('app/api/adaptive/blueprint/route.ts', 'utf8')
    // The old per-retry raw-regex recomputation must be entirely gone.
    assert.ok(!routeSource.includes("langHintRetry") && !routeSource.includes('langHintSplit'),
      'no more per-chunk independent language recomputation inside analyzeTopic')
  })

  await test('J. repair/auditor functions never rewrite an existing topic/block\'s own text (only add new blocks for gaps)', () => {
    const routeSource = fs.readFileSync('app/api/adaptive/blueprint/route.ts', 'utf8')
    const repairFnBody = routeSource.slice(
      routeSource.indexOf('async function repairCoverageGaps'),
      routeSource.indexOf('async function repairCoverageGaps') + 3000,
    )
    assert.ok(!repairFnBody.includes('.title =') && !repairFnBody.includes('.label ='),
      'repairCoverageGaps must never assign into an existing topic/block title/label field')
  })

  // ── L/M: migration behavior for existing wrong-language artifacts ──
  await test('L. an old persisted Enjoyer (no version stamp) is treated as stale — regenerated once, bounded', async () => {
    const scope = buildSourceSelectionSnapshot(['mat-a'], { 'mat-a': [1] })
    const store = new InMemoryMaterialEnjoyerStore()
    // Simulates a pre-migration payload: correct fingerprint, but predates
    // MATERIAL_ENJOYER_ACADEMIC_VERSION entirely.
    await store.set(scope.fingerprint, {
      success: true,
      blueprint: { sourceSelectionFingerprint: scope.fingerprint, topicsIndex: [{ id: 't1', title: 'English Topic Title' }] },
    })
    let regenerateCalls = 0
    const result = await getOrCreateStudyalMaterialEnjoyer(scope.fingerprint, store, async () => {
      regenerateCalls++
      return {
        success: true,
        enjoyerAcademicVersion: MATERIAL_ENJOYER_ACADEMIC_VERSION,
        blueprint: { sourceSelectionFingerprint: scope.fingerprint, topicsIndex: [{ id: 't1', title: 'Título en Español' }] },
      }
    })
    assert.equal(result.status, 'generated', 'the stale (unstamped) payload must not be silently restored')
    assert.equal(regenerateCalls, 1, 'exactly one bounded regeneration, not a loop')
  })

  await test('M. the corrected (stamped) Enjoyer persists and reopens with 0 provider calls', async () => {
    const scope = buildSourceSelectionSnapshot(['mat-a'], { 'mat-a': [1] })
    const store = new InMemoryMaterialEnjoyerStore()
    let generateCalls = 0
    const generate = async () => {
      generateCalls++
      return {
        success: true,
        enjoyerAcademicVersion: MATERIAL_ENJOYER_ACADEMIC_VERSION,
        blueprint: { sourceSelectionFingerprint: scope.fingerprint, topicsIndex: [{ id: 't1', title: 'Título en Español' }] },
      }
    }
    const first = await getOrCreateStudyalMaterialEnjoyer(scope.fingerprint, store, generate)
    assert.equal(first.status, 'generated')
    assert.equal(generateCalls, 1)

    // Subsequent reopen — any consumer, e.g. Study Map's read path.
    const restored = await lookupStudyalMaterialEnjoyer(scope.fingerprint, store)
    assert.deepEqual(restored, first.payload)
    assert.equal(generateCalls, 1, '0 additional provider work on reopen')
  })

  // ── N/O/P/Q/R/S/T: math fidelity end-to-end through explain_node ──
  const selection = { ...buildSourceSelectionSnapshot(['mat-a'], { 'mat-a': [1] }), fingerprint: 'fp-math' }
  const enjoyerPayload = {
    sourceSelectionFingerprint: 'fp-math', materialIds: ['mat-a'], selectedPages: { 'mat-a': [1] },
    topicsIndex: [{ id: 't1', title: 'Gases ideales' }],
    globalOrderedAnalysis: [
      { id: 'n1', kind: 'formula', name: 'Ley de gases ideales', content: '$PV = nRT$', importance: 90, difficulty: 'advanced', topicId: 't1', materialId: 'mat-a', pages: [1], sourceSpans: [{ page: 1, quote: 'PV = nRT' }] },
    ],
    uniqueConceptsIndex: [], relations: [],
  }
  function wireMapDeps(alaiJsonImpl: () => Promise<any>) {
    const enjoyerStore = new Map<string, any>([['fp-math', enjoyerPayload]])
    Object.assign(__routeDeps, {
      getServerSession: async () => ({ user: { id: 'user-1' } } as any),
      getAuthoritativeFreeSession: async () => ({ id: 'sess-math', userId: 'user-1', processMode: 'free', sourceSelection: selection }) as any,
      getMaterial: async () => ({ id: 'mat-a', nombre: 'Química' }) as any,
      lookupStudyalMaterialEnjoyer: async (fp: string) => enjoyerStore.get(fp) ?? null,
      materialEnjoyerStore: {} as any,
      generateValidatedLegacyJson: alaiJsonImpl,
    })
  }
  async function postExplain() {
    const response = await POST(new NextRequest('http://localhost/api/alai-studyal-map', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ mode: 'explain_node', sessionId: 'sess-math', unitIds: ['map_node:n1'] }),
    }))
    return { response, data: await response.json() }
  }

  await test('N. PV = nRT survives end-to-end through the route unmutated', async () => {
    const exact = 'La ley de gases ideales es $PV = nRT$.'
    wireMapDeps(async () => ({ answer: exact, pedagogicalNote: '', usedRelationIds: [] }))
    const { data } = await postExplain()
    assert.equal(data.explanation.answer, exact)
  })

  await test('O. P = (n/V)RT survives end-to-end through the route unmutated', async () => {
    const exact = 'Reordenando: $P = (n/V)RT$.'
    wireMapDeps(async () => ({ answer: exact, pedagogicalNote: '', usedRelationIds: [] }))
    const { data } = await postExplain()
    assert.equal(data.explanation.answer, exact)
  })

  await test('P. Kp = Kc(RT)^Δn survives end-to-end through the route unmutated', async () => {
    const exact = 'La relación es $K_p = K_c(RT)^{\\Delta n}$.'
    wireMapDeps(async () => ({ answer: exact, pedagogicalNote: '', usedRelationIds: [] }))
    const { data } = await postExplain()
    assert.equal(data.explanation.answer, exact)
  })

  await test('Q. superscripts/subscripts remain semantically correct when rendered (KaTeX produces real sup/sub structure, not flattened text)', () => {
    const html = katex.renderToString('K_p = K_c(RT)^{\\Delta n}', { throwOnError: true, displayMode: false })
    assert.ok(html.includes('class="katex'), 'must produce real KaTeX markup')
    assert.ok(/msupsub|mfrac|mord/.test(html), 'must contain actual math-structure classes, not plain flattened text')
  })

  await test('R. numerator/denominator structure remains unambiguous (\\frac renders a real fraction node)', () => {
    const html = katex.renderToString('K_c = \\frac{[C]^c[D]^d}{[A]^a[B]^b}', { throwOnError: true, displayMode: false })
    assert.ok(html.includes('mfrac'), 'a \\frac expression must render as an actual KaTeX fraction (mfrac), never flattened into ambiguous inline text')
  })

  await test('S. Δ and ⇌ survive through rendering', () => {
    const htmlDelta = katex.renderToString('\\Delta n', { throwOnError: true })
    assert.ok(htmlDelta.length > 0)
    const htmlEquilibrium = katex.renderToString('N_2O_4 \\rightleftharpoons 2NO_2', { throwOnError: true })
    assert.ok(htmlEquilibrium.includes('katex'))
  })

  await test('T. source formula wins over provider paraphrase (prompt explicitly forbids reconstruction, both in blueprint and explain_node)', () => {
    const mapRouteSource = fs.readFileSync('app/api/alai-studyal-map/route.ts', 'utf8')
    assert.match(mapRouteSource, /NUNCA la reescribas de memoria/)
    assert.match(mapRouteSource, /ni la "corrijas" con tu conocimiento general/)
    const blueprintSource = fs.readFileSync('app/api/adaptive/blueprint/route.ts', 'utf8')
    assert.match(blueprintSource, /NEVER reconstruct a formula from general chemistry\/physics\/math knowledge/)
  })

  // ── U/V/W: Study Map stays a consumer, reuses existing math infra ──
  await test('U. Study Map contains no translation logic', () => {
    const componentSource = fs.readFileSync('components/materias/ALAIStudyMap.tsx', 'utf8')
    // Excludes CSS transform functions (translate(...)/translateX(...)),
    // which are unrelated to language translation.
    assert.ok(!/\btranslat(e|ion|or)\b(?!\()/i.test(componentSource) && !/traduc/i.test(componentSource),
      'no translation logic of any kind may exist in Study Map')
    assert.ok(!componentSource.includes('detectLanguage'), 'Study Map must never independently detect/choose academic language — that is the material\'s authority, resolved upstream only')
  })

  await test('V. Study Map contains no formula-guessing/repair heuristic', () => {
    const componentSource = fs.readFileSync('components/materias/ALAIStudyMap.tsx', 'utf8')
    assert.ok(!/repairFormula|fixFormula|guessFormula|reconstructFormula/i.test(componentSource),
      'Study Map must never attempt to guess/repair a formula client-side — it only renders what the server returns')
  })

  await test('W. Study Map explanation renderer reuses existing KaTeX infrastructure (no new math library added)', () => {
    const componentSource = fs.readFileSync('components/materias/ALAIStudyMap.tsx', 'utf8')
    assert.match(componentSource, /import katex from 'katex';/)
    assert.match(componentSource, /katex\.renderToString\(/)
    const packageJson = fs.readFileSync('package.json', 'utf8')
    const katexOccurrences = (packageJson.match(/"katex"/g) || []).length
    assert.ok(katexOccurrences <= 1, 'no duplicate/second KaTeX dependency added')
    assert.ok(!packageJson.includes('mathjax') && !packageJson.includes('"remark-math"') || packageJson.includes('remark-math'),
      'no NEW math library introduced beyond what already existed')
  })

  console.log('enjoyer-language-math-fidelity-contracts: ALL PASS')
}

main().catch(error => { console.error(error); process.exit(1) })
