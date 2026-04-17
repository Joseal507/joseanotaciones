import { NextRequest, NextResponse } from 'next/server';
import { getGroqClient } from '../../../lib/groqClient';

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const file = formData.get('file') as File;

    if (!file) {
      return NextResponse.json({ success: false, error: 'No hay archivo' }, { status: 400 });
    }

    const bytes = await file.arrayBuffer();
    const buffer = Buffer.from(bytes);
    let content = '';
    let esImagen = false;
    let esAudio = false;
    let esPPT = false;
    let mimeType = '';
    const nombre = file.name.toLowerCase();

    // ─── TXT ───
    if (nombre.endsWith('.txt')) {
      content = buffer.toString('utf-8');
      mimeType = 'text/plain';

    // ─── PDF ───
    } else if (nombre.endsWith('.pdf')) {
      try {
        const pdfParse = (await import('pdf-parse')).default;
        const pdfData = await pdfParse(buffer);
        content = pdfData.text;
        mimeType = 'application/pdf';
      } catch {
        return NextResponse.json({ success: false, error: 'No se pudo leer el PDF' }, { status: 400 });
      }

    // ─── WORD ───
    } else if (nombre.endsWith('.docx') || nombre.endsWith('.doc')) {
      try {
        const mammoth = (await import('mammoth')).default;
        const result = await mammoth.extractRawText({ buffer });
        content = result.value;
        mimeType = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
      } catch {
        return NextResponse.json({ success: false, error: 'No se pudo leer el Word' }, { status: 400 });
      }

    // ─── POWERPOINT ───
    } else if (nombre.endsWith('.pptx') || nombre.endsWith('.ppt')) {
      try {
        esPPT = true;
        mimeType = 'application/vnd.openxmlformats-officedocument.presentationml.presentation';

        // Intentar con officeparser
        try {
          const officeParser = await import('officeparser');
          content = await officeParser.parseOfficeAsync(buffer as any);
        } catch {
          // Fallback: leer XML del PPTX manualmente
          try {
            const JSZip = (await import('jszip')).default;
            const zip = await JSZip.loadAsync(buffer);
            const slideTexts: string[] = [];
            let slideNum = 1;

            while (true) {
              const slideFile = zip.file(`ppt/slides/slide${slideNum}.xml`);
              if (!slideFile) break;

              const xml = await slideFile.async('string');
              // Extraer texto del XML de la diapositiva
              const textMatches = xml.match(/<a:t[^>]*>([^<]+)<\/a:t>/g) || [];
              const slideText = textMatches
                .map(t => t.replace(/<[^>]+>/g, '').trim())
                .filter(t => t.length > 0)
                .join(' ');

              if (slideText) {
                slideTexts.push(`[Diapositiva ${slideNum}]: ${slideText}`);
              }
              slideNum++;
            }

            content = slideTexts.join('\n\n');
          } catch (zipErr) {
            return NextResponse.json({
              success: false,
              error: 'No se pudo leer el PowerPoint. Intenta guardarlo como .pptx',
            }, { status: 400 });
          }
        }

        if (!content || content.trim().length === 0) {
          return NextResponse.json({
            success: false,
            error: 'El PowerPoint parece estar vacío o solo tiene imágenes sin texto.',
          }, { status: 400 });
        }

      } catch (err: any) {
        return NextResponse.json({
          success: false,
          error: 'Error procesando PowerPoint: ' + err.message,
        }, { status: 400 });
      }

    // ─── IMÁGENES ───
    } else if (nombre.match(/\.(jpg|jpeg|png|webp|gif)$/i)) {
      esImagen = true;
      mimeType = nombre.endsWith('.png') ? 'image/png'
        : nombre.endsWith('.webp') ? 'image/webp'
        : nombre.endsWith('.gif') ? 'image/gif'
        : 'image/jpeg';

      const base64Image = buffer.toString('base64');
      try {
        const client = getGroqClient();
        const visionRes = await client.chat.completions.create({
          model: 'meta-llama/llama-4-scout-17b-16e-instruct',
          messages: [
            {
              role: 'user',
              content: [
                {
                  type: 'image_url',
                  image_url: { url: `data:${mimeType};base64,${base64Image}` },
                },
                {
                  type: 'text',
                  text: 'Extract ALL text visible in this image. Also describe any diagrams, charts, tables or visual elements. Be thorough and detailed. If there are formulas or equations, write them out. Output everything you see.',
                },
              ] as any,
            },
          ],
          max_tokens: 4000,
        });
        content = visionRes.choices[0]?.message?.content || '';
        if (!content) {
          return NextResponse.json({
            success: false,
            error: 'No se pudo extraer contenido de la imagen',
          }, { status: 400 });
        }
      } catch (err: any) {
        return NextResponse.json({
          success: false,
          error: 'Error procesando imagen: ' + err.message,
        }, { status: 400 });
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
        const client = getGroqClient();
        const audioFile = new File([buffer], file.name, { type: mimeType });

        const transcription = await (client.audio as any).transcriptions.create({
          file: audioFile,
          model: 'whisper-large-v3',
          response_format: 'json',
          temperature: 0.0,
        });

        content = transcription.text || '';
        if (!content) {
          return NextResponse.json({
            success: false,
            error: 'No se pudo transcribir el audio',
          }, { status: 400 });
        }
      } catch (err: any) {
        return NextResponse.json({
          success: false,
          error: 'Error transcribiendo audio: ' + err.message,
        }, { status: 400 });
      }

    // ─── FORMATO NO SOPORTADO ───
    } else {
      return NextResponse.json({
        success: false,
        error: 'Formato no soportado. Usa PDF, Word, PowerPoint (.pptx), TXT, JPG, PNG, WebP, MP3, WAV, M4A.',
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
      words: content.trim().split(' ').length,
    });

  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}