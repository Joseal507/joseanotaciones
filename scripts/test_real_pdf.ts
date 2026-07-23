// Test completo con PDF real: extrae texto, simula blueprint, genera plan
// para todas las combinaciones de setup

import { readFileSync, existsSync } from 'fs';
import { buildLearningPath } from '../lib/adaptive/buildLearningPath';
import { buildLearningArcs } from '../lib/adaptive/buildLearningArcs';
import { buildChaptersFromArcs } from '../lib/adaptive/buildChaptersFromArcs';
import type { AdaptiveSetup } from '../lib/studySessions';

// ─── Setup combinations ───────────────────────────────────────
const SETUPS: { name: string; setup: Partial<AdaptiveSetup> }[] = [
  { name: 'HOY + nunca lo he visto',       setup: { examDateType: 'today',        knowledgeLevel: 'never_seen'  } },
  { name: 'HOY + ya lo conozco',           setup: { examDateType: 'today',        knowledgeLevel: 'already_know'} },
  { name: 'MAÑANA + nunca lo he visto',    setup: { examDateType: 'tomorrow',     knowledgeLevel: 'never_seen'  } },
  { name: 'MAÑANA + quiero repasar',       setup: { examDateType: 'tomorrow',     knowledgeLevel: 'want_review' } },
  { name: 'ESTA SEMANA + nunca lo he visto',setup: { examDateType: 'this_week',   knowledgeLevel: 'never_seen'  } },
  { name: 'ESTA SEMANA + lo conozco poco', setup: { examDateType: 'this_week',    knowledgeLevel: 'know_little' } },
  { name: 'SIN EXAMEN + nunca lo he visto',setup: { examDateType: 'just_studying',knowledgeLevel: 'never_seen'  } },
  { name: 'SIN EXAMEN + ya lo conozco',    setup: { examDateType: 'just_studying',knowledgeLevel: 'already_know'} },
];

const BASE_SETUP: AdaptiveSetup = {
  knowledgeLevel: 'never_seen',
  examDateType: 'tomorrow',
  examDateCustom: '',
  targetScore: 100,
  mainConcern: '',
  professorExamStyle: [],
  evalPreference: 'quick_test',
  planView: 'book',
  completedAt: Date.now(),
};

// ─── Blueprint simulado desde el análisis real de Niels Bohr ─
// (basado en lo que el extractor de IA produce consistentemente)
const NIELS_BOHR_BLUEPRINT = {
  topics: [
    { id: "topic_contexto_general",      title: "Contexto general",      pages: [1,3] },
    { id: "topic_vida_y_formacion",      title: "Vida y formación",      pages: [3]   },
    { id: "topic_el_problema_del_atomo", title: "El problema del átomo", pages: [4]   },
    { id: "topic_modelo_atomico_de_bohr",title: "Modelo atómico de Bohr",pages: [4]   },
    { id: "topic_mecanica_cuantica",     title: "Mecánica cuántica e interpretación de Copenhague", pages: [3,4,5] },
    { id: "topic_liderazgo",             title: "Liderazgo, ética y legado", pages: [4,5] },
  ],
  blocks: [
    { id: "b_niels_bohr",       kind: "entity",  label: "Niels Bohr",            topicId: "topic_contexto_general",      topicLabel: "Contexto general",      pages: [1], globalOrder: 0,  importance: 50, difficulty: "basic",        dependsOn: [],              relations: [], bloomLevel: "remember"  },
    { id: "b_context_impact",   kind: "concept", label: "Bohr's Impact",          topicId: "topic_contexto_general",      topicLabel: "Contexto general",      pages: [3], globalOrder: 1,  importance: 80, difficulty: "intermediate",  dependsOn: [],              relations: [], bloomLevel: "understand" },
    { id: "b_biography",        kind: "entity",  label: "Bohr's Biography",       topicId: "topic_vida_y_formacion",      topicLabel: "Vida y formación",      pages: [3], globalOrder: 2,  importance: 40, difficulty: "basic",        dependsOn: ["b_niels_bohr"],relations: [], bloomLevel: "remember"  },
    { id: "b_education",        kind: "fact",    label: "Bohr's Education",        topicId: "topic_vida_y_formacion",      topicLabel: "Vida y formación",      pages: [3], globalOrder: 3,  importance: 35, difficulty: "basic",        dependsOn: ["b_biography"], relations: [], bloomLevel: "remember"  },
    { id: "b_rutherford",       kind: "entity",  label: "Ernest Rutherford",       topicId: "topic_el_problema_del_atomo", topicLabel: "El problema del átomo", pages: [4], globalOrder: 4,  importance: 50, difficulty: "basic",        dependsOn: [],              relations: [], bloomLevel: "remember"  },
    { id: "b_rutherford_lim",   kind: "concept", label: "Rutherford's Limitations",topicId: "topic_el_problema_del_atomo", topicLabel: "El problema del átomo", pages: [4], globalOrder: 5,  importance: 70, difficulty: "intermediate",  dependsOn: ["b_rutherford"],relations: [], bloomLevel: "analyze"  },
    { id: "b_bohr_model",       kind: "concept", label: "Bohr's Atomic Model",     topicId: "topic_modelo_atomico_de_bohr",topicLabel: "Modelo atómico de Bohr",pages: [4], globalOrder: 6,  importance: 95, difficulty: "advanced",      dependsOn: ["b_rutherford_lim"], relations: [], bloomLevel: "apply" },
    { id: "b_energy_levels",    kind: "concept", label: "Electron Energy Levels",  topicId: "topic_modelo_atomico_de_bohr",topicLabel: "Modelo atómico de Bohr",pages: [4], globalOrder: 7,  importance: 90, difficulty: "advanced",      dependsOn: ["b_bohr_model"],relations: [], bloomLevel: "apply"    },
    { id: "b_hydrogen",         kind: "example", label: "Hydrogen Spectrum",        topicId: "topic_modelo_atomico_de_bohr",topicLabel: "Modelo atómico de Bohr",pages: [4], globalOrder: 8,  importance: 80, difficulty: "intermediate",  dependsOn: ["b_energy_levels"], relations: [], bloomLevel: "apply" },
    { id: "b_equation",         kind: "formula", label: "Energy Level Equation",   topicId: "topic_modelo_atomico_de_bohr",topicLabel: "Modelo atómico de Bohr",pages: [4], globalOrder: 9,  importance: 95, difficulty: "advanced",      dependsOn: ["b_energy_levels"], relations: [], bloomLevel: "apply" },
    { id: "b_quantum",          kind: "concept", label: "Quantum Mechanics",        topicId: "topic_mecanica_cuantica",     topicLabel: "Mecánica cuántica e interpretación de Copenhague", pages: [4], globalOrder: 10, importance: 85, difficulty: "advanced", dependsOn: ["b_bohr_model"], relations: [], bloomLevel: "evaluate" },
    { id: "b_copenhagen",       kind: "concept", label: "Copenhagen Interpretation",topicId: "topic_mecanica_cuantica",     topicLabel: "Mecánica cuántica e interpretación de Copenhague", pages: [4], globalOrder: 11, importance: 90, difficulty: "advanced", dependsOn: ["b_quantum"],   relations: [], bloomLevel: "evaluate" },
    { id: "b_philosophical",    kind: "concept", label: "Philosophical Implications",topicId: "topic_mecanica_cuantica",    topicLabel: "Mecánica cuántica e interpretación de Copenhague", pages: [4], globalOrder: 12, importance: 85, difficulty: "advanced", dependsOn: ["b_copenhagen"],relations: [], bloomLevel: "create"   },
    { id: "b_leadership",       kind: "concept", label: "Bohr's Leadership",        topicId: "topic_liderazgo",             topicLabel: "Liderazgo, ética y legado", pages: [4], globalOrder: 13, importance: 75, difficulty: "intermediate", dependsOn: [], relations: [], bloomLevel: "evaluate" },
    { id: "b_institute",        kind: "entity",  label: "Niels Bohr Institute",     topicId: "topic_liderazgo",             topicLabel: "Liderazgo, ética y legado", pages: [4], globalOrder: 14, importance: 55, difficulty: "basic",       dependsOn: ["b_leadership"],relations: [], bloomLevel: "remember"  },
    { id: "b_technology",       kind: "concept", label: "Bohr's Impact on Technology",topicId: "topic_liderazgo",           topicLabel: "Liderazgo, ética y legado", pages: [5], globalOrder: 15, importance: 85, difficulty: "intermediate", dependsOn: [], relations: [], bloomLevel: "evaluate" },
    { id: "b_legacy",           kind: "concept", label: "Bohr's Legacy in Physics",  topicId: "topic_liderazgo",            topicLabel: "Liderazgo, ética y legado", pages: [5], globalOrder: 16, importance: 88, difficulty: "intermediate", dependsOn: ["b_leadership"],relations: [], bloomLevel: "remember"  },
  ],
  concepts: [
    { id: "c1", name: "Bohr's Impact",             kind: "concept", importance: 80, pages: [3] },
    { id: "c2", name: "Rutherford's Limitations",  kind: "concept", importance: 70, pages: [4] },
    { id: "c3", name: "Bohr's Atomic Model",       kind: "concept", importance: 95, pages: [4] },
    { id: "c4", name: "Electron Energy Levels",    kind: "concept", importance: 90, pages: [4] },
    { id: "c5", name: "Energy Level Equation",     kind: "formula", importance: 95, pages: [4] },
    { id: "c6", name: "Hydrogen Spectrum",         kind: "example", importance: 80, pages: [4] },
    { id: "c7", name: "Copenhagen Interpretation", kind: "concept", importance: 90, pages: [4] },
    { id: "c8", name: "Philosophical Implications",kind: "concept", importance: 85, pages: [4] },
    { id: "c9", name: "Bohr's Impact on Technology",kind: "concept",importance: 85, pages: [5] },
    { id: "c10",name: "Bohr's Legacy in Physics",  kind: "concept", importance: 88, pages: [5] },
  ]
};

// ─── Validación ───────────────────────────────────────────────
function validate(chapters: any[], setupName: string): string[] {
  const errors: string[] = [];
  const learning = chapters.filter((c:any) => c.type !== 'intro' && c.type !== 'final_review');

  // 1. Sin títulos duplicados
  const titles = learning.map((c:any) => c.title);
  const seen = new Set<string>();
  for (const t of titles) {
    if (seen.has(t)) errors.push(`TÍTULO DUPLICADO: "${t}"`);
    seen.add(t);
  }

  // 2. Sin capítulos sin bloques
  for (const ch of learning) {
    if ((ch.blockIds || []).length === 0) {
      errors.push(`CAPÍTULO VACÍO: "${ch.title}"`);
    }
  }

  // 3. Presupuesto
  const budgets: Record<string, number> = {
    'today': 7, 'tomorrow': 9, 'this_week': 12, 'just_studying': 14
  };
  // Se extrae el examDateType del nombre
  const examType = setupName.includes('HOY') ? 'today'
    : setupName.includes('MAÑANA') ? 'tomorrow'
    : setupName.includes('SEMANA') ? 'this_week'
    : 'just_studying';
  const max = budgets[examType];
  if (chapters.length > max) {
    errors.push(`DEMASIADAS SESIONES: ${chapters.length} > ${max}`);
  }

  return errors;
}

// ─── Runner ───────────────────────────────────────────────────
console.log('\n' + '═'.repeat(70));
console.log('TEST COMPLETO: Niels Bohr PDF — todas las combinaciones de setup');
console.log('═'.repeat(70));

let totalErrors = 0;
const results: Record<string, number> = {};

// Construir learning path una sola vez (es el mismo para todos los setups)
const path = buildLearningPath(NIELS_BOHR_BLUEPRINT as any);
const arcs = buildLearningArcs(path);

console.log(`\nUnidades del material: ${path.units.length}`);
console.log('Orden del material:');
path.orderedUnitIds.forEach((id, i) => {
  const u = path.units.find(u => u.id === id)!;
  console.log(`  ${i+1}. [${(u as any).role}] "${(u as any).topicLabel}" — ${(u as any).blockIds?.length} bloques`);
});

console.log('\n' + '─'.repeat(70));
console.log('RESULTADOS POR SETUP:');
console.log('─'.repeat(70));

for (const { name, setup } of SETUPS) {
  const fullSetup = { ...BASE_SETUP, ...setup } as AdaptiveSetup;

  const chapters = buildChaptersFromArcs(path, arcs, fullSetup);
  const allChapters = [
    { type: 'intro', title: 'Antes de comenzar', blockIds: [] },
    ...chapters,
    { type: 'final_review', title: 'Conquista final', blockIds: [] },
  ];

  const errors = validate(allChapters, name);
  totalErrors += errors.length;
  results[name] = allChapters.length;

  const status = errors.length === 0 ? '✅' : '❌';
  console.log(`\n${status} ${name}: ${allChapters.length} sesiones`);

  allChapters.forEach((ch: any, i: number) => {
    const icon = ch.type === 'intro' ? '📖' : ch.type === 'final_review' ? '🏁' : '📘';
    const blocks = (ch.blockIds || []).length;
    console.log(`   ${icon} ${i+1}. "${ch.title}" [${blocks} bloques]`);
  });

  if (errors.length > 0) {
    errors.forEach(e => console.log(`   ⚠️  ${e}`));
  }
}

// Verificar monotonía por nivel de conocimiento
console.log('\n' + '─'.repeat(70));
console.log('VERIFICACIÓN DE MONOTONÍA:');
console.log('─'.repeat(70));

const examTypes = ['HOY', 'MAÑANA', 'ESTA SEMANA', 'SIN EXAMEN'];
const levels = ['nunca lo he visto', 'ya lo conozco'];

for (const level of levels) {
  const counts = examTypes.map(e => {
    const key = Object.keys(results).find(k => k.includes(e) && k.toLowerCase().includes(level.split(' ')[0]));
    return key ? results[key] : 0;
  }).filter(Boolean);

  if (counts.length >= 2) {
    const mono = counts.every((v, i) => i === 0 || v >= counts[i-1]);
    const status = mono ? '✅' : '⚠️ ';
    console.log(`${status} ${level}: ${counts.join(' ≤ ')}`);
  }
}

console.log('\n' + '═'.repeat(70));
const finalStatus = totalErrors === 0 ? '✅ TODOS LOS TESTS PASARON' : `❌ ${totalErrors} ERRORES`;
console.log(`RESULTADO FINAL: ${finalStatus}`);
console.log('═'.repeat(70) + '\n');
