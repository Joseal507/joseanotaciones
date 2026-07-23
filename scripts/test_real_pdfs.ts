// Test con PDFs reales del proyecto
// Extrae texto → simula blueprint → corre planner con 8 setups

import { readFileSync, existsSync } from 'fs';
import { buildLearningPath } from '../lib/adaptive/buildLearningPath';
import { buildLearningArcs } from '../lib/adaptive/buildLearningArcs';
import { buildChaptersFromArcs } from '../lib/adaptive/buildChaptersFromArcs';
import type { AdaptiveSetup } from '../lib/studySessions';

const SETUPS: { name: string; setup: Partial<AdaptiveSetup> }[] = [
  { name: 'HOY+cero',      setup: { examDateType: 'today',         knowledgeLevel: 'never_seen'   } },
  { name: 'HOY+domino',    setup: { examDateType: 'today',         knowledgeLevel: 'already_know' } },
  { name: 'MAÑANA+cero',   setup: { examDateType: 'tomorrow',      knowledgeLevel: 'never_seen'   } },
  { name: 'MAÑANA+repaso', setup: { examDateType: 'tomorrow',      knowledgeLevel: 'want_review'  } },
  { name: 'SEMANA+cero',   setup: { examDateType: 'this_week',     knowledgeLevel: 'never_seen'   } },
  { name: 'SEMANA+poco',   setup: { examDateType: 'this_week',     knowledgeLevel: 'know_little'  } },
  { name: 'LIBRE+cero',    setup: { examDateType: 'just_studying', knowledgeLevel: 'never_seen'   } },
  { name: 'LIBRE+domino',  setup: { examDateType: 'just_studying', knowledgeLevel: 'already_know' } },
];

const BASE: AdaptiveSetup = {
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

// Simular un blueprint desde texto raw del PDF
// No usamos IA — construimos un blueprint sintético a partir
// del texto para probar el planner
function textToBlueprint(text: string, filename: string): any {
  // Dividir en segmentos aproximados por páginas
  const pages = text.split(/\[(?:Pagina|Page|pág?)\s*\d+\]/i).filter(s => s.trim().length > 100);
  const actualPages = pages.length > 0 ? pages : [text];

  // Detectar bloques de contenido (párrafos con al menos 80 chars)
  const allSentences: string[] = [];
  for (const page of actualPages) {
    const sents = page
      .replace(/\n+/g, ' ')
      .replace(/\s+/g, ' ')
      .split(/(?<=[.!?])\s+/)
      .map(s => s.trim())
      .filter(s => s.length > 60 && s.length < 400);
    allSentences.push(...sents);
  }

  // Agrupar en 4-8 topics según el tamaño del texto
  const totalSentences = allSentences.length;
  const topicCount = Math.min(8, Math.max(3, Math.floor(totalSentences / 8)));
  const chunkSize = Math.ceil(allSentences.length / topicCount);

  const topics: any[] = [];
  const blocks: any[] = [];
  let globalOrder = 0;

  for (let t = 0; t < topicCount; t++) {
    const topicId = `topic_${t}`;
    const chunk = allSentences.slice(t * chunkSize, (t + 1) * chunkSize);
    if (!chunk.length) continue;

    const topicTitle = `Sección ${t + 1} de ${filename.replace('.pdf', '')}`;
    topics.push({
      id: topicId,
      title: topicTitle,
      pages: [t + 1],
    });

    // Crear 2-5 bloques por topic
    const blockCount = Math.min(5, Math.max(2, chunk.length));
    const blockChunkSize = Math.ceil(chunk.length / blockCount);

    for (let b = 0; b < blockCount; b++) {
      const sentences = chunk.slice(b * blockChunkSize, (b + 1) * blockChunkSize);
      const label = sentences[0]?.slice(0, 60) || `Bloque ${b + 1}`;
      const summary = sentences.join(' ').slice(0, 200);

      // Clasificar el tipo de bloque
      const isFormula = /=|[∑∫∂]|\d+\s*[\+\-\*\/]\s*\d+|ecuación|fórmula/i.test(label + summary);
      const isExample = /ejemplo|caso|aplicación|ejercicio/i.test(label + summary);
      const isDefinition = /se define|definición|concepto|término/i.test(label + summary);

      const kind = isFormula ? 'formula' : isExample ? 'example' : isDefinition ? 'definition' : 'concept';
      const bloomLevel = isFormula ? 'apply' : isExample ? 'apply' : t < 2 ? 'understand' : t < topicCount - 1 ? 'analyze' : 'evaluate';
      const importance = t === 0 ? 60 : t === topicCount - 1 ? 75 : 80 + Math.floor(Math.random() * 15);
      const difficulty = t < 2 ? 'basic' : t < topicCount - 1 ? 'intermediate' : 'advanced';

      blocks.push({
        id: `block_${globalOrder}`,
        kind,
        label: label.trim(),
        summary: summary.trim(),
        topicId,
        topicLabel: topicTitle,
        pages: [t + 1],
        globalOrder: globalOrder++,
        importance,
        difficulty,
        dependsOn: b > 0 ? [`block_${globalOrder - 2}`] : [],
        relations: [],
        bloomLevel,
      });
    }
  }

  const concepts = blocks
    .filter(b => ['concept', 'definition', 'formula'].includes(b.kind))
    .slice(0, 20)
    .map((b, i) => ({
      id: `c${i}`,
      name: b.label,
      kind: b.kind,
      importance: b.importance,
      pages: b.pages,
    }));

  return { topics, blocks, concepts };
}

function validate(chapters: any[], setupName: string, filename: string): string[] {
  const errors: string[] = [];
  const learning = chapters.filter((c: any) => c.type !== 'intro' && c.type !== 'final_review');

  const titles = learning.map((c: any) => c.title);
  const titleSet = new Set(titles);
  if (titleSet.size !== titles.length) {
    const dupes = titles.filter((t: string, i: number) => titles.indexOf(t) !== i);
    errors.push(`DUPLICADOS: ${[...new Set(dupes)].join(', ')}`);
  }

  for (const ch of learning) {
    if ((ch.blockIds || []).length === 0) {
      errors.push(`VACÍO: "${ch.title}"`);
    }
  }

  return errors;
}

async function testPdf(pdfPath: string, filename: string) {
  const text = readFileSync(pdfPath, 'latin1');
  if (text.length < 200) return null;

  const blueprint = textToBlueprint(text, filename);
  if (!blueprint.blocks.length || !blueprint.topics.length) return null;

  const path = buildLearningPath(blueprint);
  const arcs = buildLearningArcs(path);

  const results: { setup: string; sessions: number; structure: string; errors: string[] }[] = [];
  const sessionCounts: number[] = [];

  for (const { name, setup } of SETUPS) {
    const fullSetup = { ...BASE, ...setup };
    const chapters = buildChaptersFromArcs(path, arcs, fullSetup);
    const all = [
      { type: 'intro', title: 'Antes de comenzar', blockIds: [] },
      ...chapters,
      { type: 'final_review', title: 'Evaluación final', blockIds: [] },
    ];

    const errors = validate(all, name, filename);
    const structure = all
      .map((c: any) => `${c.title}[${(c.blockIds || []).length}]`)
      .join(' → ');

    sessionCounts.push(all.length);
    results.push({ setup: name, sessions: all.length, structure, errors });
  }

  return {
    filename,
    topics: blueprint.topics.length,
    blocks: blueprint.blocks.length,
    results,
    sessionCounts,
    monotonic: sessionCounts.every((v, i) => i === 0 || v >= sessionCounts[i - 1]),
  };
}

async function main() {
  const pdfs = [
    { path: 'scripts/fixtures/clutch1.pdf',     name: 'CLUTCH 1'       },
    { path: 'scripts/fixtures/clutch2.pdf',     name: 'CLUTCH 2'       },
    { path: 'scripts/fixtures/alzheimer.pdf',   name: 'Alzheimer'      },
    { path: 'scripts/fixtures/anemia.pdf',      name: 'Anemia'         },
    { path: 'scripts/fixtures/biofisica.pdf',   name: 'Biofísica'      },
    { path: 'scripts/fixtures/biologia 3.pdf',  name: 'Biología 3'     },
  ];

  console.log('\n' + '═'.repeat(80));
  console.log('TEST CON PDFs REALES');
  console.log('8 setups × cada PDF');
  console.log('═'.repeat(80));

  let totalErrors = 0;
  let totalMaterials = 0;

  for (const { path, name } of pdfs) {
    if (!existsSync(path)) {
      console.log(`\n⚠️  ${name}: archivo no encontrado (${path})`);
      continue;
    }

    const result = await testPdf(path, name);
    if (!result) {
      console.log(`\n⚠️  ${name}: no se pudo extraer contenido`);
      continue;
    }

    totalMaterials++;
    const errors = result.results.flatMap(r => r.errors);
    totalErrors += errors.length;

    const status = errors.length === 0 ? '✅' : '❌';
    const monotoneStatus = result.monotonic ? '✅' : '⚠️ ';

    console.log(`\n${status} ${name}`);
    console.log(`   Topics: ${result.topics} | Bloques: ${result.blocks}`);
    console.log(`   Sesiones: ${result.sessionCounts.join(', ')}`);
    console.log(`   Monotonía: ${monotoneStatus}`);

    if (errors.length > 0) {
      errors.forEach(e => console.log(`   ❌ ${e}`));
    }

    // Mostrar variación por setup
    const uniqueSessionCounts = [...new Set(result.sessionCounts)].sort((a, b) => a - b);
    if (uniqueSessionCounts.length > 1) {
      console.log(`   Variación: ${uniqueSessionCounts.join(' → ')} sesiones según setup ✅`);
    } else {
      console.log(`   Estructura fija: ${uniqueSessionCounts[0]} sesiones (material muy uniforme)`);
    }
  }

  console.log('\n' + '═'.repeat(80));
  console.log(`RESUMEN: ${totalMaterials} materiales | ${totalErrors} errores`);
  console.log(totalErrors === 0 ? '✅ TODO OK' : '❌ HAY ERRORES');
  console.log('═'.repeat(80) + '\n');
}

main().catch(console.error);
