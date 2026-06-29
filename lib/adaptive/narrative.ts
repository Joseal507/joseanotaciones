// ═══════════════════════════════════════════════════════════════
// StudyAL — Strategy Narrative
// ALAI no solo decide. Explica por qué.
// Esta capa convierte estrategias técnicas en lenguaje humano.
// ═══════════════════════════════════════════════════════════════

import type { StudyStrategy, StrategyType } from './strategy'
import type { AdaptiveProgram } from './program'
import type { StudentMemory } from './studentMemory'
import { PATTERN_LABELS } from './studentMemory'

// ── Tipos de narrativa ───────────────────────────────────────────

export interface StrategyNarrative {
  // Lo que ALAI dice al crear el programa
  programCreated: {
    headline: string          // Título corto y directo
    explanation: string       // Por qué esta estrategia
    whatToExpect: string[]    // Qué va a pasar
    firstSessionPreview: string
  }

  // Lo que ALAI dice al cambiar el programa
  programUpdated?: {
    changeReason: string
    whatChanged: string
    newDirection: string
  }

  // Lo que ALAI dice al terminar una sesión
  sessionComplete: {
    message: string
    domainMessage: string
    nextSessionPreview: string
  }
}

// ── Generar narrativa según estrategia ───────────────────────────

export function buildStrategyNarrative(
  strategy: StudyStrategy,
  program: AdaptiveProgram,
  memory: StudentMemory | null,
  previousStrategy?: StudyStrategy,
): StrategyNarrative {
  const firstSession = program.sessions[0]
  const totalSessions = program.sessions.length

  // Si hay memoria del estudiante, personalizar
  const patternNote = memory && memory.dominantPattern !== 'unknown' && memory.patternConfidence >= 40
    ? ` Recuerdo que ${PATTERN_LABELS[memory.dominantPattern].toLowerCase()}.`
    : ''

  const programCreated = buildProgramCreatedNarrative(
    strategy,
    totalSessions,
    firstSession?.title || 'primera sesión',
    patternNote,
    memory,
  )

  const programUpdated = previousStrategy
    ? buildProgramUpdatedNarrative(strategy, previousStrategy)
    : undefined

  const nextSession = program.sessions[1] || null
  const sessionComplete = buildSessionCompleteNarrative(
    strategy,
    nextSession?.title || null,
  )

  return { programCreated, programUpdated, sessionComplete }
}

// ── Narrativa de programa creado ─────────────────────────────────

function buildProgramCreatedNarrative(
  strategy: StudyStrategy,
  totalSessions: number,
  firstSessionTitle: string,
  patternNote: string,
  memory: StudentMemory | null,
): StrategyNarrative['programCreated'] {
  const hints = memory?.nextProgramHints || []
  const usedHint = hints.length > 0 && memory && memory.patternConfidence >= 60

  const narratives: Record<StrategyType, StrategyNarrative['programCreated']> = {
    emergency: {
      headline: 'Programa de rescate',
      explanation: `${strategy.why}${patternNote} Diseñé un programa corto de ${totalSessions} sesiones para maximizar lo que puedes aprender antes del examen.`,
      whatToExpect: [
        'Sesiones cortas e intensas (máximo 20 minutos)',
        'Solo los conceptos más importantes',
        'Una simulación antes del examen',
        'Sin relleno innecesario',
      ],
      firstSessionPreview: `Empezamos ahora mismo con "${firstSessionTitle}". No hay tiempo que perder.`,
    },

    forgetting_recovery: {
      headline: 'Recuperación del dominio',
      explanation: `${strategy.why}${patternNote} Antes de avanzar, necesitamos recuperar lo que el tiempo se llevó.`,
      whatToExpect: [
        'Primero recuperamos, luego avanzamos',
        `${totalSessions} sesiones enfocadas en lo que más se olvidó`,
        'Refuerzo intensivo de memoria',
        'Sin material nuevo hasta que lo anterior esté firme',
      ],
      firstSessionPreview: `Comenzamos con "${firstSessionTitle}". El objetivo es que al terminar sientas que recuerdas todo de nuevo.`,
    },

    repair_first: {
      headline: 'Corrección antes de avanzar',
      explanation: `${strategy.why}${patternNote} He diseñado ${totalSessions} sesiones que empiezan por corregir antes de construir.`,
      whatToExpect: [
        'Las primeras sesiones son desafiantes a propósito',
        'ALAI va a cuestionar lo que crees que sabes',
        'Después de la corrección, el avance será más rápido',
        'El objetivo es confianza real, no superficial',
      ],
      firstSessionPreview: `La primera sesión es "${firstSessionTitle}". Puede sorprenderte lo que descubras.`,
    },

    memory_first: {
      headline: usedHint ? 'Programa de memoria intensiva' : 'Tu problema no es comprensión',
      explanation: usedHint
        ? `${strategy.why} Y sé que la repetición funciona bien contigo.${patternNote}`
        : `${strategy.why}${patternNote} Diseñé ${totalSessions} sesiones sin teoría extra: solo anclar lo que ya sabes.`,
      whatToExpect: [
        'Muchas flashcards, poca lectura',
        'Repetición espaciada para que se quede a largo plazo',
        'Comprobaciones frecuentes de memoria',
        'Sin teoría nueva hasta que lo actual esté dominado',
      ],
      firstSessionPreview: `Empezamos con "${firstSessionTitle}". Vamos directo a la memoria.`,
    },

    application_first: {
      headline: 'De teoría a práctica',
      explanation: `${strategy.why}${patternNote} No necesitas más explicaciones. Necesitas usarlo. ${totalSessions} sesiones de práctica real.`,
      whatToExpect: [
        'Preguntas difíciles desde el principio',
        'Situaciones reales, no solo teoría',
        'ALAI te dirá exactamente qué falla y por qué',
        'El objetivo es que puedas aplicarlo bajo presión',
      ],
      firstSessionPreview: `Empezamos directamente con "${firstSessionTitle}". Sin introducción.`,
    },

    consolidation: {
      headline: 'Ya casi estás listo',
      explanation: `${strategy.why}${patternNote} No necesitas más contenido. Necesitas confirmar que lo que sabes es sólido. ${totalSessions} sesiones de consolidación.`,
      whatToExpect: [
        'Simulaciones para verificar el dominio real',
        'Reparación solo si aparecen debilidades',
        'Sesiones más cortas porque el trabajo pesado ya está hecho',
        'Foco en confianza y estabilidad',
      ],
      firstSessionPreview: `Comenzamos con "${firstSessionTitle}". El objetivo es confirmar, no aprender cosas nuevas.`,
    },

    understanding_first: {
      headline: 'Construimos desde la base',
      explanation: `${strategy.why}${patternNote} He diseñado ${totalSessions} sesiones en el orden pedagógico correcto: primero entender, luego recordar, luego aplicar.`,
      whatToExpect: [
        'Las primeras sesiones son de comprensión profunda',
        'Después pasamos a memoria y práctica',
        'Cada sesión prepara la siguiente',
        'El programa se ajustará según cómo vayas',
      ],
      firstSessionPreview: `Empezamos con "${firstSessionTitle}". La comprensión es la base de todo.`,
    },
  }

  return narratives[strategy.type] || narratives.understanding_first
}

// ── Narrativa de programa actualizado ────────────────────────────

function buildProgramUpdatedNarrative(
  newStrategy: StudyStrategy,
  oldStrategy: StudyStrategy,
): StrategyNarrative['programUpdated'] {
  if (newStrategy.type === oldStrategy.type) {
    return {
      changeReason: 'Ajusté el programa según tu progreso.',
      whatChanged: 'Reordenicé algunas sesiones para que sean más efectivas.',
      newDirection: 'El plan sigue siendo el mismo, pero optimizado.',
    }
  }

  const changes: Record<string, StrategyNarrative['programUpdated']> = {
    // De comprensión a memoria
    'understanding_first→memory_first': {
      changeReason: 'Detecté que ya entiendes el material pero no lo estás reteniendo.',
      whatChanged: 'Eliminé las sesiones de teoría extra y prioricé la memoria.',
      newDirection: 'A partir de ahora el foco es anclar lo que ya sabes.',
    },
    // De comprensión a aplicación
    'understanding_first→application_first': {
      changeReason: 'Tu comprensión ya es buena. Es momento de practicar.',
      whatChanged: 'Adelanté las sesiones de práctica y eliminé más teoría.',
      newDirection: 'Ahora vamos a usar lo que sabes en situaciones reales.',
    },
    // A reparación
    'understanding_first→repair_first': {
      changeReason: 'Detecté errores repetidos que necesitan corrección antes de avanzar.',
      whatChanged: 'Agregué sesiones de reparación antes de continuar.',
      newDirection: 'Primero corregimos, luego seguimos.',
    },
    // A consolidación
    'understanding_first→consolidation': {
      changeReason: 'Tu dominio subió más rápido de lo esperado.',
      whatChanged: 'Eliminé sesiones innecesarias y adelanté la consolidación final.',
      newDirection: 'Ya casi estás listo. Solo necesitas confirmar el dominio.',
    },
    // A emergencia
    'understanding_first→emergency': {
      changeReason: 'El examen se acerca. Cambié el plan para maximizar lo más importante.',
      whatChanged: 'El programa ahora es más corto e intenso.',
      newDirection: 'Foco solo en lo esencial antes del examen.',
    },
  }

  const key = `${oldStrategy.type}→${newStrategy.type}`
  return changes[key] || {
    changeReason: `Cambié la estrategia de "${oldStrategy.type}" a "${newStrategy.type}" porque tu situación cambió.`,
    whatChanged: 'El programa fue restructurado.',
    newDirection: newStrategy.why,
  }
}

// ── Narrativa de sesión completada ───────────────────────────────

function buildSessionCompleteNarrative(
  strategy: StudyStrategy,
  nextSessionTitle: string | null,
): StrategyNarrative['sessionComplete'] {
  const messages: Record<StrategyType, string> = {
    emergency: 'Bien hecho. Cada minuto cuenta. Sigamos.',
    forgetting_recovery: 'Estás recuperando el dominio. Se nota el progreso.',
    repair_first: 'La corrección duele un poco, pero es necesaria. Vas bien.',
    memory_first: 'Tu memoria se está fortaleciendo. La repetición funciona.',
    application_first: 'Cada práctica te acerca más al dominio real.',
    consolidation: 'Estás consolidando bien. El trabajo duro ya está hecho.',
    understanding_first: 'Cada sesión construye sobre la anterior. Sigue así.',
  }

  return {
    message: messages[strategy.type] || 'Sesión completada. Buen trabajo.',
    domainMessage: 'Tu dominio real subió con esta sesión.',
    nextSessionPreview: nextSessionTitle
      ? `La próxima sesión es "${nextSessionTitle}".`
      : 'Has completado todas las sesiones del programa.',
  }
}

// ── Generar mensaje de cambio de programa en tiempo real ─────────

export function buildProgramChangeMessage(
  reason: 'domain_gain_low' | 'domain_gain_high' | 'illusion_detected' |
           'forgetting_risk' | 'critical_concepts' | 'target_reached',
  details?: { concepts?: string[]; sessions?: number },
): string {
  const messages: Record<string, string> = {
    domain_gain_low:
      `Agregué una sesión de refuerzo porque esta sesión fue más difícil de lo esperado. ${
        details?.concepts?.length
          ? `Trabajaremos específicamente: ${details.concepts.slice(0, 2).join(' y ')}.`
          : ''
      }`,
    domain_gain_high:
      'Tu progreso fue mejor de lo esperado. Eliminé una sesión de refuerzo porque ya no la necesitas.',
    illusion_detected:
      'Detecté que hay conceptos donde crees que sabes más de lo que realmente dominas. Agregué una sesión para trabajarlo.',
    forgetting_risk:
      `Algunos conceptos están en riesgo de olvidarse. Agregué una sesión de memoria antes de continuar.${
        details?.concepts?.length
          ? ` Foco en: ${details.concepts.slice(0, 2).join(' y ')}.`
          : ''
      }`,
    critical_concepts:
      `Hay conceptos críticos que necesitan atención especial antes de avanzar.`,
    target_reached:
      'Alcanzaste tu objetivo. Agregué una sesión de consolidación para asegurar que el dominio sea estable.',
  }

  return messages[reason] || 'Actualicé tu programa según tu progreso.'
}
