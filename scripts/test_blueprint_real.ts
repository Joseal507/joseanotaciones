// Test del blueprint con texto real extraído de los PDFs
// Usa el mismo extractor que usa el sistema en producción

import { readFileSync } from 'fs';
import { existsSync } from 'fs';

const BASE_URL = 'http://localhost:3000';

const PDFS = [
  { file: 'scripts/fixtures/clutch1.pdf',   name: 'CLUTCH 1'   },
  { file: 'scripts/fixtures/clutch2.pdf',   name: 'CLUTCH 2'   },
  { file: 'scripts/fixtures/alzheimer.pdf', name: 'Alzheimer'  },
  { file: 'scripts/fixtures/biofisica.pdf', name: 'Biofísica'  },
];

async function extractText(filePath: string): Promise<string> {
  const pdf = await import('pdf-parse').then(m => m.default || m);
  const buffer = readFileSync(filePath);
  const data = await pdf(buffer);
  return data.text.replace(/\s+/g, ' ').trim();
}

async function testBlueprint(name: string, text: string): Promise<void> {
  console.log(`\n${'─'.repeat(60)}`);
  console.log(`📄 ${name} | ${text.length} chars`);

  const res = await fetch(`${BASE_URL}/api/adaptive/blueprint`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      materials: [{
        materialId: `test_${name.toLowerCase().replace(/\s/g, '_')}`,
        materialName: name,
        selectedPages: [],
        text: text,
      }],
      userProfile: null,
      adaptiveSetup: { knowledgeLevel: 'never_seen', examDateType: 'tomorrow' },
    }),
  });

  const data = await res.json();

  if (!data.success) {
    console.log(`❌ FALLO: ${data.error}`);
    return;
  }

  const bp = data.blueprint;
  const q  = data.quality;

  console.log(`Status: ${q?.status === 'complete' ? '✅ complete' : '❌ ' + q?.status}`);
  console.log(`Topics: ${bp?.topics?.length || 0}`);
  console.log(`Blocks: ${bp?.blocks?.length || 0}`);
  console.log(`Concepts: ${bp?.concepts?.length || 0}`);
  console.log(`Fallback blocks: ${q?.metrics?.fallbackBlocks || 0}`);
  console.log(`Generic notes: ${q?.metrics?.genericNoteRatio?.toFixed(2) || 0}`);

  if (q?.reasons?.length) {
    console.log(`Razones degraded: ${q.reasons.join(' | ')}`);
  }

  // Mostrar topics detectados
  const topics = bp?.topics || bp?.topicsIndex || [];
  if (topics.length) {
    console.log(`Topics detectados:`);
    topics.forEach((t: any) => console.log(`  - ${t.title}`));
  }
}

async function main() {
  console.log('═'.repeat(60));
  console.log('TEST DE BLUEPRINT CON TEXTO REAL EXTRAÍDO');
  console.log('═'.repeat(60));

  for (const { file, name } of PDFS) {
    if (!existsSync(file)) {
      console.log(`\n⚠️  ${name}: archivo no encontrado`);
      continue;
    }

    try {
      const text = await extractText(file);
      await testBlueprint(name, text);
      // Esperar entre llamadas para no saturar las keys
      await new Promise(r => setTimeout(r, 3000));
    } catch (e: any) {
      console.log(`\n❌ ${name}: ${e.message}`);
    }
  }

  console.log('\n' + '═'.repeat(60));
  console.log('FIN DEL TEST');
  console.log('═'.repeat(60));
}

main().catch(console.error);
