// ═══════════════════════════════════════════════════════════════
// /api/analizar-teorico — Análisis pedagógico con StudyAI
// Cache por material + auth + fallback completo
// ═══════════════════════════════════════════════════════════════

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '../../../lib/auth/options';
import { studyAIJson, cleanDeep, safeParseJson } from '../../../lib/studyai';
import { detectContentLanguage } from '../../../lib/detectLanguage';
import {
  getMaterialResult,
  saveMaterialResult,
} from '../../../lib/materials/repository';

export const maxDuration = 120;
export const dynamic = 'force-dynamic';

// ── Validación básica de strings ───────────────────────────────
const ok = (s: any, min = 10) =>
  typeof s === 'string' && s.trim().length >= min;

// ── Prompts ────────────────────────────────────────────────────
const REGLAS = (lang: 'es' | 'en') => lang === 'es'
  ? `REGLAS OBLIGATORIAS:
0. BASA TODO en el material. PROHIBIDO inventar datos externos.
1. Habla DIRECTAMENTE al lector: "tú", "imagínate", "fíjate".
2. Cada término técnico se explica la primera vez.
3. PROHIBIDO copiar literal. Reescribe con tus palabras.
4. PROHIBIDAS frases vacías: "es importante", "en conclusión".
5. Devuelve SOLO JSON válido. Sin markdown, sin texto extra.`
  : `MANDATORY RULES:
0. BASE EVERYTHING on the material. FORBIDDEN to invent external data.
1. Talk DIRECTLY to the reader: "you", "imagine", "notice".
2. Every technical term explained on first use.
3. FORBIDDEN to copy verbatim. Rewrite in your own words.
4. FORBIDDEN filler phrases: "it is important", "in conclusion".
5. Return ONLY valid JSON. No markdown, no extra text.`;

function promptA(lang: 'es' | 'en', text: string): string {
  const reglas = REGLAS(lang);
  if (lang === 'es') return `Eres un profesor experto que ENSEÑA, no resume.

${reglas}

Material a analizar:
${text.slice(0, 18000)}

Devuelve EXACTAMENTE este JSON:
{
  "titulo": "Título de 4-8 palabras que despierte curiosidad",
  "vision_general": [
    "Párrafo 1: Por qué este tema importa. Conecta con algo cotidiano.",
    "Párrafo 2: Qué cubre el material en palabras simples.",
    "Párrafo 3: Las partes principales en orden.",
    "Párrafo 4: Aplicaciones reales y casos concretos."
  ],
  "conceptos": [
    {
      "nombre": "Nombre exacto del concepto",
      "definicion_simple": "2-3 oraciones como si hablaras con un amigo.",
      "definicion_tecnica": "Definición precisa con terminología correcta.",
      "por_que_importa": "Para qué sirve en la vida real. 2 oraciones.",
      "ejemplo": "Caso concreto y específico. 2 oraciones."
    }
  ]
}
EXTRAE TODOS los conceptos — no te saltes ninguno.`;

  return `You are an expert teacher who TEACHES, not summarizes.

${reglas}

Material to analyze:
${text.slice(0, 18000)}

Return EXACTLY this JSON:
{
  "titulo": "4-8 word curiosity-sparking title",
  "vision_general": [
    "Paragraph 1: Why this topic matters. Connect to everyday life.",
    "Paragraph 2: What the material covers in simple words.",
    "Paragraph 3: Main parts in order.",
    "Paragraph 4: Real applications and concrete cases."
  ],
  "conceptos": [
    {
      "nombre": "Exact concept name",
      "definicion_simple": "2-3 sentences like talking to a friend.",
      "definicion_tecnica": "Precise definition with correct terminology.",
      "por_que_importa": "What it is used for in real life. 2 sentences.",
      "ejemplo": "Concrete specific case. 2 sentences."
    }
  ]
}
EXTRACT ALL concepts — don't skip any.`;
}

function promptB(lang: 'es' | 'en', text: string): string {
  const reglas = REGLAS(lang);
  if (lang === 'es') return `Eres un profesor experto. Genera la segunda parte del análisis pedagógico.

${reglas}

Material:
${text.slice(0, 18000)}

Devuelve EXACTAMENTE este JSON:
{
  "conexiones": [
    {
      "de": "Concepto A",
      "a": "Concepto B",
      "como": "Mecanismo causal. Por qué existe esta relación. 3-4 oraciones."
    }
  ],
  "ejemplos": [
    {
      "titulo": "Título del caso",
      "problema": "Situación real a resolver.",
      "razonamiento": "Paso a paso: 'Primero...', 'Fíjate que...', 'Por lo tanto...'. 4-6 oraciones.",
      "respuesta": "Conclusión + por qué tiene sentido. 2 oraciones."
    }
  ],
  "analogias": [
    {
      "concepto": "Nombre del concepto abstracto",
      "analogia": "Empieza con 'Imagínate...' o 'Es como cuando...'. 3 oraciones."
    }
  ],
  "errores_comunes": [
    {
      "confusion": "'Muchos piensan que X, pero en realidad...'",
      "por_que_pasa": "Qué crea esta confusión. 2 oraciones.",
      "como_evitarlo": "Truco mental: 'Cuando veas X, pregúntate Y'. 2 oraciones."
    }
  ],
  "resumen_final": [
    "Insight 1: algo que solo se entiende después de leer el análisis.",
    "Insight 2",
    "Insight 3"
  ],
  "autoevaluacion": [
    {
      "pregunta": "Pregunta concreta que prueba comprensión.",
      "respuesta_esperada": "• Punto 1\\n• Punto 2\\n• Punto 3"
    }
  ]
}`;

  return `You are an expert teacher. Generate the second part of the pedagogical analysis.

${reglas}

Material:
${text.slice(0, 18000)}

Return EXACTLY this JSON:
{
  "conexiones": [
    {
      "de": "Concept A",
      "a": "Concept B",
      "como": "Causal mechanism. Why this relationship exists. 3-4 sentences."
    }
  ],
  "ejemplos": [
    {
      "titulo": "Case title",
      "problema": "Real situation to solve.",
      "razonamiento": "Step by step: 'First...', 'Notice that...', 'Therefore...'. 4-6 sentences.",
      "respuesta": "Conclusion + why it makes sense. 2 sentences."
    }
  ],
  "analogias": [
    {
      "concepto": "Abstract concept name",
      "analogia": "Start with 'Imagine...' or 'It is like when...'. 3 sentences."
    }
  ],
  "errores_comunes": [
    {
      "confusion": "'Many think X, but actually...'",
      "por_que_pasa": "What creates this confusion. 2 sentences.",
      "como_evitarlo": "Mental trick: 'When you see X, ask yourself Y'. 2 sentences."
    }
  ],
  "resumen_final": [
    "Insight 1: something only understood after the full analysis.",
    "Insight 2",
    "Insight 3"
  ],
  "autoevaluacion": [
    {
      "pregunta": "Concrete question testing ONE concept.",
      "respuesta_esperada": "• Key point 1\\n• Key point 2\\n• Key point 3"
    }
  ]
}`;
}

// ── Handler ────────────────────────────────────────────────────
export async function POST(req: NextRequest) {
  try {
    // ─── Auth NextAuth (opcional pero recomendado) ───
    let userId: string | null = null;
    try {
      const session = await getServerSession(authOptions);
      userId = (session?.user as any)?.id ?? null;
    } catch {}

    // ─── Body ───
    const body = await req.json();
    const { documentos, idioma, materialId } = body as {
      documentos: {
        id: string;
        nombre: string;
        contenido: string;
        tipo: string;
      }[];
      idioma?: 'es' | 'en';
      materialId?: string;
    };

    if (!documentos?.length) {
      return NextResponse.json(
        { error: 'No se enviaron documentos' },
        { status: 400 },
      );
    }

    // ─── Cache por material ───
    if (materialId && userId) {
      const cached = await getMaterialResult(materialId, 'teorico', 'analysis')
        .catch(() => null);
      if (cached?.payload) {
        console.log(`🚀 Cache HIT análisis → ${materialId}`);
        return NextResponse.json({
          success: true,
          analisis: cached.payload,
          fromCache: true,
        });
      }
    }

    // ─── Preparar texto combinado ───
    let combinedText = '';
    const docNames: string[] = [];

    for (const doc of documentos) {
      const txt = (doc.contenido || '').trim();
      if (!txt) continue;
      combinedText += `\n\n===== ${doc.nombre} =====\n\n${txt.slice(0, 25000)}`;
      docNames.push(doc.nombre);
    }

    if (combinedText.trim().length < 50) {
      return NextResponse.json(
        { error: 'Los documentos no tienen contenido legible. Asegurate de que el texto fue extraído correctamente.' },
        { status: 400 },
      );
    }

    const lang: 'es' | 'en' = idioma === 'en' ? 'en' : 'es';
    const detectedLang = detectContentLanguage(combinedText, lang);

    console.log(`🧠 Analizando: ${combinedText.length} chars, lang=${detectedLang}`);

    // ─── Dos pasadas en paralelo ───
    const [rawA, rawB] = await Promise.all([
      studyAIJson({
        messages: [
          { role: 'system', content: promptA(detectedLang as 'es' | 'en', combinedText) },
          { role: 'user', content: detectedLang === 'es' ? 'Genera el análisis ahora.' : 'Generate the analysis now.' },
        ],
        temperature: 0.6,
        maxTokens: 8000,
        json: true,
      }).catch(async () => {
        // Fallback sin json_object forzado
        const r = await studyAIJson({
          messages: [{ role: 'user', content: promptA(detectedLang as 'es' | 'en', combinedText) }],
          temperature: 0.6,
          maxTokens: 8000,
        });
        return r;
      }),

      studyAIJson({
        messages: [
          { role: 'system', content: promptB(detectedLang as 'es' | 'en', combinedText) },
          { role: 'user', content: detectedLang === 'es' ? 'Genera la segunda parte ahora.' : 'Generate the second part now.' },
        ],
        temperature: 0.6,
        maxTokens: 8000,
        json: true,
      }).catch(async () => {
        const r = await studyAIJson({
          messages: [{ role: 'user', content: promptB(detectedLang as 'es' | 'en', combinedText) }],
          temperature: 0.6,
          maxTokens: 8000,
        });
        return r;
      }),
    ]);

    const cA = cleanDeep(rawA);
    const cB = cleanDeep(rawB);

    if (!cA || !cB) {
      return NextResponse.json(
        { error: 'La IA generó una respuesta inválida. Intenta de nuevo.' },
        { status: 500 },
      );
    }

    // ─── Construir resultado final ───
    const visionRaw = cA.vision_general;
    const vision = Array.isArray(visionRaw)
      ? visionRaw.filter((s: any) => ok(s, 20))
      : [String(visionRaw || '')].filter(s => ok(s, 20));

    const analisis = {
      titulo: ok(cA.titulo, 3) ? cA.titulo : (lang === 'es' ? 'Análisis del material' : 'Material Analysis'),
      vision_general: vision.length > 0 ? vision : [lang === 'es' ? 'Análisis generado.' : 'Analysis generated.'],
      conceptos: (cA.conceptos || []).filter((c: any) =>
        ok(c?.nombre) && ok(c?.definicion_simple, 15)
      ),
      conexiones: (cB.conexiones || []).filter((c: any) =>
        ok(c?.de) && ok(c?.a) && ok(c?.como, 20)
      ),
      ejemplos: (cB.ejemplos || []).filter((e: any) =>
        ok(e?.titulo) && ok(e?.problema, 10) && ok(e?.razonamiento, 20)
      ),
      analogias: (cB.analogias || []).filter((a: any) =>
        ok(a?.concepto) && ok(a?.analogia, 20)
      ),
      errores_comunes: (cB.errores_comunes || []).filter((e: any) =>
        ok(e?.confusion, 10) && ok(e?.por_que_pasa, 10)
      ),
      resumen_final: (cB.resumen_final || []).filter((s: any) => ok(s, 10)),
      autoevaluacion: (cB.autoevaluacion || []).filter((q: any) =>
        ok(q?.pregunta, 8) && ok(q?.respuesta_esperada, 8)
      ),
      idioma: detectedLang,
      docNames,
    };

    if (analisis.conceptos.length === 0) {
      return NextResponse.json(
        { error: 'No se pudieron extraer conceptos. Verificá que el documento tenga contenido de estudio.' },
        { status: 500 },
      );
    }

    console.log(`📊 Análisis listo: ${analisis.conceptos.length} conceptos, ${analisis.conexiones.length} conexiones`);

    // ─── Guardar en cache ───
    if (materialId && userId) {
      saveMaterialResult({
        material_id: materialId,
        enfoque: 'teorico',
        result_type: 'analysis',
        payload: analisis,
      }).catch(e => console.warn('Cache write error:', e?.message));
    }

    return NextResponse.json({ success: true, analisis });

  } catch (error: any) {
    console.error('analizar-teorico error:', error);
    return NextResponse.json(
      { error: error?.message || 'Error generando análisis' },
      { status: 500 },
    );
  }
}
