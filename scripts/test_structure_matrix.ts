import { buildLearningPath } from '../lib/adaptive/buildLearningPath';
import { buildLearningArcs } from '../lib/adaptive/buildLearningArcs';
import { buildChaptersFromArcs } from '../lib/adaptive/buildChaptersFromArcs';
import type { AdaptiveSetup } from '../lib/studySessions';

// ─────────────────────────────────────────────
// FIXTURE CANÓNICO: NIELS BOHR
// (solo para test estructural del planner)
// ─────────────────────────────────────────────
const BLUEPRINT = {
  topics: [
    { id: "t_context", title: "Contexto general", pages: [1,3] },
    { id: "t_life", title: "Vida y formación", pages: [3] },
    { id: "t_problem", title: "El problema del átomo", pages: [4] },
    { id: "t_model", title: "Modelo atómico de Bohr", pages: [4] },
    { id: "t_quantum", title: "Mecánica cuántica e interpretación de Copenhague", pages: [4,5] },
    { id: "t_legacy", title: "Liderazgo, ética y legado", pages: [4,5] },
  ],
  blocks: [
    { id: "b1", kind: "entity",  label: "Niels Bohr", summary: "Niels Bohr was a scientist.", topicId: "t_context", topicLabel: "Contexto general", pages: [1], globalOrder: 0, importance: 50, difficulty: "basic", dependsOn: [], relations: [], bloomLevel: "remember" },
    { id: "b2", kind: "concept", label: "Bohr impact", summary: "Bohr changed physics.", topicId: "t_context", topicLabel: "Contexto general", pages: [3], globalOrder: 1, importance: 75, difficulty: "intermediate", dependsOn: [], relations: [], bloomLevel: "understand" },

    { id: "b3", kind: "entity",  label: "Bohr biography", summary: "Bohr was born in Copenhagen.", topicId: "t_life", topicLabel: "Vida y formación", pages: [3], globalOrder: 2, importance: 40, difficulty: "basic", dependsOn: ["b1"], relations: [], bloomLevel: "remember" },
    { id: "b4", kind: "fact",    label: "Bohr education", summary: "He studied at the University of Copenhagen.", topicId: "t_life", topicLabel: "Vida y formación", pages: [3], globalOrder: 3, importance: 35, difficulty: "basic", dependsOn: ["b3"], relations: [], bloomLevel: "remember" },

    { id: "b5", kind: "entity",  label: "Ernest Rutherford", summary: "Rutherford proposed the nucleus model.", topicId: "t_problem", topicLabel: "El problema del átomo", pages: [4], globalOrder: 4, importance: 50, difficulty: "basic", dependsOn: [], relations: [], bloomLevel: "remember" },
    { id: "b6", kind: "concept", label: "Rutherford limitations", summary: "The model could not explain stability.", topicId: "t_problem", topicLabel: "El problema del átomo", pages: [4], globalOrder: 5, importance: 70, difficulty: "intermediate", dependsOn: ["b5"], relations: [], bloomLevel: "analyze" },

    { id: "b7", kind: "concept", label: "Bohr atomic model", summary: "Bohr proposed quantized orbits.", topicId: "t_model", topicLabel: "Modelo atómico de Bohr", pages: [4], globalOrder: 6, importance: 95, difficulty: "advanced", dependsOn: ["b6"], relations: [], bloomLevel: "apply" },
    { id: "b8", kind: "concept", label: "Electron energy levels", summary: "Electrons occupy discrete levels.", topicId: "t_model", topicLabel: "Modelo atómico de Bohr", pages: [4], globalOrder: 7, importance: 90, difficulty: "advanced", dependsOn: ["b7"], relations: [], bloomLevel: "apply" },
    { id: "b9", kind: "example", label: "Hydrogen spectrum", summary: "The model explains hydrogen lines.", topicId: "t_model", topicLabel: "Modelo atómico de Bohr", pages: [4], globalOrder: 8, importance: 80, difficulty: "intermediate", dependsOn: ["b8"], relations: [], bloomLevel: "apply" },
    { id: "b10", kind: "formula", label: "Energy level equation", summary: "En = -13.6 eV/n^2", topicId: "t_model", topicLabel: "Modelo atómico de Bohr", pages: [4], globalOrder: 9, importance: 95, difficulty: "advanced", dependsOn: ["b8"], relations: [], bloomLevel: "apply" },

    { id: "b11", kind: "concept", label: "Quantum mechanics", summary: "A new vision of microscopic reality.", topicId: "t_quantum", topicLabel: "Mecánica cuántica e interpretación de Copenhague", pages: [4], globalOrder: 10, importance: 85, difficulty: "advanced", dependsOn: ["b7"], relations: [], bloomLevel: "evaluate" },
    { id: "b12", kind: "concept", label: "Copenhagen interpretation", summary: "Observation matters.", topicId: "t_quantum", topicLabel: "Mecánica cuántica e interpretación de Copenhague", pages: [4], globalOrder: 11, importance: 90, difficulty: "advanced", dependsOn: ["b11"], relations: [], bloomLevel: "evaluate" },
    { id: "b13", kind: "concept", label: "Philosophical implications", summary: "Reality and knowledge are redefined.", topicId: "t_quantum", topicLabel: "Mecánica cuántica e interpretación de Copenhague", pages: [4], globalOrder: 12, importance: 85, difficulty: "advanced", dependsOn: ["b12"], relations: [], bloomLevel: "create" },

    { id: "b14", kind: "concept", label: "Leadership", summary: "Bohr led a scientific generation.", topicId: "t_legacy", topicLabel: "Liderazgo, ética y legado", pages: [4], globalOrder: 13, importance: 75, difficulty: "intermediate", dependsOn: [], relations: [], bloomLevel: "evaluate" },
    { id: "b15", kind: "entity",  label: "Niels Bohr Institute", summary: "A major scientific center.", topicId: "t_legacy", topicLabel: "Liderazgo, ética y legado", pages: [4], globalOrder: 14, importance: 55, difficulty: "basic", dependsOn: ["b14"], relations: [], bloomLevel: "remember" },
    { id: "b16", kind: "concept", label: "Technology impact", summary: "Bohr influenced modern technology.", topicId: "t_legacy", topicLabel: "Liderazgo, ética y legado", pages: [5], globalOrder: 15, importance: 85, difficulty: "intermediate", dependsOn: [], relations: [], bloomLevel: "evaluate" },
    { id: "b17", kind: "concept", label: "Legacy in physics", summary: "Bohr remains relevant today.", topicId: "t_legacy", topicLabel: "Liderazgo, ética y legado", pages: [5], globalOrder: 16, importance: 88, difficulty: "intermediate", dependsOn: ["b14"], relations: [], bloomLevel: "remember" },
  ],
  concepts: [
    { id: "c1", name: "Bohr atomic model", kind: "concept", importance: 95, pages: [4] },
    { id: "c2", name: "Electron energy levels", kind: "concept", importance: 90, pages: [4] },
    { id: "c3", name: "Energy level equation", kind: "formula", importance: 95, pages: [4] },
    { id: "c4", name: "Copenhagen interpretation", kind: "concept", importance: 90, pages: [4] },
    { id: "c5", name: "Technology impact", kind: "concept", importance: 85, pages: [5] },
    { id: "c6", name: "Legacy in physics", kind: "concept", importance: 88, pages: [5] },
  ]
};

// ─────────────────────────────────────────────
// MATRIZ DE COMBINACIONES
// ─────────────────────────────────────────────
const KNOWLEDGE_LEVELS = ['never_seen', 'know_little', 'want_review', 'already_know'] as const;
const EXAM_DATE_TYPES = ['today', 'tomorrow', 'this_week', 'just_studying'] as const;
const EVAL_PREFERENCES = ['quick_test', 'write_explain', 'mixed', 'read_only'] as const;
const TARGET_SCORES = [80, 100] as const;

// profesor: no debería afectar estructura, pero lo probamos
const PROFESSOR_STYLES = [
  [],
  ['multiple_choice'],
  ['true_false', 'matching'],
] as const;

const BASE_SETUP: Omit<AdaptiveSetup, 'knowledgeLevel' | 'examDateType' | 'targetScore' | 'evalPreference' | 'professorExamStyle'> = {
  examDateCustom: '',
  mainConcern: '',
  planView: 'book',
  completedAt: Date.now(),
};

// ─────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────
function structureFingerprint(chapters: any[]) {
  const learning = chapters.filter((c: any) => c.type !== 'intro' && c.type !== 'final_review');
  return JSON.stringify(
    learning.map((c: any) => ({
      title: c.title,
      topics: [...(c.topicIds || [])].sort(),
      blocks: (c.blockIds || []).length,
    }))
  );
}

function compactStructure(chapters: any[]) {
  return chapters.map((c: any, i: number) => {
    const blocks = (c.blockIds || []).length;
    return `${i+1}.${c.title}[${blocks}]`;
  }).join(' → ');
}

function prettyStyle(style: readonly string[]) {
  if (!style.length) return 'none';
  return style.join('+');
}

// ─────────────────────────────────────────────
// RUNNER
// ─────────────────────────────────────────────
const path = buildLearningPath(BLUEPRINT as any);
const arcs = buildLearningArcs(path);

console.log('\n' + '═'.repeat(90));
console.log('MATRIZ COMPLETA DEL PLANNER');
console.log('Material: Niels Bohr (17 bloques, 6 topics)');
console.log('Solo estructura — sin UI, sin títulos IA');
console.log('═'.repeat(90));

const groups = new Map<string, string[]>();
const countsByExam: Record<string, number[]> = {
  today: [],
  tomorrow: [],
  this_week: [],
  just_studying: [],
};

let total = 0;

for (const knowledgeLevel of KNOWLEDGE_LEVELS) {
  for (const examDateType of EXAM_DATE_TYPES) {
    for (const evalPreference of EVAL_PREFERENCES) {
      for (const targetScore of TARGET_SCORES) {
        for (const professorExamStyle of PROFESSOR_STYLES) {
          const setup: AdaptiveSetup = {
            ...BASE_SETUP,
            knowledgeLevel,
            examDateType,
            targetScore,
            professorExamStyle: [...professorExamStyle],
            evalPreference,
          };

          const chapters = buildChaptersFromArcs(path, arcs, setup);
          const allChapters = [
            { type: 'intro', title: 'Antes de comenzar', blockIds: [] },
            ...chapters,
            { type: 'final_review', title: 'Conquista final', blockIds: [] },
          ];

          const key = structureFingerprint(allChapters);
          const desc = [
            `knowledge=${knowledgeLevel}`,
            `exam=${examDateType}`,
            `eval=${evalPreference}`,
            `score=${targetScore}`,
            `prof=${prettyStyle(professorExamStyle)}`,
            `sessions=${allChapters.length}`,
          ].join(' | ');

          if (!groups.has(key)) groups.set(key, []);
          groups.get(key)!.push(desc);

          countsByExam[examDateType].push(allChapters.length);
          total++;
        }
      }
    }
  }
}

console.log(`\nTotal de combinaciones probadas: ${total}`);
console.log(`Estructuras únicas encontradas: ${groups.size}`);

console.log('\n' + '─'.repeat(90));
console.log('RESUMEN POR URGENCIA');
console.log('─'.repeat(90));

for (const examType of EXAM_DATE_TYPES) {
  const counts = countsByExam[examType];
  const min = Math.min(...counts);
  const max = Math.max(...counts);
  const unique = [...new Set(counts)].sort((a, b) => a - b);
  console.log(`${examType.padEnd(15)} min=${min} max=${max} únicos=[${unique.join(', ')}]`);
}

console.log('\n' + '─'.repeat(90));
console.log('GRUPOS ESTRUCTURALES ÚNICOS');
console.log('─'.repeat(90));

let idx = 1;
for (const [fingerprint, setups] of groups.entries()) {
  const example = setups[0];
  const parsed = JSON.parse(fingerprint);
  const fakeChapters = [
    { title: 'Antes de comenzar', blockIds: [] },
    ...parsed.map((x: any) => ({ title: x.title, blockIds: Array(x.blocks).fill(0) })),
    { title: 'Conquista final', blockIds: [] },
  ];

  console.log(`\n[Grupo ${idx}] ${setups.length} combinaciones`);
  console.log(`Ejemplo setup: ${example}`);
  console.log(`Estructura: ${compactStructure(fakeChapters)}`);

  // Mostrar algunos setups del grupo
  setups.slice(0, 6).forEach(s => console.log(`  - ${s}`));
  if (setups.length > 6) {
    console.log(`  ... y ${setups.length - 6} más`);
  }

  idx++;
}

console.log('\n' + '═'.repeat(90));
console.log('FIN DE LA MATRIZ');
console.log('═'.repeat(90) + '\n');
