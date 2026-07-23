import { buildLearningPath } from '../lib/adaptive/buildLearningPath';
import { buildLearningArcs } from '../lib/adaptive/buildLearningArcs';

const equilibrioBlueprint = {
  topics: [
    { id: "t1", title: "Equilibrio dinámico", pages: [1,2] },
    { id: "t2", title: "Constante de equilibrio Kc", pages: [2,3] },
    { id: "t3", title: "Kp y relación con Kc", pages: [3,4] },
    { id: "t4", title: "Significado e interpretación de K", pages: [4] },
    { id: "t5", title: "Cálculos de equilibrio", pages: [5,6] },
    { id: "t6", title: "Cociente de reacción Q", pages: [6] },
    { id: "t7", title: "Principio de Le Châtelier", pages: [7,8] },
    { id: "t8", title: "Catalizadores", pages: [8] },
  ],
  blocks: [
    { id: "b1", kind: "concept", label: "Equilibrio dinámico", summary: "Estado donde las velocidades de reacción directa e inversa son iguales.", topicId: "t1", topicLabel: "Equilibrio dinámico", pages: [1], globalOrder: 0, importance: 85, difficulty: "intermediate", dependsOn: [], relatedTo: [], relations: [], bloomLevel: "understand" },
    { id: "b2", kind: "concept", label: "Concentraciones constantes", summary: "Las concentraciones no cambian en equilibrio.", topicId: "t1", topicLabel: "Equilibrio dinámico", pages: [2], globalOrder: 1, importance: 80, difficulty: "basic", dependsOn: ["b1"], relatedTo: [], relations: [{type:"requires", targetId:"b1", targetLabel:"Equilibrio dinámico"}], bloomLevel: "understand" },
    { id: "b3", kind: "formula", label: "Expresión de Kc", summary: "Kc = [productos]^coef / [reactivos]^coef", topicId: "t2", topicLabel: "Constante de equilibrio Kc", pages: [2], globalOrder: 2, importance: 95, difficulty: "advanced", dependsOn: ["b1"], relatedTo: [], relations: [{type:"requires", targetId:"b1", targetLabel:"Equilibrio dinámico"}], bloomLevel: "apply" },
    { id: "b4", kind: "concept", label: "Construcción de Kc", summary: "Solo gases y soluciones acuosas.", topicId: "t2", topicLabel: "Constante de equilibrio Kc", pages: [3], globalOrder: 3, importance: 88, difficulty: "intermediate", dependsOn: ["b3"], relatedTo: [], relations: [], bloomLevel: "apply" },
    { id: "b5", kind: "formula", label: "Expresión de Kp", summary: "Kp usa presiones parciales.", topicId: "t3", topicLabel: "Kp y relación con Kc", pages: [3], globalOrder: 4, importance: 90, difficulty: "advanced", dependsOn: ["b3"], relatedTo: [], relations: [{type:"requires", targetId:"b3", targetLabel:"Expresión de Kc"}], bloomLevel: "apply" },
    { id: "b6", kind: "formula", label: "Kp = Kc(RT)^Δn", summary: "Δn = diferencia en moles de gas.", topicId: "t3", topicLabel: "Kp y relación con Kc", pages: [4], globalOrder: 5, importance: 92, difficulty: "advanced", dependsOn: ["b3","b5"], relatedTo: [], relations: [], bloomLevel: "analyze" },
    { id: "b7", kind: "concept", label: "Interpretación de K", summary: "K>>1 favorece productos; K<<1 favorece reactivos.", topicId: "t4", topicLabel: "Significado e interpretación de K", pages: [4], globalOrder: 6, importance: 85, difficulty: "intermediate", dependsOn: ["b3"], relatedTo: [], relations: [], bloomLevel: "evaluate" },
    { id: "b8", kind: "example", label: "Tabla ICE", summary: "Inicial, Cambio, Equilibrio para calcular concentraciones.", topicId: "t5", topicLabel: "Cálculos de equilibrio", pages: [5], globalOrder: 7, importance: 90, difficulty: "advanced", dependsOn: ["b3","b4"], relatedTo: [], relations: [], bloomLevel: "apply" },
    { id: "b9", kind: "formula", label: "Cociente Q", summary: "Q vs K predice dirección de reacción.", topicId: "t6", topicLabel: "Cociente de reacción Q", pages: [6], globalOrder: 8, importance: 88, difficulty: "intermediate", dependsOn: ["b3","b7"], relatedTo: [], relations: [], bloomLevel: "analyze" },
    { id: "b10", kind: "concept", label: "Principio de Le Châtelier", summary: "El sistema se desplaza para minimizar la perturbación.", topicId: "t7", topicLabel: "Principio de Le Châtelier", pages: [7], globalOrder: 9, importance: 92, difficulty: "intermediate", dependsOn: ["b1","b7"], relatedTo: [], relations: [], bloomLevel: "evaluate" },
    { id: "b11", kind: "concept", label: "Efecto de temperatura", summary: "T afecta el equilibrio y cambia K.", topicId: "t7", topicLabel: "Principio de Le Châtelier", pages: [7], globalOrder: 10, importance: 88, difficulty: "intermediate", dependsOn: ["b10"], relatedTo: [], relations: [], bloomLevel: "analyze" },
    { id: "b12", kind: "concept", label: "Catalizadores en equilibrio", summary: "Aceleran ambas reacciones; no cambian K.", topicId: "t8", topicLabel: "Catalizadores", pages: [8], globalOrder: 11, importance: 80, difficulty: "basic", dependsOn: ["b1"], relatedTo: [], relations: [], bloomLevel: "understand" },
  ],
  concepts: [
    { id: "c1", name: "Equilibrio dinámico", kind: "concept", importance: 85, pages: [1] },
    { id: "c2", name: "Kc", kind: "formula", importance: 95, pages: [2] },
    { id: "c3", name: "Kp", kind: "formula", importance: 90, pages: [3] },
    { id: "c4", name: "Relación Kp-Kc", kind: "formula", importance: 92, pages: [4] },
    { id: "c5", name: "Tabla ICE", kind: "example", importance: 90, pages: [5] },
    { id: "c6", name: "Cociente Q", kind: "concept", importance: 88, pages: [6] },
    { id: "c7", name: "Le Châtelier", kind: "concept", importance: 92, pages: [7] },
    { id: "c8", name: "Catalizadores", kind: "concept", importance: 80, pages: [8] },
  ]
};

console.log('\n════════════════════════════════════');
console.log('EQUILIBRIO QUÍMICO — debug del motor');
console.log('════════════════════════════════════\n');

try {
  const path = buildLearningPath(equilibrioBlueprint);
  const arcs = buildLearningArcs(path);

  console.log(`Units generadas: ${path.units.length}`);
  path.units.forEach((u, i) => {
    console.log(`  unit_${i} [${u.role}] orderHint=${u.orderHint} topic="${u.topicLabels?.[0]||''}" blocks=${u.blockIds.length} deps=[${( u?.dependsOnTopicIds || []).join(',')}]`);
  });

  console.log('\n═══ ORDEN TOPOLÓGICO ═══');
  path.orderedUnitIds.forEach((id, i) => {
    const u = path.units.find(u => u.id === id)!;
    console.log(`  ${i+1}. [${u.role}] orderHint=${u.orderHint} topic="${u.topicLabels?.[0]||''}" deps=[${( u?.dependsOnTopicIds || []).join(',')}]`);
  });

  console.log('\n═══ EDGES ═══');
  path.edges.forEach(e => {
    const from = path.units.find(u => u.id === e.fromUnitId);
    const to   = path.units.find(u => u.id === e.toUnitId);
    console.log(`  "${from?.topicLabels?.[0]||from?.title}" → "${to?.topicLabels?.[0]||to?.title}" (${e.reason})`);
  });

  console.log('\n═══ ARCOS ═══');
  arcs.forEach(a => {
    console.log(`  [${a.role}] "${a.title}" — ${a.unitIds.length} units`);
    a.unitIds.forEach(uid => {
      const u = path.units.find(u => u.id === uid)!;
      console.log(`    └ ${uid} [${u?.role}] "${u?.topicLabels?.[0]||''}"`);
    });
  });

} catch(e: any) {
  console.error('ERROR:', e.message);
  console.error(e.stack);
}
