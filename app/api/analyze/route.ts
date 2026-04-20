import { NextRequest, NextResponse } from 'next/server';
import { groqRequest } from '../../../lib/groqClient';
import { getCachedContent, saveToCache } from '../../../lib/cache';

const MAX_WORDS = 10000; // 🛡️ Límite de seguridad

export async function POST(req: NextRequest) {
  try {
    const contentType = req.headers.get('content-type') || '';
    let content = '';
    let idioma = 'es';
    let imageBase64 = '';
    let imageMime = '';
    let esImagen = false;

    if (contentType.includes('application/json')) {
      const body = await req.json();
      content = body.content || '';
      idioma = body.idioma || 'es';
      imageBase64 = body.imageBase64 || '';
      imageMime = body.imageMime || '';
      esImagen = body.esImagen || false;
    } else {
      const formData = await req.formData();
      const file = formData.get('file') as File | null;
      idioma = formData.get('idioma') as string || 'es';

      if (file) {
        const buffer = Buffer.from(await file.arrayBuffer());
        const nombre = file.name.toLowerCase();

        if (nombre.endsWith('.pdf')) {
          try {
            const pdfParse = (await import('pdf-parse')).default;
            const data = await pdfParse(buffer);
            content = data.text?.trim() || '';
          } catch {}
        } else if (nombre.endsWith('.docx')) {
          try {
            const mammoth = (await import('mammoth')).default;
            const result = await mammoth.extractRawText({ buffer });
            content = result.value;
          } catch {}
        } else if (nombre.endsWith('.txt')) {
          content = buffer.toString('utf-8');
        } else if (nombre.match(/\.(jpg|jpeg|png|webp)$/i)) {
          esImagen = true;
          imageMime = file.type;
          imageBase64 = buffer.toString('base64');
        }
      }
    }

    if (!content && !imageBase64) {
      return NextResponse.json({ error: 'No hay contenido para analizar' }, { status: 400 });
    }

    // 🛡️ VALIDACIÓN DE LÍMITE DE PALABRAS
    const wordCount = content.split(/\s+/).length;
    if (!esImagen && wordCount > MAX_WORDS) {
      return NextResponse.json({ 
        error: `Documento demasiado largo (${wordCount} palabras). Máximo permitido: ${MAX_WORDS} palabras.` 
      }, { status: 400 });
    }

    // 🎯 REVISAR CACHÉ
    if (!esImagen) {
      const cache = await getCachedContent(content);
      if (cache && cache.analysis) {
        console.log('🚀 Análisis servido desde CACHÉ');
        return NextResponse.json({ success: true, analysis: cache.analysis, fromCache: true });
      }
    }

    const lang = idioma === 'en' ? 'en' : 'es';
    const textToAnalyze = content.substring(0, 8000);

    // ── PASO ÚNICO DE ANÁLISIS (Para optimizar tokens) ──
    const prompt = lang === 'en' 
      ? `Expert academic analyst. Provide a comprehensive JSON analysis of this text:
      {"keywords":[], "summary":"4-6 sentences", "key_concepts":[], "difficulty_level":"basic/intermediate/advanced", "study_tips":[], "connections":[], "formulas":[], "applications":[]}`
      : `Analista académico experto. Provee un análisis completo en JSON de este texto:
      {"keywords":[], "summary":"4-6 oraciones", "key_concepts":[], "difficulty_level":"básico/intermedio/avanzado", "study_tips":[], "connections":[], "formulas":[], "applications":[]}`;

    const result = await groqRequest((client, model) => client.chat.completions.create({
      model: model('llama-3.3-70b-versatile'),
      messages: [
        { role: 'system', content: prompt },
        { role: 'user', content: esImagen ? "Analiza la imagen adjunta" : textToAnalyze }
      ],
      temperature: 0.2,
      max_tokens: 2500
    }));

    const analysisText = result.choices[0]?.message?.content || '{}';
    const m = analysisText.match(/\{[\s\S]*\}/);
    const finalAnalysis = m ? JSON.parse(m[0]) : {};

    // 🎯 GUARDAR EN CACHÉ
    if (!esImagen && finalAnalysis.summary) {
      await saveToCache(content, { analysis: finalAnalysis });
    }

    return NextResponse.json({ success: true, analysis: finalAnalysis });

  } catch (error: any) {
    console.error('Error /api/analyze:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
