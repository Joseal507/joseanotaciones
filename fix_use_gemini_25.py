import pathlib

path = pathlib.Path('lib/materials/extractors.ts')
text = path.read_text(encoding='utf-8')

# Reemplazar la estrategia 2 (Mistral) por Gemini 2.5 Flash vía OpenRouter
old = '''  // ── Estrategia 2: Mistral OCR (PDFs escaneados) ──
  if (process.env.MISTRAL_API_KEY) {
    try {
      const text = await extractWithMistralOcr(buffer);
      if (text.length >= 100) {
        console.log(`✅ Mistral OCR: ${text.length} chars`);
        return {
          text,
          method: 'mistral-ocr',
          chars: text.length,
          isImageBased: true,
          hasText: true,
        };
      }
    } catch (e: any) {
      console.warn('Mistral OCR error:', e?.message);
    }
  }

  // ── Estrategia 3: Gemini (último recurso) ──
  const geminiKey = process.env.GEMINI_API_KEY
    ?? process.env.GEMINI_API_KEY_2
    ?? process.env.GEMINI_API_KEY_3;

  if (geminiKey && buffer.length < 20 * 1024 * 1024) {
    try {
      const text = await extractWithGemini(buffer, geminiKey);
      if (text.length >= 50) {
        console.log(`✅ Gemini PDF: ${text.length} chars`);
        return {
          text,
          method: 'gemini',
          chars: text.length,
          isImageBased: true,
          hasText: true,
        };
      }
    } catch (e: any) {
      console.warn('Gemini PDF error:', e?.message);
    }
  }'''

new = '''  // ── Estrategia 2: Gemini 2.5 Flash vía OpenRouter (PDFs escaneados) ──
  if (process.env.OPENROUTER_API_KEY && buffer.length < 50 * 1024 * 1024) {
    try {
      const text = await extractWithOpenRouterGemini(buffer, process.env.OPENROUTER_API_KEY);
      if (text.length >= 50) {
        console.log(`✅ Gemini 2.5 Flash (OpenRouter): ${text.length} chars`);
        return {
          text,
          method: 'openrouter-gemini-2.5-flash',
          chars: text.length,
          isImageBased: true,
          hasText: true,
        };
      }
    } catch (e: any) {
      console.warn('OpenRouter Gemini error:', e?.message);
    }
  }

  // ── Estrategia 3: Mistral OCR (fallback) ──
  if (process.env.MISTRAL_API_KEY) {
    try {
      const text = await extractWithMistralOcr(buffer);
      if (text.length >= 100) {
        console.log(`✅ Mistral OCR (fallback): ${text.length} chars`);
        return {
          text,
          method: 'mistral-ocr',
          chars: text.length,
          isImageBased: true,
          hasText: true,
        };
      }
    } catch (e: any) {
      console.warn('Mistral OCR error:', e?.message);
    }
  }

  // ── Estrategia 4: Gemini directo (último recurso) ──
  const geminiKey = process.env.GEMINI_API_KEY
    ?? process.env.GEMINI_API_KEY_2
    ?? process.env.GEMINI_API_KEY_3;

  if (geminiKey && buffer.length < 20 * 1024 * 1024) {
    try {
      const text = await extractWithGemini(buffer, geminiKey);
      if (text.length >= 50) {
        console.log(`✅ Gemini PDF directo: ${text.length} chars`);
        return {
          text,
          method: 'gemini',
          chars: text.length,
          isImageBased: true,
          hasText: true,
        };
      }
    } catch (e: any) {
      console.warn('Gemini PDF error:', e?.message);
    }
  }'''

if old in text:
    text = text.replace(old, new)
    print("✅ Estrategia OCR reemplazada: Gemini 2.5 Flash via OpenRouter ahora es primera opción OCR")
else:
    print("❌ No encontré bloque de estrategias OCR")

# Agregar la función extractWithOpenRouterGemini al final del archivo
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

# Verificar si ya existe
if 'extractWithOpenRouterGemini' not in text:
    text = text.rstrip() + new_function
    print("✅ Función extractWithOpenRouterGemini añadida")
else:
    print("⚠️ Función extractWithOpenRouterGemini ya existe")

path.write_text(text, encoding='utf-8')
