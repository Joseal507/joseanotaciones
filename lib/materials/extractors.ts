// ═══════════════════════════════════════════════════════
// EXTRACTORES — texto puro, imagen, mixto
// Sin IA en el upload — solo cuando el usuario lo necesita
// ═══════════════════════════════════════════════════════

import type { MaterialKind } from './types';
import { classifyProviderFailure, sanitizedProviderMessage, shouldFallbackToGroq, type ProviderError } from '../ai/providerPolicy';

export interface ExtractionResult {
  text: string;
  pages?: number;
  method: string;
  chars: number;
  isImageBased: boolean;   // true si el contenido viene de visión
  hasText: boolean;        // true si hay texto real extraído
  classification?: 'text_pdf' | 'scanned_pdf' | 'extraction_failure';
}

export interface ExtractionOptions {
  localOnly?: boolean;
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
export async function extractPdf(
  buffer: Buffer,
  options: ExtractionOptions = {},
): Promise<ExtractionResult> {

  let localText = '';
  let localPages: number | undefined;

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

    localText = text;
    localPages = data.numpages;
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
        classification: 'text_pdf',
      };
    }
    console.log('PDF parece escaneado, intentando OCR...');
  } catch (e: any) {
    console.warn('pdf-parse error:', e?.message);
  }

  if (options.localOnly) {
    return {
      text: localText,
      pages: localPages,
      method: localText.length > 0 ? 'pdf-parse-partial' : 'none',
      chars: localText.length,
      isImageBased: true,
      hasText: localText.length > 0,
      classification: localPages === undefined ? 'extraction_failure' : 'scanned_pdf',
    };
  }

  // ── Estrategia remota canónica: OpenRouter Gemini 2.5 Flash ──
  const openrouterKey = process.env.OPENROUTER_API_KEY;
  if (openrouterKey && buffer.length < 50 * 1024 * 1024) {
    try {
      const text = await extractWithOpenRouterGemini(buffer, openrouterKey);
      if (text.length >= 50) {
        return {
          text,
          method: 'openrouter-gemini-ocr',
          chars: text.length,
          isImageBased: true,
          hasText: true,
        };
      }
    } catch (e: any) {
      console.warn('OpenRouter Gemini OCR error:', e?.message);
    }
  }

  return {
    text: '',
    method: 'none',
    chars: 0,
    isImageBased: false,
    hasText: false,
    classification: 'extraction_failure',
  };
}

// ════════════════════════════════════════
// IMAGEN — OpenRouter Gemini 2.5 Flash; Groq solo por créditos agotados confirmados
// Solo se llama cuando el usuario usa un enfoque
// ════════════════════════════════════════
export async function extractImage(
  buffer: Buffer,
  mime: string,
): Promise<ExtractionResult> {
  const base64 = buffer.toString('base64');

  const prompt = `Analiza esta imagen de estudio completamente.

1. Extrae TODO el texto visible (exactamente como aparece)
2. Describe diagramas, gráficos, tablas o figuras
3. Escribe fórmulas matemáticas en LaTeX entre $...$
4. Si hay código, transcríbelo completo
5. Organiza por secciones si las hay

Sé exhaustivo — cada detalle cuenta para el estudio.`;
  const openrouterKey = process.env.OPENROUTER_API_KEY;
  let creditsError: ProviderError | undefined;
  if (openrouterKey) {
    try {
      const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${openrouterKey}`,
          'HTTP-Referer': 'https://studyal.app',
          'X-Title': 'StudyAL Image Extraction',
        },
        body: JSON.stringify({
          model: 'google/gemini-2.5-flash',
          messages: [{ role: 'user', content: [
            { type: 'image_url', image_url: { url: `data:${mime};base64,${base64}` } },
            { type: 'text', text: prompt },
          ] }],
          max_tokens: 8192,
        }),
      });
      if (!res.ok) {
        const body = await res.text().catch(() => '');
        const providerError = { provider: 'openrouter', status: res.status, message: `OpenRouter ${res.status}`, body };
        if (shouldFallbackToGroq(providerError)) creditsError = providerError;
        else return { text: '', method: 'error', chars: 0, isImageBased: true, hasText: false };
      } else {
      const data = await res.json();
      const text = data?.choices?.[0]?.message?.content ?? '';
      if (text.length > 50) {
          return { text, method: 'openrouter-gemini-vision', chars: text.length, isImageBased: true, hasText: true };
        }
      }
    } catch (error: any) {
      return { text: '', method: 'error', chars: 0, isImageBased: true, hasText: false };
    }
  }

  if (creditsError) {
    console.info('[provider-policy]', JSON.stringify({
      event: 'openrouter_credits_exhausted', provider: 'openrouter', model: 'google/gemini-2.5-flash',
      status: creditsError.status, normalizedFailureReason: classifyProviderFailure(creditsError), fallbackAllowed: true,
      fallbackTarget: 'groq', excludedProviders: ['openrouter'], rawProviderMessage: sanitizedProviderMessage(creditsError),
      stage: 'image_extraction', taskType: 'material_analysis',
    }));
    const groqKey = process.env.GROQ_API_KEY;
    if (!groqKey) return { text: '', method: 'none', chars: 0, isImageBased: true, hasText: false };
    try {
      const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${groqKey}` },
        body: JSON.stringify({ model: 'meta-llama/llama-4-scout-17b-16e-instruct', messages: [{ role: 'user', content: [
          { type: 'image_url', image_url: { url: `data:${mime};base64,${base64}` } }, { type: 'text', text: prompt },
        ] }], max_tokens: 8192 }),
      });
      if (res.ok) {
        const data = await res.json();
        const text = data?.choices?.[0]?.message?.content ?? '';
        if (text.length > 50) return { text, method: 'groq-vision', chars: text.length, isImageBased: true, hasText: true };
      }
    } catch {}
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
// AUDIO — transcripción canónica vía OpenRouter Gemini 2.5 Flash
// ════════════════════════════════════════
export async function extractAudio(
  buffer: Buffer,
  mime: string,
  fileName: string,
): Promise<ExtractionResult> {
  const openrouterKey = process.env.OPENROUTER_API_KEY;
  if (!openrouterKey) {
    return { text: '', method: 'none', chars: 0, isImageBased: false, hasText: false };
  }

  try {
    const format = mime.includes('wav') ? 'wav' : mime.includes('mp3') ? 'mp3' : 'webm';
    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${openrouterKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'google/gemini-2.5-flash',
        messages: [{ role: 'user', content: [
          { type: 'text', text: `Transcribe literalmente el archivo ${fileName}. Devuelve solo la transcripción.` },
          { type: 'input_audio', input_audio: { data: buffer.toString('base64'), format } },
        ] }],
        temperature: 0,
      }),
    });
    if (!response.ok) throw new Error(`OpenRouter audio ${response.status}`);
    const data = await response.json();
    const text = data?.choices?.[0]?.message?.content ?? '';
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
  options: ExtractionOptions = {},
): Promise<ExtractionResult> {
  switch (kind) {
    case 'txt':   return extractTxt(buffer);
    case 'docx':  return extractDocx(buffer);
    case 'pptx':  return extractPptx(buffer);
    case 'pdf':   return extractPdf(buffer, options);
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
