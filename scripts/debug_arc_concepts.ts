import { buildLearningPath } from '../lib/adaptive/buildLearningPath';
import { buildLearningArcs } from '../lib/adaptive/buildLearningArcs';

const mockBlueprint = {
  topics: [
    { id: "topic_vida", title: "Vida y formación", pages: [3] },
    { id: "topic_problema", title: "El problema del átomo", pages: [4] },
    { id: "topic_modelo", title: "Modelo atómico de Bohr", pages: [4] },
    { id: "topic_quantum", title: "Mecánica cuántica e interpretación de Copenhague", pages: [4,5] },
    { id: "topic_legado", title: "Liderazgo, ética y legado", pages: [4,5] },
    { id: "topic_contexto", title: "Contexto general", pages: [1,3] },
  ],
  blocks: [
    { id: "b0", kind: "entity", label: "Niels Bohr", summary: "Niels Bohr was a scientist...", topicId: "topic_contexto", topicLabel: "Contexto general", pages: [1], globalOrder: 0, importance: 50, difficulty: "basic", dependsOn: [], relatedTo: [], relations: [], bloomLevel: "remember" },
    { id: "b1", kind: "concept", label: "Bohr's Impact on Science", summary: "Bohr's work revolutionized physics.", topicId: "topic_vida", topicLabel: "Vida y formación", pages: [3], globalOrder: 1, importance: 85, difficulty: "intermediate", dependsOn: [], relatedTo: [], relations: [], bloomLevel: "understand" },
    { id: "b2", kind: "entity", label: "Bohr's Biography", summary: "Niels Bohr was born on October 7, 1885...", topicId: "topic_vida", topicLabel: "Vida y formación", pages: [3], globalOrder: 2, importance: 40, difficulty: "basic", dependsOn: [], relatedTo: [], relations: [], bloomLevel: "remember" },
    { id: "b3", kind: "entity", label: "Ernest Rutherford", summary: "Rutherford proposed the nucleus model.", topicId: "topic_problema", topicLabel: "El problema del átomo", pages: [4], globalOrder: 3, importance: 50, difficulty: "basic", dependsOn: [], relatedTo: [], relations: [], bloomLevel: "remember" },
    { id: "b4", kind: "concept", label: "Limitations of Rutherford's Model", summary: "The model had problems with electron stability.", topicId: "topic_problema", topicLabel: "El problema del átomo", pages: [4], globalOrder: 4, importance: 70, difficulty: "intermediate", dependsOn: [], relatedTo: [], relations: [{ type: "requires", targetId: "b3", targetLabel: "Ernest Rutherford" }], bloomLevel: "analyze" },
    { id: "b5", kind: "concept", label: "Bohr's Atomic Model", summary: "Bohr developed a new model in 1913.", topicId: "topic_modelo", topicLabel: "Modelo atómico de Bohr", pages: [4], globalOrder: 5, importance: 90, difficulty: "advanced", dependsOn: ["b4"], relatedTo: [], relations: [{ type: "extends", targetId: "b4", targetLabel: "Limitations of Rutherford's Model" }], bloomLevel: "apply" },
    { id: "b6", kind: "concept", label: "Electron Energy Levels", summary: "Electrons jump between orbits.", topicId: "topic_modelo", topicLabel: "Modelo atómico de Bohr", pages: [4], globalOrder: 6, importance: 85, difficulty: "intermediate", dependsOn: ["b5"], relatedTo: [], relations: [], bloomLevel: "apply" },
    { id: "b7", kind: "formula", label: "Energy Level Equation", summary: "En = -13.6 eV/n^2", topicId: "topic_modelo", topicLabel: "Modelo atómico de Bohr", pages: [4], globalOrder: 7, importance: 95, difficulty: "advanced", dependsOn: ["b6"], relatedTo: [], relations: [], bloomLevel: "apply" },
    { id: "b8", kind: "concept", label: "Copenhagen Interpretation", summary: "Particles lack defined properties until observed.", topicId: "topic_quantum", topicLabel: "Mecánica cuántica e interpretación de Copenhague", pages: [4], globalOrder: 8, importance: 85, difficulty: "advanced", dependsOn: ["b5"], relatedTo: [], relations: [{ type: "extends", targetId: "b5", targetLabel: "Bohr's Atomic Model" }], bloomLevel: "evaluate" },
    { id: "b9", kind: "concept", label: "Bohr's Leadership in Science", summary: "Bohr was a leader in the scientific revolution.", topicId: "topic_legado", topicLabel: "Liderazgo, ética y legado", pages: [4], globalOrder: 9, importance: 75, difficulty: "intermediate", dependsOn: [], relatedTo: [], relations: [], bloomLevel: "evaluate" },
    { id: "b10", kind: "concept", label: "Bohr's Impact on Technology", summary: "Bohr's ideas led to nuclear energy and semiconductors.", topicId: "topic_legado", topicLabel: "Liderazgo, ética y legado", pages: [5], globalOrder: 10, importance: 85, difficulty: "intermediate", dependsOn: [], relatedTo: [], relations: [], bloomLevel: "evaluate" },
  ],
  concepts: [
    { id: "c0", name: "Bohr's Impact on Science", kind: "concept", importance: 85, pages: [3] },
    { id: "c1", name: "Limitations of Rutherford's Model", kind: "concept", importance: 70, pages: [4] },
    { id: "c2", name: "Bohr's Atomic Model", kind: "concept", importance: 90, pages: [4] },
    { id: "c3", name: "Electron Energy Levels", kind: "concept", importance: 85, pages: [4] },
    { id: "c4", name: "Energy Level Equation", kind: "formula", importance: 95, pages: [4] },
    { id: "c5", name: "Copenhagen Interpretation", kind: "concept", importance: 85, pages: [4] },
    { id: "c6", name: "Bohr's Impact on Technology", kind: "concept", importance: 85, pages: [5] },
  ]
};

const path = buildLearningPath(mockBlueprint);
const arcs = buildLearningArcs(path);

console.log('\n═══ ARCOS Y SUS CONCEPTOS ═══\n');
for (const arc of arcs) {
  console.log(`[${arc.id}] role=${arc.role}`);
  console.log(`  title: "${arc.title}"`);
  console.log(`  purpose: "${arc.purpose}"`);

  const unitMap = new Map(path.units.map(u => [u.id, u]));
  const units = arc.unitIds.map(id => unitMap.get(id)!).filter(Boolean);
  const concepts = units.flatMap(u => u.concepts || []);
  console.log(`  concepts raw: [${concepts.map(c => `"${c}"`).join(', ')}]`);
  console.log('');
}
