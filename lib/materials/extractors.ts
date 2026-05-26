// ═══════════════════════════════════════════════════════
// EXTRACTORES — texto puro, imagen, mixto
// Sin IA en el upload — solo cuando el usuario lo necesita
// ═══════════════════════════════════════════════════════

import type { MaterialKind } from './types';

export interface ExtractionResult {
  text: string;
  pages?: number;
  method: string;
  chars: number;
  isImageBased: boolean;   // true si el contenido viene de visión
  hasText: boolean;        // true si hay texto real extraído
}

// ════════════════════════════════════════
// TXT — gratis, instantáneo
// ════════════════════════════════════════
export async function extractTxt(buffer: Buffer): Promise<ExtractionResult> {
  const text = buffer.toString('utf-8').trim();
  return {
    text,
    method: 'utf8',
    chars: text.length,
    isImageBased: false,
    hasText: text.length > 0,
  };
}

// ════════════════════════════════════════
// DOCX — gratis, mammoth
// ════════════════════════════════════════
export async function extractDocx(buffer: Buffer): Promise<ExtractionResult> {
  const mammoth = (await import('mammoth')).default;
  const result = await mammoth.extractRawText({ buffer });
  const text = result.value?.trim() ?? '';
  return {
    text,
    method: 'mammoth',
    chars: text.length,
    isImageBased: false,
    hasText: text.length > 50,
  };
}

// ════════════════════════════════════════
// PPTX — gratis, jszip
// ════════════════════════════════════════
export async function extractPptx(buffer: Buffer): Promise<ExtractionResult> {
  const JSZip = (await import('jszip')).default;
  const zip = await JSZip.loadAsync(buffer);

  const slideFiles = Object.keys(zip.files)
    .filter(f => /ppt\/slides\/slide\d+\.xml$/.test(f))
    .sort((a, b) => {
      const na = parseInt(a.match(/slide(\d+)/)?.[1] ?? '0');
      const nb = parseInt(b.match(/slide(\d+)/)?.[1] ?? '0');
      return na - nb;
    });

  const slideTexts: string[] = [];
  for (const slideFile of slideFiles) {
    const xml = await zip.files[slideFile].async('string');
    const matches = xml.match(/<a:t[^>]*>([^<]+)<\/a:t>/g) ?? [];
    const texts = matches
      .map(t => t.replace(/<[^>]+>/g, '').trim())
      .filter(t => t.length > 0);
    if (texts.length > 0) {
      const num = slideFile.match(/slide(\d+)/)?.[1] ?? '?';
      slideTexts.push(`[Diapositiva ${num}]\n${texts.join(' ')}`);
    }
  }

  const text = slideTexts.join('\n\n').trim();
  return {
    text,
    pages: slideFiles.length,
    method: 'jszip',
    chars: text.length,
    isImageBased: false,
    hasText: text.length > 50,
  };
}

// ════════════════════════════════════════
// PDF — cascada inteligente
// Texto nativo → Mistral OCR → Gemini
// ════════════════════════════════════════
export async function extractPdf(buffer: Buffer): Promise<ExtractionResult> {

  // ── Estrategia 1: pdf-parse (texto nativo, gratis) ──
  try {
    const pdfParse = (await import('pdf-parse')).default;
    const pageTexts: string[] = [];
    const data = await pdfParse(buffer, {
      max: 0,
      pagerender: async (pageData: any) => {
        const content = await pageData.getTextContent();
        const pageStr = content.items.map((item: any) => item.str).join(' ').trim();
        pageTexts.push(pageStr);
        return pageStr;
      },
    });

    let text: string;
    if (pageTexts.length > 0) {
      text = pageTexts
        .map((t: string, i: number) => `[Pagina ${i + 1}]\n${t}`)
        .join('\n\f\n');
    } else {
      text = data.text?.trim() ?? '';
    }

    const isScanned = text.replace(/\[Pagina \d+\]/g, '').trim().length < 100;

    if (!isScanned) {
      console.log(`✅ PDF nativo: ${text.length} chars (${data.numpages} páginas)`);
      return {
        text,
        pages: data.numpages,
        method: 'pdf-parse',
        chars: text.length,
        isImageBased: false,
        hasText: true,
      };
    }
    console.log('PDF parece escaneado, intentando OCR...');
  } catch (e: any) {
    console.warn('pdf-parse error:', e?.message);
  }

  // ── Estrategia 2: Gemini 2.5 Flash vía OpenRouter (PDFs escaneados) ──
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
  }

  return {
    text: '',
    method: 'none',
    chars: 0,
    isImageBased: false,
    hasText: false,
  };
}

// ════════════════════════════════════════
// IMAGEN — visión con Groq/Gemini
// Solo se llama cuando el usuario usa un enfoque
// ════════════════════════════════════════
export async function extractImage(
  buffer: Buffer,
  mime: string,
): Promise<ExtractionResult> {
  const base64 = buffer.toString('base64');

  // ── Intentar Groq Vision primero (más rápido) ──
  const groqKeys = [
    process.env.GROQ_API_KEY,
    process.env.GROQ_API_KEY_2,
    process.env.GROQ_API_KEY_3,
  ].filter(Boolean) as string[];

  for (const key of groqKeys) {
    try {
      const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${key}`,
        },
        body: JSON.stringify({
          model: 'meta-llama/llama-4-scout-17b-16e-instruct',
          messages: [{
            role: 'user',
            content: [
              {
                type: 'image_url',
                image_url: { url: `data:${mime};base64,${base64}` },
              },
              {
                type: 'text',
                text: `Analiza esta imagen de estudio completamente.

1. Extrae TODO el texto visible (exactamente como aparece)
2. Describe diagramas, gráficos, tablas o figuras
3. Escribe fórmulas matemáticas en LaTeX entre $...$
4. Si hay código, transcríbelo completo
5. Organiza por secciones si las hay

Sé exhaustivo — cada detalle cuenta para el estudio.`,
              },
            ],
          }],
          max_tokens: 8192,
        }),
      });

      if (!res.ok) continue;
      const data = await res.json();
      const text = data?.choices?.[0]?.message?.content ?? '';

      if (text.length > 50) {
        console.log(`✅ Groq Vision imagen: ${text.length} chars`);
        return {
          text,
          method: 'groq-vision',
          chars: text.length,
          isImageBased: true,
          hasText: true,
        };
      }
    } catch { continue; }
  }

  // ── Fallback: Gemini Vision ──
  const geminiKey = process.env.GEMINI_API_KEY;
  if (geminiKey) {
    try {
      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${geminiKey}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{
              parts: [
                { inlineData: { mimeType: mime, data: base64 } },
                {
                  text: `Analiza esta imagen de estudio:
1. Extrae todo el texto visible
2. Describe diagramas y figuras
3. Fórmulas en LaTeX
4. Sé exhaustivo`,
                },
              ],
            }],
            generationConfig: { maxOutputTokens: 8192 },
          }),
        },
      );

      if (res.ok) {
        const data = await res.json();
        const text = data?.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
        if (text.length > 50) {
          console.log(`✅ Gemini Vision imagen: ${text.length} chars`);
          return {
            text,
            method: 'gemini-vision',
            chars: text.length,
            isImageBased: true,
            hasText: true,
          };
        }
      }
    } catch (e: any) {
      console.warn('Gemini Vision error:', e?.message);
    }
  }

  return {
    text: '',
    method: 'none',
    chars: 0,
    isImageBased: true,
    hasText: false,
  };
}

// ════════════════════════════════════════
// AUDIO — Whisper via Groq
// ════════════════════════════════════════
export async function extractAudio(
  buffer: Buffer,
  mime: string,
  fileName: string,
): Promise<ExtractionResult> {
  const groqKey = process.env.GROQ_API_KEY;
  if (!groqKey) {
    return { text: '', method: 'none', chars: 0, isImageBased: false, hasText: false };
  }

  try {
    const { default: Groq } = await import('groq-sdk');
    const client = new Groq({ apiKey: groqKey });
    const audioFile = new File([new Uint8Array(buffer)], fileName, { type: mime });

    const transcription = await (client.audio as any).transcriptions.create({
      file: audioFile,
      model: 'whisper-large-v3',
      response_format: 'json',
      temperature: 0.0,
    });

    const text = transcription.text ?? '';
    console.log(`✅ Whisper audio: ${text.length} chars`);
    return {
      text,
      method: 'whisper',
      chars: text.length,
      isImageBased: false,
      hasText: text.length > 0,
    };
  } catch (e: any) {
    console.warn('Whisper error:', e?.message);
    return { text: '', method: 'error', chars: 0, isImageBased: false, hasText: false };
  }
}

// ════════════════════════════════════════
// DISPATCHER PRINCIPAL
// ════════════════════════════════════════
export async function extractText(
  buffer: Buffer,
  kind: MaterialKind,
  mime: string,
  fileName = 'file',
): Promise<ExtractionResult> {
  switch (kind) {
    case 'txt':   return extractTxt(buffer);
    case 'docx':  return extractDocx(buffer);
    case 'pptx':  return extractPptx(buffer);
    case 'pdf':   return extractPdf(buffer);
    case 'image': return extractImage(buffer, mime);
    case 'audio': return extractAudio(buffer, mime, fileName);
    default:
      return { text: '', method: 'unsupported', chars: 0, isImageBased: false, hasText: false };
  }
}

// ════════════════════════════════════════
// HELPERS PRIVADOS
// ════════════════════════════════════════

async function extractWithMistralOcr(buffer: Buffer): Promise<string> {
  const apiKey = process.env.MISTRAL_API_KEY!;
  const fd = new FormData();
  fd.append(
    'file',
    new Blob([new Uint8Array(buffer)], { type: 'application/pdf' }),
    'doc.pdf',
  );
  fd.append('purpose', 'ocr');

  const up = await fetch('https://api.mistral.ai/v1/files', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}` },
    body: fd,
  });
  if (!up.ok) return '';
  const { id } = await up.json();

  const su = await fetch(`https://api.mistral.ai/v1/files/${id}/url`, {
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  if (!su.ok) return '';
  const { url } = await su.json();

  const ocr = await fetch('https://api.mistral.ai/v1/ocr', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'mistral-ocr-latest',
      document: { type: 'document_url', document_url: url },
    }),
  });
  if (!ocr.ok) return '';

  const od = await ocr.json();
  const text = od.pages?.map((p: any, i: number) => {
    const pageText = String(p.markdown || p.text || '').trim();
    return `\f[Página ${i + 1}]\n${pageText}`;
  }).join('\n\n') ?? '';

  fetch(`https://api.mistral.ai/v1/files/${id}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${apiKey}` },
  }).catch(() => {});

  return text;
}

async function extractWithGemini(buffer: Buffer, apiKey: string): Promise<string> {
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{
          parts: [
            {
              inlineData: {
                mimeType: 'application/pdf',
                data: buffer.toString('base64'),
              },
            },
            { text: 'Extract ALL text from this PDF exactly as it appears. Include all content.' },
          ],
        }],
        generationConfig: { maxOutputTokens: 8192 },
      }),
    },
  );
  if (!res.ok) return '';
  const data = await res.json();
  return data?.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
}

// ════════════════════════════════════════
// OpenRouter Gemini 2.5 Flash — OCR económico
// ════════════════════════════════════════
async function extractWithOpenRouterGemini(buffer: Buffer, apiKey: string): Promise<string> {
  const base64 = buffer.toString('base64');

  const prompt = `Eres un extractor de texto de PDF. Tu tarea: devolver TODO el texto del PDF organizado EXACTAMENTE por páginas.

FORMATO OBLIGATORIO (sin excepciones):

[Pagina 1]
texto de la página 1 aquí...
todo el texto literal sin omitir nada...

[Pagina 2]
texto de la página 2 aquí...

[Pagina 3]
texto de la página 3 aquí...

REGLAS:
- DEBES empezar cada página con el marcador exacto: [Pagina N] donde N es el número de página (1, 2, 3...)
- DEBES incluir TODAS las páginas del PDF (no omitas ninguna)
- Cada marcador [Pagina N] va en su propia línea
- Después del marcador viene el texto completo de esa página
- Si una página está vacía, escribe: [Pagina N]\n(página vacía)
- Conserva orden de lectura natural (arriba→abajo, izq→der)
- Incluye títulos, párrafos, tablas como texto plano, listas, todo
- NO inventes texto, solo extrae lo visible
- NO uses markdown (sin #, sin **, sin --)
- Para fórmulas matemáticas usa LaTeX $...$
- NO añadas comentarios ni explicaciones tuyas

EJEMPLO de respuesta válida:
[Pagina 1]
Título del documento
Primer párrafo del documento...
Segundo párrafo...

[Pagina 2]
Sección 2: Detalles
Lista de elementos:
- Item 1
- Item 2

Empieza AHORA con [Pagina 1]:`;

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

