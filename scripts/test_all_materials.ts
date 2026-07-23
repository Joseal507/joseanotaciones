import { buildLearningPath } from '../lib/adaptive/buildLearningPath';
import { buildLearningArcs } from '../lib/adaptive/buildLearningArcs';
import { buildChaptersFromArcs } from '../lib/adaptive/buildChaptersFromArcs';

// ─── tipos de setup a probar ──────────────────────────────────
const SETUPS = [
  { examDateType: 'today',         name: 'HOY'         },
  { examDateType: 'tomorrow',      name: 'MAÑANA'      },
  { examDateType: 'this_week',     name: 'ESTA SEMANA' },
  { examDateType: 'just_studying', name: 'SIN EXAMEN'  },
] as const;

const BASE_SETUP = {
  knowledgeLevel: 'never_seen' as const,
  examDateCustom: '',
  targetScore: 100,
  mainConcern: '',
  professorExamStyle: [] as string[],
  evalPreference: 'quick_test' as const,
  planView: 'book' as const,
  completedAt: Date.now(),
};

// ─── Material 1: Equilibrio Químico ──────────────────────────
const EQUILIBRIO = {
  name: "Equilibrio Químico (científico/procedimental)",
  blueprint: {
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
      { id: "b1", kind: "concept", label: "Equilibrio dinámico", topicId: "t1", topicLabel: "Equilibrio dinámico", pages: [1], globalOrder: 0, importance: 85, difficulty: "intermediate", dependsOn: [], relations: [], bloomLevel: "understand" },
      { id: "b2", kind: "concept", label: "Concentraciones constantes", topicId: "t1", topicLabel: "Equilibrio dinámico", pages: [2], globalOrder: 1, importance: 80, difficulty: "basic", dependsOn: ["b1"], relations: [], bloomLevel: "understand" },
      { id: "b3", kind: "formula", label: "Expresión de Kc", topicId: "t2", topicLabel: "Constante de equilibrio Kc", pages: [2], globalOrder: 2, importance: 95, difficulty: "advanced", dependsOn: ["b1"], relations: [], bloomLevel: "apply" },
      { id: "b4", kind: "concept", label: "Construcción de Kc", topicId: "t2", topicLabel: "Constante de equilibrio Kc", pages: [3], globalOrder: 3, importance: 88, difficulty: "intermediate", dependsOn: ["b3"], relations: [], bloomLevel: "apply" },
      { id: "b5", kind: "formula", label: "Expresión de Kp", topicId: "t3", topicLabel: "Kp y relación con Kc", pages: [3], globalOrder: 4, importance: 90, difficulty: "advanced", dependsOn: ["b3"], relations: [], bloomLevel: "apply" },
      { id: "b6", kind: "formula", label: "Kp = Kc(RT)^Δn", topicId: "t3", topicLabel: "Kp y relación con Kc", pages: [4], globalOrder: 5, importance: 92, difficulty: "advanced", dependsOn: ["b5"], relations: [], bloomLevel: "analyze" },
      { id: "b7", kind: "concept", label: "Interpretación de K", topicId: "t4", topicLabel: "Significado e interpretación de K", pages: [4], globalOrder: 6, importance: 85, difficulty: "intermediate", dependsOn: ["b3"], relations: [], bloomLevel: "evaluate" },
      { id: "b8", kind: "example", label: "Tabla ICE", topicId: "t5", topicLabel: "Cálculos de equilibrio", pages: [5], globalOrder: 7, importance: 90, difficulty: "advanced", dependsOn: ["b3","b4"], relations: [], bloomLevel: "apply" },
      { id: "b9", kind: "formula", label: "Cociente Q", topicId: "t6", topicLabel: "Cociente de reacción Q", pages: [6], globalOrder: 8, importance: 88, difficulty: "intermediate", dependsOn: ["b3","b7"], relations: [], bloomLevel: "analyze" },
      { id: "b10", kind: "concept", label: "Principio de Le Châtelier", topicId: "t7", topicLabel: "Principio de Le Châtelier", pages: [7], globalOrder: 9, importance: 92, difficulty: "intermediate", dependsOn: ["b1","b7"], relations: [], bloomLevel: "evaluate" },
      { id: "b11", kind: "concept", label: "Efecto de temperatura", topicId: "t7", topicLabel: "Principio de Le Châtelier", pages: [7], globalOrder: 10, importance: 88, difficulty: "intermediate", dependsOn: ["b10"], relations: [], bloomLevel: "analyze" },
      { id: "b12", kind: "concept", label: "Catalizadores en equilibrio", topicId: "t8", topicLabel: "Catalizadores", pages: [8], globalOrder: 11, importance: 80, difficulty: "basic", dependsOn: ["b1"], relations: [], bloomLevel: "understand" },
    ],
    concepts: [
      { id: "c1", name: "Equilibrio dinámico", kind: "concept", importance: 85, pages: [1] },
      { id: "c2", name: "Kc", kind: "formula", importance: 95, pages: [2] },
      { id: "c3", name: "Kp", kind: "formula", importance: 90, pages: [3] },
      { id: "c4", name: "Tabla ICE", kind: "example", importance: 90, pages: [5] },
      { id: "c5", name: "Cociente Q", kind: "concept", importance: 88, pages: [6] },
      { id: "c6", name: "Le Châtelier", kind: "concept", importance: 92, pages: [7] },
      { id: "c7", name: "Catalizadores", kind: "concept", importance: 80, pages: [8] },
    ]
  }
};

// ─── Material 2: Niels Bohr (histórico/narrativo) ─────────────
const BOHR = {
  name: "Niels Bohr (histórico/narrativo)",
  blueprint: {
    topics: [
      { id: "t1", title: "Vida y formación", pages: [3] },
      { id: "t2", title: "El problema del átomo", pages: [4] },
      { id: "t3", title: "Modelo atómico de Bohr", pages: [4] },
      { id: "t4", title: "Mecánica cuántica e interpretación de Copenhague", pages: [4,5] },
      { id: "t5", title: "Liderazgo, ética y legado", pages: [4,5] },
      { id: "t6", title: "Contexto general", pages: [1,3] },
    ],
    blocks: [
      { id: "b1", kind: "entity", label: "Niels Bohr", topicId: "t6", topicLabel: "Contexto general", pages: [1], globalOrder: 0, importance: 50, difficulty: "basic", dependsOn: [], relations: [], bloomLevel: "remember" },
      { id: "b2", kind: "concept", label: "Bohr's Impact on Science", topicId: "t1", topicLabel: "Vida y formación", pages: [3], globalOrder: 1, importance: 85, difficulty: "intermediate", dependsOn: [], relations: [], bloomLevel: "understand" },
      { id: "b3", kind: "entity", label: "Bohr's Biography", topicId: "t1", topicLabel: "Vida y formación", pages: [3], globalOrder: 2, importance: 40, difficulty: "basic", dependsOn: ["b1"], relations: [], bloomLevel: "remember" },
      { id: "b4", kind: "entity", label: "Ernest Rutherford", topicId: "t2", topicLabel: "El problema del átomo", pages: [4], globalOrder: 3, importance: 50, difficulty: "basic", dependsOn: [], relations: [], bloomLevel: "remember" },
      { id: "b5", kind: "concept", label: "Limitations of Rutherford's Model", topicId: "t2", topicLabel: "El problema del átomo", pages: [4], globalOrder: 4, importance: 70, difficulty: "intermediate", dependsOn: ["b4"], relations: [], bloomLevel: "analyze" },
      { id: "b6", kind: "concept", label: "Bohr's Atomic Model", topicId: "t3", topicLabel: "Modelo atómico de Bohr", pages: [4], globalOrder: 5, importance: 90, difficulty: "advanced", dependsOn: ["b5"], relations: [], bloomLevel: "apply" },
      { id: "b7", kind: "concept", label: "Electron Energy Levels", topicId: "t3", topicLabel: "Modelo atómico de Bohr", pages: [4], globalOrder: 6, importance: 85, difficulty: "intermediate", dependsOn: ["b6"], relations: [], bloomLevel: "apply" },
      { id: "b8", kind: "formula", label: "Energy Level Equation", topicId: "t3", topicLabel: "Modelo atómico de Bohr", pages: [4], globalOrder: 7, importance: 95, difficulty: "advanced", dependsOn: ["b7"], relations: [], bloomLevel: "apply" },
      { id: "b9", kind: "concept", label: "Copenhagen Interpretation", topicId: "t4", topicLabel: "Mecánica cuántica e interpretación de Copenhague", pages: [4], globalOrder: 8, importance: 85, difficulty: "advanced", dependsOn: ["b6"], relations: [], bloomLevel: "evaluate" },
      { id: "b10", kind: "concept", label: "Quantum Mechanics and Reality", topicId: "t4", topicLabel: "Mecánica cuántica e interpretación de Copenhague", pages: [4], globalOrder: 9, importance: 85, difficulty: "advanced", dependsOn: ["b9"], relations: [], bloomLevel: "analyze" },
      { id: "b11", kind: "concept", label: "Bohr's Leadership", topicId: "t5", topicLabel: "Liderazgo, ética y legado", pages: [4], globalOrder: 10, importance: 75, difficulty: "intermediate", dependsOn: [], relations: [], bloomLevel: "evaluate" },
      { id: "b12", kind: "concept", label: "Bohr's Impact on Technology", topicId: "t5", topicLabel: "Liderazgo, ética y legado", pages: [5], globalOrder: 11, importance: 85, difficulty: "intermediate", dependsOn: [], relations: [], bloomLevel: "evaluate" },
    ],
    concepts: [
      { id: "c1", name: "Bohr's Atomic Model", kind: "concept", importance: 90, pages: [4] },
      { id: "c2", name: "Electron Energy Levels", kind: "concept", importance: 85, pages: [4] },
      { id: "c3", name: "Energy Level Equation", kind: "formula", importance: 95, pages: [4] },
      { id: "c4", name: "Copenhagen Interpretation", kind: "concept", importance: 85, pages: [4] },
      { id: "c5", name: "Bohr's Leadership", kind: "concept", importance: 75, pages: [4] },
      { id: "c6", name: "Bohr's Impact on Technology", kind: "concept", importance: 85, pages: [5] },
    ]
  }
};

// ─── Material 3: Biomecánica (terminología + procedimientos) ──
const BIOMECANICA = {
  name: "Biomecánica (terminología + procedimientos)",
  blueprint: {
    topics: [
      { id: "t1", title: "Planos y direcciones anatómicas", pages: [1,2] },
      { id: "t2", title: "Grados de libertad del movimiento", pages: [2,3] },
      { id: "t3", title: "Articulaciones y movilidad", pages: [3,4] },
      { id: "t4", title: "Componentes del movimiento humano", pages: [4,5] },
      { id: "t5", title: "Antropometría y hombre estándar", pages: [5,6] },
      { id: "t6", title: "Relaciones alométricas e isométricas", pages: [6,7] },
    ],
    blocks: [
      { id: "b1", kind: "definition", label: "Planos anatómicos", topicId: "t1", topicLabel: "Planos y direcciones anatómicas", pages: [1], globalOrder: 0, importance: 85, difficulty: "basic", dependsOn: [], relations: [], bloomLevel: "remember" },
      { id: "b2", kind: "definition", label: "Direcciones anatómicas", topicId: "t1", topicLabel: "Planos y direcciones anatómicas", pages: [2], globalOrder: 1, importance: 80, difficulty: "basic", dependsOn: ["b1"], relations: [], bloomLevel: "remember" },
      { id: "b3", kind: "concept", label: "Grados de libertad", topicId: "t2", topicLabel: "Grados de libertad del movimiento", pages: [2], globalOrder: 2, importance: 88, difficulty: "intermediate", dependsOn: ["b1"], relations: [], bloomLevel: "understand" },
      { id: "b4", kind: "concept", label: "Traslación y rotación", topicId: "t2", topicLabel: "Grados de libertad del movimiento", pages: [3], globalOrder: 3, importance: 85, difficulty: "intermediate", dependsOn: ["b3"], relations: [], bloomLevel: "understand" },
      { id: "b5", kind: "concept", label: "Tipos de articulación", topicId: "t3", topicLabel: "Articulaciones y movilidad", pages: [3], globalOrder: 4, importance: 90, difficulty: "intermediate", dependsOn: ["b3"], relations: [], bloomLevel: "analyze" },
      { id: "b6", kind: "concept", label: "Pares antagonistas", topicId: "t4", topicLabel: "Componentes del movimiento humano", pages: [4], globalOrder: 5, importance: 85, difficulty: "intermediate", dependsOn: ["b5"], relations: [], bloomLevel: "analyze" },
      { id: "b7", kind: "example", label: "Movimientos del brazo", topicId: "t4", topicLabel: "Componentes del movimiento humano", pages: [5], globalOrder: 6, importance: 80, difficulty: "basic", dependsOn: ["b6"], relations: [], bloomLevel: "apply" },
      { id: "b8", kind: "concept", label: "Hombre estándar", topicId: "t5", topicLabel: "Antropometría y hombre estándar", pages: [5], globalOrder: 7, importance: 88, difficulty: "intermediate", dependsOn: [], relations: [], bloomLevel: "understand" },
      { id: "b9", kind: "formula", label: "Masa segmentaria", topicId: "t5", topicLabel: "Antropometría y hombre estándar", pages: [6], globalOrder: 8, importance: 92, difficulty: "advanced", dependsOn: ["b8"], relations: [], bloomLevel: "apply" },
      { id: "b10", kind: "formula", label: "Escalas alométricas", topicId: "t6", topicLabel: "Relaciones alométricas e isométricas", pages: [6], globalOrder: 9, importance: 88, difficulty: "advanced", dependsOn: ["b9"], relations: [], bloomLevel: "analyze" },
      { id: "b11", kind: "formula", label: "IMC y área superficial", topicId: "t6", topicLabel: "Relaciones alométricas e isométricas", pages: [7], globalOrder: 10, importance: 85, difficulty: "intermediate", dependsOn: ["b10"], relations: [], bloomLevel: "apply" },
    ],
    concepts: [
      { id: "c1", name: "Planos anatómicos", kind: "definition", importance: 85, pages: [1] },
      { id: "c2", name: "Grados de libertad", kind: "concept", importance: 88, pages: [2] },
      { id: "c3", name: "Tipos de articulación", kind: "concept", importance: 90, pages: [3] },
      { id: "c4", name: "Masa segmentaria", kind: "formula", importance: 92, pages: [6] },
      { id: "c5", name: "Escalas alométricas", kind: "formula", importance: 88, pages: [6] },
    ]
  }
};

// ─── Función de validación ────────────────────────────────────
function validatePlan(materialName: string, setupName: string, chapters: any[]): string[] {
  const errors: string[] = [];
  const learningChapters = chapters.filter((c: any) => c.type !== 'intro' && c.type !== 'final_review');
  
  // 1. No títulos duplicados
  const titles = learningChapters.map((c: any) => c.title);
  const titleSet = new Set(titles);
  if (titleSet.size !== titles.length) {
    const dupes = titles.filter((t: string, i: number) => titles.indexOf(t) !== i);
    errors.push(`❌ TÍTULOS DUPLICADOS: ${[...new Set(dupes)].join(', ')}`);
  }

  // 2. No capítulos vacíos
  const empty = learningChapters.filter((c: any) => (c.blockIds || []).length === 0);
  if (empty.length > 0) {
    errors.push(`❌ CAPÍTULOS VACÍOS: ${empty.map((c: any) => c.title).join(', ')}`);
  }

  // 3. Presupuesto razonable
  const total = chapters.length;
  const maxBySetup: Record<string, number> = {
    'HOY': 7, 'MAÑANA': 8, 'ESTA SEMANA': 11, 'SIN EXAMEN': 12
  };
  const max = maxBySetup[setupName] || 12;
  if (total > max) {
    errors.push(`❌ DEMASIADAS SESIONES: ${total} > ${max} para ${setupName}`);
  }

  // 4. Consistencia hoy <= mañana <= semana
  // (esto se verifica externamente)

  return errors;
}

// ─── Runner ───────────────────────────────────────────────────
const MATERIALS = [EQUILIBRIO, BOHR, BIOMECANICA];

let totalErrors = 0;
const sessionCounts: Record<string, Record<string, number>> = {};

for (const material of MATERIALS) {
  console.log(`\n${'═'.repeat(60)}`);
  console.log(`MATERIAL: ${material.name}`);
  console.log('═'.repeat(60));
  
  sessionCounts[material.name] = {};

  for (const setupVariant of SETUPS) {
    const setup = { ...BASE_SETUP, examDateType: setupVariant.examDateType };
    
    try {
      const path = buildLearningPath(material.blueprint as any);
      const arcs = buildLearningArcs(path);
      const chapters = buildChaptersFromArcs(path, arcs, setup as any);
      
      const allChapters = [
        { type: 'intro', title: 'Antes de comenzar', blockIds: [] },
        ...chapters,
        { type: 'final_review', title: 'Conquista final', blockIds: [] },
      ];

      const errors = validatePlan(material.name, setupVariant.name, allChapters);
      totalErrors += errors.length;
      
      const count = allChapters.length;
      sessionCounts[material.name][setupVariant.name] = count;

      const status = errors.length === 0 ? '✅' : '❌';
      console.log(`\n  ${status} ${setupVariant.name}: ${count} sesiones`);
      
      // Mostrar estructura
      allChapters.forEach((ch: any, i: number) => {
        const icon = ch.type === 'intro' ? '📖' : ch.type === 'final_review' ? '🏁' : '📘';
        const blockCount = (ch.blockIds || []).length;
        console.log(`     ${icon} ${i+1}. "${ch.title}" [${blockCount} bloques]`);
      });
      
      if (errors.length > 0) {
        errors.forEach(e => console.log(`     ${e}`));
      }

    } catch(e: any) {
      totalErrors++;
      console.log(`\n  ❌ ${setupVariant.name}: ERROR — ${e.message}`);
    }
  }

  // Verificar monotonía (hoy <= mañana <= semana)
  const counts = sessionCounts[material.name];
  const hoy = counts['HOY'] || 0;
  const manana = counts['MAÑANA'] || 0;
  const semana = counts['ESTA SEMANA'] || 0;
  const sinExamen = counts['SIN EXAMEN'] || 0;
  
  if (hoy > manana || manana > semana) {
    console.log(`\n  ⚠️  MONOTONÍA VIOLADA: hoy=${hoy} mañana=${manana} semana=${semana}`);
  } else {
    console.log(`\n  ✅ MONOTONÍA OK: hoy=${hoy} ≤ mañana=${manana} ≤ semana=${semana}`);
  }
}

console.log(`\n${'═'.repeat(60)}`);
console.log(`RESUMEN: ${totalErrors === 0 ? '✅ TODO OK' : `❌ ${totalErrors} ERRORES`}`);
console.log('═'.repeat(60));
