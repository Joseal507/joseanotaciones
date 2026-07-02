import { NextRequest, NextResponse } from 'next/server';
import { alaiRequest } from '../../../lib/alai';

export async function POST(req: NextRequest) {
  try {
    const { materialText, materialId, tema, materia } = await req.json();

    if (!materialText?.trim()) {
      return NextResponse.json({ success: false, error: 'No text provided' }, { status: 400 });
    }

    const prompt = `Eres un Ontólogo Académico y Experto en Diseño Curricular. Tu tarea es analizar el texto proporcionado y extraer el "Grafo de Conocimiento" completo.

REGLAS CRÍTICAS DE EXTRACCIÓN:
1. ATOMICIDAD: Cada concepto debe ser una entidad única, medible y evaluable (ej: "Ciclo de Krebs", no "El ciclo de krebs es un proceso...").
2. JERARQUÍA: Identifica conceptos macro (temas principales) y conceptos micro (detalles, fórmulas, fechas, nombres).
3. EXHAUSTIVIDAD: No dejes fuera ningún concepto técnico, teórico o práctico que un estudiante deba saber para un examen.
4. FILTRO DE RUIDO: NO extraigas preguntas, NO extraigas frases completas, NO extraigas conectores lógicos.
5. CANTIDAD: Extrae entre 15 y 40 conceptos dependiendo de la densidad del texto.

CONTEXTO:
Materia: ${materia || 'No especificada'}
Tema: ${tema || 'No especificado'}

TEXTO A ANALIZAR:
${materialText.slice(0, 22000)}

FORMATO DE RESPUESTA OBLIGATORIO (Devuelve SOLO un JSON válido, sin markdown, sin explicaciones):
{
  "concepts": [
    {
      "name": "Nombre exacto del concepto",
      "type": "macro" | "micro" | "process" | "definition" | "formula",
      "importance": 1-10,
      "prerequisites": ["concepto previo 1", "concepto previo 2"]
    }
  ]
}

EJEMPLO DE SALIDA CORRECTA:
{
  "concepts": [
    {"name": "Fotosíntesis", "type": "macro", "importance": 10, "prerequisites": []},
    {"name": "ATP", "type": "micro", "importance": 9, "prerequisites": ["Fotosíntesis"]},
    {"name": "Fase luminosa", "type": "process", "importance": 8, "prerequisites": ["Fotosíntesis"]}
  ]
}`;

    const completion = await groq.chat.completions.create({
      model: 'llama-3.3-70b-versatile',
      messages: [
        { role: 'system', content: 'Eres un motor de extracción de conocimiento. Solo devuelves JSON válido.' },
        { role: 'user', content: prompt }
      ],
      temperature: 0.1, // Baja temperatura para máxima precisión
      max_tokens: 2000,
      response_format: { type: "json_object" }
    });

    const text = completion.choices[0]?.message?.content || '';
    
    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch (e) {
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (jsonMatch) parsed = JSON.parse(jsonMatch[0]);
      else throw new Error('Invalid JSON from AI');
    }

    // Procesar y limpiar conceptos
    const rawConcepts = Array.isArray(parsed.concepts) ? parsed.concepts : [];
    
    const concepts = rawConcepts
      .filter((c: any) => c && typeof c.name === 'string')
      .map((c: any) => c.name.trim())
      .filter((name: string) => 
        name.length > 1 && 
        name.length <= 60 && 
        !name.includes('?') &&
        !name.toLowerCase().startsWith('qué') &&
        !name.toLowerCase().startsWith('cómo')
      );

    // Eliminar duplicados (case-insensitive)
    const uniqueConcepts = Array.from(new Set(concepts.map((c: string) => c.toLowerCase())))
      .map(lower => concepts.find((c: string) => c.toLowerCase() === lower));

    if (uniqueConcepts.length === 0) {
      return NextResponse.json({ success: false, error: 'No valid concepts extracted' }, { status: 500 });
    }

    console.log(`✅ [Mastery] Extraídos ${uniqueConcepts.length} conceptos atómicos para ${materialId}`);

    return NextResponse.json({ 
      success: true, 
      concepts: uniqueConcepts, 
      materialId,
      rawGraph: parsed.concepts // Guardamos el grafo completo para el futuro
    });

  } catch (err: any) {
    console.error('Extract concepts error:', err);
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}
