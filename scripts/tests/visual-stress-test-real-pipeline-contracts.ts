import assert from 'node:assert/strict'
import { buildLearningPath } from '../../lib/adaptive/buildLearningPath'
import { buildLearningArcs } from '../../lib/adaptive/buildLearningArcs'
import { buildChaptersFromArcs } from '../../lib/adaptive/buildChaptersFromArcs'
import { certifyBlueprint } from '../../app/api/adaptive/blueprint/route'
import { attachVisualsToPreparedTeaching, factoryTeaching } from '../../app/api/adaptive/session-teach/route'
import type { AdaptiveSetup } from '../../lib/studySessions'
import type { TeachingContent } from '../../lib/ai/teachingContentContract'
import type { VisualEngine } from '../../lib/adaptive/visual/visualContract'

// StudyAL_Visual_System_Stress_Test — GAP 1 (pedido explícito del usuario tras
// el reporte de Layer B): "Eso NO demuestra el pipeline que falló en mi
// prueba manual" — refiriéndose a que visual-engine-pipeline-matrix-
// contracts.ts alimenta contenido directamente a factoryTeaching, saltándose
// blueprint -> topics -> blocks -> units/arcs -> journey -> sessions.
//
// BÚSQUEDA EXHAUSTIVA PREVIA (documentada aquí porque no hay otro lugar
// mejor): se buscó el blueprint REAL del material del stress test en
// reports/, .wrangler/ (D1 local), tests/fixtures/real-materials/,
// scripts/fixtures/, dumps de localStorage, logs, y el scratchpad de
// sesiones previas de este mismo proyecto. NO existe en ningún lugar
// accesible — el material se subió y probó manualmente en el entorno del
// usuario (S3 + D1 remoto), nunca se persistió en el repo. No se inventa un
// documento fuente falso.
//
// FRONTERA EXPLÍCITA fixtureada vs. real:
//   FIXTUREADO: la lista bruta de CanonicalBlock (lo que produciría la
//     extracción de blueprint desde el documento real vía visión/OCR/LLM —
//     esa etapa requiere el documento real + llamadas LLM, ninguna de las
//     dos disponible aquí) y el `TeachingContent` por sesión (lo que
//     produciría el LLM de generación de clase — ver visual-engine-pipeline-
//     matrix-contracts.ts para la matriz de PARAPHRASE ya cubierta ahí).
//   REAL (código de producción sin mockear, sin reimplementar): TODO lo
//     demás — buildLearningPath, buildLearningArcs, buildChaptersFromArcs
//     (blocks -> units -> arcs -> chapters/sesiones), certifyBlueprint
//     (gate de certificación), y factoryTeaching (classContent ->
//     VisualRequirement -> VisualSpec firmado). Estas son EXACTAMENTE las
//     funciones que invoca la ruta viva (generate-plan/route.ts y
//     session-teach/route.ts), no clones.
//
// CIERRE DE LA FRONTERA FINAL (ronda posterior): los quotes grounded de DCL,
// 2-metilbutano y código YA NO usan el formato literal conveniente ("Peso =
// 50 N a 270°" / "Átomos: C1=carbono..." / "Traza: línea 1...") — son
// redacción natural (ver comentarios en cada topic más abajo). Si los 8
// topics siguen resolviendo el engine correcto, ninguno de los 6 depende de
// una sintaxis especial producida por un LLM — ver visual-source-paraphrase-
// adversarial-contracts.ts para la prueba dedicada (4/4 + adversariales).

process.env.NEXTAUTH_SECRET = process.env.NEXTAUTH_SECRET || 'test-secret-for-pretest'

// ---------------------------------------------------------------------------
// 1) Blueprint fixture — 8 topics del stress test real (según la descripción
//    dada por el usuario al reportar el bug). Topic 1 (propósito/mapa) NO
//    recibe ningún CanonicalBlock a propósito: por contrato ("1 puede ser
//    mapa/intro") su contenido vive en la introducción/mapa, nunca en un
//    block de aprendizaje — ver condición explícita del usuario.
// ---------------------------------------------------------------------------

interface TopicFixture {
  topic: string
  topicId: string
  blockId: string
  pages: number[]
  kind: string
  label: string
  topicLabel: string
  content: string
  // Redacción de enseñanza DISTINTA de `content` (el quote grounded) — prueba,
  // dentro del pipeline COMPLETO (no aislado), que el visual sigue viniendo
  // del block grounded y no de esta prosa alternativa (cierre arquitectónico,
  // sección 6 del pedido del usuario).
  teachingProse: string
  cognitiveTarget: string
  expectedEngine: VisualEngine | null
  expectedRequiredness: 'required_for_mastery' | 'supportive' | null
}

const topics: TopicFixture[] = [
  {
    topic: '2. FUNCIONES (lineal/cuadrática)',
    topicId: 't_funciones', blockId: 'b_funciones', pages: [3, 4], kind: 'formula',
    label: 'Función lineal f(x) = 2x + 3', topicLabel: 'Funciones lineales y cuadráticas',
    content: 'La función f(x) = 2x + 3 tiene dominio -5 <= x <= 5. La gráfica muestra pendiente positiva y una intersección con el eje y.',
    teachingProse: 'Consideremos una relación lineal cuya pendiente es 2 y cuya ordenada al origen es 3, definida en un intervalo acotado de valores de x.',
    cognitiveTarget: 'application', expectedEngine: 'graph_2d', expectedRequiredness: 'required_for_mastery',
  },
  {
    topic: '3. ICE (equilibrio químico)',
    topicId: 't_ice', blockId: 'b_ice', pages: [7, 8], kind: 'concept',
    label: 'Tabla ICE del equilibrio H2/I2/HI', topicLabel: 'Equilibrio químico: tabla ICE',
    content: 'Reacción: H2 + I2 ⇌ 2HI. Concentraciones iniciales: [H2] = 1.00, [I2] = 1.00, [HI] = 0. Cambio: [H2] = -x, [I2] = -x, [HI] = +2x. En el equilibrio: [H2] = 1-x, [I2] = 1-x, [HI] = 2x.',
    teachingProse: 'Al mezclar hidrógeno y yodo se forma yoduro de hidrógeno; ambos reactivos disminuyen mientras el producto aumenta hasta alcanzar el equilibrio.',
    cognitiveTarget: 'application', expectedEngine: 'structured_grid', expectedRequiredness: 'required_for_mastery',
  },
  {
    topic: '4. DCL (fuerzas concurrentes)',
    topicId: 't_dcl', blockId: 'b_dcl', pages: [11], kind: 'concept',
    label: 'Diagrama de cuerpo libre sobre un bloque', topicLabel: 'Fuerzas concurrentes y DCL',
    // Redacción NATURAL, deliberadamente SIN el formato literal "Peso = 50 N
    // a 270°" (cierre de la frontera final — el quote grounded ya no exige
    // sintaxis especial de StudyAL, ver visual-source-paraphrase-adversarial-
    // contracts.ts).
    content: 'Sobre el bloque actúan dos fuerzas concurrentes. El peso apunta verticalmente hacia abajo con una magnitud de 50 N. La normal apunta hacia arriba con una magnitud de 50 N. Analicemos el equilibrio en el eje vertical.',
    teachingProse: 'El bloque experimenta dos fuerzas concurrentes: su peso dirigido hacia abajo y la normal, de igual magnitud, hacia arriba.',
    cognitiveTarget: 'application', expectedEngine: 'spatial_vector', expectedRequiredness: 'required_for_mastery',
  },
  {
    topic: '5. 2-METILBUTANO (conectividad molecular)',
    topicId: 't_metilbutano', blockId: 'b_metilbutano', pages: [14], kind: 'concept',
    label: 'Estructura esquelética del 2-metilbutano', topicLabel: 'Conectividad molecular: 2-metilbutano',
    // Redacción NATURAL — fórmula condensada estándar (notación química, no
    // específica de StudyAL), sin la lista artificial "Átomos:/Enlaces:".
    content: 'La molécula de 2-metilbutano puede representarse mediante la fórmula condensada CH3-CH(CH3)-CH2-CH3, donde todos los enlaces son simples.',
    teachingProse: 'La molécula tiene cuatro carbonos conectados en cadena mediante enlaces simples, sin insaturaciones.',
    cognitiveTarget: 'application', expectedEngine: 'chemistry_2d', expectedRequiredness: 'required_for_mastery',
  },
  {
    topic: '6. CÓDIGO (traza de estado del programa)',
    topicId: 't_codigo', blockId: 'b_codigo', pages: [18, 19], kind: 'concept',
    label: 'Traza de ejecución de un programa simple', topicLabel: 'Traza de estado del programa',
    // Redacción NATURAL — sin la sección artificial "Traza: línea 1...";
    // la traza se DERIVA determinísticamente del código real (subset seguro).
    content: 'Analicemos la ejecución del siguiente programa paso a paso:\n```python\nx = 3\ny = x * 2\nprint(y)\n```',
    teachingProse: 'Si seguimos la ejecución paso a paso, x toma un valor inicial, y se calcula como su doble, y la salida impresa refleja ese resultado.',
    cognitiveTarget: 'application', expectedEngine: 'code_execution', expectedRequiredness: 'required_for_mastery',
  },
  {
    topic: '7. LÍNEA DE TIEMPO (secuencia temporal)',
    topicId: 't_timeline', blockId: 'b_timeline', pages: [22], kind: 'concept',
    label: 'Cronología de dos hitos históricos', topicLabel: 'Secuencia temporal',
    content: 'En 1848 ocurrió el descubrimiento inicial. En 1859 se publicó el estudio que lo formalizó. La secuencia cronológica conecta ambos hitos.',
    teachingProse: 'El hallazgo original data de mediados del siglo XIX, y su formalización llegó algo más de una década después.',
    cognitiveTarget: 'comprehension', expectedEngine: 'timeline', expectedRequiredness: 'supportive',
  },
  {
    topic: '8. ADVERSARIAL (texto no-visual)',
    topicId: 't_adversarial', blockId: 'b_adversarial', pages: [25], kind: 'concept',
    label: 'Reflexión sobre el método científico', topicLabel: 'Reflexión metodológica',
    content: 'El método científico avanza mediante observación, hipótesis y contraste con la evidencia disponible. Ningún paso garantiza la verdad definitiva; cada conclusión permanece abierta a revisión futura conforme aparece nueva evidencia relevante para el problema estudiado.',
    teachingProse: 'La ciencia progresa comparando ideas propuestas contra lo que realmente se observa, sin garantizar nunca una certeza absoluta.',
    cognitiveTarget: 'application', expectedEngine: null, expectedRequiredness: null,
  },
]

const rawBlueprint = {
  version: 1,
  topics: [
    { id: 't_purpose_map', title: '1. Propósito del documento / mapa', pages: [1] },
    ...topics.map((t, i) => ({ id: t.topicId, title: t.topicLabel, pages: t.pages, order: i + 1 })),
  ],
  blocks: topics.map((t, i) => ({
    id: t.blockId,
    kind: t.kind,
    label: t.label,
    // Resumen genérico, deliberadamente SIN datos estructurados propios —
    // evita colisionar con las citas literales de sourceSpans (p.ej. un
    // slice truncado a mitad de un patrón regex produciría un duplicado
    // roto). En producción el resumen lo escribe el LLM de estructura como
    // 1-3 oraciones reales; aquí basta con que no interfiera.
    summary: `Bloque extraído del material sobre ${t.topicLabel.toLowerCase()}.`,
    topicId: t.topicId,
    topicLabel: t.topicLabel,
    pages: t.pages,
    globalOrder: i + 1,
    importance: 60,
    difficulty: 'intermediate' as const,
    dependsOn: [],
    relations: [],
    // Grounded en el documento — extraído UNA vez en blueprint/route.ts
    // (prompt "exact short quote from the source text"), nunca en la prosa
    // de enseñanza que factoryTeaching recibirá más abajo (t.teachingProse,
    // deliberadamente distinta de este quote).
    bloomLevel: t.cognitiveTarget === 'application' ? 'apply' : 'understand',
    sourceSpans: [{ quote: t.content, page: t.pages[0] ?? 1, certainty: 'supported' as const }],
  })),
  concepts: [],
}

const setup: AdaptiveSetup = {
  knowledgeLevel: 'never_seen', examDateType: 'just_studying', targetScore: 80,
  mainConcern: '', professorExamStyle: [], evalPreference: 'mix_everything',
  planView: 'book', completedAt: 1,
}

// ---------------------------------------------------------------------------
// 2) Pipeline REAL: blocks -> units -> arcs -> chapters (sesiones)
// ---------------------------------------------------------------------------
const path = buildLearningPath(rawBlueprint)
const arcs = buildLearningArcs(path)
const chapters = buildChaptersFromArcs(path, arcs, setup)

assert.ok(chapters.length >= 1, 'debe producirse al menos un capítulo de aprendizaje')

// Ningún block se pierde entre blocks -> chapters, sin importar cuántos
// topics originales terminen fusionados en la misma sesión (Codex C: el
// merge de arcos NUNCA descarta bloques).
const allChapterBlockIds = new Set(chapters.flatMap(c => c.blockIds))
for (const t of topics) {
  assert.ok(allChapterBlockIds.has(t.blockId), `PÉRDIDA ESTRUCTURAL: el block "${t.blockId}" (${t.topic}) nunca aparece en ningún capítulo de aprendizaje`)
}

// Mapa block -> capítulo que lo contiene (para la matriz final)
const chapterOfBlock = new Map<string, (typeof chapters)[number]>()
for (const chapter of chapters) {
  for (const blockId of chapter.blockIds) chapterOfBlock.set(blockId, chapter)
}

// ---------------------------------------------------------------------------
// 3) Session preparation REAL: para cada capítulo, ensamblar el TeachingContent
//    (fixture — límite explícito con LLM, ver cabecera) SOLO con los steps
//    correspondientes a los blocks que ese capítulo real posee, y pasarlo por
//    factoryTeaching REAL (la misma función que usa el POST vivo).
// ---------------------------------------------------------------------------
const byBlockId = new Map(topics.map(t => [t.blockId, t]))
const actualEngineByBlockId = new Map<string, VisualEngine | null>()
const sessionByBlockId = new Map<string, number>()
const stepIdByBlockId = new Map<string, string>()
const visualSpecByBlockId = new Map<string, any>()
const requirementByBlockId = new Map<string, string | undefined>()
const evidenceKindByBlockId = new Map<string, string | undefined>()

for (const chapter of chapters) {
  const stepsForChapter = chapter.blockIds.map(blockId => byBlockId.get(blockId)!).filter(Boolean)
  if (!stepsForChapter.length) continue

  // `content` = t.teachingProse (deliberadamente DISTINTA del quote grounded
  // del block) — si el visual sigue apareciendo correcto, es prueba directa
  // de que viene del block grounded y no de esta prosa, dentro del pipeline
  // COMPLETO (no aislado, como en visual-grounded-paraphrase-invariance).
  const source: TeachingContent = {
    sessionIntro: `Inicio de ${chapter.title}.`,
    steps: stepsForChapter.map(t => ({
      id: `step_${t.blockId}`,
      type: 'concept',
      title: t.label,
      content: t.teachingProse,
      keyPoints: [{ id: `kp_${t.blockId}`, text: 'punto clave' } as any],
      microId: t.blockId,
      importance: 'important',
      cognitiveTarget: t.cognitiveTarget as any,
      relatedBlockIds: [t.blockId],
      factKeys: [`fk_${t.blockId}`],
      sourceReferences: [],
    })),
    closing: `Cierre de ${chapter.title}.`,
  }

  const session = {
    id: chapter.id, chapterNumber: chapter.chapterNumber, title: chapter.title,
    objective: chapter.objective, topicIds: chapter.topicIds, blockIds: chapter.blockIds,
    concepts: chapter.concepts, pages: chapter.pages, kind: 'learning' as const,
  }

  const prepared = factoryTeaching(source, session, rawBlueprint.blocks)
  for (const step of prepared.steps) {
    const blockId = step.microId
    actualEngineByBlockId.set(blockId, (step.visualSpec?.engine as VisualEngine | undefined) ?? null)
    sessionByBlockId.set(blockId, chapter.chapterNumber)
    stepIdByBlockId.set(blockId, step.id)
    visualSpecByBlockId.set(blockId, step.visualSpec)
    requirementByBlockId.set(blockId, step.visualRequirement?.requiredness)
    evidenceKindByBlockId.set(blockId, step.visualEvidenceKind)
  }
}

// ---------------------------------------------------------------------------
// 4) Matriz final — impresa para el reporte y verificada assert por assert
// ---------------------------------------------------------------------------
console.log('\nTOPIC | SOURCE_PAGES | BLOCK_ID | SESSION | STEP | EXPECTED_VISUAL | ACTUAL_VISUAL | REQUIREDNESS | PROVENANCE | STATUS')
for (const t of topics) {
  const actual = actualEngineByBlockId.get(t.blockId)
  const sessionNum = sessionByBlockId.get(t.blockId)
  const stepId = stepIdByBlockId.get(t.blockId)
  const spec = visualSpecByBlockId.get(t.blockId)
  const requiredness = requirementByBlockId.get(t.blockId) ?? 'n/a'
  const provenanceBlockId = spec?.sourceGrounding?.sourceSpans?.[0]?.blockId ?? '(ninguna)'
  const status = t.expectedEngine === null
    ? (actual == null ? 'OK (sin visual, esperado)' : `FALLO: produjo visual inesperado "${actual}"`)
    : (actual === t.expectedEngine ? 'OK' : `FALLO: esperado "${t.expectedEngine}", obtuvo "${actual}"`)
  console.log(`${t.topic} | ${JSON.stringify(t.pages)} | ${t.blockId} | ${sessionNum} | ${stepId} | ${t.expectedEngine ?? '(ninguno)'} | ${actual ?? '(ninguno)'} | ${requiredness} | ${provenanceBlockId} | ${status}`)

  assert.ok(sessionNum !== undefined, `${t.topic}: debe haber sido asignado a una sesión de aprendizaje real (no solo intro/mapa)`)
  if (t.expectedEngine === null) {
    assert.equal(actual, null, `${t.topic}: NO debe producir ningún visual`)
    assert.equal(requirementByBlockId.get(t.blockId), undefined, `${t.topic}: no debe producirse ningún VisualRequirement`)
    assert.equal(evidenceKindByBlockId.get(t.blockId), undefined, `${t.topic}: adversarial nunca debe generar visualEvidenceKind`)
  } else {
    assert.equal(actual, t.expectedEngine, `${t.topic}: engine esperado "${t.expectedEngine}", obtuvo "${actual}"`)

    // Provenance: el VisualSpec debe apuntar exactamente al block grounded del
    // que salió — no al step ni a ningún otro block — esto es lo que
    // demuestra que NO se inventó nada: cada dato es trazable a su origen.
    assert.equal(provenanceBlockId, t.blockId, `${t.topic}: provenance debe apuntar al block grounded real ("${t.blockId}"), obtuvo "${provenanceBlockId}"`)
    assert.ok(spec?.integrity, `${t.topic}: el VisualSpec debe estar firmado (server-authoritative), no puede llegar al cliente sin integrity`)

    // VisualRequirement correcto + gating real: required_for_mastery SÍ debe
    // producir visualEvidenceKind (el campo que StudyALAdaptive/page.tsx usa
    // para bloquear Continuar hasta resolver el visual); supportive/
    // understanding NUNCA debe bloquear.
    assert.equal(requirementByBlockId.get(t.blockId), t.expectedRequiredness, `${t.topic}: requiredness esperada "${t.expectedRequiredness}", obtuvo "${requirementByBlockId.get(t.blockId)}"`)
    if (t.expectedRequiredness === 'required_for_mastery') {
      assert.ok(evidenceKindByBlockId.get(t.blockId), `${t.topic}: required_for_mastery DEBE producir visualEvidenceKind (bloquea avance real) — sin esto, isVisualStepSatisfied() nunca exigiría resolver el visual`)
    } else {
      assert.equal(evidenceKindByBlockId.get(t.blockId), undefined, `${t.topic}: ${t.expectedRequiredness} NUNCA debe producir visualEvidenceKind (no debe bloquear avance)`)
    }
  }
}
console.log(`(Topic 1 — propósito/mapa: sin block de aprendizaje por diseño, contenido vive en intro/mapa — no aplica a esta matriz)\n`)

console.log(`[pipeline] ${chapters.length} sesión(es) de aprendizaje real generada(s) para ${topics.length} topics (fusión de arcos es válida — ver Codex C: el merge nunca descarta blocks).`)

// Reproducción chapter_3: un teaching ya persistido antes de que se adjuntaran
// visuales debe recuperar deterministicamente el bloque ICE grounded al ser
// restaurado, sin regenerar la enseñanza ni depender de su paráfrasis.
{
  const ice = topics.find(topic => topic.blockId === 'b_ice')!
  const chapter = chapterOfBlock.get(ice.blockId)!
  const persistedWithoutVisuals: any = {
    sessionId: chapter.id, title: chapter.title, introduction: 'Inicio', closing: 'Cierre',
    steps: [{ stepId:'chapter_3_ice_step', id:'chapter_3_ice_step', microId:ice.blockId, title:ice.label, type:'concept', content:ice.teachingProse, keyPoints:['Aplicar la tabla ICE'], keyPointIds:['chapter_3_ice_step:kp:1'], factKeys:['b_ice:fact:1'], importance:'important', cognitiveTarget:'application', sourceReferences:[], relatedBlockIds:[ice.blockId] }],
  }
  const restored = attachVisualsToPreparedTeaching(persistedWithoutVisuals, { ...chapter, kind:'learning' as const }, rawBlueprint.blocks)
  assert.equal(restored.steps[0].visualSpec?.engine, 'structured_grid', 'chapter_3 ICE restaurado debe adjuntar structured_grid al objeto final consumido por la página')
  assert.equal(restored.steps[0].visualRequirement?.requiredness, 'required_for_mastery')
  assert.ok(restored.steps[0].visualSpec?.integrity)
}

// ---------------------------------------------------------------------------
// 5) REGRESIÓN DEL BUG REAL — un topic con página asignada pero SIN bloque
//    extraído (el patrón exacto que Codex C identificó como el mecanismo más
//    plausible detrás de la desaparición real de un topic) nunca se convierte
//    en unit y por tanto NUNCA llega a un capítulo de aprendizaje — Y ahora
//    (a diferencia de antes de esta ronda) el gate de certificación lo
//    bloquea explícitamente en vez de dejarlo pasar en silencio.
// ---------------------------------------------------------------------------
{
  const blueprintWithLostTopic = {
    ...rawBlueprint,
    topics: [
      ...rawBlueprint.topics,
      { id: 't_lost', title: 'Nomenclatura IUPAC de alcanos ramificados', pages: [16] },
    ],
    // deliberadamente SIN ningún block para t_lost — simula una extracción
    // fallida para un topic confinado a una página, el mismo patrón
    // hipotetizado para el topic real perdido del stress test.
  }

  const lostPath = buildLearningPath(blueprintWithLostTopic)
  const lostUnitTopicIds = new Set(lostPath.units.map(u => u.topicId))
  assert.ok(!lostUnitTopicIds.has('t_lost'), 'REGRESIÓN: un topic sin bloques nunca debe convertirse en unit (confirma el mecanismo de pérdida real, no solo hipotético)')

  const lostArcs = buildLearningArcs(lostPath)
  const lostChapters = buildChaptersFromArcs(lostPath, lostArcs, setup)
  const lostChapterBlockIds = new Set(lostChapters.flatMap(c => c.blockIds))
  // t_lost no tiene blockId propio (nunca se generó ninguno) — la aserción
  // real es que NINGÚN capítulo referencia t_lost como topicId.
  const lostChapterTopicIds = new Set(lostChapters.flatMap(c => c.topicIds))
  assert.ok(!lostChapterTopicIds.has('t_lost'), 'REGRESIÓN: el topic sin bloques nunca debe aparecer en ningún capítulo de aprendizaje')

  // Antes de esta ronda, certifyBlueprint SOLO bloqueaba topics vacíos de
  // MÁS de una página — un topic de una sola página como este pasaba sin
  // ninguna señal. Verificamos que el fix (blueprint-empty-topic-
  // certification-contracts.ts) efectivamente cubre este caso exacto.
  const certification = certifyBlueprint(
    blueprintWithLostTopic,
    { status: 'complete', reasons: [] },
    { passed: true, issues: [], uncoveredFragments: [] },
  )
  assert.equal(certification.coverageCertified, false, 'REGRESIÓN: certifyBlueprint debe bloquear certificación cuando un topic con página asignada carece de bloques (fix de esta ronda)')
  assert.equal(certification.planGenerationAllowed, false, 'REGRESIÓN: generate-plan debe quedar bloqueado (422) mientras el topic perdido no tenga bloque')
  assert.ok(certification.certificationReasons.some(r => r.includes('Nomenclatura IUPAC')), 'REGRESIÓN: la razón de bloqueo debe nombrar el topic perdido específico')

  console.log('REGRESIÓN DEL BUG REAL: topic sin bloques -> nunca se convierte en unit -> nunca llega a un capítulo -> certifyBlueprint lo bloquea explícitamente (antes de esta ronda hubiera pasado en silencio para un topic de 1 página) PASS')
}

console.log('visual-stress-test-real-pipeline-contracts: PASS (blueprint -> topics -> blocks -> units/arcs -> chapters/sesiones -> session preparation -> classContent -> VisualSpec, 100% código de producción real salvo la extracción de blocks desde el documento y la prosa de enseñanza del LLM, ambas fixtureadas y declaradas explícitamente)')
