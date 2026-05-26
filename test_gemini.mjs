import fs from 'fs';

const PDF_PATH = process.argv[2];
const API_KEY = process.env.OPENROUTER_API_KEY;

if (!API_KEY || !PDF_PATH) {
  console.log('Uso: OPENROUTER_API_KEY=xxx node test_gemini.mjs /ruta/al.pdf');
  process.exit(1);
}

const pdfB64 = fs.readFileSync(PDF_PATH).toString('base64');

const prompt = `Analiza este PDF página por página. Para cada página devuelve TODOS los bloques de texto que veas con sus coordenadas exactas.

Devuelve SOLO JSON válido con esta estructura:
{
  "pages": [
    {
      "page": 1,
      "width": 1000,
      "height": 1000,
      "blocks": [
        {"text": "texto literal", "bbox": [ymin, xmin, ymax, xmax]}
      ]
    }
  ]
}

Coordenadas normalizadas 0-1000. NO inventes coords, solo las reales.`;

const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${API_KEY}`,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({
    model: 'google/gemini-2.5-flash',
    messages: [{
      role: 'user',
      content: [
        { type: 'text', text: prompt },
        { type: 'file', file: { filename: 'doc.pdf', file_data: `data:application/pdf;base64,${pdfB64}` } },
      ],
    }],
  }),
});

console.log('Status:', res.status);
const data = await res.json();
console.log(JSON.stringify(data, null, 2).slice(0, 4000));
