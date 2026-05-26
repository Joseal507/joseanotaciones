with open('app/api/quiz/route.ts', 'r', encoding='utf-8') as f:
    src = f.read()

# ══════════════════════════════════════════════════════════════
# FIX 1: Distribución proporcional garantizada por material
# El problema: i % allExtractedConcepts.length no garantiza
# que si hay 2 materiales con distinta cantidad de conceptos,
# ambos tengan representación proporcional.
# Fix: intercalar conceptos de cada material de forma round-robin
# ══════════════════════════════════════════════════════════════
OLD_TASKS = '''    const selectedTasks: ConceptTask[] = [];

    // DUPLICACIÓN INTELIGENTE CON INTERCALACIÓN DE TIPOS Y MÓDULO SEGURO
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
    }

    console.log(`🧠 [Quiz Backend] Tareas totales asignadas con colchón proporcional: ${selectedTasks.length}`);'''

NEW_TASKS = '''    const selectedTasks: ConceptTask[] = [];

    // DISTRIBUCIÓN PROPORCIONAL GARANTIZADA POR MATERIAL
    // Agrupar conceptos por material
    const conceptsByMaterial: Record<string, ExtractedConcept[]> = {};
    for (const c of allExtractedConcepts) {
      if (!conceptsByMaterial[c.materialId]) conceptsByMaterial[c.materialId] = [];
      conceptsByMaterial[c.materialId].push(c);
    }
    const matIds = Object.keys(conceptsByMaterial);
    console.log(`🧠 [Quiz Backend] Conceptos por material:`, matIds.map(id => `${id}: ${conceptsByMaterial[id].length}`).join(', '));

    // Calcular cuántas preguntas le tocan a cada material proporcionalmente
    const totalConcepts = allExtractedConcepts.length;
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
    console.log(`🧠 [Quiz Backend] Tareas por material:`, matIds.map(id => `${id}: ${tasksPerMaterial[id]}`).join(', '));

    // Generar tareas round-robin entre materiales para intercalar bien
    const cursors: Record<string, number> = {};
    matIds.forEach(id => { cursors[id] = 0; });

    // Crear lista intercalada: 1 de mat1, 1 de mat2, 1 de mat1, etc.
    const interleavedTasks: ConceptTask[] = [];
    const maxPerMat = Math.max(...matIds.map(id => tasksPerMaterial[id]));
    let typeIdx = 0;
    for (let i = 0; i < maxPerMat; i++) {
      for (const matId of matIds) {
        if (cursors[matId] >= tasksPerMaterial[matId]) continue;
        const concepts = conceptsByMaterial[matId];
        const concept = concepts[cursors[matId] % concepts.length];
        const type = tipos[typeIdx % tipos.length];
        interleavedTasks.push({
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
    selectedTasks.push(...interleavedTasks.slice(0, bufferCount));

    console.log(`🧠 [Quiz Backend] Tareas totales asignadas con distribución proporcional: ${selectedTasks.length}`);
    console.log(`🧠 [Quiz Backend] Distribución final:`, 
      matIds.map(id => `${id}: ${selectedTasks.filter(t => t.materialId === id).length}`).join(', '));'''

if OLD_TASKS in src:
    src = src.replace(OLD_TASKS, NEW_TASKS)
    print("✅ 1. Distribución proporcional por material arreglada")
else:
    print("❌ 1. No encontré el bloque de selectedTasks")

with open('app/api/quiz/route.ts', 'w', encoding='utf-8') as f:
    f.write(src)

print("✅ route.ts actualizado")
