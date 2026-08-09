import { NextRequest, NextResponse } from 'next/server';
import { alaiJson } from '../../../../lib/alai';

export const maxDuration = 60;
export const dynamic = 'force-dynamic';

interface TaughtStep {
  stepNumber: number;
  type: string;
  title: string;
  content: string;
  keyPoint?: string | null;
  isCurrent?: boolean;
}

interface PrimaryBlock {
  id: string;
  label: string;
  summary: string;
  kind: string;
  sourceQuote?: string | null;
}

interface ContextBlock {
  label: string;
  summary: string;
  kind: string;
}

interface AskRequest {
  question: string;
  sessionContext: {
    sessionTitle: string;
    sessionObjective: string;
    sessionClosing?: string;
    currentStep?: {
      title: string;
      content: string;
    };
    allTaughtSteps?: TaughtStep[];
  };
  materialTitle: string;
  primaryBlocks?: PrimaryBlock[];
  contextBlocks?: ContextBlock[];
  // Deprecated: mantenido para compat
  relevantBlocks?: Array<{
    label: string;
    summary: string;
    kind: string;
  }>;
  userProfile?: {
    name?: string;
    career?: string;
  };
  history?: Array<{ role: 'user' | 'assistant'; content: string }>;
}

function detectLang(text: string): 'es' | 'en' {
  if (/[áéíóúüñÁÉÍÓÚÜÑ]/.test(text)) return 'es';
  const lower = text.toLowerCase();
  const esCount = (lower.match(/\b(el|la|los|las|de|del|en|un|una|que|es|con|para|por|como|más|también|este|esta|su|sus|se|al|lo|qué|cómo|por qué|cuál)\b/g) || []).length;
  const enCount = (lower.match(/\b(the|of|and|in|is|it|for|as|on|with|this|that|are|was|were|be|been|have|has|had|what|how|why|which)\b/g) || []).length;
  return esCount >= enCount ? 'es' : 'en';
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json() as AskRequest;
    const { question, sessionContext, materialTitle, primaryBlocks, contextBlocks, relevantBlocks, userProfile, history } = body;

    if (!question || question.trim().length < 2) {
      return NextResponse.json({ success: false, error: 'Pregunta requerida' }, { status: 400 });
    }

    const lang = detectLang(question + ' ' + materialTitle);
    const isSpanish = lang === 'es';

    // ═══════════════════════════════════════════════════════════════
    // FUENTE 1 (prioritaria): TODA la clase enseñada
    // ═══════════════════════════════════════════════════════════════
    const taughtStepsContext = sessionContext.allTaughtSteps && sessionContext.allTaughtSteps.length > 0
      ? sessionContext.allTaughtSteps.map((s) =>
          `[Paso ${s.stepNumber} — ${s.type}${s.isCurrent ? ' — PASO ACTUAL' : ''}] "${s.title}"\n${s.content}${s.keyPoint ? '\nIdea clave: ' + s.keyPoint : ''}`
        ).join('\n\n')
      : '(no hay pasos enseñados disponibles)';

    // ═══════════════════════════════════════════════════════════════
    // FUENTE 2: Bloques primarios de esta sesión (del análisis del material)
    // ═══════════════════════════════════════════════════════════════
    const primaryBlocksContext = primaryBlocks && primaryBlocks.length > 0
      ? primaryBlocks.map((b, i) =>
          `${i + 1}. [${b.kind}] ${b.label}: ${b.summary}${b.sourceQuote ? '\n   Cita del material: "' + b.sourceQuote + '"' : ''}`
        ).join('\n')
      : '(no hay bloques primarios)';

    // ═══════════════════════════════════════════════════════════════
    // FUENTE 3: Bloques de contexto del material completo (no primarios)
    // ═══════════════════════════════════════════════════════════════
    const contextBlocksContext = contextBlocks && contextBlocks.length > 0
      ? contextBlocks.slice(0, 15).map((b, i) =>
          `${i + 1}. [${b.kind}] ${b.label}: ${b.summary}`
        ).join('\n')
      : (relevantBlocks && relevantBlocks.length > 0
          ? relevantBlocks.slice(0, 10).map((b, i) => `${i + 1}. [${b.kind}] ${b.label}: ${b.summary}`).join('\n')
          : '(no hay contexto adicional)');

    const currentStepContext = sessionContext.currentStep
      ? `\nPASO ACTUAL QUE EL ESTUDIANTE ESTÁ VIENDO:\n"${sessionContext.currentStep.title}"\n${sessionContext.currentStep.content}`
      : '';

    const sessionClosingContext = sessionContext.sessionClosing
      ? `\nCIERRE DE LA SESIÓN:\n${sessionContext.sessionClosing}`
      : '';

    const userContext = userProfile?.name
      ? `El estudiante se llama ${userProfile.name.split(' ')[0]}.`
      : '';

    const historyContext = history && history.length > 0
      ? '\n\nHISTORIAL DE ESTA CONVERSACIÓN:\n' +
        history.slice(-6).map(h => `${h.role === 'user' ? 'Estudiante' : 'Tú'}: ${h.content}`).join('\n')
      : '';

    const prompt = isSpanish
      ? `Eres el mismo tutor que está dando esta sesión de estudio. El estudiante te pregunta sobre lo que acaba de aprender.
${userContext}

MATERIAL: "${materialTitle}"
SESIÓN ACTUAL: "${sessionContext.sessionTitle}"
OBJETIVO: ${sessionContext.sessionObjective}
${currentStepContext}${sessionClosingContext}

═══════════════════════════════════════════════════════════════
LO QUE ENSEÑASTE EN ESTA SESIÓN (FUENTE PRIMARIA)
═══════════════════════════════════════════════════════════════

${taughtStepsContext}

═══════════════════════════════════════════════════════════════
BLOQUES DEL ANÁLISIS QUE CUBRE ESTA SESIÓN
═══════════════════════════════════════════════════════════════

${primaryBlocksContext}

═══════════════════════════════════════════════════════════════
OTRO CONTEXTO DEL MATERIAL (por si es útil)
═══════════════════════════════════════════════════════════════

${contextBlocksContext}
${historyContext}

═══════════════════════════════════════════════════════════════
PREGUNTA DEL ESTUDIANTE
═══════════════════════════════════════════════════════════════

"${question}"

═══════════════════════════════════════════════════════════════
REGLAS ESTRICTAS PARA TU RESPUESTA
═══════════════════════════════════════════════════════════════

REGLA 1 — CONSISTENCIA ABSOLUTA CON LO ENSEÑADO:
Si algo fue enseñado en los pasos de esta sesión, DEBES usarlo. Nunca digas "el material no lo detalla" si tu propia clase lo enseñó.
Ejemplo: si un paso explicó por qué X funciona, y el estudiante pregunta por qué X funciona, responde con lo que enseñaste — no digas que no está.

REGLA 2 — ORDEN DE FUENTES:
1º) Los pasos de la clase (lo que enseñaste)
2º) Los bloques primarios del análisis
3º) Los bloques de contexto adicional
Solo si NINGUNO de estos tiene la respuesta, di que el material no cubre ese detalle específico.

REGLA 3 — TONO DE TUTOR PERSONAL:
- Habla en SEGUNDA PERSONA SINGULAR ("tú") — NUNCA en plural
- PROHIBIDO: "ustedes", "hola a todos", "bienvenidos", "piensen", "recuerden", "prepárense"
- Usa: "recuerda que en la clase vimos...", "como estudiaste en el paso X..."
- Sé directo y claro, sin adornos innecesarios
- 2-6 oraciones normalmente

REGLA 4 — FIDELIDAD ESTRICTA:
- No inventes datos, fechas, cifras, características que no estén en las fuentes
- Si el material dice "muchos consideran X el mejor", NO digas "X es el mejor" — preserva la modalidad
- Si un paso dice algo con cierto detalle, usa ese detalle

REGLA 5 — CONEXIÓN CON LO ENSEÑADO:
Si la respuesta viene de un paso específico, menciónalo naturalmente: "recuerda que en la clase vimos..."

Responde SOLO con JSON válido:
{
  "answer": "Tu respuesta usando lo enseñado y el material",
  "sourceUsed": "taught_steps | primary_blocks | context_blocks | outside_material",
  "confidence": "high | medium | low"
}`
      : `You are the same tutor teaching this study session. The student is asking about what they just learned.
${userContext}

MATERIAL: "${materialTitle}"
CURRENT SESSION: "${sessionContext.sessionTitle}"
OBJECTIVE: ${sessionContext.sessionObjective}
${currentStepContext}${sessionClosingContext}

═══════════════════════════════════════════════════════════════
WHAT YOU TAUGHT IN THIS SESSION (PRIMARY SOURCE)
═══════════════════════════════════════════════════════════════

${taughtStepsContext}

═══════════════════════════════════════════════════════════════
ANALYSIS BLOCKS THIS SESSION COVERS
═══════════════════════════════════════════════════════════════

${primaryBlocksContext}

═══════════════════════════════════════════════════════════════
OTHER MATERIAL CONTEXT (if useful)
═══════════════════════════════════════════════════════════════

${contextBlocksContext}
${historyContext}

═══════════════════════════════════════════════════════════════
STUDENT'S QUESTION
═══════════════════════════════════════════════════════════════

"${question}"

═══════════════════════════════════════════════════════════════
STRICT RULES
═══════════════════════════════════════════════════════════════

RULE 1 — ABSOLUTE CONSISTENCY WITH WHAT YOU TAUGHT:
If something was taught in the steps, USE IT. Never say "the material doesn't detail this" if your own class taught it.

RULE 2 — SOURCE ORDER:
1st) The taught steps
2nd) Primary analysis blocks
3rd) Context blocks
Only if NONE has the answer, say the material doesn't cover that detail.

RULE 3 — PERSONAL TUTOR TONE:
- Second person singular ("you") — NEVER plural
- FORBIDDEN: "you all", "hello everyone", "welcome", "think everyone"
- Reference what was taught: "remember that in class we saw...", "as you learned in step X..."
- Direct and clear
- 2-6 sentences normally

RULE 4 — STRICT FIDELITY:
- Don't invent facts, dates, characteristics not in the sources
- Preserve modality of the source

Respond ONLY with valid JSON:
{
  "answer": "Your answer using what was taught and the material",
  "sourceUsed": "taught_steps | primary_blocks | context_blocks | outside_material",
  "confidence": "high | medium | low"
}`;

    const result = await alaiJson({
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.3,
      maxTokens: 1200,
      json: true,
    });

    if (!result?.answer || String(result.answer).trim().length < 5) {
      throw new Error('Respuesta vacía de la IA');
    }

    return NextResponse.json({
      success: true,
      answer: String(result.answer).trim(),
      sourceUsed: result.sourceUsed || 'brief_material',
      confidence: result.confidence || 'medium',
    });

  } catch (e: any) {
    console.error('[session-ask] Error:', e?.message);
    return NextResponse.json(
      { success: false, error: e?.message || 'Error respondiendo la pregunta' },
      { status: 500 }
    );
  }
}
