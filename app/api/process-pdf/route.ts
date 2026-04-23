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

function cleanContent(text: string): string {
  if (!text) return '';
  return text
    // Quitar referencias de imágenes: ![anything](anything)
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1' !== '' ? '' : '')
    .replace(/!\[.*?\]\(.*?\)/g, '')
    // Quitar líneas que solo tienen referencia de imagen
    .replace(/^!\[.*
?/gm, '')
    // Quitar nombres de archivo de imagen comunes
    .replace(/\S+\.(jpeg|jpg|png|gif|webp|svg|bmp|tiff)/gi, '')
    // Quitar markdown de encabezados pero mantener el texto
    .replace(/^#{1,6}\s+/gm, '')
    // Quitar líneas vacías múltiples (más de 2 seguidas)
    .replace(/
{3,}/g, '

')
    // Limpiar espacios al inicio/final
    .trim();
}

export async function POST(req: NextRequest) {
  try {
    const { r2Url, fileName } = await req.json();

    if (!r2Url) {
      return NextResponse.json({ error: 'r2Url required' }, { status: 400 });
    }

    // Extraer key del R2 URL
    // URL: https://endpoint/bucket/uploads/user/123.pdf
    // key: uploads/user/123.pdf
    const urlParts = new URL(r2Url);
    const key = urlParts.pathname.replace(`/${process.env.R2_BUCKET || 'joseanotaciones'}/`, '');

    console.log('📥 Descargando desde R2, key:', key);

    // Descargar con SDK (autenticado)
    const getCommand = new GetObjectCommand({
      Bucket: process.env.R2_BUCKET || 'joseanotaciones',
      Key: key,
    });

    const r2Response = await r2Client.send(getCommand);
    if (!r2Response.Body) throw new Error('Empty response from R2');

    const buffer = Buffer.from(await r2Response.Body.transformToByteArray());
    console.log(`📄 Archivo descargado: ${(buffer.length / 1024 / 1024).toFixed(1)}MB`);

    let content = '';
    const nombre = (fileName || '').toLowerCase();

    // Estrategia 1: pdf-parse
    if (nombre.endsWith('.pdf')) {
      try {
        const pdfParse = (await import('pdf-parse')).default;
        const data = await pdfParse(buffer, { max: 0 });
        content = data.text?.trim() || '';
        console.log(`pdf-parse: ${content.length} chars`);
      } catch (e: any) {
        console.log('pdf-parse error:', e?.message);
      }
    }

    // Estrategia 2: Gemini Vision
    const geminiKeys = [
      process.env.GEMINI_API_KEY,
      process.env.GEMINI_API_KEY_2,
      process.env.GEMINI_API_KEY_3,
      process.env.GEMINI_API_KEY_4,
    ].filter(Boolean) as string[];

    if (geminiKeys.length > 0 && buffer.length < 20 * 1024 * 1024) {
      for (const key of geminiKeys.slice(0, 3)) {
        try {
          const base64 = buffer.toString('base64');
          const res = await fetch(
            `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${key}`,
            {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                contents: [{ parts: [
                  { inlineData: { mimeType: 'application/pdf', data: base64 } },
                  { text: `Extract ALL content from this PDF:
1. All printed text in order
2. Handwritten notes mark as [handwritten: ...]
3. Diagrams mark as [diagram: ...]
4. Math formulas
5. Tables and figures
Return everything as structured text.` },
                ]}],
                generationConfig: { temperature: 0.1, maxOutputTokens: 8192 },
              }),
            }
          );
          if (!res.ok) {
            console.log('Gemini key failed:', res.status);
            continue;
          }
          const data = await res.json();
          const geminiText = data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
          if (geminiText && geminiText.length > 50) {
            content = content
              ? content + '\n\n--- Visual content ---\n\n' + geminiText
              : geminiText;
            console.log(`✅ Gemini: ${content.length} chars`);
            break;
          }
        } catch (e: any) {
          console.log('Gemini error:', e?.message);
          continue;
        }
      }
    }

    // Estrategia 3: Mistral OCR (silencioso si falla)
    if ((!content || content.length < 100) && process.env.MISTRAL_API_KEY) {
      try {
        const apiKey = process.env.MISTRAL_API_KEY;
        const formData = new FormData();
        const blob = new Blob([buffer], { type: 'application/pdf' });
        formData.append('file', blob, fileName || 'document.pdf');
        formData.append('purpose', 'ocr');

        const uploadRes = await fetch('https://api.mistral.ai/v1/files', {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${apiKey}` },
          body: formData,
        });

        if (uploadRes.ok) {
          const { id: fileId } = await uploadRes.json();
          const signedRes = await fetch(`https://api.mistral.ai/v1/files/${fileId}/url`, {
            headers: { 'Authorization': `Bearer ${apiKey}` },
          });
          if (signedRes.ok) {
            const { url: signedUrl } = await signedRes.json();
            const ocrRes = await fetch('https://api.mistral.ai/v1/ocr', {
              method: 'POST',
              headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
              body: JSON.stringify({ model: 'mistral-ocr-latest', document: { type: 'document_url', document_url: signedUrl } }),
            });
            if (ocrRes.ok) {
              const ocrData = await ocrRes.json();
              const mistralText = ocrData.pages?.map((p: any) => p.markdown || p.text || '').join('\n\n') || '';
              if (mistralText.length > content.length) {
                content = mistralText;
                console.log(`✅ Mistral: ${content.length} chars`);
              }
            }
            await fetch(`https://api.mistral.ai/v1/files/${fileId}`, {
              method: 'DELETE',
              headers: { 'Authorization': `Bearer ${apiKey}` },
            }).catch(() => {});
          }
        }
      } catch (e: any) {
        console.log('Mistral error:', e?.message);
      }
    }

    // Limpiar el contenido de referencias de imágenes y markdown feo
    content = cleanContent(content);
    console.log(`✅ Resultado final limpio: ${content.length} chars`);

    return NextResponse.json({
      success: true,
      content: content || 'No se pudo extraer texto de este archivo.',
    });

  } catch (error: any) {
    console.error('Process PDF error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
