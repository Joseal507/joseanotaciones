import { NextRequest, NextResponse } from 'next/server';

export const maxDuration = 60; // 60 segundos máximo
export const dynamic = 'force-dynamic';
import { getGroqClient } from '../../../lib/groqClient';
import { uploadToR2, generateR2Key } from '../../../lib/r2';

// ─── MISTRAL OCR para PDFs ───
async function extraerConMistral(buffer: Buffer, fileName: string): Promise<string> {
  try {
    const apiKey = process.env.MISTRAL_API_KEY || '';
    if (!apiKey) throw new Error('No hay MISTRAL_API_KEY');

    const nombre = fileName.toLowerCase();
    const mimeType = nombre.endsWith('.pdf') ? 'application/pdf'
      : nombre.endsWith('.pptx') ? 'application/vnd.openxmlformats-officedocument.presentationml.presentation'
      : nombre.endsWith('.docx') ? 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
      : nombre.endsWith('.xlsx') ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
      : 'application/pdf';

    if (nombre.endsWith('.ppt') && !nombre.endsWith('.pptx')) {
      throw new Error('Formato .ppt no soportado por Mistral, usar .pptx');
    }

    console.log(`☁️ Subiendo ${nombre} a Mistral (${mimeType})...`);

    const formData = new FormData();
    const blob = new Blob([new Uint8Array(buffer)], { type: mimeType });
    formData.append('file', blob, fileName);
    formData.append('purpose', 'ocr');

    const uploadRes = await fetch('https://api.mistral.ai/v1/files', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${apiKey}` },
      body: formData,
    });

    if (!uploadRes.ok) {
      const errText = await uploadRes.text();
      console.log(`Mistral upload error: ${errText.substring(0, 200)}`);
      // Si el error es "string not attached" u otro, simplemente retornar vacío
      return '';
    }
    const uploadData = await uploadRes.json();
    const fileId = uploadData.id;
    console.log(`✅ Subido: ${fileId}`);

    const signedRes = await fetch(`https://api.mistral.ai/v1/files/${fileId}/url`, {
      headers: { 'Authorization': `Bearer ${apiKey}` },
    });
    if (!signedRes.ok) {
      console.log(`Mistral signed URL error: ${signedRes.status}`);
      return '';
    }
    const signedUrl = (await signedRes.json()).url;

    const ocrRes = await fetch('https://api.mistral.ai/v1/ocr', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'mistral-ocr-latest',
        document: { type: 'document_url', document_url: signedUrl },
      }),
    });
    if (!ocrRes.ok) {
      console.log(`Mistral OCR error: ${ocrRes.status}`);
      return '';
    }

    const ocrData = await ocrRes.json();
    const texto = ocrData.pages?.map((p: any) => p.markdown || p.text || '').join('\n\n') || '';
    console.log(`✅ Mistral OCR: ${texto.length} chars`);

    await fetch(`https://api.mistral.ai/v1/files/${fileId}`, {
      method: 'DELETE',
      headers: { 'Authorization': `Bearer ${apiKey}` },
    }).catch(() => {});

    return texto;
  } catch (error: any) {
    console.error('❌ Mistral OCR ERROR:', error?.message);
    return '';
  }
}

// ─── HANDLER PRINCIPAL ───
export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const file = formData.get('file') as File;
    const userId = formData.get('userId') as string || 'anonymous';

    // Check file size — Vercel free tier limit is ~4.5MB for API routes
    if (file && file.size > 40 * 1024 * 1024) {
      return NextResponse.json({
        error: 'El archivo es muy grande. Máximo 40MB.',
        errorCode: 'FILE_TOO_LARGE',
      }, { status: 413 });
    }

    if (!file) {
      return NextResponse.json({ success: false, error: 'No hay archivo' }, { status: 400 });
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const nombre = file.name.toLowerCase();
    let content = '';
    let esImagen = false;
    let esAudio = false;
    let esPPT = false;
    let mimeType = '';
    let r2Url = '';

    console.log(`📄 Procesando: ${nombre} (${(buffer.length / 1024 / 1024).toFixed(1)}MB)`);

    // ─── PDF ───
    if (nombre.endsWith('.pdf')) {
      mimeType = 'application/pdf';

      // 🔥 Guardar en R2
      try {
        const r2Key = generateR2Key(userId, file.name);
        r2Url = await uploadToR2(r2Key, buffer, mimeType);
        console.log(`✅ PDF guardado en R2: ${r2Url}`);
      } catch (r2Error: any) {
        console.warn(`⚠️ R2 no disponible: ${r2Error.message}`);
      }

        // Estrategia 1: pdf-parse (rápido, sin API externa)
      try {
        const pdfParse = (await import('pdf-parse')).default;
        const data = await pdfParse(buffer, { max: 0 });
        content = data.text?.trim() || '';
        console.log(`pdf-parse: ${content.length} chars`);
      } catch (e: any) {
        console.log('pdf-parse error:', e?.message);
      }

      // Estrategia 2: Mistral OCR si pdf-parse no extrajo suficiente
      // Envuelto en try/catch total para que NUNCA falle
      if (!content || content.length < 100) {
        try {
          if (process.env.MISTRAL_API_KEY) {
            const mistralContent = await extraerConMistral(buffer, file.name);
            if (mistralContent && mistralContent.length > (content?.length || 0)) {
              content = mistralContent;
            }
          }
        } catch {
          console.log('Mistral falló, continuando con fallbacks...');
        }
      }

      // Estrategia 3: Gemini Vision para PDFs con imágenes/escaneados
      if (!content || content.length < 50) {
        try {
          const geminiKeys = [
            process.env.GEMINI_API_KEY,
            process.env.GEMINI_API_KEY_2,
            process.env.GEMINI_API_KEY_3,
            process.env.GEMINI_API_KEY_4,
          ].filter(Boolean);
          if (geminiKeys.length > 0) {
            const key = geminiKeys[0];
            const base64 = buffer.toString('base64');
            const res = await fetch(
              `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${key}`,
              {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  contents: [{
                    parts: [
                      { inlineData: { mimeType: 'application/pdf', data: base64 } },
                      { text: 'Extract ALL text from this PDF exactly as it appears. Return only the text content, no explanations.' },
                    ],
                  }],
                  generationConfig: { maxOutputTokens: 8192 },
                }),
              }
            );
            if (res.ok) {
              const data = await res.json();
              const geminiText = data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
              if (geminiText.length > content.length) {
                content = geminiText;
                console.log(`Gemini PDF: ${content.length} chars`);
              }
            }
          }
        } catch (e: any) {
          console.log('Gemini PDF error:', e?.message);
        }
      }

      // Estrategia 4: Groq Vision si Gemini y Mistral no alcanzaron
      if (!content || content.length < 200) {
        const groqKeys = [
          process.env.GROQ_API_KEY,
          process.env.GROQ_API_KEY_2,
          process.env.GROQ_API_KEY_3,
          process.env.GROQ_API_KEY_4,
          process.env.GROQ_API_KEY_5,
          process.env.GROQ_API_KEY_6,
        ].filter(Boolean) as string[];

        if (groqKeys.length > 0 && buffer.length < 10 * 1024 * 1024) {
          for (const gk of groqKeys.slice(0, 3)) {
            try {
              const base64 = buffer.toString('base64');
              const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${gk}` },
                body: JSON.stringify({
                  model: 'meta-llama/llama-4-scout-17b-16e-instruct',
                  messages: [{
                    role: 'user',
                    content: [
                      { type: 'image_url', image_url: { url: `data:application/pdf;base64,${base64}` } },
                      { type: 'text', text: 'Extract ALL text and content from this document completely.' },
                    ],
                  }],
                  temperature: 0.1,
                  max_tokens: 4096,
                }),
              });
              if (!res.ok) continue;
              const data = await res.json();
              const groqText = data?.choices?.[0]?.message?.content || '';
              if (groqText && groqText.length > (content?.length || 0)) {
                content = groqText;
                console.log(`✅ Groq Vision: ${content.length} chars`);
                break;
              }
            } catch { continue; }
          }
        }
      }

    // ─── TXT ───
    } else if (nombre.endsWith('.txt')) {
      mimeType = 'text/plain';
      content = buffer.toString('utf-8');

      try {
        const r2Key = generateR2Key(userId, file.name);
        r2Url = await uploadToR2(r2Key, buffer, mimeType);
      } catch (e: any) {
        console.warn(`⚠️ R2 no disponible: ${e.message}`);
      }

    // ─── WORD ───
    } else if (nombre.endsWith('.docx') || nombre.endsWith('.doc')) {
      mimeType = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

      try {
        const r2Key = generateR2Key(userId, file.name);
        r2Url = await uploadToR2(r2Key, buffer, mimeType);
      } catch (e: any) {
        console.warn(`⚠️ R2 no disponible: ${e.message}`);
      }

      try {
        const mammoth = (await import('mammoth')).default;
        const result = await mammoth.extractRawText({ buffer });
        content = result.value?.trim() || '';
        console.log(`mammoth DOCX: ${content.length} chars`);
      } catch (e: any) {
        console.log('mammoth error:', e?.message);
        return NextResponse.json({ success: false, error: 'No se pudo leer el Word' }, { status: 400 });
      }

    // ─── POWERPOINT ───
    } else if (nombre.endsWith('.pptx') || nombre.endsWith('.ppt')) {
      esPPT = true;
      mimeType = nombre.endsWith('.pptx')
        ? 'application/vnd.openxmlformats-officedocument.presentationml.presentation'
        : 'application/vnd.ms-powerpoint';

      try {
        const r2Key = generateR2Key(userId, file.name);
        r2Url = await uploadToR2(r2Key, buffer, mimeType);
      } catch (e: any) {
        console.warn(`⚠️ R2 no disponible: ${e.message}`);
      }

      if (nombre.endsWith('.pptx')) {
        try {
          const JSZip = (await import('jszip')).default;
          const zip = await JSZip.loadAsync(buffer);
          const slideFiles = Object.keys(zip.files)
            .filter(f => f.match(/ppt\/slides\/slide\d+\.xml$/))
            .sort((a, b) => {
              const na = parseInt(a.match(/slide(\d+)/)?.[1] || '0');
              const nb = parseInt(b.match(/slide(\d+)/)?.[1] || '0');
              return na - nb;
            });

          const slideTexts: string[] = [];
          for (const slideFile of slideFiles) {
            const xml = await zip.files[slideFile].async('string');
            const matches = xml.match(/<a:t[^>]*>([^<]+)<\/a:t>/g) || [];
            const textos = matches.map(t => t.replace(/<[^>]+>/g, '').trim()).filter(t => t.length > 0);
            if (textos.length > 0) {
              const num = slideFile.match(/slide(\d+)/)?.[1] || '?';
              slideTexts.push(`[Diapositiva ${num}]\n${textos.join(' ')}`);
            }
          }
          content = slideTexts.join('\n\n').trim();
          console.log(`JSZip PPTX: ${content.length} chars`);
        } catch (e: any) {
          console.log('JSZip error:', e?.message);
        }
      }

      if (!content || content.length < 50) {
        try {
          const op = await import('officeparser');
          if (typeof (op as any).parseOfficeAsync === 'function') {
            content = await (op as any).parseOfficeAsync(buffer);
          } else if (typeof (op as any).default?.parseOfficeAsync === 'function') {
            content = await (op as any).default.parseOfficeAsync(buffer);
          }
          content = content?.trim() || '';
          console.log(`officeparser PPTX: ${content.length} chars`);
        } catch (e: any) {
          console.log('officeparser error:', e?.message);
        }
      }

      if ((!content || content.length < 50) && process.env.MISTRAL_API_KEY && nombre.endsWith('.pptx')) {
        content = await extraerConMistral(buffer, file.name);
      }

      if (!content || content.trim().length < 20) {
        const esPptAntiguo = nombre.endsWith('.ppt') && !nombre.endsWith('.pptx');
        return NextResponse.json({
          success: false,
          error: esPptAntiguo
            ? 'El formato .ppt (antiguo) no es compatible. Ábrelo en PowerPoint y guárdalo como .pptx'
            : 'No se pudo extraer contenido del PowerPoint.',
        }, { status: 400 });
      }

    // ─── IMÁGENES ───
    } else if (nombre.match(/\.(jpg|jpeg|png|webp|gif)$/i)) {
      esImagen = true;
      mimeType = nombre.endsWith('.png') ? 'image/png'
        : nombre.endsWith('.webp') ? 'image/webp'
        : nombre.endsWith('.gif') ? 'image/gif'
        : 'image/jpeg';

      try {
        const r2Key = generateR2Key(userId, file.name);
        r2Url = await uploadToR2(r2Key, buffer, mimeType);
      } catch (e: any) {
        console.warn(`⚠️ R2 no disponible: ${e.message}`);
      }

      try {
        const client = getGroqClient();
        const res = await client!.chat.completions.create({
          model: 'meta-llama/llama-4-scout-17b-16e-instruct',
          messages: [{
            role: 'user',
            content: [
              { type: 'image_url', image_url: { url: `data:${mimeType};base64,${buffer.toString('base64')}` } },
              { type: 'text', text: 'Extrae TODO el texto visible. Describe diagramas, tablas y elementos visuales. Fórmulas en LaTeX. Sé exhaustivo.' },
            ] as any,
          }],
          max_tokens: 4000,
        });
        content = res.choices[0]?.message?.content || '';
        console.log(`Vision imagen: ${content.length} chars`);
      } catch (err: any) {
        return NextResponse.json({ success: false, error: 'Error procesando imagen: ' + err.message }, { status: 400 });
      }

    // ─── AUDIO ───
    } else if (nombre.match(/\.(mp3|mp4|wav|m4a|ogg|webm|flac|aac)$/i)) {
      esAudio = true;
      mimeType = nombre.endsWith('.mp3') ? 'audio/mpeg'
        : nombre.endsWith('.wav') ? 'audio/wav'
        : nombre.endsWith('.m4a') ? 'audio/m4a'
        : nombre.endsWith('.ogg') ? 'audio/ogg'
        : nombre.endsWith('.flac') ? 'audio/flac'
        : nombre.endsWith('.aac') ? 'audio/aac'
        : nombre.endsWith('.mp4') ? 'audio/mp4'
        : 'audio/webm';

      try {
        const r2Key = generateR2Key(userId, file.name);
        r2Url = await uploadToR2(r2Key, buffer, mimeType);
      } catch (e: any) {
        console.warn(`⚠️ R2 no disponible: ${e.message}`);
      }

      try {
        const client = getGroqClient();
        const audioFile = new File([buffer], file.name, { type: mimeType });
        const transcription = await (client!.audio as any).transcriptions.create({
          file: audioFile,
          model: 'whisper-large-v3',
          response_format: 'json',
          temperature: 0.0,
        });
        content = transcription.text || '';
        console.log(`Whisper audio: ${content.length} chars`);
      } catch (err: any) {
        return NextResponse.json({ success: false, error: 'Error transcribiendo audio: ' + err.message }, { status: 400 });
      }

    // ─── FORMATO NO SOPORTADO ───
    } else {
      return NextResponse.json({
        success: false,
        error: 'Formato no soportado. Usa PDF, Word, PowerPoint, TXT, JPG, PNG, WebP, MP3, WAV, M4A.',
      }, { status: 400 });
    }

    if (!content || content.trim().length === 0) {
      return NextResponse.json({
        success: false,
        error: 'El archivo está vacío o no tiene contenido legible.',
      }, { status: 400 });
    }

    const fileBase64 = buffer.toString('base64');

    // Limpiar referencias de imágenes de Markdown
    if (content) {
      content = content
        .replace(/!\[.*?\]\(.*?\)/g, '')
        .replace(/^!\[.*\n?/gm, '')
        .replace(/\b\S+\.(jpeg|jpg|png|gif|webp|svg|bmp|tiff)\b/gi, '')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
    }

    return NextResponse.json({
      success: true,
      content: content.trim(),
      filename: file.name,
      fileBase64,
      mimeType,
      esImagen,
      esAudio,
      esPPT,
      r2Url,
      words: content.trim().split(/\s+/).length,
    });

  } catch (error: any) {
    console.error('Error general upload:', error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
