import { NextRequest, NextResponse } from 'next/server';

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const file = formData.get('file') as File;
    if (!file) return NextResponse.json({ error: 'No file' }, { status: 400 });

    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    // Usar pdf-parse para extraer info básica
    const pdfParse = await import('pdf-parse');
    const data = await pdfParse.default(buffer);

    // Devolver número de páginas - renderizado en cliente con canvas nativo
    return NextResponse.json({ 
      numPages: data.numpages,
      text: data.text,
    });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: 'Error processing PDF' }, { status: 500 });
  }
}