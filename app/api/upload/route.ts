import { NextRequest, NextResponse } from 'next/server';

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

    if (file.name.endsWith('.txt')) {
      content = buffer.toString('utf-8');
    } else if (file.name.endsWith('.pdf')) {
      try {
        const pdfParse = (await import('pdf-parse')).default;
        const pdfData = await pdfParse(buffer);
        content = pdfData.text;
      } catch (err) {
        return NextResponse.json({ success: false, error: 'No se pudo leer el PDF' }, { status: 400 });
      }
    } else if (file.name.endsWith('.docx') || file.name.endsWith('.doc')) {
      try {
        const mammoth = (await import('mammoth')).default;
        const result = await mammoth.extractRawText({ buffer });
        content = result.value;
      } catch (err) {
        return NextResponse.json({ success: false, error: 'No se pudo leer el Word' }, { status: 400 });
      }
    } else {
      return NextResponse.json({ success: false, error: 'Formato no soportado. Usa PDF, Word o TXT.' }, { status: 400 });
    }

    if (!content || content.trim().length === 0) {
      return NextResponse.json({ success: false, error: 'El archivo está vacío.' }, { status: 400 });
    }

    // Convertir archivo a base64 para enviarlo al cliente
    const base64 = buffer.toString('base64');
    const mimeType = file.name.endsWith('.pdf') ? 'application/pdf'
      : file.name.endsWith('.docx') ? 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
      : 'text/plain';

    return NextResponse.json({
      success: true,
      content: content.trim(),
      filename: file.name,
      fileBase64: base64,
      mimeType,
      words: content.trim().split(' ').length,
    });

  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}