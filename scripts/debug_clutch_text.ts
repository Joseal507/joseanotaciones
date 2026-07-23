import { readFileSync } from 'fs';
import pdf from 'pdf-parse';

async function run() {
  const dataBuffer = readFileSync('scripts/fixtures/clutch2.pdf');
  
  console.log('--- Iniciando extracción de texto real ---');
  const data = await pdf(dataBuffer);
  
  const cleanText = data.text.replace(/\s+/g, ' ').trim();
  
  console.log('PDF: CLUTCH 2.pdf');
  console.log('Páginas detectadas:', data.numpages);
  console.log('Caracteres extraídos:', data.text.length);
  console.log('Caracteres limpios:', cleanText.length);
  console.log('\n--- Muestra del contenido real ---');
  console.log(cleanText.slice(0, 500));
}

run().catch(console.error);
