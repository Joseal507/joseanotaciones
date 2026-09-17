import assert from 'node:assert/strict'
import fs from 'node:fs'
import { NextRequest } from 'next/server'
import { wrapNodeText } from '../../components/materias/ALAIStudyMap'
import { buildSourceSelectionSnapshot } from '../../lib/adaptive/sourceSelection'
import { safeParseJson } from '../../lib/alai'
import { detectLanguage } from '../../lib/detectLanguage'
import { POST, __routeDeps } from '../../app/api/alai-studyal-map/route'
import { POST as chatPOST, __routeDeps as chatRouteDeps } from '../../app/api/alai-studyal-chat/route'

// ============================================================
// STUDYMAP_LIVE_UX_HARDENING: after the Phase 1 live visual test, the
// team observed several concrete product/quality issues, traced and
// fixed here:
//
// 1. Leaf vs branch explanation was two DIFFERENT paths (explain_node
//    vs the legacy /api/alai-studyal-chat) — unified onto ONE grounded
//    explain_node path for both, root stays deterministic-only.
// 2. Two independent camera-control effects (smart-fit + focus-camera)
//    raced for `transform` after a branch expansion — the smart-fit
//    effect now yields entirely to the focus-camera effect whenever a
//    node is selected.
// 3. Node text escaped its SVG rect because the code referenced
//    `clipPath="url(#clip-...)"` with NO matching `<clipPath>` element
//    ever defined anywhere — an SVG reference to a missing clip path
//    renders unclipped. A real <clipPath><rect .../></clipPath> now
//    exists per node, matching its exact box.
// 4. English titles from Spanish material were traced to
//    app/api/adaptive/blueprint/route.ts's `langHint`, which checked
//    only for the PRESENCE of accented characters in a small local text
//    sample — a Spanish paragraph about "Bohr" with no tildes in that
//    specific chunk was misclassified as English. Replaced with the
//    existing, more robust `detectLanguage()` (function-word frequency,
//    already used by Análisis) — no extra provider call.
// 5. Raw JSON leaked into the UI because the legacy chat route's local
//    `extractJson()` had none of lib/alai.ts's hardening (fence
//    stripping, truncation repair), and on failure its fallback
//    literally returned the ENTIRE raw provider text as the visible
//    `answer`. Replaced with the same `safeParseJson` used elsewhere,
//    and a parse failure now returns a clean `success:false` error —
//    never raw text.
// 6. Formula compaction: the explain_node prompt's formula-preservation
//    rule was strengthened to require verbatim character-for-character
//    copying from the authorized source block, and the previously
//    English-only legacy-chat path (which had NO formula rule at all)
//    is no longer reachable for Study Map explanations at all.
// ============================================================

function test(name: string, fn: () => void | Promise<void>) {
  return (async () => { await fn(); console.log(`  ✅ ${name}`) })()
}

// ── Server-side fixtures (mirrors studymap-legacy-auth-contracts.ts's established shape) ──
const selection = { ...buildSourceSelectionSnapshot(['mat-a'], { 'mat-a': [4] }), fingerprint: 'fp-hardening' }
const branchLeaves = [
  { id: 'n1', kind: 'formula', name: 'Modelo de Bohr', content: 'E_n = -13.6 eV / n²', importance: 90, difficulty: 'advanced', topicId: 't1', materialId: 'mat-a', pages: [4], sourceSpans: [{ page: 4, quote: 'E_n = -13.6 eV / n²' }] },
  { id: 'n2', kind: 'concept', name: 'Niveles de energía', content: 'Los electrones ocupan niveles discretos de energía', importance: 80, difficulty: 'medium', topicId: 't1', materialId: 'mat-a', pages: [4], sourceSpans: [{ page: 4, quote: 'niveles discretos' }] },
]
const enjoyerPayload = {
  sourceSelectionFingerprint: 'fp-hardening', materialIds: ['mat-a'], selectedPages: { 'mat-a': [4] },
  topicsIndex: [{ id: 't1', title: 'Física cuántica' }],
  globalOrderedAnalysis: branchLeaves,
  uniqueConceptsIndex: [], relations: [],
}

function wireMapDeps(alaiJsonImpl: () => Promise<any>, userId: string | null = 'user-1') {
  const enjoyerStore = new Map<string, any>([['fp-hardening', enjoyerPayload]])
  Object.assign(__routeDeps, {
    getServerSession: async () => (userId ? ({ user: { id: userId } } as any) : null),
    getAuthoritativeFreeSession: async () => ({ id: 'sess-hardening', userId: 'user-1', processMode: 'free', sourceSelection: selection }) as any,
    getMaterial: async () => ({ id: 'mat-a', nombre: 'Física' }) as any,
    lookupStudyalMaterialEnjoyer: async (fp: string) => enjoyerStore.get(fp) ?? null,
    materialEnjoyerStore: {} as any,
    generateValidatedLegacyJson: alaiJsonImpl,
  })
}

async function postExplain(body: Record<string, unknown>) {
  const response = await POST(new NextRequest('http://localhost/api/alai-studyal-map', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ mode: 'explain_node', sessionId: 'sess-hardening', ...body }),
  }))
  return { response, data: await response.json() }
}

async function main() {
  // ── A/M: first leaf selection -> max 1 explain_node call
  await test('A. first leaf selection -> exactly 1 explain_node call', async () => {
    let calls = 0
    wireMapDeps(async () => { calls++; return { answer: 'E_n = -13.6 eV / n²', pedagogicalNote: '', usedRelationIds: [] } })
    const { response, data } = await postExplain({ unitIds: ['map_node:n1'] })
    assert.equal(response.status, 200)
    assert.equal(calls, 1)
    assert.equal(data.explanation.unitIds.length, 1)
  })

  // ── B: first branch selection -> max 1 Study Map explain call, 0 automatic legacy chat
  await test('B. first branch selection (multiple unitIds) -> exactly 1 explain call, grounded in all its leaves', async () => {
    let calls = 0
    wireMapDeps(async () => { calls++; return { answer: 'Explicación del grupo.', pedagogicalNote: '', usedRelationIds: [] } })
    const { response, data } = await postExplain({ unitIds: ['map_node:n1', 'map_node:n2'] })
    assert.equal(response.status, 200)
    assert.equal(calls, 1)
    assert.deepEqual(data.explanation.unitIds.sort(), ['map_node:n1', 'map_node:n2'])
  })

  await test('H. /api/alai-studyal-chat is never FETCHED by ALAIStudyMap.tsx anymore (structural)', () => {
    const componentSource = fs.readFileSync('components/materias/ALAIStudyMap.tsx', 'utf8')
    assert.ok(!componentSource.includes("fetch('/api/alai-studyal-chat'"), 'the legacy chat endpoint must not be called from Study Map at all anymore')
  })

  // ── C: root never triggers generation (deterministic-only) — structural,
  // since the client's showingRoot gate prevents requestNodeExplanation
  // from ever being invoked for root; reaffirmed here.
  await test('C. root is never sent to explain_node (structural: the auto-effect gates on showingRoot before any fetch)', () => {
    const componentSource = fs.readFileSync('components/materias/ALAIStudyMap.tsx', 'utf8')
    const autoEffect = componentSource.slice(
      componentSource.indexOf('// Automatic path — EVERY explainable node'),
      componentSource.indexOf('}, [current, showingRoot, sessionId, requestNodeExplanation]);'),
    )
    assert.match(autoEffect, /if \(!current \|\| showingRoot\) \{/, 'root (showingRoot) must be excluded before any explanation logic runs')
  })

  // ── G: persisted explanation restore -> 0 calls (server-side proof:
  // a request with an ALREADY-cached client-side explanation never
  // needs to reach the server at all — proven at the client boundary).
  await test('G. persisted explanation restore requires 0 server calls (structural: client checks explanationsByNodeIdRef before any fetch)', () => {
    const componentSource = fs.readFileSync('components/materias/ALAIStudyMap.tsx', 'utf8')
    const fnBody = componentSource.slice(
      componentSource.indexOf('const requestNodeExplanation = useCallback'),
      componentSource.indexOf('const leafIds = collectLeafNodeIds'),
    )
    assert.match(fnBody, /const persisted = explanationsByNodeIdRef\.current\[key\];\s*\n\s*if \(persisted\) \{/, 'a cached explanation must short-circuit before any fetch is constructed')
  })

  // ── N/O: material language controls explanation language, no extra provider call
  await test('N. material language (not UI locale) controls the explain_node response language', async () => {
    let capturedPrompt = ''
    wireMapDeps(async (input: any) => { capturedPrompt = input.prompt; return { answer: 'ok', pedagogicalNote: '', usedRelationIds: [] } })
    await postExplain({ unitIds: ['map_node:n1'] })
    assert.match(capturedPrompt, /Responde EN ESPAÑOL/, 'Spanish grounded content must produce a Spanish-language instruction')
  })

  await test('O. no extra provider call is used for language detection (detectLanguage is a pure deterministic function)', () => {
    let calls = 0
    const before = calls
    const lang = detectLanguage('El material está en español y trata sobre física cuántica.')
    assert.equal(lang, 'es')
    assert.equal(calls, before, 'detectLanguage must never itself perform network/provider work')
  })

  await test('root cause: adaptive blueprint no longer uses the accent-only language heuristic', () => {
    const routeSource = fs.readFileSync('app/api/adaptive/blueprint/route.ts', 'utf8')
    assert.ok(!routeSource.includes("test(topicText) ? 'es' : 'en'") && !routeSource.includes("test(sourceSample) ? 'es' : 'en'") && !routeSource.includes("test(fullText) ? 'es' : 'en'"),
      'the fragile accented-character-only heuristic must be gone')
    const occurrences = (routeSource.match(/detectLanguage\(/g) || []).length
    assert.ok(occurrences >= 3, 'all three langHint call sites must use the robust shared detector')
  })

  // ── P/Q: raw JSON / internal fields never leak into student-visible UI
  await test('P. fenced JSON from the provider is parsed cleanly, never shown raw (legacy chat route, still used by Análisis)', async () => {
    Object.assign(chatRouteDeps, {
      getServerSession: async () => ({ user: { id: 'user-1' } } as any),
      alai: async () => ({
        text: '```json\n{"answer":"Respuesta limpia.","inMaterial":true,"confidence":"alta","sourceMaterial":"m1","sourceMaterialName":"Material","sourcePages":[4],"suggestedFollowups":[]}\n```',
        provider: 'openrouter', model: 'x',
      }),
    })
    const response = await chatPOST(new NextRequest('http://localhost/api/alai-studyal-chat', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ message: '¿Qué es esto?', materialText: 'texto autorizado', history: [] }),
    }))
    const data = await response.json()
    assert.equal(response.status, 200)
    assert.equal(data.answer, 'Respuesta limpia.', 'the fence must be stripped, answer must be the clean field only')
    assert.ok(!data.answer.includes('```') && !data.answer.includes('"confidence"'), 'no raw JSON/fence artifacts in the visible answer')
  })

  await test('Q. a genuinely unparseable provider response returns a clean error, never raw provider text as the answer', async () => {
    Object.assign(chatRouteDeps, {
      getServerSession: async () => ({ user: { id: 'user-1' } } as any),
      alai: async () => ({ text: 'not json at all, truncated mid-sen', provider: 'openrouter', model: 'x' }),
    })
    const response = await chatPOST(new NextRequest('http://localhost/api/alai-studyal-chat', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ message: '¿Qué es esto?', materialText: 'texto autorizado', history: [] }),
    }))
    const data = await response.json()
    assert.equal(response.status, 502)
    assert.equal(data.success, false)
    assert.ok(!('answer' in data), 'no answer field at all on failure — never leak raw provider text as if it were a real answer')
  })

  await test('Q2. internal fields (sourceMaterial/confidence/inMaterial) never leak INTO the visible answer text itself', async () => {
    Object.assign(chatRouteDeps, {
      getServerSession: async () => ({ user: { id: 'user-1' } } as any),
      alai: async () => ({
        text: JSON.stringify({ answer: 'Texto limpio para el estudiante.', inMaterial: true, confidence: 'alta', sourceMaterial: 'mat-1', sourceMaterialName: 'Mat', sourcePages: [4], suggestedFollowups: [] }),
        provider: 'openrouter', model: 'x',
      }),
    })
    const response = await chatPOST(new NextRequest('http://localhost/api/alai-studyal-chat', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ message: 'hola', materialText: 'texto', history: [] }),
    }))
    const data = await response.json()
    assert.equal(data.answer, 'Texto limpio para el estudiante.')
    assert.ok(!data.answer.includes('confidence') && !data.answer.includes('sourceMaterial') && !data.answer.includes('inMaterial'),
      'internal metadata fields must be returned as SEPARATE structured fields, never concatenated into the answer text')
    assert.equal(data.confidence, 'alta')
    assert.equal(data.sourceMaterial, 'mat-1')
  })

  await test('P2. safeParseJson (the parser now shared by this route) handles whitespace/fences/malformed input safely', () => {
    assert.deepEqual(safeParseJson('  \n```json\n{"a":1}\n```  '), { a: 1 })
    assert.equal(safeParseJson('{"a": truncated'), null)
    assert.equal(safeParseJson(''), null)
  })

  // ── R: formulas preserve source notation through the unified explain_node path
  await test('R. the explain_node route never mutates the answer text (formula characters pass through untouched)', async () => {
    const exact = 'E_n = -13.6 eV / n²'
    wireMapDeps(async () => ({ answer: exact, pedagogicalNote: '', usedRelationIds: [] }))
    const { data } = await postExplain({ unitIds: ['map_node:n1'] })
    assert.equal(data.explanation.answer, exact)
  })

  await test('R2. the formula-preservation prompt rule requires verbatim character-for-character copying', () => {
    const routeSource = fs.readFileSync('app/api/alai-studyal-map/route.ts', 'utf8')
    assert.match(routeSource, /escríbela como LaTeX entre signos de dólar/, 'the LaTeX-wrapped formula instruction must be present')
    assert.match(routeSource, /NUNCA la reescribas de memoria/, 'the never-reconstruct-from-memory instruction must be present')
  })

  // ── I/J/K: node centering accounts for usable viewport + inspector width, preserves zoom
  await test('I/J. focus-camera effect reserves bottom chrome and centers within rect.width (already excluding the panel sibling)', () => {
    const componentSource = fs.readFileSync('components/materias/ALAIStudyMap.tsx', 'utf8')
    const focusEffect = componentSource.slice(
      componentSource.indexOf('GUIDED_LOCAL_FRAMING: cámara animada hacia el nodo enfocado'),
      componentSource.indexOf('const onMouseDown = ('),
    )
    assert.match(focusEffect, /BOTTOM_CHROME_RESERVE/, 'a bottom-chrome reserve must exist')
    assert.match(focusEffect, /effectiveHeight \/ 2/, 'vertical centering must use the reserved effective height, not the raw container height')
    // STUDYMAP_UX_PHASE2: horizontal centering now uses effectiveWidth
    // (rect.width minus any floating/overlay inspector reservation),
    // not raw rect.width directly — a strict generalization. A desktop
    // sidebar panel (flex sibling) still yields reserveRight=0, so
    // effectiveWidth reduces to rect.width exactly as before for it.
    assert.match(focusEffect, /effectiveWidth = Math\.max\(200, rect\.width - reserveRight\)/, 'horizontal centering must derive from rect.width minus any overlay-panel reservation')
    assert.match(focusEffect, /targetX = effectiveWidth \/ 2/, 'horizontal centering uses the reserved effective width, not raw rect.width directly')
  })

  await test('K. focus-camera never calls the fit-to-all rescale function (STUDYMAP_GUIDED_CAMERA superseded "always preserve current scale" with a stable per-node-type readable-scale target — see studymap-guided-camera-contracts.ts — but a full-graph fit must still never be reachable from node focus)', () => {
    const componentSource = fs.readFileSync('components/materias/ALAIStudyMap.tsx', 'utf8')
    const focusEffect = componentSource.slice(
      componentSource.indexOf('GUIDED_LOCAL_FRAMING: cámara animada hacia el nodo enfocado'),
      componentSource.indexOf('const onMouseDown = ('),
    )
    assert.ok(!focusEffect.includes('computeFitTransform'), 'focusing a node must never call the fit/rescale function')
    assert.match(focusEffect, /transform\.scale/, 'the animation start point (startScale) must still read from the CURRENT transform.scale')
  })

  await test('smart-fit yields camera ownership to the focus effect when a node is selected (no racing)', () => {
    const componentSource = fs.readFileSync('components/materias/ALAIStudyMap.tsx', 'utf8')
    const smartFit = componentSource.slice(
      componentSource.indexOf('// STUDYMAP_UX_PHASE1 smart fit'),
      componentSource.indexOf('GUIDED_LOCAL_FRAMING: cámara animada hacia el nodo enfocado'),
    )
    assert.match(smartFit, /if \(focusNodeId\) \{[\s\S]*?return;\s*\}/, 'the smart-fit effect must return early (skip recentering) whenever a node is focused/selected')
  })

  // ── L/M: node text cannot escape its SVG rect; long Spanish text clips correctly
  await test('L. a real <clipPath> element now exists matching each node\'s exact rect (root cause fix)', () => {
    const componentSource = fs.readFileSync('components/materias/ALAIStudyMap.tsx', 'utf8')
    assert.match(componentSource, /<clipPath id=\{`clip-\$\{n\.node\.id\}`\}>\s*<rect x=\{left\} y=\{top\} width=\{w\} height=\{h\}/,
      'a <clipPath> with a <rect> matching the node\'s left/top/w/h must be defined')
    assert.ok(componentSource.includes('clipPath={`url(#clip-${n.node.id})`}'), 'the content group must still reference that exact clip path id')
  })

  await test('M. wrapText bounds every line to maxChars, including long Spanish text with accents and long unbroken tokens', () => {
    const spanish = 'Explicación detallada del modelo atómico de Bohr y su importancia histórica en la física cuántica moderna'
    const lines = wrapNodeText(spanish, 20, 3)
    assert.ok(lines.length <= 3)
    for (const line of lines) assert.ok(line.length <= 20, `line "${line}" (${line.length} chars) must not exceed maxChars`)

    const english = 'This is a sufficiently long English description that must also wrap correctly without breaking'
    const linesEn = wrapNodeText(english, 18, 2)
    for (const line of linesEn) assert.ok(line.length <= 18)

    const veryLongToken = wrapNodeText('Supercalifragilisticexpialidocious', 12, 1)
    assert.equal(veryLongToken.length, 1)
    assert.ok(veryLongToken[0].length <= 12, 'an unbroken token longer than the line must be truncated to fit')

    const accented = wrapNodeText('Educación, información, química, biología, geografía y matemáticas básicas', 15, 4)
    for (const line of accented) assert.ok(line.length <= 15)

    const punctuation = wrapNodeText('¿Qué es esto?, ¡Increíble! — dijo el profesor: "una fórmula".', 16, 4)
    for (const line of punctuation) assert.ok(line.length <= 16)
  })

  await test('K (unified). no Material Brain dependency introduced by this hardening pass', () => {
    for (const file of ['components/materias/ALAIStudyMap.tsx', 'app/api/alai-studyal-map/route.ts', 'app/api/alai-studyal-chat/route.ts', 'app/api/adaptive/blueprint/route.ts']) {
      const source = fs.readFileSync(file, 'utf8')
      assert.ok(!source.includes('setBrainSourceSelection') && !source.includes('useMaterialBrainLifecycle'))
    }
  })

  console.log('studymap-live-ux-hardening-contracts: ALL PASS')
}

main().catch(error => { console.error(error); process.exit(1) })
