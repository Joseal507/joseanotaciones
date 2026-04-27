import { NextRequest, NextResponse } from 'next/server';
import { groqRequest } from '../../../lib/groqClient';
import { getCachedContent, saveToCache } from '../../../lib/cache';

export const maxDuration = 60;

const MAX_WORDS = 10000;

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
          } catch (e) {
            console.error('Error PDF:', e);
            return NextResponse.json({ error: 'Error al leer el PDF' }, { status: 400 });
          }
        } else if (nombre.endsWith('.docx')) {
          try {
            const mammoth = (await import('mammoth')).default;
            const result = await mammoth.extractRawText({ buffer });
            content = result.value;
          } catch (e) {
            console.error('Error DOCX:', e);
            return NextResponse.json({ error: 'Error al leer el DOCX' }, { status: 400 });
          }
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

    const wordCount = content.split(/\s+/).length;
    if (!esImagen && wordCount > MAX_WORDS) {
      return NextResponse.json({
        error: `Documento demasiado largo (${wordCount} palabras). Máximo: ${MAX_WORDS}.`
      }, { status: 400 });
    }

    if (!esImagen) {
      const cache = await getCachedContent(content);
      if (cache && cache.analysis) {
        console.log('🚀 Análisis desde CACHÉ');
        return NextResponse.json({ success: true, analysis: cache.analysis, fromCache: true });
      }
    }

    const lang = idioma === 'en' ? 'en' : 'es';
    const textToAnalyze = content.substring(0, 8000);

    const prompt = lang === 'en'
      ? `You are an expert academic analyst. Analyze the text and return a COMPLETE JSON with ALL fields filled.
RULES:
- "keywords": AT LEAST 5-10 important terms
- "summary": 4-6 complete sentences
- "key_concepts": AT LEAST 5 main concepts with explanation
- "difficulty_level": exactly "basic", "intermediate" or "advanced"
- "study_tips": AT LEAST 3 specific tips
- "connections": AT LEAST 3 connections between concepts
- "formulas": list formulas if any, empty array [] if none
- "applications": AT LEAST 2 real world applications

Respond ONLY with this JSON, no extra text:
{
  "keywords": [],
  "summary": "",
  "key_concepts": [],
  "difficulty_level": "",
  "study_tips": [],
  "connections": [],
  "formulas": [],
  "applications": []
}`
      : `Eres un analista académico experto. Analiza el texto y devuelve un JSON COMPLETO con TODOS los campos llenos.
REGLAS:
- "keywords": AL MENOS 5-10 términos importantes
- "summary": 4-6 oraciones completas
- "key_concepts": AL MENOS 5 conceptos con explicación
- "difficulty_level": exactamente "básico", "intermedio" o "avanzado"
- "study_tips": AL MENOS 3 consejos específicos
- "connections": AL MENOS 3 conexiones entre conceptos
- "formulas": fórmulas si existen, array vacío [] si no
- "applications": AL MENOS 2 aplicaciones reales

Responde SOLO con este JSON, sin texto extra:
{
  "keywords": [],
  "summary": "",
  "key_concepts": [],
  "difficulty_level": "",
  "study_tips": [],
  "connections": [],
  "formulas": [],
  "applications": []
}`;

    const analysisText = await groqRequest(async (client, model) => {
      const r = await client.chat.completions.create({
        model: model('llama-3.3-70b-versatile'),
        messages: [
          { role: 'system', content: prompt },
          { role: 'user', content: esImagen ? 'Analiza la imagen adjunta' : `Texto a analizar:\n\n${textToAnalyze}` },
        ],
        temperature: 0.1,
        max_tokens: 3000,
      });
      return r.choices[0]?.message?.content || '{}';
    });

    const m = analysisText.match(/\{[\s\S]*\}/);
    let finalAnalysis = m ? JSON.parse(m[0]) : {};

    const ensureArray = (val: any, fallback: string[]) =>
      Array.isArray(val) && val.length > 0 ? val : fallback;

    finalAnalysis = {
      keywords: ensureArray(finalAnalysis.keywords, ['concepto principal']),
      summary: finalAnalysis.summary || 'Documento analizado correctamente.',
      key_concepts: ensureArray(finalAnalysis.key_concepts, ['Ver documento']),
      difficulty_level: finalAnalysis.difficulty_level || 'intermedio',
      study_tips: ensureArray(finalAnalysis.study_tips, ['Leer el documento completo']),
      connections: ensureArray(finalAnalysis.connections, ['Los conceptos están interrelacionados']),
      formulas: finalAnalysis.formulas || [],
      applications: ensureArray(finalAnalysis.applications, ['Aplicación académica']),
    };

    if (!esImagen && finalAnalysis.summary) {
      await saveToCache(content, { analysis: finalAnalysis });
    }

    return NextResponse.json({ success: true, analysis: finalAnalysis });

  } catch (error: any) {
    console.error('Error /api/analyze:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
