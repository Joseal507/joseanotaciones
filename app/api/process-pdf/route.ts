import { NextRequest, NextResponse } from 'next/server';
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const r2Client = new S3Client({
  region: 'auto',
  endpoint: process.env.R2_ENDPOINT,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID!,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!,
  },
});

const geminiKeyStatus = new Map<string, number>();
const GEMINI_KEYS = [
  process.env.GEMINI_API_KEY, process.env.GEMINI_API_KEY_2,
  process.env.GEMINI_API_KEY_3, process.env.GEMINI_API_KEY_4,
  process.env.GEMINI_API_KEY_5,
].filter(Boolean) as string[];
let geminiIdx = 0;

const GROQ_KEYS = [
  process.env.GROQ_API_KEY, process.env.GROQ_API_KEY_2,
  process.env.GROQ_API_KEY_3, process.env.GROQ_API_KEY_4,
].filter(Boolean) as string[];

const tryGemini = async (buffer: Buffer, prompt: string): Promise<string> => {
  const now = Date.now();
  for (let i = 0; i < GEMINI_KEYS.length; i++) {
    const idx = (geminiIdx + i) % GEMINI_KEYS.length;
    const key = GEMINI_KEYS[idx];
    if (geminiKeyStatus.has(key) && now < geminiKeyStatus.get(key)!) continue;
    try {
      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${key}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{ parts: [{ inlineData: { mimeType: 'application/pdf', data: buffer.toString('base64') } }, { text: prompt }] }],
            generationConfig: { maxOutputTokens: 8192 },
          }),
        }
      );
      if (res.status === 429) { geminiKeyStatus.set(key, Date.now() + 60_000); continue; }
      if (!res.ok) continue;
      const d = await res.json();
      const text = d?.candidates?.[0]?.content?.parts?.[0]?.text || '';
      if (text.length > 50) { geminiIdx = (idx + 1) % GEMINI_KEYS.length; console.log(`✅ Gemini key ${idx + 1}: ${text.length} chars`); return text; }
    } catch { continue; }
  }
  return '';
};

const tryMistral = async (buffer: Buffer, fileName: string): Promise<string> => {
  if (!process.env.MISTRAL_API_KEY) return '';
  try {
    const apiKey = process.env.MISTRAL_API_KEY;
    const fd = new FormData();
    fd.append('file', new Blob([new Uint8Array(buffer)], { type: 'application/pdf' }), fileName || 'doc.pdf');
    fd.append('purpose', 'ocr');
    const up = await fetch('https://api.mistral.ai/v1/files', { method: 'POST', headers: { 'Authorization': `Bearer ${apiKey}` }, body: fd });
    if (!up.ok) return '';
    const { id } = await up.json();
    const su = await fetch(`https://api.mistral.ai/v1/files/${id}/url`, { headers: { 'Authorization': `Bearer ${apiKey}` } });
    if (!su.ok) return '';
    const { url } = await su.json();
    const ocr = await fetch('https://api.mistral.ai/v1/ocr', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'mistral-ocr-latest', document: { type: 'document_url', document_url: url } }),
    });
    if (!ocr.ok) return '';
    const od = await ocr.json();
    const text = od.pages?.map((p: any) => p.markdown || p.text || '').join('\n\n') || '';
    fetch(`https://api.mistral.ai/v1/files/${id}`, { method: 'DELETE', headers: { 'Authorization': `Bearer ${apiKey}` } }).catch(() => {});
    console.log(`✅ Mistral OCR: ${text.length} chars`);
    return text;
  } catch (e: any) { console.log('Mistral error:', e?.message); return ''; }
};

const tryGroqVision = async (buffer: Buffer): Promise<string> => {
  if (buffer.length > 10 * 1024 * 1024) return '';
  for (const key of GROQ_KEYS) {
    try {
      const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${key}` },
        body: JSON.stringify({
          model: 'meta-llama/llama-4-scout-17b-16e-instruct',
          messages: [{ role: 'user', content: [{ type: 'image_url', image_url: { url: `data:application/pdf;base64,${buffer.toString('base64')}` } }, { type: 'text', text: 'Extract ALL text from this document.' }] }],
          max_tokens: 4096,
        }),
      });
      if (!res.ok) continue;
      const d = await res.json();
      const text = d?.choices?.[0]?.message?.content || '';
      if (text.length > 100) { console.log(`✅ Groq Vision: ${text.length} chars`); return text; }
    } catch { continue; }
  }
  return '';
};

export async function POST(req: NextRequest) {
  try {
    const { r2Url, fileName } = await req.json();
    if (!r2Url) return NextResponse.json({ error: 'r2Url required' }, { status: 400 });

    const urlParts = new URL(r2Url);
    const key = urlParts.pathname.replace(`/${process.env.R2_BUCKET || 'studyal'}/`, '');

    console.log('Descargando:', key);
    const r2Response = await r2Client.send(new GetObjectCommand({ Bucket: process.env.R2_BUCKET || 'studyal', Key: key }));
    if (!r2Response.Body) throw new Error('Empty R2 response');
    const buffer = Buffer.from(await r2Response.Body.transformToByteArray());
    console.log(`Descargado: ${(buffer.length / 1024 / 1024).toFixed(1)}MB`);

    let content = '';
    const nombre = (fileName || '').toLowerCase();

    // 1. pdf-parse (instantáneo, sin IA)
    if (nombre.endsWith('.pdf')) {
      try {
        const pdfParse = (await import('pdf-parse')).default;
        const data = await pdfParse(buffer, { max: 0 });
        content = data.text?.trim() || '';
        console.log(`pdf-parse: ${content.length} chars`);
      } catch (e: any) { console.log('pdf-parse error:', e?.message); }
    }

    // Si pdf-parse extrajo suficiente, no usar IA
    if (content.length >= 500) {
      console.log(`✅ pdf-parse suficiente, saltando IA`);
      return NextResponse.json({ success: true, content });
    }

    // 2. Gemini + Mistral en PARALELO
    console.log('Usando IA en paralelo...');
    const [geminiText, mistralText] = await Promise.all([
      buffer.length < 20 * 1024 * 1024
        ? tryGemini(buffer, 'Extract ALL text, handwritten notes, formulas, tables. Be thorough and complete.')
        : Promise.resolve(''),
      tryMistral(buffer, fileName || 'doc.pdf'),
    ]);

    if (geminiText.length > content.length) content = geminiText;
    if (mistralText.length > content.length) content = mistralText;

    // 3. Groq Vision último recurso
    if (content.length < 200) {
      const groqText = await tryGroqVision(buffer);
      if (groqText.length > content.length) content = groqText;
    }

    console.log(`Final: ${content.length} chars`);
    return NextResponse.json({ success: true, content: content || 'No se pudo extraer texto.' });

  } catch (error: any) {
    console.error('process-pdf error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
