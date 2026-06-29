import { NextRequest, NextResponse } from 'next/server';
import Groq from 'groq-sdk';

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

export async function POST(req: NextRequest) {
  try {
    const { materialText, concepts, materialId, tema, materia } = await req.json();

    if (!materialText?.trim() || !concepts?.length) {
      return NextResponse.json({ success: false, error: 'Missing data' }, { status: 400 });
    }

    const prompt = `Eres un experto en pedagogía y mapas de conocimiento. Analiza las relaciones entre los siguientes conceptos académicos.

CONCEPTOS:
${concepts.join(', ')}

MATERIAL (contexto):
${materialText.slice(0, 10000)}

TIPOS DE RELACIÓN DISPONIBLES:
- prerequisite: A es prerequisito de B (hay que entender A antes que B)
- prerequisite_of: A depende de B como prerequisito
- part_of: A es parte de B
- causes: A causa o produce B
- related: A y B están relacionados pero sin jerarquía clara
- contrasts: A contrasta con B
- example_of: A es un ejemplo de B
- compared_with: A se compara habitualmente con B
- depends_on: A depende conceptualmente de B
- requires: A requiere B para funcionar
- opposite_of: A es lo opuesto de B

INSTRUCCIONES:
1. Identifica relaciones REALES entre los conceptos dados
2. Usa solo los conceptos de la lista proporcionada
3. Incluye solo relaciones que realmente existen en el material
4. La fuerza (strength) va de 0.1 a 1.0 según qué tan fuerte es la relación
5. Máximo 30 relaciones

RESPONDE SOLO con JSON válido:
{
  "relations": [
    {"from": "concepto_a", "to": "concepto_b", "type": "prerequisite", "strength": 0.9},
    ...
  ]
}`;

    const completion = await groq.chat.completions.create({
      model: 'llama-3.3-70b-versatile',
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.2,
      max_tokens: 2000,
    });

    const text = completion.choices[0]?.message?.content || '';
    const jsonMatch = text.match(/\{[\s\S]*\}/);

    if (!jsonMatch) {
      return NextResponse.json({ success: false, error: 'Invalid AI response' }, { status: 500 });
    }

    const parsed = JSON.parse(jsonMatch[0]);
    const validTypes = [
      'prerequisite', 'prerequisite_of', 'part_of', 'causes', 'related',
      'contrasts', 'example_of', 'compared_with', 'depends_on', 'requires', 'opposite_of',
    ];

    const conceptSet = new Set(concepts.map((c: string) => c.toLowerCase()));
    const relations = (parsed.relations || [])
      .filter((r: any) =>
        r.from && r.to && r.type &&
        validTypes.includes(r.type) &&
        conceptSet.has(r.from.toLowerCase()) &&
        conceptSet.has(r.to.toLowerCase()) &&
        r.from.toLowerCase() !== r.to.toLowerCase() &&
        typeof r.strength === 'number' && r.strength > 0 && r.strength <= 1
      )
      .slice(0, 30);

    console.log(`✅ Extracted ${relations.length} graph relations for material ${materialId}`);

    return NextResponse.json({ success: true, relations, concepts, materialId });

  } catch (err: any) {
    console.error('Extract graph error:', err);
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}
