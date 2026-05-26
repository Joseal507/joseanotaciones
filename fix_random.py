with open('app/api/quiz/route.ts', 'r', encoding='utf-8') as f:
    src = f.read()

OLD = '''// DUPLICACIÓN INTELIGENTE CON INTERCALACIÓN DE TIPOS Y MÓDULO SEGURO
for (let i = 0; i < bufferCount; i++) {
  const conceptObj = allExtractedConcepts[i % allExtractedConcepts.length];
  const type = tipos[i % tipos.length];

  selectedTasks.push({
    concept: conceptObj.text,
    materialId: conceptObj.materialId,
    materialName: conceptObj.materialName,
    page: conceptObj.page,
    type
  });
}'''

NEW = '''// SHUFFLE REAL + DISTRIBUCIÓN PROPORCIONAL POR MATERIAL
const conceptsByMaterial: Record<string, ExtractedConcept[]> = {};
for (const c of allExtractedConcepts) {
  if (!conceptsByMaterial[c.materialId]) conceptsByMaterial[c.materialId] = [];
  conceptsByMaterial[c.materialId].push(c);
}
// Shuffle interno de cada material
for (const id of Object.keys(conceptsByMaterial)) {
  conceptsByMaterial[id] = conceptsByMaterial[id].sort(() => Math.random() - 0.5);
}
const matIds = Object.keys(conceptsByMaterial);
const totalConcepts = allExtractedConcepts.length;

// Cuántas tareas le toca a cada material
const tasksPerMaterial: Record<string, number> = {};
let assigned = 0;
matIds.forEach((id, idx) => {
  if (idx === matIds.length - 1) {
    tasksPerMaterial[id] = bufferCount - assigned;
  } else {
    const share = Math.round((conceptsByMaterial[id].length / totalConcepts) * bufferCount);
    tasksPerMaterial[id] = Math.max(1, share);
    assigned += tasksPerMaterial[id];
  }
});
console.log(`🧠 [Quiz Backend] Distribución por material:`, matIds.map(id => `${id}: ${tasksPerMaterial[id]}`).join(', '));

// Tipos shuffleados (sin patrón fijo)
const tiposShuffled = [...tipos].sort(() => Math.random() - 0.5);

// Intercalar round-robin entre materiales
const cursors: Record<string, number> = {};
matIds.forEach(id => { cursors[id] = 0; });
const maxPerMat = Math.max(...matIds.map(id => tasksPerMaterial[id]));
let typeIdx = 0;
for (let i = 0; i < maxPerMat; i++) {
  for (const matId of matIds) {
    if (cursors[matId] >= tasksPerMaterial[matId]) continue;
    const concepts = conceptsByMaterial[matId];
    const concept = concepts[cursors[matId] % concepts.length];
    // tipo rotativo pero con offset random al inicio
    const type = tipos[(typeIdx + Math.trunc(Math.random() * tipos.length)) % tipos.length];
    selectedTasks.push({
      concept: concept.text,
      materialId: concept.materialId,
      materialName: concept.materialName,
      page: concept.page,
      type
    });
    cursors[matId]++;
    typeIdx++;
  }
}
// Shuffle final del batch completo
selectedTasks.sort(() => Math.random() - 0.5);'''

if OLD in src:
    src = src.replace(OLD, NEW)
    print("✅ Backend: shuffle + distribución proporcional aplicado")
else:
    print("❌ No encontré el bloque — verificá manualmente")

with open('app/api/quiz/route.ts', 'w', encoding='utf-8') as f:
    f.write(src)
