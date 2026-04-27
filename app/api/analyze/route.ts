import { NextRequest, NextResponse } from 'next/server';
import { groqRequest } from '../../../lib/groqClient';
import { getCachedContent, saveToCache } from '../../../lib/cache';

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

    // ── PROMPT MEJORADO: Obliga a la IA a llenar TODOS los campos ──
    const prompt = lang === 'en'
      ? `You are an expert academic analyst. Analyze the text and return a COMPLETE JSON with ALL fields filled.
RULES (MANDATORY):
- "keywords": extract AT LEAST 5-10 important terms
- "summary": write 4-6 complete sentences explaining the main topic
- "key_concepts": list AT LEAST 5 main concepts with brief explanation each
- "difficulty_level": must be exactly "basic", "intermediate" or "advanced"
- "study_tips": write AT LEAST 3 specific and useful study tips
- "connections": write AT LEAST 3 connections between concepts
- "formulas": list formulas if any exist, empty array [] if none
- "applications": list AT LEAST 2 real world applications

NEVER leave any field empty. If unsure, infer from context.

Respond ONLY with this JSON structure, no extra text:
{
  "keywords": ["term1", "term2", "term3", "term4", "term5"],
  "summary": "4-6 sentences here",
  "key_concepts": ["concept1", "concept2", "concept3", "concept4", "concept5"],
  "difficulty_level": "basic/intermediate/advanced",
  "study_tips": ["tip1", "tip2", "tip3"],
  "connections": ["connection1", "connection2", "connection3"],
  "formulas": [],
  "applications": ["application1", "application2"]
}`
      : `Eres un analista académico experto. Analiza el texto y devuelve un JSON COMPLETO con TODOS los campos llenos.
REGLAS (OBLIGATORIAS):
- "keywords": extrae AL MENOS 5-10 términos importantes del texto
- "summary": escribe 4-6 oraciones completas explicando el tema principal
- "key_concepts": lista AL MENOS 5 conceptos principales con breve explicación cada uno
- "difficulty_level": debe ser exactamente "básico", "intermedio" o "avanzado"
- "study_tips": escribe AL MENOS 3 consejos de estudio específicos y útiles
- "connections": escribe AL MENOS 3 conexiones entre conceptos del texto
- "formulas": lista fórmulas si existen, array vacío [] si no hay
- "applications": lista AL MENOS 2 aplicaciones reales del tema

NUNCA dejes ningún campo vacío. Si no estás seguro, infiere del contexto.

Responde SOLO con este JSON, sin texto extra:
{
  "keywords": ["término1", "término2", "término3", "término4", "término5"],
  "summary": "4-6 oraciones aquí",
  "key_concepts": ["concepto1", "concepto2", "concepto3", "concepto4", "concepto5"],
  "difficulty_level": "básico/intermedio/avanzado",
  "study_tips": ["consejo1", "consejo2", "consejo3"],
  "connections": ["conexión1", "conexión2", "conexión3"],
  "formulas": [],
  "applications": ["aplicación1", "aplicación2"]
}`;

    const analysisText = await groqRequest(async (client, model) => {
      const r = await client.chat.completions.create({
        model: model('llama-3.3-70b-versatile'),
        messages: [
          { role: 'system', content: prompt },
          { role: 'user', content: esImagen ? 'Analiza la imagen adjunta' : `Texto a analizar:\n\n${textToAnalyze}` },
        ],
        temperature: 0.1, // ← Más bajo = más consistente y completo
        max_tokens: 3000, // ← Más tokens para que no se corte
      });
      return r.choices[0]?.message?.content || '{}';
    });

    const m = analysisText.match(/\{[\s\S]*\}/);
    let finalAnalysis = m ? JSON.parse(m[0]) : {};

    // ── VALIDACIÓN: Si algún campo está vacío, poner valores por defecto ──
    const ensureArray = (val: any, fallback: string[]) =>
      Array.isArray(val) && val.length > 0 ? val : fallback;

    finalAnalysis = {
      keywords: ensureArray(finalAnalysis.keywords, ['concepto principal', 'tema central']),
      summary: finalAnalysis.summary || 'Documento analizado correctamente.',
      key_concepts: ensureArray(finalAnalysis.key_concepts, ['Ver documento para detalles']),
      difficulty_level: finalAnalysis.difficulty_level || 'intermedio',
      study_tips: ensureArray(finalAnalysis.study_tips, ['Leer el documento completo', 'Tomar notas de los conceptos clave']),
      connections: ensureArray(finalAnalysis.connections, ['Los conceptos están interrelacionados']),
      formulas: finalAnalysis.formulas || [],
      applications: ensureArray(finalAnalysis.applications, ['Aplicación académica', 'Aplicación práctica']),
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
