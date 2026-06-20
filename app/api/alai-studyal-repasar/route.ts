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

function wordCount(text: string) {
  return String(text || '').trim().split(/\s+/).filter(Boolean).length;
}

function calibrateRepasarScore({
  rawScore,
  mode,
  explanation,
  strengths,
  missingConcepts,
  confusions,
  conceptStatus,
}: {
  rawScore: number;
  mode: string;
  explanation: string;
  strengths: string[];
  missingConcepts: string[];
  confusions: string[];
  conceptStatus: any[];
}) {
  const words = wordCount(explanation);
  const hasUsefulUnderstanding =
    strengths.length > 0 ||
    conceptStatus.some((c: any) => c?.status === 'mastered' || c?.status === 'progress');

  const hasConfusion = confusions.length > 0;
  const missingCount = missingConcepts.length;

  if (words < 4) return Math.min(rawScore, 15);

  let score = rawScore;

  // Si la IA reconoce comprensión, no puede dar puntajes ridículos.
  if (hasUsefulUnderstanding) {
    if (mode === 'nino') score = Math.max(score, 68);
    else if (mode === 'universitario') score = Math.max(score, 52);
    else if (mode === 'profesor') score = Math.max(score, 36);
    else score = Math.max(score, 55);
  }

  // Respuesta corta pero relacionada: crédito básico, diferente por lector.
  if (words >= 8 && hasUsefulUnderstanding) {
    if (mode === 'nino') score += 12;
    if (mode === 'universitario') score += 4;
    if (mode === 'profesor') score -= 4;
  }

  // Penalizaciones suaves y claras.
  if (missingCount >= 4) score -= mode === 'profesor' ? 14 : mode === 'universitario' ? 8 : 2;
  else if (missingCount >= 2) score -= mode === 'profesor' ? 8 : mode === 'universitario' ? 5 : 1;

  if (hasConfusion) score -= mode === 'profesor' ? 12 : mode === 'universitario' ? 8 : 4;

  // Diferenciar lectores aunque el modelo intente igualar puntajes.
  if (hasUsefulUnderstanding) {
    if (mode === 'nino') score = Math.max(score, 65);
    if (mode === 'universitario') score = Math.max(score, 45);
    if (mode === 'profesor') score = Math.max(score, 30);
  }

  return cleanScore(Math.round(score));
}

function levelFromScore(score: number) {
  if (score >= 90) return 'dominio fuerte';
  if (score >= 75) return 'buen avance';
  if (score >= 55) return 'en progreso';
  if (score >= 25) return 'base débil';
  return 'necesita repaso';
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();

    const materialText = String(body.materialText || '').trim();
    const explanation = String(body.explanation || '').trim();
    const notes = String(body.notes || '').trim();
    const mode = String(body.mode || 'libre').trim();

    const modeConfig: Record<string, {
      persona: string;
      scoringGuide: string;
      strictness: string;
    }> = {
      nino: {
        persona: 'Niño',
        strictness: 'muy baja',
        scoringGuide: `
NIÑO:
- Evalúa si se entiende la idea principal.
- NO castigues fuerte por falta de datos, nombres o detalles.
- Si el estudiante capta la idea general, debe estar mínimo entre 65 y 80.
- Si lo explica simple y con sentido, puede estar entre 80 y 95 aunque no cubra todo.
- Solo baja de 50 si no se entiende la idea central o está fuera del tema.
- Para niño, NO castigues fuerte por no mencionar nombres, fechas o detalles.
`,
      },
      universitario: {
        persona: 'Universitario',
        strictness: 'media',
        scoringGuide: `
UNIVERSITARIO:
- Evalúa si sirve para estudiar y responder en clase.
- Debe cubrir ideas principales, algunos detalles y conexiones.
- Si tiene idea central correcta pero poca profundidad: 50 a 68.
- Si explica bien pero omite detalles importantes: 65 a 82.
- Si explica con orden, conceptos y ejemplos: 82 a 95.
- Solo baja de 25 si casi no hay contenido útil o está fuera del material.
`,
      },
      profesor: {
        persona: 'Profesor',
        strictness: 'alta',
        scoringGuide: `
PROFESOR:
- Evalúa precisión, rigor, conceptos omitidos y relaciones.
- Puede penalizar fuerte omisiones importantes.
- Si tiene idea central correcta pero superficial: 35 a 58.
- Si explica bastante bien pero falta análisis: 60 a 78.
- Si está completo, preciso y conectado: 80 a 100.
- Solo baja de 20 si la explicación es irrelevante, vacía o muy equivocada.
`,
      },
      libre: {
        persona: 'Evaluador neutral',
        strictness: 'balanceada',
        scoringGuide: `
EVALUADOR NEUTRAL:
- Evalúa utilidad general para repasar.
- Balancea claridad, contenido y conexión con el material.
- Si se entiende lo básico: 45 a 65.
- Si es útil pero incompleto: 65 a 80.
- Si está claro, conectado y completo: 80 a 100.
`,
      },
    };

    const selectedMode = modeConfig[mode] || modeConfig.libre;
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
Si la explicación menciona ideas correctas aunque sea incompleta, debe recibir crédito real.

NO acepto scoring mediocre:
- Una respuesta con una idea correcta no puede recibir 0, 5 u 8.
- Si das un score bajo, explica exactamente qué faltó y qué sí entendió.
- El feedback debe servirle al estudiante para mejorar, no solo juzgarlo.
- No evalúes como ensayo. Evalúa como repaso activo.

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

GUÍA DE PUNTAJE DEL LECTOR SELECCIONADO:
${selectedMode.scoringGuide}

OBLIGATORIO:
El score, reviewer.rating y feedback deben cambiar según el lector seleccionado.
La misma respuesta NO debe recibir el mismo puntaje como niño, universitario y profesor.
Para niño, premia mucho más la idea central.
Para profesor, exige mucho más precisión y conexiones.

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

LECTOR SELECCIONADO:
${selectedMode.persona}

NIVEL DE EXIGENCIA:
${selectedMode.strictness}

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
    "persona": "${selectedMode.persona}",
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

    const strengths = cleanArray(parsed.strengths);
    const missingConcepts = cleanArray(parsed.missingConcepts);
    const confusions = cleanArray(parsed.confusions);
    const conceptStatus = Array.isArray(parsed.conceptStatus)
      ? parsed.conceptStatus.map(cleanConceptStatus).filter((c: any) => c.concept).slice(0, 10)
      : [];

    const rawScore = cleanScore(parsed.score);
    const score = calibrateRepasarScore({
      rawScore,
      mode,
      explanation,
      strengths,
      missingConcepts,
      confusions,
      conceptStatus,
    });

    const reviewer = parsed.reviewer ? cleanReviewer(parsed.reviewer) : null;
    if (reviewer) {
      reviewer.rating = score;
      reviewer.persona = reviewer.persona || selectedMode.persona;
    }

    return NextResponse.json({
      analysis: {
        score,
        level: levelFromScore(score),
        metrics: {
          coverage: score,
          clarity: score,
          depth: score,
          connections: score,
        },
        summary: String(parsed.summary || parsed.feedback || ''),
        mainIssue: String(parsed.mainIssue || ''),
        scoreReason: String(parsed.scoreReason || ''),
        estimatedNextScore: cleanScore(Math.max(parsed.estimatedNextScore || 0, Math.min(100, score + (score < 55 ? 25 : 15)))),
        reviewer,
        conceptStatus,
        strengths,
        missingConcepts,
        confusions,
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
