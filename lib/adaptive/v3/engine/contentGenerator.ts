// ═══════════════════════════════════════════════════════════════
// CONTENT GENERATOR (v3)
// 
// Recibe una orden CONCRETA del motor:
// - microConcept
// - objective (qué hacer)
// - format (multiple_choice, ordering, etc, o 'none')
// - avoidRepeating (qué no volver a mostrar)
// 
// Genera SOLO el contenido y el widget si aplica.
// NO decide pedagogía. Solo escribe.
// ═══════════════════════════════════════════════════════════════

import { alaiRequest, safeParseJson } from '../../../alai'
import { calculateDepth, depthToPromptInstruction } from './contentDepth'
import { formatToInstruction } from './formatSelector'
import { buildTransition, transitionToPromptInstruction, type TransitionContext } from './transitionEngine'
import { buildFormatInstruction, type EvalPreference } from './interactionLibrary'
import type {
  MicroConcept,
  MicroState,
  TeachingObjective,
  SessionState,
} from '../types'

// ═══════════════════════════════════════════════════════════════
// REQUEST Y RESPONSE
// ═══════════════════════════════════════════════════════════════
export interface GenerationRequest {
  micro: MicroConcept
  microState: MicroState
  objective: TeachingObjective
  interactionFormat: string
  sessionState: SessionState
  studentProfile?: any
  avoidRepeating?: string[]
  lastStudentResponse?: any
  evalPreference?: EvalPreference
  // Contexto para transiciones narrativas
  previousObjective?: TeachingObjective
  previousMicro?: MicroConcept
  lastOutcome?: 'correct' | 'partial' | 'incorrect' | null
  isFirstInteraction?: boolean
  isMicroChange?: boolean
  isSessionClosing?: boolean
}

export interface GeneratedContent {
  title?: string
  tutorMessage: string                // Voz del tutor
  blocks: any[]                       // Bloques de contenido
  keyIdea?: string                    // Idea para recordar
  interaction: any | null             // Widget si aplica
  metadata: {
    objective: TeachingObjective
    microId: string
    generatedAt: number
  }
}

// ═══════════════════════════════════════════════════════════════
// FUNCIÓN PRINCIPAL
// ═══════════════════════════════════════════════════════════════
export async function generateContent(request: GenerationRequest): Promise<GeneratedContent> {
  const { micro, microState, objective, interactionFormat, sessionState, studentProfile, avoidRepeating = [] } = request

  const prompt = buildPromptForObjective(request)

  try {
    const result = await alaiRequest(async (client: any, modelFn: any) => {
      const res = await client.chat.completions.create({
        model: modelFn(),
        messages: [
          {
            role: 'system',
            content: 'Eres ALAI, un tutor humano brillante. Recibes una orden PRECISA sobre qué hacer y generas EXACTAMENTE eso. Nunca inventas más. Solo JSON válido.',
          },
          { role: 'user', content: prompt },
        ],
        temperature: 0.4,
        max_tokens: 2000,
      })
      const raw = res?.choices?.[0]?.message?.content || ''
      if (!raw.trim()) throw new Error('Empty content generator response')
      return { text: raw, provider: 'unknown', model: 'unknown' }
    })

    const parsed = safeParseJson(result.text)
    if (!parsed) {
      return buildFallbackContent(request)
    }

    return {
      title: parsed.title || undefined,
      tutorMessage: parsed.tutorMessage || '',
      blocks: Array.isArray(parsed.blocks) ? parsed.blocks : [
        { type: 'text', text: 'Continuemos.' }
      ],
      keyIdea: parsed.keyIdea || undefined,
      interaction: parsed.interaction || null,
      metadata: {
        objective,
        microId: micro.id,
        generatedAt: Date.now(),
      },
    }
  } catch (err: any) {
    console.error('[ContentGenerator]', err.message)
    return buildFallbackContent(request)
  }
}

// ═══════════════════════════════════════════════════════════════
// PROMPT SEGÚN OBJETIVO
// ═══════════════════════════════════════════════════════════════
function buildPromptForObjective(request: GenerationRequest): string {
  const {
    micro, microState, objective, interactionFormat, sessionState,
    studentProfile, avoidRepeating, lastStudentResponse,
    previousObjective, previousMicro, lastOutcome,
    isFirstInteraction, isMicroChange, isSessionClosing,
    evalPreference,
  } = request

  // ─── Calcular profundidad ADECUADA para este micro ───
  const depthGuidance = calculateDepth(micro, microState, objective)
  const depthInstruction = depthToPromptInstruction(depthGuidance, micro)

  // ─── Calcular transición narrativa ───
  const transitionCtx: TransitionContext = {
    currentObjective: objective,
    previousObjective,
    currentMicro: micro,
    previousMicro,
    microState,
    sessionState,
    lastOutcome: lastOutcome || null,
    isFirstInteraction: !!isFirstInteraction,
    isMicroChange: !!isMicroChange,
    isSessionClosing: !!isSessionClosing,
  }
  const transition = buildTransition(transitionCtx)
  const transitionInstruction = transitionToPromptInstruction(transition)

  // ─── Calcular instrucción de formato según preferencia del estudiante ───
  let formatInstructionBlock = '"interaction": null'
  if (interactionFormat === 'auto') {
    const _fmtLib = buildFormatInstruction({
      cognitiveType: micro.cognitiveType,
      difficulty: micro.difficulty,
      preference: evalPreference || 'mix_everything',
      hasFormulas: micro.formulas.length > 0,
      hasProcedures: micro.procedures.length > 0,
      hasExamples: micro.examples.length > 0,
      hasCommonErrors: micro.commonErrors.length > 0,
      formatsAlreadyUsed: (avoidRepeating || [])
        .filter((a: string) => a.startsWith('FORMATO:'))
        .map((a: string) => a.replace('FORMATO: ', '')),
      isFirstQuestion: microState.evidence.answeredCorrectly === 0 && microState.evidence.answeredIncorrectly === 0,
    })
    formatInstructionBlock = `"interaction": {\n` + _fmtLib + `\n"prompt": "pregunta clara basada en el material",\n"data": { "type": "formato elegido según instrucciones", "...campos según schema..." }\n}`
  } else if (interactionFormat !== 'none') {
    formatInstructionBlock = '"interaction": ' + formatToInstruction(interactionFormat as any, micro)
  }


  const carreraContext = studentProfile?.carrera ? `Estudiante de ${studentProfile.carrera}` : ''
  const energyNote = sessionState.studentState.energy === 'frustrated'
    ? '⚠ El estudiante está FRUSTRADO. Sé especialmente claro y motivador.'
    : sessionState.studentState.energy === 'tired'
    ? '⚠ El estudiante está cansado. Sé conciso.'
    : ''

  const avoidNote = avoidRepeating.length > 0
    ? `
═══════════════════════════════════════════════════════════════
⛔ PROHIBIDO REPETIR — YA SE USARON ESTAS PREGUNTAS/CONTENIDOS:
═══════════════════════════════════════════════════════════════
${avoidRepeating.map(a => '- ' + a).join('\n')}

REGLA ABSOLUTA: Tu pregunta debe ser DIFERENTE a todas las de arriba.
Si la pregunta anterior era "¿Cuáles son los pilares de la identidad?"
tu nueva pregunta NO puede ser una variación de eso.
Pregunta algo DIFERENTE sobre el mismo concepto.
Cambia el ÁNGULO de la pregunta.
═══════════════════════════════════════════════════════════════`
    : ''

  // Contexto del micro para el LLM
  const microContext = `
MICROCONCEPTO A TRABAJAR:
Nombre: ${micro.name}
Definición: ${micro.fullDefinition}
Tipo cognitivo: ${micro.cognitiveType}
Dificultad: ${micro.difficulty}/100

Citas del material (usa ESTAS palabras cuando puedas):
${micro.sourceQuotes.map(q => '"' + q + '"').join('\n')}

${micro.examples.length > 0 ? `Ejemplos disponibles:\n${micro.examples.map(e => '- ' + e.scenario + (e.solution ? ' → ' + e.solution : '')).join('\n')}` : ''}

${micro.formulas.length > 0 ? `Fórmulas:\n${micro.formulas.map(f => '- ' + f.expression + ' (' + f.whenToUse + ')').join('\n')}` : ''}

${micro.procedures.length > 0 ? `Procedimientos:\n${micro.procedures.map(p => '- ' + p.name + ': ' + p.steps.map(s => s.description).join(' → ')).join('\n')}` : ''}

${micro.commonErrors.length > 0 ? `Errores comunes:\n${micro.commonErrors.map(e => '- ' + e.description + ' (corrección: ' + e.correction + ')').join('\n')}` : ''}
`

  // Instrucciones específicas por objetivo
  const objectiveInstructions = getInstructionsForObjective(objective, interactionFormat, lastStudentResponse)

  return `${carreraContext ? carreraContext + '\n' : ''}${energyNote ? energyNote + '\n' : ''}
${microContext}

═══════════════════════════════════════════════════════════════
PROFUNDIDAD REQUERIDA (calculada según tipo, dificultad e importancia)
═══════════════════════════════════════════════════════════════
${depthInstruction}

═══════════════════════════════════════════════════════════════
TRANSICIÓN NARRATIVA
═══════════════════════════════════════════════════════════════
${transitionInstruction}

═══════════════════════════════════════════════════════════════
TU ORDEN
═══════════════════════════════════════════════════════════════
Objetivo: ${objective}
Formato: ${interactionFormat}

${objectiveInstructions}
${avoidNote}

═══════════════════════════════════════════════════════════════
REGLAS DE VOZ DEL TUTOR (críticas)
═══════════════════════════════════════════════════════════════

El "tutorMessage" es lo PRIMERO que ve el estudiante. Es tu VOZ como tutor.

🚫 PROHIBIDO:
  ✗ "Estamos a punto de explorar..."
  ✗ "Hola" / "¡Hola!"
  ✗ "Vamos a ver..."
  ✗ "Ahora exploraremos..."
  ✗ "En esta lección aprenderemos..."
  ✗ "Es la primera vez que..."
  ✗ Cualquier apertura que suene a plantilla de curso

✅ CORRECTO (según TRANSICIÓN NARRATIVA):

- Si es "first_ever" (primer micro del estudiante hoy): saluda breve y ve directo.
    "Empezamos con lo básico: ..."
    "Arranquemos. El primer concepto clave es ..."

- Si es "micro_completed" (ya dominó el anterior): celebra y CONECTA con el nuevo.
    "Perfecto, ya tienes claro X. Ahora Y, que se conecta porque..."
    "Bien. Con X sólido, Y va a tener mucho más sentido..."

- Si es "objective_shift" (ya verificó comprensión, ahora aplica):
    "Ya entiendes la idea. Ahora vamos a aplicarla a un caso concreto."
    "Bien, el concepto está claro. Pongámoslo a prueba."

- Si es "continuing" (mismo micro, siguiente turno): CERO fanfarria.
    "Revisemos ..."
    "Otro ángulo: ..."
    "Piensa en esto: ..."

- Si es "session_closing":
    "Excelente sesión. Dominaste ..."
    "Terminamos. Lo que quedó firme: ..."

REGLA MADRE: 1-2 oraciones. Conversacional. Sin adornos. Como te hablaría un profesor 1-a-1.

═══════════════════════════════════════════════════════════════
FORMATO DE RESPUESTA
═══════════════════════════════════════════════════════════════

Devuelve SOLO este JSON:
{
  "title": "Título breve (opcional)",
  "tutorMessage": "Voz del tutor — sigue las REGLAS DE VOZ de abajo, respeta la TRANSICIÓN NARRATIVA. NUNCA uses aperturas prohibidas.",
  "blocks": [
    { "type": "text", "text": "..." },
    { "type": "heading", "text": "...", "level": 2 },
    { "type": "formula", "plain": "...", "explanation": "..." },
    { "type": "example", "description": "...", "solution": "..." },
    { "type": "steps", "steps": [{"label":"1","content":"...","explanation":"..."}] },
    { "type": "callout", "variant": "info|warning|success|insight", "text": "..." },
    { "type": "list", "ordered": true, "items": ["..."] }
  ],
  "keyIdea": "Idea clave para recordar (opcional, 1 oración)",
  ${formatInstructionBlock}
    : '"interaction": ' + formatToInstruction(interactionFormat as any, micro)
  }
}

REGLAS:
- USA información REAL del microconcepto proporcionado arriba
- NO inventes datos que no estén en el material
- Habla como profesor humano, natural y directo
- Respeta la PROFUNDIDAD REQUERIDA (ni más, ni menos)
- Si es "minimal" o "brief": ve directo al grano, sin adornos
- Si es "thorough" o "deep": profundiza con ejemplos, comparaciones, y errores comunes
- Cada bloque debe aportar VALOR PEDAGÓGICO, no relleno`
}

// ═══════════════════════════════════════════════════════════════
// INSTRUCCIONES POR OBJETIVO
// ═══════════════════════════════════════════════════════════════
function getInstructionsForObjective(
  objective: TeachingObjective,
  format: string,
  lastResponse: any,
): string {
  const instructions: Record<TeachingObjective, string> = {
    introduce: `Presenta este microconcepto por PRIMERA VEZ. 
- Explica qué es de forma clara y directa
- Máximo 3 bloques
- Sin pregunta al final (esto es solo presentación)`,

    explain_deeper: `Profundiza en la explicación. El estudiante ya lo vio pero necesita más detalle.
- Añade contexto, matices o aspectos no cubiertos antes
- Sin pregunta al final`,

    illustrate_with_example: `Muestra UN EJEMPLO CONCRETO del microconcepto.
- Usa un caso específico
- Explica paso a paso si aplica
- Termina con la lección clave
- Sin pregunta al final`,

    verify_understanding: `Verifica si el estudiante entendió el microconcepto.

REGLAS IMPORTANTES:
- NO repitas la explicación completa. El estudiante YA LA VIO en la página anterior.
- Máximo 1-2 oraciones de contexto breve, luego LA PREGUNTA.
- La pregunta debe ser respondible con lo que aprendió.
- Si el formato es fill_blank: SIEMPRE incluye un campo "bank" con 4-5 opciones (la correcta + 3-4 distractores). Ejemplo: "bank": ["pasión", "velocidad", "dinero", "suerte"]
- Si el formato es fill_blank: NO pongas la respuesta visible en el texto de contexto arriba de la pregunta.
- La evaluación va SEPARADA de la enseñanza. Aquí solo evalúas.`,

    test_application: `Prueba que el estudiante puede APLICAR el microconcepto a un caso.
- Presenta un caso o problema
- Pide que el estudiante lo resuelva usando el concepto
- La pregunta debe requerir APLICACIÓN, no solo memoria`,

    test_transfer: `Prueba que el estudiante puede TRANSFERIR el concepto a un contexto NUEVO.
- Presenta una situación diferente a las que ya se vieron
- La pregunta debe requerir aplicar el concepto en contexto no familiar`,

    consolidate: `CIERRE del microconcepto. El estudiante ya lo dominó.
- Resumen breve de lo aprendido
- Menciona qué puede hacer ahora con este conocimiento
- Sin pregunta al final`,

    reveal_answer: `El estudiante FALLÓ una pregunta. REVELA la respuesta correcta y EXPLÍCALA.
- Muestra claramente cuál era la respuesta correcta
- Explica POR QUÉ es correcta usando el material
- Sin pregunta al final
${lastResponse ? '- El estudiante respondió: ' + JSON.stringify(lastResponse) : ''}`,

    reconstruct_from_error: `El estudiante falló DOS veces. RECONSTRUYE el microconcepto desde OTRO ÁNGULO.
- NO repitas la explicación anterior
- Usa una analogía, ejemplo diferente, o enfoque distinto
- El objetivo es que ahora sí entienda
- Sin pregunta al final`,

    connect_to_previous: `Conecta este microconcepto con otros ya aprendidos.
- Muestra cómo se relaciona
- Sin pregunta al final`,

    recall_check: `Verifica que el estudiante RECUERDA el microconcepto después de tiempo.
- Pregunta breve para verificar retención`,
  }

  return instructions[objective] || instructions.verify_understanding
}

// ═══════════════════════════════════════════════════════════════
// SCHEMA DE INTERACCIÓN SEGÚN FORMATO
// ═══════════════════════════════════════════════════════════════
function getInteractionSchema(format: string): string {
  const schemas: Record<string, string> = {
    multiple_choice: `"interaction": {
    "interactionType": "multiple_choice",
    "prompt": "Pregunta clara",
    "data": {
      "type": "multiple_choice",
      "options": ["opción A", "opción B", "opción C", "opción D"],
      "correctIndex": 0,
      "explanation": "Por qué es correcta"
    }
  }`,
    true_false: `"interaction": {
    "interactionType": "true_false",
    "prompt": "Afirmación a evaluar",
    "data": {
      "type": "true_false",
      "statement": "El afirmación exacta",
      "correctAnswer": true,
      "explanation": "Por qué"
    }
  }`,
    fill_blank: `"interaction": {
    "interactionType": "fill_blank",
    "prompt": "Completa el espacio",
    "data": {
      "type": "fill_blank",
      "template": "Los Falcons fueron fundados en ____",
      "correctAnswers": ["1965"]
    }
  }`,
    matching: `"interaction": {
    "interactionType": "matching",
    "prompt": "Relaciona cada elemento con su descripción",
    "data": {
      "type": "matching",
      "pairs": [
        {"left": "Elemento 1", "right": "Descripción 1"},
        {"left": "Elemento 2", "right": "Descripción 2"},
        {"left": "Elemento 3", "right": "Descripción 3"}
      ]
    }
  }`,
    ordering: `"interaction": {
    "interactionType": "ordering",
    "prompt": "Ordena estos elementos correctamente",
    "data": {
      "type": "ordering",
      "items": ["Item A", "Item B", "Item C"],
      "correctOrder": [0, 1, 2]
    }
  }`,
    open_response: `"interaction": {
    "interactionType": "open_response",
    "prompt": "Pregunta abierta",
    "data": {
      "type": "open_response",
      "acceptedAnswers": ["palabras clave que deberían aparecer"]
    }
  }`,
    step_by_step_solver: `"interaction": {
    "interactionType": "step_by_step_solver",
    "prompt": "Resuelve paso a paso",
    "data": {
      "type": "step_by_step_solver",
      "problem": "El problema a resolver",
      "expectedSteps": ["paso 1", "paso 2", "paso 3"],
      "finalAnswer": "respuesta esperada"
    }
  }`,
    practical_case: `"interaction": {
    "interactionType": "practical_case",
    "prompt": "Caso práctico",
    "data": {
      "type": "practical_case",
      "scenario": "Descripción del caso",
      "question": "Qué haría el estudiante",
      "expectedElements": ["elemento 1", "elemento 2"]
    }
  }`,
    classify_groups: `"interaction": {
    "interactionType": "classify_groups",
    "prompt": "Clasifica cada elemento en su grupo",
    "data": {
      "type": "classify_groups",
      "items": ["item1", "item2", "item3", "item4"],
      "groups": ["grupo A", "grupo B"],
      "correctAssignments": {"item1": "grupo A", "item2": "grupo B", "item3": "grupo A", "item4": "grupo B"}
    }
  }`,
  }

  return schemas[format] || schemas.multiple_choice
}

// ═══════════════════════════════════════════════════════════════
// FALLBACK CONTENT (si el LLM falla)
// ═══════════════════════════════════════════════════════════════
function buildFallbackContent(request: GenerationRequest): GeneratedContent {
  const { micro, objective } = request

  return {
    title: micro.name,
    tutorMessage: 'Continuemos aprendiendo.',
    blocks: [
      { type: 'text', text: micro.fullDefinition || micro.shortDescription }
    ],
    keyIdea: micro.shortDescription,
    interaction: null,
    metadata: {
      objective,
      microId: micro.id,
      generatedAt: Date.now(),
    },
  }
}
