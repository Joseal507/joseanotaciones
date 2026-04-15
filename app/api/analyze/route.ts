import { NextRequest, NextResponse } from 'next/server';
import OpenAI from 'openai';

const client = new OpenAI({
  apiKey: process.env.GROQ_API_KEY,
  baseURL: 'https://api.groq.com/openai/v1',
});

export async function POST(request: NextRequest) {
  try {
    const { content, idioma, imageBase64, imageMime, esImagen } = await request.json();
    const lang = idioma === 'en' ? 'en' : 'es';

    let analysis: any = {};

    // ===== ANÁLISIS CON VISIÓN (si hay imagen) =====
    if (esImagen && imageBase64 && imageMime) {
      const visionPrompt = lang === 'en'
        ? `You are an expert academic analyst. Analyze this image/document carefully and provide a COMPREHENSIVE analysis. Respond ONLY with valid JSON:
{
  "keywords": ["keyword1", "keyword2", ...],
  "important_phrases": ["phrase1", "phrase2", ...],
  "summary": "detailed summary",
  "visual_elements": ["description of charts/diagrams/tables"],
  "key_concepts": ["main concept 1", "main concept 2"],
  "difficulty_level": "basic/intermediate/advanced",
  "topics": ["topic1", "topic2"]
}`
        : `Eres un analista académico experto. Analiza esta imagen/documento cuidadosamente y proporciona un análisis COMPLETO. Responde SOLO con JSON válido:
{
  "keywords": ["palabra1", "palabra2", ...],
  "important_phrases": ["frase1", "frase2", ...],
  "summary": "resumen detallado",
  "visual_elements": ["descripción de gráficas/diagramas/tablas"],
  "key_concepts": ["concepto principal 1", "concepto principal 2"],
  "difficulty_level": "básico/intermedio/avanzado",
  "topics": ["tema1", "tema2"]
}`;

      const visionRes = await client.chat.completions.create({
        model: 'meta-llama/llama-4-scout-17b-16e-instruct',
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'image_url',
                image_url: { url: `data:${imageMime};base64,${imageBase64}` },
              },
              { type: 'text', text: visionPrompt },
            ] as any,
          },
        ],
        temperature: 0.2,
        max_tokens: 2000,
      });

      const visionText = visionRes.choices[0]?.message?.content || '{}';
      const jsonMatch = visionText.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        try { analysis = JSON.parse(jsonMatch[0]); } catch {}
      }
    }

    // ===== ANÁLISIS PROFUNDO CON LLAMA 3.3 70B =====
    const deepSystemPrompt = lang === 'en'
      ? `You are an expert academic analyst with deep reasoning capabilities. Analyze the provided text and extract comprehensive study information. Respond ONLY with valid JSON:
{
  "keywords": ["up to 15 most important keywords"],
  "important_phrases": ["up to 10 most important phrases or concepts"],
  "summary": "comprehensive 3-5 sentence summary covering all main points",
  "key_concepts": ["main concepts to understand"],
  "difficulty_level": "basic/intermediate/advanced",
  "topics": ["main topics covered"],
  "study_tips": ["specific tips for studying this content"],
  "connections": ["connections between concepts"]
}`
      : `Eres un analista académico experto con capacidades de razonamiento profundo. Analiza el texto proporcionado y extrae información de estudio completa. Responde SOLO con JSON válido:
{
  "keywords": ["hasta 15 palabras clave más importantes"],
  "important_phrases": ["hasta 10 frases o conceptos más importantes"],
  "summary": "resumen completo de 3-5 oraciones cubriendo todos los puntos principales",
  "key_concepts": ["conceptos principales que hay que entender"],
  "difficulty_level": "básico/intermedio/avanzado",
  "topics": ["temas principales cubiertos"],
  "study_tips": ["consejos específicos para estudiar este contenido"],
  "connections": ["conexiones entre conceptos"]
}`;

    const deepRes = await client.chat.completions.create({
      model: 'llama-3.3-70b-versatile',
      messages: [
        { role: 'system', content: deepSystemPrompt },
        {
          role: 'user',
          content: lang === 'en'
            ? `Analyze this content deeply:\n\n${content.substring(0, 6000)}`
            : `Analiza este contenido en profundidad:\n\n${content.substring(0, 6000)}`,
        },
      ],
      temperature: 0.2,
      max_tokens: 2000,
    });

    const deepText = deepRes.choices[0]?.message?.content || '{}';
    const deepJson = deepText.match(/\{[\s\S]*\}/);
    let deepAnalysis: any = {};
    if (deepJson) {
      try { deepAnalysis = JSON.parse(deepJson[0]); } catch {}
    }

    // ===== COMBINAR AMBOS ANÁLISIS =====
    const combinedAnalysis = {
      keywords: [
        ...new Set([
          ...(analysis.keywords || []),
          ...(deepAnalysis.keywords || []),
        ])
      ].slice(0, 15),
      important_phrases: [
        ...new Set([
          ...(analysis.important_phrases || []),
          ...(deepAnalysis.important_phrases || []),
        ])
      ].slice(0, 10),
      summary: deepAnalysis.summary || analysis.summary || '',
      key_concepts: [
        ...new Set([
          ...(analysis.key_concepts || []),
          ...(deepAnalysis.key_concepts || []),
        ])
      ].slice(0, 10),
      difficulty_level: deepAnalysis.difficulty_level || analysis.difficulty_level || '',
      topics: [
        ...new Set([
          ...(analysis.topics || []),
          ...(deepAnalysis.topics || []),
        ])
      ].slice(0, 8),
      study_tips: (deepAnalysis.study_tips || []).slice(0, 5),
      connections: (deepAnalysis.connections || []).slice(0, 5),
      visual_elements: analysis.visual_elements || [],
    };

    return NextResponse.json({ success: true, analysis: combinedAnalysis });

  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}