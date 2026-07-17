// ═══════════════════════════════════════════════════════════════
// STUDENT PROFILES — 16 perfiles deterministas
// ═══════════════════════════════════════════════════════════════

import type { SimulatedStudentProfile, StudentProfileId } from './types'
import type { StudentProfileSegment } from './types'

export const PROFILE_SEGMENTS: Record<StudentProfileId, StudentProfileSegment> = {
  expert: 'capable', slow_but_correct: 'capable', deep_understanding: 'capable',
  honest_beginner: 'recoverable', assistance_dependent: 'recoverable', forgetful: 'recoverable', dropout_returning: 'recoverable', hint_user: 'recoverable', legacy_student: 'recoverable',
  high_confidence_misconception: 'recoverable', low_confidence_expert: 'recoverable', inconsistent: 'recoverable',
  guesser: 'adversarial', memorizer_no_transfer: 'adversarial', resistant: 'adversarial', reveal_then_recover: 'adversarial',
}

export const ACCEPTANCE_PROFILE_IDS: Record<StudentProfileSegment, StudentProfileId[]> = {
  capable: ['expert', 'deep_understanding', 'slow_but_correct'],
  recoverable: ['high_confidence_misconception', 'low_confidence_expert', 'inconsistent', 'assistance_dependent'],
  adversarial: ['guesser', 'resistant', 'reveal_then_recover', 'memorizer_no_transfer'],
}

export const ACCEPTANCE_PROFILE_NAMES: Partial<Record<StudentProfileId, string>> = {
  expert: 'expert',
  deep_understanding: 'deep_understanding',
  slow_but_correct: 'strong_beginner',
  high_confidence_misconception: 'misconception_prone',
  low_confidence_expert: 'low_confidence',
  inconsistent: 'inconsistent',
  assistance_dependent: 'assistance_dependent',
  guesser: 'random_guesser',
  resistant: 'answer_repeater',
  reveal_then_recover: 'reveal_dependent',
  memorizer_no_transfer: 'memorizer_without_transfer',
}

export const STUDENT_PROFILES: Record<StudentProfileId, SimulatedStudentProfile> = {

  expert: {
    id: 'expert',
    label: 'Experto real',
    baseKnowledgeByType: {
      definitional: 0.92, conceptual: 0.90, procedural: 0.88,
      mathematical: 0.87, causal: 0.89, comparative: 0.91,
      analytical: 0.88, applicative: 0.86,
    },
    defaultBaseKnowledge: 0.90,
    confidenceCalibration: 0.05,
    hintUsageRate: 0.02,
    revealRate: 0.01,
    forgettingRate: 0.002,
    learningRate: 0.95,
    guessRate: 0.01,
    dropoutRate: 0.0,
    responseSpeedMultiplier: 0.5,
    canImprove: true,
  },

  honest_beginner: {
    id: 'honest_beginner',
    label: 'Principiante honesto',
    baseKnowledgeByType: {
      definitional: 0.25, conceptual: 0.20, procedural: 0.18,
      mathematical: 0.15, causal: 0.20, analytical: 0.15,
    },
    defaultBaseKnowledge: 0.20,
    confidenceCalibration: -0.10,
    hintUsageRate: 0.30,
    revealRate: 0.15,
    forgettingRate: 0.05,
    learningRate: 0.40,
    guessRate: 0.10,
    dropoutRate: 0.05,
    responseSpeedMultiplier: 1.5,
    canImprove: true,
  },

  high_confidence_misconception: {
    id: 'high_confidence_misconception',
    label: 'Ilusión de conocimiento',
    baseKnowledgeByType: {
      definitional: 0.45, conceptual: 0.35,
    },
    defaultBaseKnowledge: 0.40,
    confidenceCalibration: 0.45,   // muy overconfident
    hintUsageRate: 0.05,
    revealRate: 0.05,
    forgettingRate: 0.03,
    learningRate: 0.25,            // aprende lento (creencia resistente)
    guessRate: 0.05,
    dropoutRate: 0.10,
    responseSpeedMultiplier: 0.7,
    canImprove: true,
  },

  assistance_dependent: {
    id: 'assistance_dependent',
    label: 'Dependiente de ayuda',
    baseKnowledgeByType: {
      definitional: 0.55, conceptual: 0.40,
    },
    defaultBaseKnowledge: 0.45,
    confidenceCalibration: -0.05,
    hintUsageRate: 0.70,           // siempre pide pista
    revealRate: 0.40,
    forgettingRate: 0.04,
    learningRate: 0.30,
    guessRate: 0.05,
    dropoutRate: 0.05,
    responseSpeedMultiplier: 1.2,
    canImprove: false,             // no mejora sin ayuda
  },

  slow_but_correct: {
    id: 'slow_but_correct',
    label: 'Lento pero competente',
    baseKnowledgeByType: {
      definitional: 0.75, conceptual: 0.72, procedural: 0.70,
    },
    defaultBaseKnowledge: 0.72,
    confidenceCalibration: -0.15,
    hintUsageRate: 0.10,
    revealRate: 0.05,
    forgettingRate: 0.02,
    learningRate: 0.60,
    guessRate: 0.02,
    dropoutRate: 0.0,
    responseSpeedMultiplier: 3.5,  // muy lento
    canImprove: true,
  },

  guesser: {
    id: 'guesser',
    label: 'Adivinador',
    baseKnowledgeByType: {
      definitional: 0.30,
    },
    defaultBaseKnowledge: 0.25,
    confidenceCalibration: 0.20,
    hintUsageRate: 0.05,
    revealRate: 0.10,
    forgettingRate: 0.06,
    learningRate: 0.20,
    guessRate: 0.65,               // adivina mucho en MCQ
    dropoutRate: 0.15,
    responseSpeedMultiplier: 0.4,  // rápido (adivina sin pensar)
    canImprove: false,
  },

  memorizer_no_transfer: {
    id: 'memorizer_no_transfer',
    label: 'Memorizador sin transferencia',
    baseKnowledgeByType: {
      definitional: 0.88, chronological: 0.85, classificatory: 0.82,
      conceptual: 0.45, causal: 0.30, applicative: 0.20,
      analytical: 0.20, procedural: 0.35,
    },
    defaultBaseKnowledge: 0.55,
    confidenceCalibration: 0.10,
    hintUsageRate: 0.08,
    revealRate: 0.05,
    forgettingRate: 0.04,
    learningRate: 0.70,
    guessRate: 0.05,
    dropoutRate: 0.0,
    responseSpeedMultiplier: 0.8,
    canImprove: true,
  },

  deep_understanding: {
    id: 'deep_understanding',
    label: 'Comprensión profunda',
    baseKnowledgeByType: {
      definitional: 0.80, conceptual: 0.88, causal: 0.90,
      analytical: 0.92, applicative: 0.88, procedural: 0.75,
      comparative: 0.85,
    },
    defaultBaseKnowledge: 0.85,
    confidenceCalibration: 0.02,
    hintUsageRate: 0.03,
    revealRate: 0.01,
    forgettingRate: 0.01,
    learningRate: 0.90,
    guessRate: 0.01,
    dropoutRate: 0.0,
    responseSpeedMultiplier: 1.2,  // piensa bien antes de responder
    canImprove: true,
  },

  forgetful: {
    id: 'forgetful',
    label: 'Olvidadizo',
    baseKnowledgeByType: {
      definitional: 0.65, conceptual: 0.60,
    },
    defaultBaseKnowledge: 0.62,
    confidenceCalibration: 0.0,
    hintUsageRate: 0.15,
    revealRate: 0.10,
    forgettingRate: 0.15,          // olvida rápido
    learningRate: 0.55,
    guessRate: 0.08,
    dropoutRate: 0.08,
    responseSpeedMultiplier: 1.0,
    canImprove: true,
  },

  resistant: {
    id: 'resistant',
    label: 'Resistente al aprendizaje',
    baseKnowledgeByType: {
      definitional: 0.25, conceptual: 0.20,
    },
    defaultBaseKnowledge: 0.22,
    confidenceCalibration: 0.30,
    hintUsageRate: 0.10,
    revealRate: 0.20,
    forgettingRate: 0.08,
    learningRate: 0.05,            // mejora mínimamente
    guessRate: 0.20,
    dropoutRate: 0.20,
    responseSpeedMultiplier: 1.0,
    canImprove: false,
  },

  inconsistent: {
    id: 'inconsistent',
    label: 'Inconsistente',
    baseKnowledgeByType: {
      definitional: 0.55,
    },
    defaultBaseKnowledge: 0.50,
    confidenceCalibration: 0.0,
    hintUsageRate: 0.20,
    revealRate: 0.15,
    forgettingRate: 0.05,
    learningRate: 0.40,
    guessRate: 0.25,               // a veces adivina
    dropoutRate: 0.10,
    responseSpeedMultiplier: 1.0,
    canImprove: true,
  },

  dropout_returning: {
    id: 'dropout_returning',
    label: 'Abandono y retorno',
    baseKnowledgeByType: {
      definitional: 0.50,
    },
    defaultBaseKnowledge: 0.48,
    confidenceCalibration: -0.05,
    hintUsageRate: 0.25,
    revealRate: 0.15,
    forgettingRate: 0.12,          // olvida más entre sesiones
    learningRate: 0.45,
    guessRate: 0.10,
    dropoutRate: 0.50,             // abandona muy seguido
    responseSpeedMultiplier: 1.1,
    canImprove: true,
  },

  low_confidence_expert: {
    id: 'low_confidence_expert',
    label: 'Baja autoconfianza',
    baseKnowledgeByType: {
      definitional: 0.83, conceptual: 0.80, procedural: 0.78,
    },
    defaultBaseKnowledge: 0.80,
    confidenceCalibration: -0.40,  // muy underconfident
    hintUsageRate: 0.20,
    revealRate: 0.05,
    forgettingRate: 0.02,
    learningRate: 0.75,
    guessRate: 0.03,
    dropoutRate: 0.05,
    responseSpeedMultiplier: 1.8,
    canImprove: true,
  },

  hint_user: {
    id: 'hint_user',
    label: 'Usuario de pistas',
    baseKnowledgeByType: {
      definitional: 0.60,
    },
    defaultBaseKnowledge: 0.55,
    confidenceCalibration: -0.10,
    hintUsageRate: 0.80,           // casi siempre pide pista
    revealRate: 0.20,
    forgettingRate: 0.04,
    learningRate: 0.45,
    guessRate: 0.05,
    dropoutRate: 0.0,
    responseSpeedMultiplier: 1.3,
    canImprove: true,
  },

  reveal_then_recover: {
    id: 'reveal_then_recover',
    label: 'Reveal y recuperación',
    baseKnowledgeByType: {
      definitional: 0.40,
    },
    defaultBaseKnowledge: 0.38,
    confidenceCalibration: 0.0,
    hintUsageRate: 0.30,
    revealRate: 0.60,              // pide reveal, luego aprende
    forgettingRate: 0.06,
    learningRate: 0.60,            // mejora tras ver la respuesta
    guessRate: 0.10,
    dropoutRate: 0.0,
    responseSpeedMultiplier: 1.0,
    canImprove: true,
  },

  legacy_student: {
    id: 'legacy_student',
    label: 'Datos legacy incompletos',
    baseKnowledgeByType: {
      definitional: 0.65,
    },
    defaultBaseKnowledge: 0.60,
    confidenceCalibration: 0.0,
    hintUsageRate: 0.15,
    revealRate: 0.10,
    forgettingRate: 0.03,
    learningRate: 0.55,
    guessRate: 0.08,
    dropoutRate: 0.05,
    responseSpeedMultiplier: 1.0,
    canImprove: true,
  },
}

export function getProfile(id: StudentProfileId): SimulatedStudentProfile {
  return STUDENT_PROFILES[id]
}

export const ALL_PROFILE_IDS = Object.keys(STUDENT_PROFILES) as StudentProfileId[]
