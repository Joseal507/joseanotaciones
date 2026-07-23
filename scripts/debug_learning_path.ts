// Debug: ver las unidades que genera buildLearningPath
import { buildLearningPath } from '../lib/adaptive/buildLearningPath';

// Simular un blueprint mínimo desde lo que vemos en la UI
// (en producción esto vendría del blueprint real guardado en sesión)
const mockBlueprint = {
  topics: [
    { id: "topic_vida_y_formacion", title: "Vida y formación", pages: [3] },
    { id: "topic_el_problema_del_atomo", title: "El problema del átomo", pages: [4] },
    { id: "topic_modelo_atomico_de_bohr", title: "Modelo atómico de Bohr", pages: [4] },
    { id: "topic_mecanica_cuantica", title: "Mecánica cuántica e interpretación de Copenhague", pages: [3,4,5] },
    { id: "topic_liderazgo", title: "Liderazgo, ética y legado", pages: [4,5] },
    { id: "topic_contexto", title: "Contexto general", pages: [1,3,4] },
  ],
  blocks: [
    // Contexto general (foundation)
    { id: "b0", kind: "entity", label: "Niels Bohr", summary: "Niels Bohr was a scientist who changed our understanding of the universe.", topicId: "topic_contexto", topicLabel: "Contexto general", pages: [1], globalOrder: 0, importance: 50, difficulty: "basic", dependsOn: [], relatedTo: [], relations: [], bloomLevel: "remember" },
    { id: "b1", kind: "note", label: "Importance of Niels Bohr", summary: "Niels Bohr's work revolutionized physics.", topicId: "topic_contexto", topicLabel: "Contexto general", pages: [3], globalOrder: 1, importance: 50, difficulty: "basic", dependsOn: [], relatedTo: [], relations: [], bloomLevel: "remember" },

    // Vida y formación (foundation)
    { id: "b2", kind: "concept", label: "Bohr's Contribution to Quantum Mechanics", summary: "Bohr helped build the foundations of quantum mechanics.", topicId: "topic_vida_y_formacion", topicLabel: "Vida y formación", pages: [3], globalOrder: 2, importance: 85, difficulty: "intermediate", dependsOn: [], relatedTo: [], relations: [], bloomLevel: "understand" },
    { id: "b3", kind: "concept", label: "Understanding Atomic Structure", summary: "Bohr's discoveries helped us understand how atoms function.", topicId: "topic_vida_y_formacion", topicLabel: "Vida y formación", pages: [3], globalOrder: 3, importance: 80, difficulty: "intermediate", dependsOn: [], relatedTo: [], relations: [{ type: "explains", targetId: "b2", targetLabel: "Bohr's Contribution to Quantum Mechanics" }], bloomLevel: "apply" },
    { id: "b4", kind: "entity", label: "Bohr's Biography", summary: "Niels Bohr was born on October 7, 1885, in Copenhagen.", topicId: "topic_vida_y_formacion", topicLabel: "Vida y formación", pages: [3], globalOrder: 4, importance: 40, difficulty: "basic", dependsOn: [], relatedTo: [], relations: [], bloomLevel: "remember" },
    { id: "b5", kind: "note", label: "Bohr's Education", summary: "Bohr studied at the University of Copenhagen.", topicId: "topic_vida_y_formacion", topicLabel: "Vida y formación", pages: [3], globalOrder: 5, importance: 30, difficulty: "basic", dependsOn: [], relatedTo: [], relations: [], bloomLevel: "remember" },

    // El problema del átomo (problem)
    { id: "b6", kind: "entity", label: "Ernest Rutherford", summary: "Rutherford proposed the atomic nucleus model.", topicId: "topic_el_problema_del_atomo", topicLabel: "El problema del átomo", pages: [4], globalOrder: 6, importance: 50, difficulty: "basic", dependsOn: [], relatedTo: [], relations: [], bloomLevel: "remember" },
    { id: "b7", kind: "concept", label: "Limitations of Rutherford's Model", summary: "Rutherford's model had significant problems regarding electron stability.", topicId: "topic_el_problema_del_atomo", topicLabel: "El problema del átomo", pages: [4], globalOrder: 7, importance: 70, difficulty: "intermediate", dependsOn: [], relatedTo: [], relations: [{ type: "requires", targetId: "b6", targetLabel: "Ernest Rutherford" }], bloomLevel: "analyze" },

    // Modelo atómico de Bohr (mechanism)
    { id: "b8", kind: "concept", label: "Bohr's Atomic Model", summary: "Bohr developed a new model where electrons orbit in specific energy levels.", topicId: "topic_modelo_atomico_de_bohr", topicLabel: "Modelo atómico de Bohr", pages: [4], globalOrder: 8, importance: 90, difficulty: "intermediate", dependsOn: ["b7"], relatedTo: [], relations: [{ type: "extends", targetId: "b7", targetLabel: "Limitations of Rutherford's Model" }], bloomLevel: "apply" },
    { id: "b9", kind: "concept", label: "Energy Levels and Electron Transitions", summary: "Electrons jump between orbits by absorbing or emitting energy.", topicId: "topic_modelo_atomico_de_bohr", topicLabel: "Modelo atómico de Bohr", pages: [4], globalOrder: 9, importance: 85, difficulty: "intermediate", dependsOn: ["b8"], relatedTo: [], relations: [{ type: "example_of", targetId: "b8", targetLabel: "Bohr's Atomic Model" }], bloomLevel: "understand" },

    // Application
    { id: "b10", kind: "concept", label: "Explanation of the Hydrogen Spectrum", summary: "Bohr's model explained the hydrogen spectrum.", topicId: "topic_modelo_atomico_de_bohr", topicLabel: "Modelo atómico de Bohr", pages: [4], globalOrder: 10, importance: 80, difficulty: "intermediate", dependsOn: ["b8"], relatedTo: [], relations: [{ type: "example_of", targetId: "b8", targetLabel: "Bohr's Atomic Model" }], bloomLevel: "apply" },
    { id: "b11", kind: "formula", label: "Energy Levels Equation", summary: "En = -13.6 eV/n^2", topicId: "topic_modelo_atomico_de_bohr", topicLabel: "Modelo atómico de Bohr", pages: [4], globalOrder: 11, importance: 90, difficulty: "advanced", dependsOn: ["b8"], relatedTo: [], relations: [{ type: "example_of", targetId: "b8", targetLabel: "Bohr's Atomic Model" }], bloomLevel: "apply" },

    // Mecánica cuántica (integration)
    { id: "b12", kind: "concept", label: "Impact of Bohr's Work", summary: "Bohr's work opened a new understanding of reality.", topicId: "topic_mecanica_cuantica", topicLabel: "Mecánica cuántica e interpretación de Copenhague", pages: [4], globalOrder: 12, importance: 80, difficulty: "intermediate", dependsOn: ["b8"], relatedTo: [], relations: [{ type: "extends", targetId: "b2", targetLabel: "Bohr's Contribution to Quantum Mechanics" }], bloomLevel: "evaluate" },
    { id: "b13", kind: "concept", label: "Quantum Mechanics and Reality", summary: "Quantum discoveries showed subatomic particles behave strangely.", topicId: "topic_mecanica_cuantica", topicLabel: "Mecánica cuántica e interpretación de Copenhague", pages: [4], globalOrder: 13, importance: 85, difficulty: "advanced", dependsOn: ["b12"], relatedTo: [], relations: [{ type: "extends", targetId: "b2", targetLabel: "Bohr's Contribution to Quantum Mechanics" }], bloomLevel: "analyze" },
    { id: "b14", kind: "concept", label: "Copenhagen Interpretation", summary: "Particles lack defined properties until observed.", topicId: "topic_mecanica_cuantica", topicLabel: "Mecánica cuántica e interpretación de Copenhague", pages: [4], globalOrder: 14, importance: 85, difficulty: "advanced", dependsOn: ["b13"], relatedTo: [], relations: [{ type: "extends", targetId: "b13", targetLabel: "Quantum Mechanics and Reality" }], bloomLevel: "analyze" },
    { id: "b15", kind: "concept", label: "Philosophical Implications of Quantum Mechanics", summary: "Bohr's ideas force a rethinking of reality and knowledge.", topicId: "topic_mecanica_cuantica", topicLabel: "Mecánica cuántica e interpretación de Copenhague", pages: [4], globalOrder: 15, importance: 80, difficulty: "advanced", dependsOn: ["b14"], relatedTo: [], relations: [{ type: "extends", targetId: "b14", targetLabel: "Copenhagen Interpretation" }], bloomLevel: "evaluate" },

    // Liderazgo (context)
    { id: "b16", kind: "entity", label: "Bohr as a Leader", summary: "Bohr was a leader in the scientific revolution.", topicId: "topic_liderazgo", topicLabel: "Liderazgo, ética y legado", pages: [4], globalOrder: 16, importance: 50, difficulty: "basic", dependsOn: [], relatedTo: [], relations: [], bloomLevel: "remember" },
    { id: "b17", kind: "entity", label: "Niels Bohr Institute", summary: "Bohr founded the Niels Bohr Institute.", topicId: "topic_liderazgo", topicLabel: "Liderazgo, ética y legado", pages: [4], globalOrder: 17, importance: 55, difficulty: "basic", dependsOn: [], relatedTo: [], relations: [], bloomLevel: "remember" },
    { id: "b18", kind: "concept", label: "Collaboration and Debate", summary: "Bohr fostered scientific creativity.", topicId: "topic_liderazgo", topicLabel: "Liderazgo, ética y legado", pages: [4], globalOrder: 18, importance: 60, difficulty: "intermediate", dependsOn: [], relatedTo: [{ type: "extends", targetId: "b16", targetLabel: "Bohr as a Leader" }], relations: [], bloomLevel: "evaluate" },
    { id: "b19", kind: "entity", label: "Bohr's Role in World War II", summary: "Bohr played a role in nuclear energy during WWII.", topicId: "topic_liderazgo", topicLabel: "Liderazgo, ética y legado", pages: [4], globalOrder: 19, importance: 40, difficulty: "basic", dependsOn: [], relatedTo: [], relations: [], bloomLevel: "remember" },
    { id: "b20", kind: "fact", label: "Nobel Prize in Physics", summary: "Bohr received the Nobel Prize in 1922.", topicId: "topic_liderazgo", topicLabel: "Liderazgo, ética y legado", pages: [5], globalOrder: 20, importance: 60, difficulty: "basic", dependsOn: [], relatedTo: [], relations: [], bloomLevel: "remember" },
    { id: "b21", kind: "concept", label: "Bohr's Impact on Technology", summary: "Bohr's ideas led to nuclear energy, semiconductors, and lasers.", topicId: "topic_liderazgo", topicLabel: "Liderazgo, ética y legado", pages: [5], globalOrder: 21, importance: 85, difficulty: "intermediate", dependsOn: [], relatedTo: [], relations: [], bloomLevel: "evaluate" },
    { id: "b22", kind: "concept", label: "Bohr's Contribution to Science", summary: "Bohr changed the understanding of the atom.", topicId: "topic_liderazgo", topicLabel: "Liderazgo, ética y legado", pages: [5], globalOrder: 22, importance: 90, difficulty: "advanced", dependsOn: [], relatedTo: [], relations: [], bloomLevel: "create" },
    { id: "b23", kind: "concept", label: "Bohr's Legacy in Physics", summary: "Bohr's legacy continues in contemporary physics.", topicId: "topic_liderazgo", topicLabel: "Liderazgo, ética y legado", pages: [5], globalOrder: 23, importance: 88, difficulty: "intermediate", dependsOn: [], relatedTo: [], relations: [], bloomLevel: "analyze" },
  ],
  concepts: [
    { id: "c0", name: "Bohr's Contribution to Quantum Mechanics", kind: "concept", importance: 85, pages: [3] },
    { id: "c1", name: "Understanding Atomic Structure", kind: "concept", importance: 80, pages: [3] },
    { id: "c2", name: "Limitations of Rutherford's Model", kind: "concept", importance: 70, pages: [4] },
    { id: "c3", name: "Bohr's Atomic Model", kind: "concept", importance: 90, pages: [4] },
    { id: "c4", name: "Energy Levels and Electron Transitions", kind: "concept", importance: 85, pages: [4] },
    { id: "c5", name: "Explanation of the Hydrogen Spectrum", kind: "concept", importance: 80, pages: [4] },
    { id: "c6", name: "Energy Levels Equation", kind: "formula", importance: 90, pages: [4] },
    { id: "c7", name: "Impact of Bohr's Work", kind: "concept", importance: 80, pages: [4] },
    { id: "c8", name: "Quantum Mechanics and Reality", kind: "concept", importance: 85, pages: [4] },
    { id: "c9", name: "Copenhagen Interpretation", kind: "concept", importance: 85, pages: [4] },
    { id: "c10", name: "Philosophical Implications of Quantum Mechanics", kind: "concept", importance: 80, pages: [4] },
    { id: "c11", name: "Bohr's Impact on Technology", kind: "concept", importance: 85, pages: [5] },
    { id: "c12", name: "Bohr's Contribution to Science", kind: "concept", importance: 90, pages: [5] },
    { id: "c13", name: "Bohr's Legacy in Physics", kind: "concept", importance: 88, pages: [5] },
  ]
};

const path = buildLearningPath(mockBlueprint);

console.log('\n═══ UNITS GENERADAS ═══');
for (const unit of path.units) {
  console.log(`\n[${unit.id}] role=${unit.role} title="${unit.title}"`);
  console.log(`  orderHint=${unit.orderHint} depth=${unit.dependencyDepth}`);
  console.log(`  blocks=${unit.blockIds.length} concepts=${unit.concepts.slice(0,3).join(', ')}`);
  console.log(`  prereqs=[${unit.prerequisiteUnitIds.join(', ')}]`);
  console.log(`  unlocks=[${unit.unlocksUnitIds.join(', ')}]`);
}

console.log('\n═══ ORDEN TOPOLÓGICO ═══');
path.orderedUnitIds.forEach((id, i) => {
  const u = path.units.find(u => u.id === id)!;
  console.log(`  ${i+1}. [${id}] role=${u.role} "${u.title}"`);
});

console.log('\n═══ EDGES ═══');
for (const e of path.edges) {
  const from = path.units.find(u => u.id === e.fromUnitId);
  const to = path.units.find(u => u.id === e.toUnitId);
  console.log(`  "${from?.title}" → "${to?.title}" (${e.reason})`);
}
