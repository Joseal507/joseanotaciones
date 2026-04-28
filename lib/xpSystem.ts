// ============================================================
// STUDYAL XP SYSTEM - Sistema centralizado de XP y niveles
// ============================================================

// ── CONSTANTES (fácil de ajustar) ──
export const XP_CONFIG = {
  // Quizzes
  QUIZ: {
    SHORT_EASY: 20,
    SHORT_MEDIUM: 35,
    SHORT_HARD: 50,
    LONG_EASY: 45,
    LONG_MEDIUM: 70,
    LONG_HARD: 100,
    BONUS_80_PERCENT: 10,
    BONUS_100_PERCENT: 20,
    STREAK_BONUS: 5,
    STREAK_MAX: 25,
    REPEAT_PENALTY: 0.5, // 50% XP en repetición
    SHORT_THRESHOLD: 14,  // ≤14 preguntas = corto
  },

  // Flashcards
  FLASHCARD: {
    XP_PER_CARD: 2,
    XP_PER_CARD_AFTER_50: 1, // diminishing returns
    ACCURACY_BONUS: 10,      // si >85% accuracy
    ACCURACY_THRESHOLD: 85,
    DIMINISHING_AFTER: 50,
  },

  // Posts comunidad
  POST: {
    CREATE: 15,
    LIKE_XP: 2,
    LIKE_CAP: 50,
    COMMENT_XP: 5,
    COMMENT_CAP: 50,
    MIN_ENGAGEMENT_TIME_HOURS: 24, // esperar 24h para dar XP de engagement
    COOLDOWN_HOURS: 4,            // mínimo entre posts con XP
  },

  // Objetivos
  GOALS: {
    SMALL: 50,
    MEDIUM: 120,
    LARGE: 250,
  },

  // Timer Pomodoro
  TIMER: {
    XP_PER_MINUTE: 1,        // 1 XP por minuto estudiado
    BONUS_25_MIN: 10,        // bonus al completar sesión 25min
    BONUS_50_MIN: 25,        // bonus al completar sesión 50min
    MAX_XP_PER_SESSION: 60,  // máximo por sesión
  },

  // Bonos diarios
  DAILY: {
    LOGIN: 10,
    STREAK_3: 20,
    STREAK_7: 50,
    STREAK_30: 150,
  },

  // Niveles
  LEVEL: {
    XP_BASE: 100,
    EXPONENT: 1.5,
    MAX_LEVEL: 100,
  },
};

// ============================================================
// SISTEMA DE NIVELES
// ============================================================

/**
 * XP necesario para llegar al nivel N
 * Fórmula: 100 * (level ^ 1.5)
 * Nivel 100 requiere ~100,000 XP total
 */
export const getXpForLevel = (level: number): number => {
  return Math.floor(
    XP_CONFIG.LEVEL.XP_BASE * Math.pow(level, XP_CONFIG.LEVEL.EXPONENT)
  );
};

/**
 * XP total acumulado para llegar al nivel N (sumando todos los niveles anteriores)
 */
export const getTotalXpForLevel = (level: number): number => {
  let total = 0;
  for (let i = 1; i < level; i++) {
    total += getXpForLevel(i);
  }
  return total;
};

/**
 * Nivel actual basado en XP total
 */
export const getLevelFromXp = (totalXp: number): number => {
  let level = 1;
  let xpNeeded = 0;

  while (level < XP_CONFIG.LEVEL.MAX_LEVEL) {
    xpNeeded += getXpForLevel(level);
    if (totalXp < xpNeeded) break;
    level++;
  }

  return Math.min(level, XP_CONFIG.LEVEL.MAX_LEVEL);
};

/**
 * XP dentro del nivel actual (para la barra de progreso)
 */
export const getXpInCurrentLevel = (totalXp: number): number => {
  const level = getLevelFromXp(totalXp);
  const xpForPreviousLevels = getTotalXpForLevel(level);
  return totalXp - xpForPreviousLevels;
};

/**
 * XP necesario para subir al siguiente nivel
 */
export const getXpNeededForNextLevel = (totalXp: number): number => {
  const level = getLevelFromXp(totalXp);
  return getXpForLevel(level);
};

/**
 * Porcentaje de progreso al siguiente nivel (0-100)
 */
export const getLevelProgress = (totalXp: number): number => {
  const current = getXpInCurrentLevel(totalXp);
  const needed = getXpNeededForNextLevel(totalXp);
  return Math.min(Math.round((current / needed) * 100), 100);
};

/**
 * Título según nivel
 */
export const getLevelTitle = (level: number): { titulo: string; color: string; emoji: string } => {
  if (level >= 100) return { titulo: 'Leyenda', color: '#ff6b35', emoji: '🔱' };
  if (level >= 90)  return { titulo: 'Gran Maestro', color: '#ff4d4d', emoji: '👑' };
  if (level >= 80)  return { titulo: 'Maestro', color: '#a855f7', emoji: '💜' };
  if (level >= 70)  return { titulo: 'Experto', color: '#6366f1', emoji: '⚡' };
  if (level >= 60)  return { titulo: 'Avanzado', color: '#3b82f6', emoji: '🔵' };
  if (level >= 50)  return { titulo: 'Competente', color: '#06b6d4', emoji: '💎' };
  if (level >= 40)  return { titulo: 'Intermedio', color: '#10b981', emoji: '🟢' };
  if (level >= 30)  return { titulo: 'Aprendiz', color: '#84cc16', emoji: '🌱' };
  if (level >= 20)  return { titulo: 'Estudiante', color: '#f5c842', emoji: '⭐' };
  if (level >= 10)  return { titulo: 'Novato', color: '#f97316', emoji: '🔥' };
  return              { titulo: 'Principiante', color: '#9ca3af', emoji: '📚' };
};

// ============================================================
// CÁLCULO DE XP POR ACTIVIDAD
// ============================================================

// ── QUIZZES ──
export interface QuizXpParams {
  preguntasTotales: number;
  correctas: number;
  nivel: 'facil' | 'intermedio' | 'dificil';
  esRepeticion?: boolean;
  streakQuizzes?: number; // cuántos quizzes consecutivos ha hecho
}

export const calcularXpQuiz = (params: QuizXpParams): {
  base: number;
  bonus: number;
  streakBonus: number;
  total: number;
  desglose: string[];
} => {
  const { preguntasTotales, correctas, nivel, esRepeticion, streakQuizzes = 0 } = params;
  const esLargo = preguntasTotales > XP_CONFIG.QUIZ.SHORT_THRESHOLD;
  const precision = preguntasTotales > 0 ? (correctas / preguntasTotales) * 100 : 0;
  const desglose: string[] = [];

  // XP base según tamaño y dificultad
  let base = 0;
  if (!esLargo) {
    if (nivel === 'facil') base = XP_CONFIG.QUIZ.SHORT_EASY;
    else if (nivel === 'intermedio') base = XP_CONFIG.QUIZ.SHORT_MEDIUM;
    else base = XP_CONFIG.QUIZ.SHORT_HARD;
  } else {
    if (nivel === 'facil') base = XP_CONFIG.QUIZ.LONG_EASY;
    else if (nivel === 'intermedio') base = XP_CONFIG.QUIZ.LONG_MEDIUM;
    else base = XP_CONFIG.QUIZ.LONG_HARD;
  }

  desglose.push(`Base ${nivel} ${esLargo ? 'largo' : 'corto'}: +${base} XP`);

  // Penalización por repetición
  if (esRepeticion) {
    base = Math.floor(base * XP_CONFIG.QUIZ.REPEAT_PENALTY);
    desglose.push(`Repetición: -50% = ${base} XP`);
  }

  // Bonus por precisión
  let bonus = 0;
  if (precision === 100) {
    bonus = XP_CONFIG.QUIZ.BONUS_100_PERCENT;
    desglose.push(`¡Perfecto! 100%: +${bonus} XP`);
  } else if (precision >= 80) {
    bonus = XP_CONFIG.QUIZ.BONUS_80_PERCENT;
    desglose.push(`Más de 80%: +${bonus} XP`);
  }

  // Streak bonus
  const streakBonus = Math.min(
    streakQuizzes * XP_CONFIG.QUIZ.STREAK_BONUS,
    XP_CONFIG.QUIZ.STREAK_MAX
  );
  if (streakBonus > 0) {
    desglose.push(`Racha x${streakQuizzes}: +${streakBonus} XP`);
  }

  const total = base + bonus + streakBonus;

  return { base, bonus, streakBonus, total, desglose };
};

// ── FLASHCARDS ──
export interface FlashcardXpParams {
  tarjetasRevisadas: number;
  correctas: number;
}

export const calcularXpFlashcards = (params: FlashcardXpParams): {
  base: number;
  accuracyBonus: number;
  total: number;
  desglose: string[];
} => {
  const { tarjetasRevisadas, correctas } = params;
  const desglose: string[] = [];

  // XP base con diminishing returns después de 50 tarjetas
  let base = 0;
  const normalCards = Math.min(tarjetasRevisadas, XP_CONFIG.FLASHCARD.DIMINISHING_AFTER);
  const extraCards = Math.max(0, tarjetasRevisadas - XP_CONFIG.FLASHCARD.DIMINISHING_AFTER);

  base += normalCards * XP_CONFIG.FLASHCARD.XP_PER_CARD;
  base += extraCards * XP_CONFIG.FLASHCARD.XP_PER_CARD_AFTER_50;

  desglose.push(`${normalCards} tarjetas × ${XP_CONFIG.FLASHCARD.XP_PER_CARD} XP: +${normalCards * XP_CONFIG.FLASHCARD.XP_PER_CARD} XP`);
  if (extraCards > 0) {
    desglose.push(`${extraCards} tarjetas extra × ${XP_CONFIG.FLASHCARD.XP_PER_CARD_AFTER_50} XP: +${extraCards * XP_CONFIG.FLASHCARD.XP_PER_CARD_AFTER_50} XP`);
  }

  // Bonus de precisión
  const precision = tarjetasRevisadas > 0 ? (correctas / tarjetasRevisadas) * 100 : 0;
  let accuracyBonus = 0;
  if (precision >= XP_CONFIG.FLASHCARD.ACCURACY_THRESHOLD) {
    accuracyBonus = XP_CONFIG.FLASHCARD.ACCURACY_BONUS;
    desglose.push(`Precisión ${Math.round(precision)}%: +${accuracyBonus} XP`);
  }

  const total = base + accuracyBonus;
  return { base, accuracyBonus, total, desglose };
};

// ── POSTS ──
export const calcularXpPost = (params: {
  likes: number;
  comentarios: number;
  horasDesdePublicacion: number;
}): { total: number; desglose: string[] } => {
  const { likes, comentarios, horasDesdePublicacion } = params;
  const desglose: string[] = [];

  if (horasDesdePublicacion < XP_CONFIG.POST.MIN_ENGAGEMENT_TIME_HOURS) {
    return { total: 0, desglose: ['Esperando engagement...'] };
  }

  const likeXp = Math.min(likes * XP_CONFIG.POST.LIKE_XP, XP_CONFIG.POST.LIKE_CAP);
  const commentXp = Math.min(comentarios * XP_CONFIG.POST.COMMENT_XP, XP_CONFIG.POST.COMMENT_CAP);

  if (likeXp > 0) desglose.push(`${likes} likes: +${likeXp} XP`);
  if (commentXp > 0) desglose.push(`${comentarios} comentarios: +${commentXp} XP`);

  return { total: likeXp + commentXp, desglose };
};

// ── OBJETIVOS ──
export const calcularXpObjetivo = (
  tamaño: 'pequeño' | 'mediano' | 'grande'
): number => {
  if (tamaño === 'pequeño') return XP_CONFIG.GOALS.SMALL;
  if (tamaño === 'mediano') return XP_CONFIG.GOALS.MEDIUM;
  return XP_CONFIG.GOALS.LARGE;
};

// ── BONOS DIARIOS ──
export const calcularXpDiario = (params: {
  login: boolean;
  rachaActual: number;
}): { total: number; desglose: string[] } => {
  const { login, rachaActual } = params;
  const desglose: string[] = [];
  let total = 0;

  if (login) {
    total += XP_CONFIG.DAILY.LOGIN;
    desglose.push(`Login diario: +${XP_CONFIG.DAILY.LOGIN} XP`);
  }

  if (rachaActual >= 30) {
    total += XP_CONFIG.DAILY.STREAK_30;
    desglose.push(`Racha 30 días: +${XP_CONFIG.DAILY.STREAK_30} XP`);
  } else if (rachaActual >= 7) {
    total += XP_CONFIG.DAILY.STREAK_7;
    desglose.push(`Racha 7 días: +${XP_CONFIG.DAILY.STREAK_7} XP`);
  } else if (rachaActual >= 3) {
    total += XP_CONFIG.DAILY.STREAK_3;
    desglose.push(`Racha 3 días: +${XP_CONFIG.DAILY.STREAK_3} XP`);
  }

  return { total, desglose };
};
