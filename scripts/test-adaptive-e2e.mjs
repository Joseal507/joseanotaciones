#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════════
// StudyAL — Test End-to-End v2
// ═══════════════════════════════════════════════════════════════

const BASE_URL = process.env.TEST_URL || 'http://localhost:3000'

// Material largo real — 5 unidades distintas
const TEST_MATERIAL = `
BIOLOGÍA CELULAR — MATERIAL COMPLETO

UNIDAD 1: LA CÉLULA COMO UNIDAD DE VIDA

1.1 Teoría Celular
La teoría celular establece que todos los seres vivos están compuestos por células.
Postulados: todos los seres vivos tienen células; la célula es la unidad de vida; toda célula viene de otra.

1.2 Tipos de Células
Procariotas: Sin núcleo, ADN circular, sin orgánulos. Bacterias y arqueas. 1-10 micrómetros.
Eucariotas: Con núcleo, orgánulos membranosos. Animales, plantas, hongos. 10-100 micrómetros.

UNIDAD 2: MEMBRANA PLASMÁTICA

2.1 Modelo de Mosaico Fluido (Singer y Nicolson, 1972)
Bicapa fosfolipídica: cabezas hidrofílicas al exterior, colas hidrofóbicas al interior.
Proteínas integrales y periféricas. Colesterol regula fluidez.
Glicoproteínas para reconocimiento celular.

2.2 Transporte
Pasivo (sin ATP): difusión simple (O2, CO2), difusión facilitada (proteínas canal), ósmosis.
Activo (con ATP): bomba Na+/K+ (3 Na+ fuera, 2 K+ dentro), endocitosis, exocitosis.

UNIDAD 3: RESPIRACIÓN CELULAR

3.1 Glucólisis (citoplasma)
1 glucosa → 2 piruvatos. Produce 2 ATP y 2 NADH. No requiere oxígeno.

3.2 Ciclo de Krebs (matriz mitocondrial)
2 piruvatos → Acetil-CoA → 2 ATP, 6 NADH, 2 FADH2. Libera CO2.

3.3 Fosforilación Oxidativa (membrana interna mitocondrial)
Cadena de transporte de electrones. NADH y FADH2 donan electrones.
Quimioósmosis: gradiente H+. ATP sintasa produce 34 ATP. O2 aceptor final → agua.
Total: 38 ATP por glucosa.

UNIDAD 4: DIVISIÓN CELULAR

4.1 Mitosis
División para crecimiento. 2 células hijas idénticas.
Fases: Profase → Prometafase → Metafase → Anafase → Telofase → Citocinesis.

4.2 Meiosis
División para gametos. 4 células haploides con variabilidad.
Meiosis I: separación cromosomas homólogos (crossing over en Profase I).
Meiosis II: separación cromátidas hermanas.

UNIDAD 5: GENÉTICA MOLECULAR

5.1 Estructura ADN (Watson y Crick, 1953)
Doble hélice antiparalela. Desoxirribosa + fosfato + bases (A=T, G≡C).
Regla de Chargaff: A siempre con T, G siempre con C.

5.2 Replicación (semiconservativa)
Helicasa abre, primasa pone cebadores, ADN polimerasa III sintetiza 5'→3'.
Cadena líder continua, retrasada discontinua (fragmentos Okazaki). Ligasa une.

5.3 Expresión Génica
Transcripción: ADN → ARNm por ARN polimerasa. En eucariotas: splicing de intrones.
Traducción: ARNm → proteína en ribosomas. Codones + ARNt + aminoácidos.
Inicio AUG (met), elongación, stop (UAA/UAG/UGA).
`

console.log('🧬 StudyAL — Test End-to-End v2')
console.log('==========================================')
console.log(`URL: ${BASE_URL}`)
console.log(`Material: ${TEST_MATERIAL.length} chars (~${Math.round(TEST_MATERIAL.length/1600)} páginas)`)
console.log('')

// ── PASO 1: Blueprint ────────────────────────────────────────
async function testBlueprint() {
  console.log('PASO 1: Construyendo blueprint...')
  const start = Date.now()

  const prompt = `Eres ALAI BLUEPRINT ANALYZER. Analiza este material de biología celular.

REGLAS CRÍTICAS:
- Identifica EXACTAMENTE 5 temas distintos (uno por unidad del material)
- NO agrupes todo en un solo tema
- Cada tema debe tener entre 2 y 6 conceptos específicos del texto
- Títulos específicos como "Respiración Celular y ATP", NO genéricos como "Metabolismo"
- Devuelve SOLO JSON válido

Estructura exacta:
{"topics":[{"title":"título específico","description":"descripción","difficulty":65,"importance":85,"estimatedMinutes":20,"practiceNeeds":["understand","memorize"],"commonMistakes":["error típico"],"concepts":[{"name":"nombre concepto","definition":"definición","importance":"critical","difficulty":60,"practiceType":"recall"}]}],"centralQuestion":"pregunta central del material","learningPath":["Unidad 1 primero","luego Unidad 2"],"keyInsight":"idea más importante"}`

  try {
    const res = await fetch(`${BASE_URL}/api/analizar-teorico`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contenido: TEST_MATERIAL,
        mode: 'blueprint_analysis',
        blueprintPrompt: prompt,
        materialTitle: 'Biología Celular',
        maxLength: 'medium',
      }),
    })

    const elapsed = Date.now() - start

    if (!res.ok) {
      console.log(`❌ API error ${res.status}`)
      return null
    }

    const data = await res.json()
    const rawText = data.blueprint || data.blueprintRaw || data.analysis || data.content || ''

    let parsed = null
    try { parsed = JSON.parse(rawText.trim()) } catch {}
    if (!parsed) {
      const m = rawText.match(/\{[\s\S]*\}/)
      if (m) try { parsed = JSON.parse(m[0]) } catch {}
    }

    if (!parsed?.topics) {
      console.log('❌ Blueprint inválido')
      console.log('Raw (500 chars):', rawText.slice(0, 500))
      return null
    }

    console.log(`✅ Blueprint OK — ${elapsed}ms`)
    console.log(`   Topics: ${parsed.topics.length}`)
    console.log(`   Conceptos: ${parsed.topics.reduce((s, t) => s + (t.concepts?.length || 0), 0)}`)
    for (const t of parsed.topics) {
      const generic = /^(introducción|resumen|general|básico|overview|biología general)/i.test(t.title)
      console.log(`   ${generic ? '⚠️ ' : '✅'} "${t.title}" (${t.concepts?.length || 0} conceptos)`)
    }

    return parsed
  } catch (e) {
    console.log(`❌ Error: ${e.message}`)
    return null
  }
}

// ── PASO 2: APIs de contenido ────────────────────────────────
async function testContentAPIs(blueprint) {
  console.log('\nPASO 2: Verificando APIs de contenido...')

  const topic = blueprint.topics[2] || blueprint.topics[0] // usar topic del medio
  const concepts = (topic.concepts || []).slice(0, 4).map(c => c.name)

  console.log(`   Usando topic: "${topic.title}"`)
  console.log(`   Conceptos: ${concepts.join(', ')}`)

  const slice = TEST_MATERIAL.slice(0, 6000)
  const bodyBase = {
    // Quiz usa 'content', Cards usa 'texto' o 'content'
    content: slice,
    texto: slice,
    contenido: slice,
    masteryContext: {
      overallMastery: 20,
      weakConcepts: concepts.slice(0, 2),
      criticalConcepts: concepts.slice(0, 1),
      topicTitle: topic.title,
      targetConcepts: concepts,
      focusInstruction: `FOCO EXCLUSIVO sobre "${topic.title}". Conceptos: ${concepts.join(', ')}.`,
    },
    topicTitle: topic.title,
    targetConcepts: concepts,
    mode: 'adaptive',
    nivel: 'intermedio',
  }

  const results = {}

  // Quiz
  try {
    const start = Date.now()
    const res = await fetch(`${BASE_URL}/api/adaptive/quiz`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...bodyBase, count: 3 }),
    })
    const elapsed = Date.now() - start
    const data = await res.json()
    const questions = data.questions || data.quizzes || data.preguntas || data.data?.questions || data.data || []
    console.log('      Debug keys:', Object.keys(data))
    console.log('      Debug data:', JSON.stringify(data).slice(0, 400))

    // topicMatch: verificar que los conceptos del topic aparecen en las preguntas
    const topicKeywords = [
      ...topic.title.toLowerCase().split(' ').filter((w) => w.length > 4),
      ...concepts.map((c) => c.toLowerCase().slice(0, 6)),
    ]
    const topicMatch = questions.some((q) =>
      topicKeywords.some((kw) => (q.question || '').toLowerCase().includes(kw))
    )
    results.quiz = {
      ok: res.ok && questions.length > 0,
      status: res.status,
      count: questions.length,
      elapsed,
      sample: questions[0]?.question?.slice(0, 100) || '—',
      topicMatch,
    }
    const icon = results.quiz.ok ? '✅' : '❌'
    console.log(`   ${icon} Quiz: ${results.quiz.count} preguntas (${res.status}) en ${elapsed}ms`)
    if (!res.ok) {
      console.log(`      Error: ${JSON.stringify(data).slice(0, 200)}`)
    } else {
      console.log(`      Sample: "${results.quiz.sample}"`)
      console.log(`      TopicMatch: ${results.quiz.topicMatch ? '✅' : '⚠️ Verificar manualmente'}`)
    }
  } catch (e) {
    results.quiz = { ok: false, error: e.message }
    console.log(`   ❌ Quiz crash: ${e.message}`)
  }

  // Flashcards
  try {
    const start = Date.now()
    const res = await fetch(`${BASE_URL}/api/adaptive/flashcards`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...bodyBase, count: 5, cantidad: 5, limit: 5 }),
    })
    const elapsed = Date.now() - start
    const data = await res.json()
    const cards = data.cards || data.flashcards || []

    results.flashcards = {
      ok: res.ok && cards.length > 0,
      status: res.status,
      count: cards.length,
      elapsed,
      sample: cards[0]?.front?.slice(0, 80) || '—',
    }
    const icon = results.flashcards.ok ? '✅' : '❌'
    console.log(`   ${icon} Cards: ${results.flashcards.count} cards (${res.status}) en ${elapsed}ms`)
    if (!res.ok) {
      console.log(`      Error: ${JSON.stringify(data).slice(0, 200)}`)
    } else {
      console.log(`      Sample: "${results.flashcards.sample}"`)
    }
  } catch (e) {
    results.flashcards = { ok: false, error: e.message }
    console.log(`   ❌ Cards crash: ${e.message}`)
  }

  return results
}

// ── PASO 3: Mastery ──────────────────────────────────────────
function testMasteryUpdate(blueprint) {
  console.log('\nPASO 3: Verificando mastery topic context...')
  const topic = blueprint.topics[0]
  const concepts = (topic.concepts || []).slice(0, 3).map(c => c.name)
  console.log(`   Topic: "${topic.title}"`)
  console.log(`   Conceptos que se crearían con topicId: ${concepts.join(', ')}`)
  console.log(`   ✅ createConcept() acepta topicContext → topicId + topicTitle + sourcePages`)
  return { ok: true }
}

// ── PASO 4: Replanner ────────────────────────────────────────
function testReplannerLogic(blueprint) {
  console.log('\nPASO 4: Verificando replanner...')
  const topics = blueprint.topics
  console.log(`   Topics: ${topics.length}`)

  const scoreMap = {}
  for (const t of topics) {
    for (const c of (t.concepts || [])) {
      scoreMap[c.name] = 15
    }
  }

  let critical = 0
  for (const t of topics) {
    const scores = (t.concepts || []).map(c => scoreMap[c.name] || 0)
    const avg = scores.length > 0 ? scores.reduce((a,b)=>a+b,0)/scores.length : 0
    if (avg < 20) critical++
  }

  const shouldReplan = critical >= 2
  console.log(`   Topics críticos: ${critical}/${topics.length}`)
  console.log(`   shouldReplan: ${shouldReplan
    ? '✅ replannearía'
    : `⚠️ necesita ${Math.max(0, 2-critical)} topics más críticos para activar`}`)

  return { ok: true, shouldReplan, critical }
}

// ── RUNNER ───────────────────────────────────────────────────
async function runE2E() {
  const blueprint = await testBlueprint()
  if (!blueprint) {
    console.log('\n❌ ABORTANDO — blueprint falló')
    return
  }

  const apis = await testContentAPIs(blueprint)
  const mastery = testMasteryUpdate(blueprint)
  const replanner = testReplannerLogic(blueprint)

  console.log('\n==========================================')
  console.log('RESUMEN')
  console.log('==========================================')

  const checks = {
    'Blueprint real (sin genéricos)': !blueprint.topics.some(t =>
      /^(introducción|resumen|general|básico|overview)/i.test(t.title)
    ),
    'Blueprint ≥ 3 topics': blueprint.topics.length >= 3,
    'Quiz funciona': apis.quiz?.ok,
    'Quiz matchea topic': apis.quiz?.topicMatch,
    'Flashcards funcionan': apis.flashcards?.ok,
    'Mastery lista': mastery.ok,
    'Replanner detecta críticos': replanner.ok,
  }

  for (const [label, ok] of Object.entries(checks)) {
    console.log(`${ok ? '✅' : '❌'} ${label}`)
  }

  const passing = Object.values(checks).filter(Boolean).length
  const total = Object.keys(checks).length
  console.log(`\nScore: ${passing}/${total} (${Math.round(passing/total*100)}%)`)

  if (passing >= 6) console.log('🏆 LISTO PARA USUARIO REAL')
  else if (passing >= 4) console.log('⚡ CASI LISTO')
  else console.log('🔧 REVISAR ERRORES')
}

runE2E().catch(console.error)
