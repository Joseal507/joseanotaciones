import pathlib

path = pathlib.Path('lib/materials/extractors.ts')
text = path.read_text(encoding='utf-8')

# Verificar de verdad si existe la función
has_function = 'async function extractWithOpenRouterGemini' in text

if has_function:
    print("✅ Ya existe la función")
else:
    new_function = '''

// ════════════════════════════════════════
// OpenRouter Gemini 2.5 Flash — OCR económico
// ════════════════════════════════════════
async function extractWithOpenRouterGemini(buffer: Buffer, apiKey: string): Promise<string> {
  const base64 = buffer.toString('base64');

  const prompt = `Extrae TODO el texto de este PDF página por página.

REGLAS ESTRICTAS:
1. Para cada página devuelve EXACTAMENTE este formato:
[Pagina N]
<todo el texto de esa página tal cual aparece>

2. Conserva el orden de lectura natural (de arriba a abajo, izquierda a derecha)
3. Incluye títulos, párrafos, tablas (como texto plano), listas
4. NO inventes texto, solo extrae lo que ves
5. Separa cada página con dos saltos de línea
6. NO uses markdown, solo texto plano
7. Para fórmulas matemáticas usa notación LaTeX entre $...$

Devuelve SOLO el texto extraído, sin explicaciones adicionales.`;

  const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': 'https://studyal.app',
      'X-Title': 'StudyAL OCR',
    },
    body: JSON.stringify({
      model: 'google/gemini-2.5-flash',
      messages: [{
        role: 'user',
        content: [
          { type: 'text', text: prompt },
          {
            type: 'file',
            file: {
              filename: 'document.pdf',
              file_data: `data:application/pdf;base64,${base64}`,
            },
          },
        ],
      }],
      max_tokens: 32000,
      temperature: 0.1,
    }),
  });

  if (!res.ok) {
    const err = await res.text().catch(() => '');
    throw new Error(`OpenRouter ${res.status}: ${err.slice(0, 200)}`);
  }

  const data = await res.json();
  const text = data?.choices?.[0]?.message?.content ?? '';
  return String(text).trim();
}
'''
    text = text.rstrip() + new_function + '\n'
    path.write_text(text, encoding='utf-8')
    print("✅ Función extractWithOpenRouterGemini añadida al final del archivo")
