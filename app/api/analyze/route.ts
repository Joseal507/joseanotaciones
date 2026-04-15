import { NextRequest, NextResponse } from 'next/server';
import { getGroqClient } from '../../../lib/groqClient';

export async function POST(request: NextRequest) {
  try {
    const { content, idioma, imageBase64, imageMime, esImagen } = await request.json();
    const lang = idioma === 'en' ? 'en' : 'es';

    let visionAnalysis: any = {};

    // ===== IMAGEN: análisis visual =====
    if (esImagen && imageBase64 && imageMime) {
      const visionPrompt = lang === 'en'
        ? `Analyze this image carefully. Extract ALL information visible. Respond ONLY with valid JSON:
{"keywords":["k1","k2"],"important_phrases":["p1","p2"],"summary":"detailed summary","visual_elements":["descriptions"],"key_concepts":["c1","c2"],"difficulty_level":"basic/intermediate/advanced","topics":["t1","t2"]}`
        : `Analiza esta imagen cuidadosamente. Extrae TODA la información visible. Responde SOLO con JSON válido:
{"keywords":["k1","k2"],"important_phrases":["p1","p2"],"summary":"resumen detallado","visual_elements":["descripciones"],"key_concepts":["c1","c2"],"difficulty_level":"básico/intermedio/avanzado","topics":["t1","t2"]}`;

      try {
        const vc = getGroqClient();
        const vr = await vc.chat.completions.create({
          model: 'meta-llama/llama-4-scout-17b-16e-instruct',
          messages: [{ role: 'user', content: [
            { type: 'image_url', image_url: { url: `data:${imageMime};base64,${imageBase64}` } },
            { type: 'text', text: visionPrompt },
          ] as any }],
          temperature: 0.2,
          max_tokens: 2000,
        });
        const vt = vr.choices[0]?.message?.content || '{}';
        const vm = vt.match(/\{[\s\S]*\}/);
        if (vm) try { visionAnalysis = JSON.parse(vm[0]); } catch {}
      } catch (e) { console.log('Vision falló:', e); }
    }

    const textToAnalyze = content?.substring(0, 6000) || '';

    // ===== PASO 1: GPT-OSS-120B extrae conceptos profundos =====
    let deep120b: any = {};
    try {
      const c1 = getGroqClient();
      const r1 = await c1.chat.completions.create({
        model: 'openai/gpt-oss-120b',
        messages: [
          { role: 'system', content: lang === 'en'
            ? 'You are a deep reasoning engine. Extract the deepest concepts, hidden relationships, and critical insights from this text. Respond ONLY with JSON: {"deep_concepts":["c1","c2"],"relationships":["r1","r2"],"critical_insights":["i1","i2"],"hidden_details":["d1","d2"]}'
            : 'Eres un motor de razonamiento profundo. Extrae los conceptos más profundos, relaciones ocultas e insights críticos de este texto. Responde SOLO con JSON: {"deep_concepts":["c1","c2"],"relationships":["r1","r2"],"critical_insights":["i1","i2"],"hidden_details":["d1","d2"]}'
          },
          { role: 'user', content: textToAnalyze },
        ],
        temperature: 0.2,
        max_tokens: 800,
      });
      const t1 = r1.choices[0]?.message?.content || '{}';
      const m1 = t1.match(/\{[\s\S]*\}/);
      if (m1) try { deep120b = JSON.parse(m1[0]); } catch {}
    } catch (e) { console.log('gpt-oss-120b analyze falló:', e); }

    // ===== PASO 2: Kimi-K2 análisis científico/estructural =====
    let kimiAnalysis: any = {};
    try {
      const c2 = getGroqClient();
      const r2 = await c2.chat.completions.create({
        model: 'moonshotai/kimi-k2-instruct',
        messages: [
          { role: 'system', content: lang === 'en'
            ? 'You are a scientific analysis expert. Identify formulas, data, classifications, hierarchies and practical applications. Respond ONLY with JSON: {"formulas":["f1"],"classifications":["c1"],"hierarchies":["h1"],"applications":["a1"],"data_points":["d1"]}'
            : 'Eres un experto en análisis científico. Identifica fórmulas, datos, clasificaciones, jerarquías y aplicaciones prácticas. Responde SOLO con JSON: {"formulas":["f1"],"classifications":["c1"],"hierarchies":["h1"],"applications":["a1"],"data_points":["d1"]}'
          },
          { role: 'user', content: textToAnalyze },
        ],
        temperature: 0.2,
        max_tokens: 600,
      });
      const t2 = r2.choices[0]?.message?.content || '{}';
      const m2 = t2.match(/\{[\s\S]*\}/);
      if (m2) try { kimiAnalysis = JSON.parse(m2[0]); } catch {}
    } catch (e) { console.log('kimi analyze falló:', e); }

    // ===== PASO 3: Llama 3.3 70B análisis final completo =====
    const extraContext = [
      deep120b.deep_concepts?.length ? `Deep concepts: ${deep120b.deep_concepts.join(', ')}` : '',
      deep120b.relationships?.length ? `Relationships: ${deep120b.relationships.join(', ')}` : '',
      kimiAnalysis.formulas?.length ? `Formulas: ${kimiAnalysis.formulas.join(', ')}` : '',
      kimiAnalysis.classifications?.length ? `Classifications: ${kimiAnalysis.classifications.join(', ')}` : '',
    ].filter(Boolean).join('\n');

    const finalPrompt = lang === 'en'
      ? `You are an expert academic analyst. You have expert analysis from 2 specialized AIs. Use it to create the MOST COMPLETE analysis possible. Respond ONLY with valid JSON:
{"keywords":["up to 20"],"important_phrases":["up to 15"],"summary":"comprehensive 4-6 sentence summary","key_concepts":["all main concepts"],"difficulty_level":"basic/intermediate/advanced","topics":["all topics"],"study_tips":["specific tips"],"connections":["connections between concepts"],"formulas":["any formulas found"],"applications":["practical applications"]}

EXPERT ANALYSIS:\n${extraContext}`
      : `Eres un analista académico experto. Tienes análisis experto de 2 AIs especializadas. Úsalo para crear el análisis MÁS COMPLETO posible. Responde SOLO con JSON válido:
{"keywords":["hasta 20"],"important_phrases":["hasta 15"],"summary":"resumen completo de 4-6 oraciones","key_concepts":["todos los conceptos principales"],"difficulty_level":"básico/intermedio/avanzado","topics":["todos los temas"],"study_tips":["consejos específicos"],"connections":["conexiones entre conceptos"],"formulas":["fórmulas encontradas"],"applications":["aplicaciones prácticas"]}

ANÁLISIS EXPERTO:\n${extraContext}`;

    const c3 = getGroqClient();
    const r3 = await c3.chat.completions.create({
      model: 'llama-3.3-70b-versatile',
      messages: [
        { role: 'system', content: finalPrompt },
        { role: 'user', content: textToAnalyze },
      ],
      temperature: 0.2,
      max_tokens: 2500,
    });

    const t3 = r3.choices[0]?.message?.content || '{}';
    const m3 = t3.match(/\{[\s\S]*\}/);
    let finalAnalysis: any = {};
    if (m3) try { finalAnalysis = JSON.parse(m3[0]); } catch {}

    // ===== COMBINAR TODO =====
    const combined = {
      keywords: [...new Set([...(visionAnalysis.keywords || []), ...(finalAnalysis.keywords || [])])].slice(0, 20),
      important_phrases: [...new Set([...(visionAnalysis.important_phrases || []), ...(finalAnalysis.important_phrases || [])])].slice(0, 15),
      summary: finalAnalysis.summary || visionAnalysis.summary || '',
      key_concepts: [...new Set([...(finalAnalysis.key_concepts || []), ...(deep120b.deep_concepts || [])])].slice(0, 15),
      difficulty_level: finalAnalysis.difficulty_level || visionAnalysis.difficulty_level || '',
      topics: [...new Set([...(finalAnalysis.topics || []), ...(visionAnalysis.topics || [])])].slice(0, 10),
      study_tips: (finalAnalysis.study_tips || []).slice(0, 6),
      connections: [...new Set([...(finalAnalysis.connections || []), ...(deep120b.relationships || [])])].slice(0, 8),
      formulas: [...new Set([...(finalAnalysis.formulas || []), ...(kimiAnalysis.formulas || [])])],
      applications: [...new Set([...(finalAnalysis.applications || []), ...(kimiAnalysis.applications || [])])],
      visual_elements: visionAnalysis.visual_elements || [],
      hidden_details: deep120b.hidden_details || [],
    };

    return NextResponse.json({ success: true, analysis: combined });

  } catch (error: any) {
    // Fallback simple
    try {
      const { content, idioma } = await request.clone().json();
      const c = getGroqClient();
      const r = await c.chat.completions.create({
        model: 'llama-3.3-70b-versatile',
        messages: [
          { role: 'system', content: idioma === 'en' ? 'Analyze this text. Respond with JSON: {"keywords":[],"summary":"","key_concepts":[]}' : 'Analiza este texto. Responde con JSON: {"keywords":[],"summary":"","key_concepts":[]}' },
          { role: 'user', content: content?.substring(0, 4000) || '' },
        ],
        temperature: 0.2,
        max_tokens: 1500,
      });
      const t = r.choices[0]?.message?.content || '{}';
      const m = t.match(/\{[\s\S]*\}/);
      return NextResponse.json({ success: true, analysis: m ? JSON.parse(m[0]) : {} });
    } catch (e: any) {
      return NextResponse.json({ success: false, error: e.message }, { status: 500 });
    }
  }
}