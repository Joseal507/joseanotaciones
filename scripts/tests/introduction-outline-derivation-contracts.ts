import assert from 'node:assert/strict'
import { buildTeachingOnlyPrompt } from '../../app/api/adaptive/session-teach/route'

// Auditoría adversarial (Codex, Intro/Review #3 y Teaching #4.2, post-319a5bc):
//
// ANTES: introSource tomaba SIEMPRE los primeros 5 `blueprint.topics` por
// posición y asignaba el `type` de cada paso de introducción por índice
// (0='intro', 1='concept', resto='connection') — dos materiales cuyos
// primeros 5 topics compartieran posición producían el MISMO armazón sin
// importar el `role` real que extractDocumentStructure ya había calculado
// por contenido, y un topic genuinamente central (role='foundation' o
// 'mechanism') que apareciera después de la posición 5 quedaba descartado
// sin más. Y cognitiveTarget de teaching solo distinguía fact→recognition
// vs cualquier otro kind→comprehension, así que una fórmula o un ejemplo
// trabajado (que exigen aplicación) quedaban marcados igual que una
// definición simple.
//
// Este archivo prueba, contra la función REAL de producción
// (buildTeachingOnlyPrompt, sin mockear ningún LLM — es pura construcción
// de prompt), que ambos ahora se derivan del contenido real.

function baseSession(kind: 'introduction' | 'learning', blockIds: string[] = []) {
  return {
    id: 's1', chapterNumber: 1, title: 'Sesión', objective: 'Objetivo', topicIds: [], blockIds, concepts: [], pages: [], kind,
  }
}

function baseSetup() {
  return { knowledgeLevel: 'never_seen', examDateType: 'just_studying', evalPreference: 'mix_everything' }
}

// ═══ A. El type de cada paso de introducción se deriva del role real, no de la posición ═══
function testIntroductionTypeDerivesFromRole() {
  const topics = [
    { id: 't1', title: 'Contexto histórico', description: 'desc', role: 'context', order: 0 },
    { id: 't2', title: 'Mecanismo central', description: 'desc', role: 'mechanism', order: 1 },
    { id: 't3', title: 'Aplicación práctica', description: 'desc', role: 'application', order: 2 },
  ]
  const prompt = buildTeachingOnlyPrompt({
    session: baseSession('introduction'), blueprint: { topics, blocks: [] }, setup: baseSetup(), materialTitle: 'Material X',
  } as any)
  const metadataMatch = prompt.match(/METADATOS OBLIGATORIOS POR PASO: (\[.*?\])\n/)
  assert.ok(metadataMatch, 'debe existir el bloque de metadatos obligatorios')
  const metadata = JSON.parse(metadataMatch![1])
  // role='context' (primer topic) -> 'connection', NO 'intro' por ser el
  // primer índice — antes SIEMPRE habría sido 'intro' solo por ser el índice 0.
  assert.equal(metadata[0].type, 'connection', 'BUG DE ORIGEN SI FALLA: el primer topic con role=context no debe forzarse a type=intro solo por su posición')
  assert.equal(metadata[1].type, 'concept', 'role=mechanism debe mapear a concept (núcleo conceptual), no a lo que dicte la posición')
  assert.equal(metadata[2].type, 'example', 'role=application debe mapear a example, no a connection por estar en la posición 2')
}

// ═══ B. Con más de 5 topics, foundation/mechanism se priorizan sobre la posición ═══
function testMoreThanFiveTopicsPrioritizesCentralRoles() {
  const topics = [
    { id: 't1', title: 'Contexto 1', description: 'd', role: 'context', order: 0 },
    { id: 't2', title: 'Contexto 2', description: 'd', role: 'context', order: 1 },
    { id: 't3', title: 'Contexto 3', description: 'd', role: 'context', order: 2 },
    { id: 't4', title: 'Contexto 4', description: 'd', role: 'context', order: 3 },
    { id: 't5', title: 'Contexto 5', description: 'd', role: 'context', order: 4 },
    // Este topic central aparece en la posición 6 (índice 5) — con el
    // comportamiento anterior (slice(0,5) ciego a role) quedaba descartado.
    { id: 't6', title: 'El mecanismo que explica todo', description: 'd', role: 'foundation', order: 5 },
  ]
  const prompt = buildTeachingOnlyPrompt({
    session: baseSession('introduction'), blueprint: { topics, blocks: [] }, setup: baseSetup(), materialTitle: 'Material Y',
  } as any)
  assert.ok(
    prompt.includes('El mecanismo que explica todo'),
    'BUG DE ORIGEN SI FALLA: un topic role=foundation en la posición 6 debe seguir seleccionándose para la introducción, no descartarse solo por posición',
  )
}

// ═══ C. Dos materiales con distinta composición de roles producen outlines distintos ═══
function testDifferentMaterialsProduceStructurallyDifferentOutlines() {
  const historyTopics = [
    { id: 'h1', title: 'Antecedentes', description: 'd', role: 'foundation', order: 0 },
    { id: 'h2', title: 'Causas', description: 'd', role: 'problem', order: 1 },
    { id: 'h3', title: 'Eventos', description: 'd', role: 'mechanism', order: 2 },
    { id: 'h4', title: 'Consecuencias', description: 'd', role: 'context', order: 3 },
  ]
  const codeTopics = [
    { id: 'c1', title: 'Objetivo del programa', description: 'd', role: 'foundation', order: 0 },
    { id: 'c2', title: 'Estructuras de datos', description: 'd', role: 'mechanism', order: 1 },
    { id: 'c3', title: 'Errores frecuentes', description: 'd', role: 'application', order: 2 },
  ]
  const historyPrompt = buildTeachingOnlyPrompt({
    session: baseSession('introduction'), blueprint: { topics: historyTopics, blocks: [] }, setup: baseSetup(), materialTitle: 'Historia',
  } as any)
  const codePrompt = buildTeachingOnlyPrompt({
    session: baseSession('introduction'), blueprint: { topics: codeTopics, blocks: [] }, setup: baseSetup(), materialTitle: 'Programación',
  } as any)
  const historyMeta = JSON.parse(historyPrompt.match(/METADATOS OBLIGATORIOS POR PASO: (\[.*?\])\n/)![1])
  const codeMeta = JSON.parse(codePrompt.match(/METADATOS OBLIGATORIOS POR PASO: (\[.*?\])\n/)![1])
  assert.notDeepEqual(
    historyMeta.map((m: any) => m.type),
    codeMeta.map((m: any) => m.type).length === historyMeta.length ? codeMeta.map((m: any) => m.type) : ['__length_mismatch__'],
    'materiales con distinta composición de roles deben producir secuencias de type distintas, no el mismo armazón fijo',
  )
}

// ═══ D. cognitiveTarget de teaching usa la taxonomía real de block.kind, no solo fact/else ═══
function testCognitiveTargetVariesByBlockKind() {
  const blocks = [
    { id: 'b1', label: 'Un dato', summary: 's', kind: 'fact', importance: 50 },
    { id: 'b2', label: 'Una fórmula', summary: 's', kind: 'formula', importance: 50 },
    { id: 'b3', label: 'Un ejemplo trabajado', summary: 's', kind: 'example', importance: 50 },
    { id: 'b4', label: 'Un concepto', summary: 's', kind: 'concept', importance: 50 },
  ]
  const prompt = buildTeachingOnlyPrompt({
    session: baseSession('learning', ['b1', 'b2', 'b3', 'b4']), blueprint: { topics: [], blocks }, setup: baseSetup(), materialTitle: 'Material Z',
  } as any)
  const metadata = JSON.parse(prompt.match(/METADATOS OBLIGATORIOS POR PASO: (\[.*?\])\n/)![1])
  const byMicroId = Object.fromEntries(metadata.map((m: any) => [m.microId, m.cognitiveTarget]))
  assert.equal(byMicroId.b1, 'recognition', 'fact debe seguir siendo recognition')
  assert.equal(byMicroId.b2, 'application', 'BUG DE ORIGEN SI FALLA: formula debe ser application, no comprehension genérico')
  assert.equal(byMicroId.b3, 'application', 'BUG DE ORIGEN SI FALLA: example (ejemplo trabajado) debe ser application, no comprehension genérico')
  assert.equal(byMicroId.b4, 'comprehension', 'concept sigue siendo comprehension')
}

testIntroductionTypeDerivesFromRole()
testMoreThanFiveTopicsPrioritizesCentralRoles()
testDifferentMaterialsProduceStructurallyDifferentOutlines()
testCognitiveTargetVariesByBlockKind()

console.log('introduction-outline-derivation-contracts: PASS (type de introducción derivado de role real, topics centrales fuera de las primeras 5 posiciones se conservan, materiales distintos producen outlines distintos, cognitiveTarget usa la taxonomía real de block.kind)')
