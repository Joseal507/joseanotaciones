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

function cleanConceptStatus(value: any) {
  const status = String(value?.status || 'progress').trim();
  return {
    concept: String(value?.concept || '').trim(),
    status: ['mastered', 'progress', 'weak'].includes(status) ? status : 'progress',
    note: String(value?.note || '').trim(),
  };
}

function cleanAction(value: any) {
  return {
    title: String(value?.title || '').trim(),
    detail: String(value?.detail || '').trim(),
  };
}

function cleanFollowUp(value: any) {
  if (typeof value === 'string') {
    return { question: value.trim(), why: '', concept: '' };
  }

  return {
    question: String(value?.question || '').trim(),
    why: String(value?.why || '').trim(),
    concept: String(value?.concept || '').trim(),
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

Evalúas comprensión real para un modo de repaso activo.
El estudiante NO está escribiendo un ensayo: está diciendo lo que recuerda y entendió después de leer.

REGLA CENTRAL:
No califiques como 0 solo porque faltan conceptos.
Un 0 solo aplica si la respuesta está vacía, no tiene relación con el material, o contradice casi todo.
Si la explicación menciona ideas correctas aunque sea incompleta, debe recibir crédito.

Evalúa:
- qué ideas correctas sí entendió
- qué ideas importantes omitió
- qué conexiones todavía no hizo
- qué errores o confusiones aparecen
- qué debería corregir en el siguiente intento

Repasar es ADAPTATIVO:
Después del feedback, genera preguntas de seguimiento específicas para mejorar el siguiente intento.
Las preguntas deben atacar conceptos débiles, omisiones o relaciones no explicadas.
No hagas preguntas triviales ni genéricas.

Evalúa SOLO desde el lector seleccionado en MODO DE EXPLICACIÓN.
No evalúes con todos los lectores a la vez.

Criterio por lector:
- nino: prioriza idea central, lenguaje simple, claridad y ejemplos. Sé amable. No exijas términos técnicos.
- universitario: prioriza comprensión académica, orden, conceptos clave y preparación para examen. Estricto moderado.
- profesor: prioriza rigor, precisión, relaciones, omisiones importantes y errores finos. Estricto alto.
- libre: prioriza utilidad global, claridad, estructura y qué tan estudiable es la explicación. Balanceado.

El feedback debe ser MUY fácil de entender:
- frases cortas
- directo al punto
- cero lenguaje genérico
- explica por qué bajó o subió el score
- da acciones concretas

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
  "summary": "",
  "mainIssue": "",
  "scoreReason": "",
  "estimatedNextScore": 0,
  "reviewer": {
    "persona": "",
    "rating": 0,
    "verdict": "",
    "feedback": "",
    "wouldUnderstand": false,
    "missingForThem": []
  },
  "conceptStatus": [
    {
      "concept": "",
      "status": "mastered | progress | weak",
      "note": ""
    }
  ],
  "strengths": [],
  "missingConcepts": [],
  "confusions": [],
  "weakConcepts": [],
  "actions": [
    {
      "title": "",
      "detail": ""
    }
  ],
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
          summary: 'No pude estructurar el análisis automáticamente.',
          mainIssue: 'La respuesta de la IA no llegó en el formato esperado.',
          scoreReason: 'Se muestra feedback crudo para no perder información.',
          estimatedNextScore: 65,
          strengths: [],
          missingConcepts: [],
          confusions: [],
          weakConcepts: [],
          conceptStatus: [],
          actions: [],
          reviewer: null,
          followUpQuestions: [],
          feedback: result.text.slice(0, 1200),
          nextStep: 'Vuelve a intentar explicando la idea central, conceptos clave y una conexión importante.',
        },
      });
    }

    return NextResponse.json({
      analysis: {
        score: cleanScore(parsed.score),
        level: String(parsed.level || 'en progreso'),
        metrics: {
          coverage: cleanScore(parsed.metrics?.coverage ?? parsed.score),
          clarity: cleanScore(parsed.metrics?.clarity ?? parsed.score),
          depth: cleanScore(parsed.metrics?.depth ?? parsed.score),
          connections: cleanScore(parsed.metrics?.connections ?? parsed.score),
        },
        summary: String(parsed.summary || parsed.feedback || ''),
        mainIssue: String(parsed.mainIssue || ''),
        scoreReason: String(parsed.scoreReason || ''),
        estimatedNextScore: cleanScore(parsed.estimatedNextScore || Math.min(100, Number(parsed.score || 0) + 12)),
        reviewer: parsed.reviewer ? cleanReviewer(parsed.reviewer) : null,
        conceptStatus: Array.isArray(parsed.conceptStatus)
          ? parsed.conceptStatus.map(cleanConceptStatus).filter((c: any) => c.concept).slice(0, 10)
          : [],
        strengths: cleanArray(parsed.strengths),
        missingConcepts: cleanArray(parsed.missingConcepts),
        confusions: cleanArray(parsed.confusions),
        weakConcepts: cleanArray(parsed.weakConcepts),
        actions: Array.isArray(parsed.actions)
          ? parsed.actions.map(cleanAction).filter((a: any) => a.title || a.detail).slice(0, 4)
          : [],
        followUpQuestions: Array.isArray(parsed.followUpQuestions)
          ? parsed.followUpQuestions.map(cleanFollowUp).filter((q: any) => q.question).slice(0, 4)
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
