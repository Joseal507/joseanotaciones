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
      const pdfParse = (await import('pdf-parse')).default;
      const pdfData = await pdfParse(buffer);
      content = pdfData.text;
    } else if (file.name.endsWith('.docx') || file.name.endsWith('.doc')) {
      const mammoth = (await import('mammoth')).default;
      const result = await mammoth.extractRawText({ buffer });
      content = result.value;
    } else {
      return NextResponse.json({ success: false, error: 'Formato no soportado. Usa PDF, Word o TXT' }, { status: 400 });
    }

    if (!content || content.trim().length === 0) {
      return NextResponse.json({ success: false, error: 'No se pudo extraer texto del archivo' }, { status: 400 });
    }

    return NextResponse.json({ 
      success: true, 
      content: content.trim(), 
      filename: file.name 
    });

  } catch (error: any) {
    console.error('Error upload:', error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}