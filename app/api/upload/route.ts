import { NextRequest, NextResponse } from 'next/server';
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

    if (!uploadRes.ok) throw new Error(`Upload falló: ${await uploadRes.text()}`);
    const uploadData = await uploadRes.json();
    const fileId = uploadData.id;
    console.log(`✅ Subido: ${fileId}`);

    const signedRes = await fetch(`https://api.mistral.ai/v1/files/${fileId}/url`, {
      headers: { 'Authorization': `Bearer ${apiKey}` },
    });
    if (!signedRes.ok) throw new Error(`URL firmada falló: ${await signedRes.text()}`);
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
    if (!ocrRes.ok) throw new Error(`OCR falló: ${await ocrRes.text()}`);

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

      if (process.env.MISTRAL_API_KEY) {
        content = await extraerConMistral(buffer, file.name);
      }

      if (!content || content.length < 50) {
        try {
          const pdfParse = (await import('pdf-parse')).default;
          const data = await pdfParse(buffer, { max: 0 });
          content = data.text?.trim() || '';
          console.log(`pdf-parse: ${content.length} chars`);
        } catch (e: any) {
          console.log('pdf-parse error:', e?.message);
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
