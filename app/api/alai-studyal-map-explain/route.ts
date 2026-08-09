import { NextRequest, NextResponse } from 'next/server';
import { detectLanguage } from '../../../lib/detectLanguage';
import { generateValidatedLegacyJson } from '../../../lib/ai/legacyRouteGeneration';

export const maxDuration = 60;

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const concepto = String(body.concepto || '').trim();
    const descripcion = String(body.descripcion || '').trim();
    const categoria = String(body.categoria || '').trim();
    const tema = String(body.tema || '').trim();
    const materia = String(body.materia || '').trim();
    const contexto = String(body.contexto || '').trim();

    if (!concepto) return NextResponse.json({ success: false, error: 'Concepto vacío' });

    const lang = detectLanguage(contexto || concepto || descripcion);
    const isEs = lang !== 'en';

    // Truncar pero manteniendo lo más relevante
    const contextoTrunc = contexto.length > 14000 ? contexto.slice(0, 14000) + '\n\n[...continúa...]' : contexto;

    const prompt = isEs
      ? `Eres ALAI, el mejor profesor del mundo. El estudiante hizo click en un concepto de su mapa mental y necesita ENTENDERLO USANDO ÚNICAMENTE lo que dice el material que él subió. NO inventes nada. NO uses conocimiento externo. SOLO el material.

CONTEXTO DEL ESTUDIANTE:
- Materia: ${materia || 'No especificada'}
- Tema general: ${tema || 'No especificado'}
- Categoría temática: ${categoria || 'General'}
- Concepto que quiere entender: "${concepto}"
- Descripción breve previa: "${descripcion}"

REGLAS CRÍTICAS (no negociables):

1. FUENTE ÚNICA: Tu única fuente es el MATERIAL pegado abajo. Si el material no menciona algo, NO lo inventes.

2. ESPECIFICIDAD: Usa nombres exactos, números reales, fechas, citas, datos concretos del material. Nada genérico.

3. SI EL MATERIAL NO CUBRE EL CONCEPTO:
   - Sé honesto: "El material no profundiza en X, solo menciona que..."
   - Usa lo poco que diga el material literal
   - NO rellenes con datos de tu conocimiento general

4. CITA TEXTUAL: La "cita_material" debe ser una frase REAL del material, no parafraseada.

5. EJEMPLOS: Solo usa ejemplos que aparezcan en el material. Si no hay ejemplos, di "El material no presenta ejemplos específicos" en ese campo y dale un ejemplo derivado del contexto.

6. PÁGINAS: Si el material tiene marcadores [Pagina N], menciona en qué página(s) está el concepto.

Devuelve JSON puro (sin markdown, sin \`\`\`):
{
  "explicacion_simple": "Explicación clara del concepto USANDO los datos del material, en 2-3 oraciones. Si el material es escaso, sé breve pero exacto.",
  "profundidad": "Detalles específicos del material: datos exactos, contexto, matices que aparecen literalmente en el texto (3-4 oraciones).",
  "ejemplo": "Ejemplo concreto del material (caso real, situación, jugador, evento, etc). Si no hay, di 'El material no presenta ejemplos específicos pero menciona...' y úsalo.",
  "por_que_importa": "Por qué este concepto es importante SEGÚN EL MATERIAL. Cita la razón que dé el texto (1-2 oraciones).",
  "conexiones": "Cómo este concepto se relaciona con OTROS conceptos del MISMO material (1-2 oraciones).",
  "cita_material": "Cita textual (o casi textual) del material que respalde este concepto. Frase literal.",
  "tip_memorizar": "Un truco corto basado en algo memorable del material (dato curioso, palabra clave, asociación)."
}

═══════════════════════════════════════════════════
MATERIAL DEL ESTUDIANTE (esta es tu ÚNICA fuente):
═══════════════════════════════════════════════════
${contextoTrunc}
═══════════════════════════════════════════════════

Responde SOLO el JSON. Sin texto antes, sin markdown, sin explicaciones.`
      : `You are ALAI, the world's best teacher. The student clicked on a concept and needs to UNDERSTAND IT USING ONLY what their material says. DO NOT invent. DO NOT use external knowledge. ONLY the material.

CONTEXT:
- Subject: ${materia}
- Topic: ${tema}
- Category: ${categoria}
- Concept: "${concepto}"
- Brief description: "${descripcion}"

CRITICAL RULES:
1. SINGLE SOURCE: Your only source is the MATERIAL pasted below. If material doesn't mention something, DON'T invent.
2. SPECIFICITY: Use exact names, real numbers, dates, quotes from material.
3. IF MATERIAL DOESN'T COVER IT: Be honest. Don't fill with general knowledge.
4. DIRECT QUOTE: "cita_material" must be a REAL phrase from material.
5. EXAMPLES: Only from material.

Return pure JSON (no markdown):
{
  "explicacion_simple": "Clear explanation USING material data, 2-3 sentences",
  "profundidad": "Specific details from material (3-4 sentences)",
  "ejemplo": "Concrete example from material",
  "por_que_importa": "Why this matters ACCORDING TO MATERIAL (1-2 sentences)",
  "conexiones": "How it relates to OTHER concepts in SAME material",
  "cita_material": "Direct quote (or near-direct) from material",
  "tip_memorizar": "Short trick based on something memorable from material"
}

═══════════════════════════════════════════════════
STUDENT'S MATERIAL (your ONLY source):
═══════════════════════════════════════════════════
${contextoTrunc}
═══════════════════════════════════════════════════

Respond ONLY with JSON. No text before, no markdown.`;

    const parsed: any = await generateValidatedLegacyJson({
      taskType: 'explanation',
      prompt,
      temperature: 0.15,
      maxTokens: 2500,
      normalize: value => value,
      validate: value => {
        const record = value as any
        const required = ['explicacion_simple', 'profundidad', 'ejemplo', 'por_que_importa', 'conexiones', 'cita_material', 'tip_memorizar']
        const missing = required.filter(field => !String(record?.[field] || '').trim())
        return {
          valid: missing.length === 0,
          errors: missing.map(field => `STRUCTURAL_VALIDATION_FAILED:missing_${field}`),
        }
      },
      telemetryContext: { route: 'mind_map_explanation', concept: concepto },
    })

    return NextResponse.json({ success: true, explicacion: parsed });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message });
  }
}
