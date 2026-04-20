import { NextRequest, NextResponse } from 'next/server';
import { groqRequest } from '../../../lib/groqClient';

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
        } else if (nombre.endsWith('.pptx') || nombre.endsWith('.ppt')) {
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
            const texts: string[] = [];
            for (const sf of slideFiles) {
              const xml = await zip.files[sf].async('string');
              const matches = xml.match(/<a:t[^>]*>([^<]+)<\/a:t>/g) || [];
              const t = matches.map(m => m.replace(/<[^>]+>/g, '').trim()).filter(Boolean).join(' ');
              if (t) texts.push(t);
            }
            content = texts.join('\n\n');
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

    const lang = idioma === 'en' ? 'en' : 'es';
    const textToAnalyze = content.substring(0, 8000);

    let deepAnalysis: any = {};
    try {
      const r1 = await groqRequest(client => client.chat.completions.create({
        model: 'llama-3.3-70b-versatile',
        messages: [
          {
            role: 'system',
            content: lang === 'en'
              ? 'Extract the deepest concepts, hidden relationships and critical insights. Respond ONLY with JSON: {"deep_concepts":["c1"],"relationships":["r1"],"critical_insights":["i1"],"hidden_details":["d1"]}'
              : 'Extrae los conceptos más profundos, relaciones ocultas e insights críticos. Responde SOLO con JSON: {"deep_concepts":["c1"],"relationships":["r1"],"critical_insights":["i1"],"hidden_details":["d1"]}',
          },
          { role: 'user', content: textToAnalyze },
        ],
        temperature: 0.2,
        max_tokens: 800,
      }));
      const t1 = r1.choices[0]?.message?.content || '{}';
      const m1 = t1.match(/\{[\s\S]*\}/);
      if (m1) deepAnalysis = JSON.parse(m1[0]);
    } catch (e) { console.log('Paso 1 falló:', e); }

    let techAnalysis: any = {};
    try {
      const r2 = await groqRequest(client => client.chat.completions.create({
        model: 'llama-3.3-70b-versatile',
        messages: [
          {
            role: 'system',
            content: lang === 'en'
              ? 'Identify formulas, data, classifications, hierarchies and practical applications. Respond ONLY with JSON: {"formulas":["f1"],"classifications":["c1"],"hierarchies":["h1"],"applications":["a1"],"data_points":["d1"]}'
              : 'Identifica fórmulas, datos, clasificaciones, jerarquías y aplicaciones prácticas. Responde SOLO con JSON: {"formulas":["f1"],"classifications":["c1"],"hierarchies":["h1"],"applications":["a1"],"data_points":["d1"]}',
          },
          { role: 'user', content: textToAnalyze },
        ],
        temperature: 0.2,
        max_tokens: 600,
      }));
      const t2 = r2.choices[0]?.message?.content || '{}';
      const m2 = t2.match(/\{[\s\S]*\}/);
      if (m2) techAnalysis = JSON.parse(m2[0]);
    } catch (e) { console.log('Paso 2 falló:', e); }

    let visionAnalysis: any = {};
    if (esImagen && imageBase64 && imageMime) {
      try {
        const vr = await groqRequest(client => client.chat.completions.create({
          model: 'meta-llama/llama-4-scout-17b-16e-instruct',
          messages: [{
            role: 'user',
            content: [
              { type: 'image_url', image_url: { url: `data:${imageMime};base64,${imageBase64}` } },
              {
                type: 'text',
                text: lang === 'en'
                  ? 'Analyze this image carefully. Respond ONLY with JSON: {"keywords":["k1"],"important_phrases":["p1"],"summary":"detailed summary","visual_elements":["v1"],"key_concepts":["c1"],"difficulty_level":"basic/intermediate/advanced","topics":["t1"]}'
                  : 'Analiza esta imagen cuidadosamente. Responde SOLO con JSON: {"keywords":["k1"],"important_phrases":["p1"],"summary":"resumen detallado","visual_elements":["v1"],"key_concepts":["c1"],"difficulty_level":"básico/intermedio/avanzado","topics":["t1"]}',
              },
            ] as any,
          }],
          temperature: 0.2,
          max_tokens: 2000,
        }));
        const vt = vr.choices[0]?.message?.content || '{}';
        const vm = vt.match(/\{[\s\S]*\}/);
        if (vm) visionAnalysis = JSON.parse(vm[0]);
      } catch (e) { console.log('Vision falló:', e); }
    }

    const extraContext = [
      deepAnalysis.deep_concepts?.length ? `Conceptos profundos: ${deepAnalysis.deep_concepts.join(', ')}` : '',
      deepAnalysis.relationships?.length ? `Relaciones: ${deepAnalysis.relationships.join(', ')}` : '',
      techAnalysis.formulas?.length ? `Fórmulas: ${techAnalysis.formulas.join(', ')}` : '',
      techAnalysis.classifications?.length ? `Clasificaciones: ${techAnalysis.classifications.join(', ')}` : '',
    ].filter(Boolean).join('\n');

    const finalPrompt = lang === 'en'
      ? `You are an expert academic analyst. Create the MOST COMPLETE analysis possible. Respond ONLY with valid JSON:
{"keywords":["up to 20 keywords"],"important_phrases":["up to 15 important phrases"],"summary":"comprehensive 4-6 sentence summary","key_concepts":["all main concepts"],"difficulty_level":"basic/intermediate/advanced","topics":["all topics"],"study_tips":["specific study tips"],"connections":["connections between concepts"],"formulas":["any formulas"],"applications":["practical applications"]}
EXPERT PRE-ANALYSIS:\n${extraContext}`
      : `Eres un analista académico experto. Crea el análisis MÁS COMPLETO posible. Responde SOLO con JSON válido:
{"keywords":["hasta 20 palabras clave"],"important_phrases":["hasta 15 frases importantes"],"summary":"resumen completo de 4-6 oraciones","key_concepts":["todos los conceptos principales"],"difficulty_level":"básico/intermedio/avanzado","topics":["todos los temas"],"study_tips":["consejos específicos de estudio"],"connections":["conexiones entre conceptos"],"formulas":["fórmulas encontradas"],"applications":["aplicaciones prácticas"]}
PRE-ANÁLISIS EXPERTO:\n${extraContext}`;

    const r3 = await groqRequest(client => client.chat.completions.create({
      model: 'llama-3.3-70b-versatile',
      messages: [
        { role: 'system', content: finalPrompt },
        { role: 'user', content: esImagen ? JSON.stringify(visionAnalysis) : textToAnalyze },
      ],
      temperature: 0.2,
      max_tokens: 2500,
    }));

    const t3 = r3.choices[0]?.message?.content || '{}';
    const m3 = t3.match(/\{[\s\S]*\}/);
    let finalAnalysis: any = {};
    if (m3) {
      try { finalAnalysis = JSON.parse(m3[0]); } catch {}
    }

    const combined = {
      keywords: [...new Set([...(visionAnalysis.keywords || []), ...(finalAnalysis.keywords || [])])].slice(0, 20),
      important_phrases: [...new Set([...(visionAnalysis.important_phrases || []), ...(finalAnalysis.important_phrases || [])])].slice(0, 15),
      summary: finalAnalysis.summary || visionAnalysis.summary || '',
      key_concepts: [...new Set([...(finalAnalysis.key_concepts || []), ...(deepAnalysis.deep_concepts || [])])].slice(0, 15),
      difficulty_level: finalAnalysis.difficulty_level || visionAnalysis.difficulty_level || '',
      topics: [...new Set([...(finalAnalysis.topics || []), ...(visionAnalysis.topics || [])])].slice(0, 10),
      study_tips: (finalAnalysis.study_tips || []).slice(0, 6),
      connections: [...new Set([...(finalAnalysis.connections || []), ...(deepAnalysis.relationships || [])])].slice(0, 8),
      formulas: [...new Set([...(finalAnalysis.formulas || []), ...(techAnalysis.formulas || [])])],
      applications: [...new Set([...(finalAnalysis.applications || []), ...(techAnalysis.applications || [])])],
      visual_elements: visionAnalysis.visual_elements || [],
      hidden_details: deepAnalysis.hidden_details || [],
    };

    return NextResponse.json({ success: true, analysis: combined });

  } catch (error: any) {
    console.error('Error en /api/analyze:', error);
    try {
      const body = await req.clone().json().catch(() => ({}));
      const r = await groqRequest(client => client.chat.completions.create({
        model: 'llama-3.3-70b-versatile',
        messages: [
          { role: 'system', content: 'Analiza este texto. Responde con JSON: {"keywords":[],"summary":"","key_concepts":[],"important_phrases":[],"study_tips":[],"topics":[],"difficulty_level":"","connections":[],"formulas":[],"applications":[]}' },
          { role: 'user', content: body.content?.substring(0, 4000) || '' },
        ],
        temperature: 0.2,
        max_tokens: 1500,
      }));
      const t = r.choices[0]?.message?.content || '{}';
      const m = t.match(/\{[\s\S]*\}/);
      return NextResponse.json({ success: true, analysis: m ? JSON.parse(m[0]) : {} });
    } catch (e: any) {
      return NextResponse.json({ success: false, error: e.message }, { status: 500 });
    }
  }
}
