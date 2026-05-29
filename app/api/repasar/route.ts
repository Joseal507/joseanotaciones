import { NextRequest, NextResponse } from 'next/server';
import { studyAI } from '../../../lib/studyai';

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

    const result = await studyAI({
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
- cobertura conceptual
- comprensión profunda
- claridad
- conexiones entre ideas
- errores o confusiones
- dominio general

No seas complaciente. Sé útil, directo y pedagógico.

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
  "strengths": [],
  "missingConcepts": [],
  "confusions": [],
  "weakConcepts": [],
  "followUpQuestions": [],
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
        strengths: cleanArray(parsed.strengths),
        missingConcepts: cleanArray(parsed.missingConcepts),
        confusions: cleanArray(parsed.confusions),
        weakConcepts: cleanArray(parsed.weakConcepts),
        followUpQuestions: cleanArray(parsed.followUpQuestions).slice(0, 5),
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
