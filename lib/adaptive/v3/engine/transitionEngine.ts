// ═══════════════════════════════════════════════════════════════
// TRANSITION ENGINE
// 
// Genera puentes narrativos entre páginas para que el tutor
// se sienta como una conversación fluida, no una serie de tarjetas.
// ═══════════════════════════════════════════════════════════════

import type {
  MicroConcept,
  MicroState,
  TeachingObjective,
  SessionState,
} from '../types'

export type TransitionType =
  | 'first_ever'              // Primera página de toda la sesión
  | 'new_micro'               // Cambio de microconcepto
  | 'after_correct'           // Después de responder bien
  | 'after_incorrect'         // Después de fallar
  | 'after_partial'           // Después de respuesta parcial
  | 'theory_to_question'      // De enseñanza a evaluación
  | 'question_to_deeper'      // De pregunta simple a aplicación
  | 'micro_completed'         // Cierre de micro
  | 'session_closing'         // Cierre de sesión
  | 'continuing'              // Continuación natural (sin evento especial)

export interface TransitionContext {
  currentObjective: TeachingObjective
  previousObjective?: TeachingObjective
  currentMicro: MicroConcept
  previousMicro?: MicroConcept
  microState: MicroState
  sessionState: SessionState
  lastOutcome?: 'correct' | 'partial' | 'incorrect' | null
  isFirstInteraction: boolean
  isMicroChange: boolean
  isSessionClosing: boolean
}

export interface Transition {
  type: TransitionType
  tutorMessage: string          // El mensaje que aparece al inicio
  toneNote: string              // Instrucción para el LLM sobre cómo hablar
  shouldMention: string[]       // Cosas específicas que mencionar
}

// ═══════════════════════════════════════════════════════════════
// DETECTAR TIPO DE TRANSICIÓN
// ═══════════════════════════════════════════════════════════════
export function detectTransition(ctx: TransitionContext): TransitionType {
  if (ctx.isSessionClosing) return 'session_closing'

  if (ctx.isFirstInteraction) return 'first_ever'

  // Cambio de micro
  if (ctx.isMicroChange) {
    if (ctx.previousMicro && ctx.previousObjective === 'consolidate') {
      return 'micro_completed'
    }
    return 'new_micro'
  }

  // Después de respuesta
  if (ctx.lastOutcome === 'correct') {
    // De verificación a aplicación
    if (ctx.previousObjective === 'verify_understanding' && ctx.currentObjective === 'test_application') {
      return 'question_to_deeper'
    }
    return 'after_correct'
  }

  if (ctx.lastOutcome === 'incorrect') return 'after_incorrect'
  if (ctx.lastOutcome === 'partial') return 'after_partial'

  // De teoría a pregunta
  if (
    (ctx.previousObjective === 'introduce' || ctx.previousObjective === 'explain_deeper' ||
     ctx.previousObjective === 'illustrate_with_example' || ctx.previousObjective === 'reveal_answer' ||
     ctx.previousObjective === 'reconstruct_from_error') &&
    (ctx.currentObjective === 'verify_understanding' || ctx.currentObjective === 'test_application')
  ) {
    return 'theory_to_question'
  }

  return 'continuing'
}

// ═══════════════════════════════════════════════════════════════
// GENERAR TRANSICIÓN
// ═══════════════════════════════════════════════════════════════
export function buildTransition(ctx: TransitionContext): Transition {
  const type = detectTransition(ctx)

  switch (type) {
    case 'first_ever':
      return {
        type,
        tutorMessage: '',  // El content generator crea el mensaje inicial
        toneNote: 'Es el PRIMER CONTACTO del estudiante con este material. Sé acogedor, breve, y presenta el tema con energía.',
        shouldMention: [`Es la primera vez que ve "${ctx.currentMicro.name}"`],
      }

    case 'new_micro':
      return {
        type,
        tutorMessage: '',
        toneNote: `Estamos ENTRANDO a un nuevo microconcepto: "${ctx.currentMicro.name}". ${ctx.previousMicro ? `El anterior fue "${ctx.previousMicro.name}".` : ''} Conecta ambos naturalmente si tiene sentido.`,
        shouldMention: ctx.previousMicro
          ? [`Puente desde "${ctx.previousMicro.name}" hacia "${ctx.currentMicro.name}"`]
          : [`Presenta "${ctx.currentMicro.name}"`],
      }

    case 'after_correct':
      return {
        type,
        tutorMessage: '',
        toneNote: `El estudiante ACERTÓ la última pregunta. Reconoce el logro brevemente (una línea) y conecta con lo que viene. NO seas efusivo — sé natural. Frases como "Bien, ahora que ya entiendes eso..." o "Correcto. Vamos al siguiente punto..."`,
        shouldMention: ['Reconoce brevemente el acierto', 'Conecta naturalmente con lo siguiente'],
      }

    case 'after_partial':
      return {
        type,
        tutorMessage: '',
        toneNote: `El estudiante respondió PARCIALMENTE. Reconoce lo que estuvo bien y aclara lo que faltó, sin sonar condescendiente. Frases como "Casi. Lo que faltó fue..."`,
        shouldMention: ['Valida lo que estuvo bien', 'Aclara lo que faltó'],
      }

    case 'after_incorrect':
      return {
        type,
        tutorMessage: '',
        toneNote: `El estudiante FALLÓ. No lo trates mal — es normal. Reencuadra amablemente y ofrece la explicación. Frases como "No es exactamente eso — déjame mostrarte por qué..." o "Vamos a verlo diferente".`,
        shouldMention: ['Reencuadra sin juzgar', 'Ofrece nueva perspectiva'],
      }

    case 'theory_to_question':
      return {
        type,
        tutorMessage: '',
        toneNote: `Pasamos de EXPLICAR a PREGUNTAR. Haz la transición natural. Frases como "Ahora te toca a ti", "A ver si te quedó claro:", "Probemos esto:".`,
        shouldMention: ['Anuncia que viene una pregunta'],
      }

    case 'question_to_deeper':
      return {
        type,
        tutorMessage: '',
        toneNote: `El estudiante ya verificó comprensión, ahora vamos a APLICACIÓN. Frases como "Ya entiendes el concepto. Ahora vamos a aplicarlo a un caso real..."`,
        shouldMention: ['Sube el nivel de dificultad', 'De comprensión a aplicación'],
      }

    case 'micro_completed':
      return {
        type,
        tutorMessage: '',
        toneNote: `El estudiante DOMINÓ "${ctx.previousMicro?.name}" y ahora vamos a "${ctx.currentMicro.name}". Celebra brevemente y presenta el siguiente. Frases como "Perfecto, ya dominas X. Ahora vamos a Y, que se relaciona porque..."`,
        shouldMention: [
          `Celebra dominio de "${ctx.previousMicro?.name}"`,
          `Conecta con "${ctx.currentMicro.name}"`,
        ],
      }

    case 'session_closing':
      return {
        type,
        tutorMessage: '',
        toneNote: 'CERRAMOS LA SESIÓN. Celebra el trabajo del estudiante y muestra qué logró. Sé cálido pero conciso.',
        shouldMention: [
          `Micros dominados: ${ctx.sessionState.queue.completedMicroIds.length}/${ctx.sessionState.queue.totalPlanned}`,
          'Celebra el progreso',
        ],
      }

    case 'continuing':
    default:
      return {
        type,
        tutorMessage: '',
        toneNote: 'Continuación natural del flujo. Sin fanfarria — solo lo siguiente que tiene sentido decir.',
        shouldMention: [],
      }
  }
}

// ═══════════════════════════════════════════════════════════════
// INSTRUCCIÓN PARA EL PROMPT DEL LLM
// ═══════════════════════════════════════════════════════════════
export function transitionToPromptInstruction(transition: Transition): string {
  const parts: string[] = []

  parts.push(`TIPO DE TRANSICIÓN: ${transition.type}`)
  parts.push(`TONO: ${transition.toneNote}`)

  if (transition.shouldMention.length > 0) {
    parts.push(`MENCIONA:`)
    for (const mention of transition.shouldMention) {
      parts.push(`- ${mention}`)
    }
  }

  parts.push(`\nEl "tutorMessage" al inicio de la respuesta debe REFLEJAR esta transición naturalmente. No la anuncies literalmente. Sé humano.`)

  return parts.join('\n')
}
