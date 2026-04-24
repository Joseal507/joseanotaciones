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
    console.log(`Descargado: ${(buffer.length/1024/1024).toFixed(1)}MB`);

    let content = '';
    const nombre = (fileName || '').toLowerCase();

    // 1. pdf-parse
    if (nombre.endsWith('.pdf')) {
      try {
        const pdfParse = (await import('pdf-parse')).default;
        const data = await pdfParse(buffer, { max: 0 });
        content = data.text?.trim() || '';
        console.log(`pdf-parse: ${content.length} chars`);
      } catch (e: any) { console.log('pdf-parse error:', e?.message); }
    }

    // 2. Gemini Vision
    const geminiKeys = [process.env.GEMINI_API_KEY, process.env.GEMINI_API_KEY_2, process.env.GEMINI_API_KEY_3, process.env.GEMINI_API_KEY_4].filter(Boolean) as string[];
    if (buffer.length < 20 * 1024 * 1024) {
      for (const gkey of geminiKeys.slice(0, 4)) {
        try {
          const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${gkey}`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ contents: [{ parts: [{ inlineData: { mimeType: 'application/pdf', data: buffer.toString('base64') } }, { text: 'Extract ALL text, handwritten notes, formulas, tables. Be thorough.' }] }], generationConfig: { maxOutputTokens: 8192 } }),
          });
          if (!res.ok) { console.log('Gemini failed:', res.status); continue; }
          const d = await res.json();
          const t = d?.candidates?.[0]?.content?.parts?.[0]?.text || '';
          if (t.length > 50) { content = content ? content + '\n\n' + t : t; console.log(`Gemini: ${content.length} chars`); break; }
        } catch { continue; }
      }
    }

    // 3. Groq Vision fallback
    if (!content || content.length < 200) {
      const groqKeys = [process.env.GROQ_API_KEY, process.env.GROQ_API_KEY_2, process.env.GROQ_API_KEY_3, process.env.GROQ_API_KEY_4, process.env.GROQ_API_KEY_5, process.env.GROQ_API_KEY_6].filter(Boolean) as string[];
      if (buffer.length < 10 * 1024 * 1024) {
        for (const gk of groqKeys.slice(0, 3)) {
          try {
            const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
              method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${gk}` },
              body: JSON.stringify({ model: 'meta-llama/llama-4-scout-17b-16e-instruct', messages: [{ role: 'user', content: [{ type: 'image_url', image_url: { url: `data:application/pdf;base64,${buffer.toString('base64')}` } }, { type: 'text', text: 'Extract ALL text from this document completely.' }] }], max_tokens: 4096 }),
            });
            if (!res.ok) continue;
            const d = await res.json();
            const t = d?.choices?.[0]?.message?.content || '';
            if (t.length > (content?.length || 0)) { content = t; console.log(`Groq Vision: ${content.length} chars`); break; }
          } catch { continue; }
        }
      }
    }

    // 4. Mistral OCR
    if ((!content || content.length < 100) && process.env.MISTRAL_API_KEY) {
      try {
        const apiKey = process.env.MISTRAL_API_KEY;
        const fd = new FormData();
        fd.append('file', new Blob([buffer], { type: 'application/pdf' }), fileName || 'doc.pdf');
        fd.append('purpose', 'ocr');
        const up = await fetch('https://api.mistral.ai/v1/files', { method: 'POST', headers: { 'Authorization': `Bearer ${apiKey}` }, body: fd });
        if (up.ok) {
          const { id } = await up.json();
          const su = await fetch(`https://api.mistral.ai/v1/files/${id}/url`, { headers: { 'Authorization': `Bearer ${apiKey}` } });
          if (su.ok) {
            const { url } = await su.json();
            const ocr = await fetch('https://api.mistral.ai/v1/ocr', { method: 'POST', headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ model: 'mistral-ocr-latest', document: { type: 'document_url', document_url: url } }) });
            if (ocr.ok) { const od = await ocr.json(); const t = od.pages?.map((p: any) => p.markdown || p.text || '').join('\n\n') || ''; if (t.length > content.length) { content = t; console.log(`Mistral: ${content.length} chars`); } }
          }
          await fetch(`https://api.mistral.ai/v1/files/${id}`, { method: 'DELETE', headers: { 'Authorization': `Bearer ${apiKey}` } }).catch(() => {});
        }
      } catch (e: any) { console.log('Mistral error:', e?.message); }
    }

    console.log(`Final: ${content.length} chars`);
    return NextResponse.json({ success: true, content: content || 'No se pudo extraer texto.' });
  } catch (error: any) {
    console.error('process-pdf error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
