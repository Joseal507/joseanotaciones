import { NextRequest, NextResponse } from 'next/server';
import { alai } from '../../../lib/alai';

export const maxDuration = 120;

function extractJson(text: string) {
  try {
    return JSON.parse(text.trim());
  } catch {}

  const match = text.match(/\{[\s\S]*\}/);
  if (match) {
    try {
      return JSON.parse(match[0]);
    } catch {}
  }

  return null;
}

function cleanArray(value: any): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((v) => String(v || '').trim()).filter(Boolean).slice(0, 10);
}

function cleanScore(value: any) {
  return Math.max(0, Math.min(100, Number(value) || 0));
}

function cleanReviewer(value: any) {
  return {
    persona: String(value?.persona || '').trim(),
    rating: cleanScore(value?.rating),
    verdict: String(value?.verdict || '').trim(),
    feedback: String(value?.feedback || '').trim(),
    wouldUnderstand: Boolean(value?.wouldUnderstand),
    missingForThem: cleanArray(value?.missingForThem).slice(0, 6),
  };
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();

    const materialText = String(body.materialText || '').trim();
    const explanation = String(body.explanation || '').trim();
    const notes = String(body.notes || '').trim();
    const mode = String(body.mode || 'libre').trim();
    const materia = String(body.materia || '').trim();
    const tema = String(body.tema || '').trim();
    const previousWeakConcepts = Array.isArray(body.previousWeakConcepts) ? body.previousWeakConcepts : [];

    if (!materialText) {
      return NextResponse.json({ error: 'No hay contenido para analizar.' }, { status: 400 });
    }

    if (!explanation) {
      return NextResponse.json({ error: 'No hay explicación del usuario.' }, { status: 400 });
    }

    const result = await alai({
      json: true,
      temperature: 0.22,
      maxTokens: 3000,
      messages: [
        {
          role: 'system',
          content: `
Eres un tutor pedagógico experto de StudyAL.

Evalúas comprensión real, no memorización literal.
El estudiante puede explicar con palabras diferentes al material.

Evalúa:
- cobertura conceptual contra TODO el material
- comprensión profunda
- claridad
- conexiones entre ideas
- errores o confusiones
- dominio general

IMPORTANTE:
Repasar es ADAPTATIVO.

Debes detectar los conceptos que el estudiante NO domina.

Luego genera preguntas de seguimiento enfocadas EXCLUSIVAMENTE en:
- conceptos omitidos
- conceptos débiles
- relaciones importantes no explicadas
- errores detectados

Las preguntas deben ayudar al estudiante a mejorar su siguiente intento.
No hagas preguntas triviales.

Evalúa SOLO desde el lector seleccionado en MODO DE EXPLICACIÓN.
No evalúes con los 4 lectores a la vez.

Lectores disponibles:
- nino: evalúa si una persona sin base podría captar la idea central.
- universitario: evalúa precisión, orden, términos correctos y suficiencia para estudiar.
- profesor: evalúa rigor, omisiones importantes, errores finos y dominio real.
- libre: evaluador neutral; evalúa utilidad global, estructura, claridad y preparación para examen.

El lector seleccionado debe hablar con su propia voz, como si hubiera leído la explicación del estudiante.
No seas complaciente. Sé útil, directo y pedagógico.
Nunca inventes contenido fuera del material.
Devuelve SOLO JSON válido.
`,
        },
        {
          role: 'user',
          content: `
MATERIA:
${materia}

TEMA:
${tema}

MODO DE EXPLICACIÓN:
${mode}

CONCEPTOS DÉBILES PREVIOS:
${previousWeakConcepts.join(', ') || 'Ninguno'}

MATERIAL:
"""
${materialText}
"""

NOTAS DEL ESTUDIANTE:
"""
${notes || 'Sin notas'}
"""

EXPLICACIÓN DEL ESTUDIANTE:
"""
${explanation}
"""

Devuelve EXACTAMENTE este JSON:

{
  "score": 0,
  "level": "",
  "metrics": {
    "coverage": 0,
    "clarity": 0,
    "depth": 0,
    "connections": 0
  },
  "reviewer": {
    "persona": "",
    "rating": 0,
    "verdict": "",
    "feedback": "",
    "wouldUnderstand": false,
    "missingForThem": []
  },
  "strengths": [],
  "missingConcepts": [],
  "confusions": [],
  "weakConcepts": [],

  "followUpQuestions": [
    {
      "question": "",
      "why": "",
      "concept": ""
    }
  ],

  "feedback": "",
  "nextStep": ""
}
`,
        },
      ],
    });

    const parsed = extractJson(result.text);

    if (!parsed) {
      return NextResponse.json({
        analysis: {
          score: 50,
          level: 'en progreso',
          metrics: { coverage: 50, clarity: 50, depth: 50, connections: 50 },
          strengths: [],
          missingConcepts: [],
          confusions: [],
          weakConcepts: [],
          reviewer: null,
          followUpQuestions: [],
          feedback: result.text.slice(0, 1200),
          nextStep: 'Reformula tu explicación con idea central, conceptos clave, relaciones y ejemplo.',
        },
      });
    }

    return NextResponse.json({
      analysis: {
        score: cleanScore(parsed.score),
        level: String(parsed.level || 'en progreso'),
        metrics: {
          coverage: cleanScore(parsed.metrics?.coverage),
          clarity: cleanScore(parsed.metrics?.clarity),
          depth: cleanScore(parsed.metrics?.depth),
          connections: cleanScore(parsed.metrics?.connections),
        },
        reviewer: parsed.reviewer ? cleanReviewer(parsed.reviewer) : null,
        strengths: cleanArray(parsed.strengths),
        missingConcepts: cleanArray(parsed.missingConcepts),
        confusions: cleanArray(parsed.confusions),
        weakConcepts: cleanArray(parsed.weakConcepts),
        followUpQuestions: Array.isArray(parsed.followUpQuestions)
          ? parsed.followUpQuestions.slice(0, 5)
          : [],
        feedback: String(parsed.feedback || ''),
        nextStep: String(parsed.nextStep || ''),
      },
    });
  } catch (err: any) {
    console.error('REPASAR API ERROR:', err);
    return NextResponse.json(
      { error: err?.message || 'Error analizando comprensión.' },
      { status: 500 }
    );
  }
}
