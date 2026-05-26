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

// ============================================================
// SISTEMA DE RANGOS (tipo Marvel Rivals)
// ============================================================

export interface Rango {
  id: string;
  nombre: string;
  division: 1 | 2 | 3;
  emoji: string;
  color: string;
  colorSecundario: string;
  marcoGradient: string;
  xpMinimo: number;   // XP total mínimo para este rango
  xpMaximo: number;   // XP total máximo (inicio del siguiente)
  icono: string;      // símbolo del rango
}

// XP por rango (ajustado para que sea alcanzable)
// Bronce:   0     - 2,999
// Plata:    3,000 - 8,999
// Oro:      9,000 - 24,999
// Diamante: 25,000 - 74,999
// Himmy:    75,000+

export const RANGOS: Rango[] = [
  // ── BRONCE ──
  { id: 'bronce_1',   nombre: 'Bronce',   division: 1, emoji: '🥉', color: '#cd7f32', colorSecundario: '#8B4513', marcoGradient: 'linear-gradient(135deg, #cd7f32, #8B4513, #cd7f32)', xpMinimo: 0,     xpMaximo: 999,   icono: '🥉' },
  { id: 'bronce_2',   nombre: 'Bronce',   division: 2, emoji: '🥉', color: '#cd7f32', colorSecundario: '#8B4513', marcoGradient: 'linear-gradient(135deg, #cd7f32, #a0522d, #cd7f32)', xpMinimo: 1000,  xpMaximo: 1999,  icono: '🥉' },
  { id: 'bronce_3',   nombre: 'Bronce',   division: 3, emoji: '🥉', color: '#cd7f32', colorSecundario: '#8B4513', marcoGradient: 'linear-gradient(135deg, #cd7f32, #8B4513, #cd7f32)', xpMinimo: 2000,  xpMaximo: 2999,  icono: '🥉' },
  // ── PLATA ──
  { id: 'plata_1',    nombre: 'Plata',    division: 1, emoji: '🥈', color: '#C0C0C0', colorSecundario: '#808080', marcoGradient: 'linear-gradient(135deg, #e8e8e8, #a0a0a0, #e8e8e8)', xpMinimo: 3000,  xpMaximo: 4999,  icono: '🥈' },
  { id: 'plata_2',    nombre: 'Plata',    division: 2, emoji: '🥈', color: '#C0C0C0', colorSecundario: '#808080', marcoGradient: 'linear-gradient(135deg, #d8d8d8, #909090, #d8d8d8)', xpMinimo: 5000,  xpMaximo: 6999,  icono: '🥈' },
  { id: 'plata_3',    nombre: 'Plata',    division: 3, emoji: '🥈', color: '#C0C0C0', colorSecundario: '#808080', marcoGradient: 'linear-gradient(135deg, #e8e8e8, #b0b0b0, #e8e8e8)', xpMinimo: 7000,  xpMaximo: 8999,  icono: '🥈' },
  // ── ORO ──
  { id: 'oro_1',      nombre: 'Oro',      division: 1, emoji: '🥇', color: '#FFD700', colorSecundario: '#FFA500', marcoGradient: 'linear-gradient(135deg, #FFD700, #FFA500, #FFD700)', xpMinimo: 9000,  xpMaximo: 14999, icono: '🥇' },
  { id: 'oro_2',      nombre: 'Oro',      division: 2, emoji: '🥇', color: '#FFD700', colorSecundario: '#FFA500', marcoGradient: 'linear-gradient(135deg, #FFE55C, #FFB700, #FFE55C)', xpMinimo: 15000, xpMaximo: 19999, icono: '🥇' },
  { id: 'oro_3',      nombre: 'Oro',      division: 3, emoji: '🥇', color: '#FFD700', colorSecundario: '#FFA500', marcoGradient: 'linear-gradient(135deg, #FFD700, #FF8C00, #FFD700)', xpMinimo: 20000, xpMaximo: 24999, icono: '🥇' },
  // ── DIAMANTE ──
  { id: 'diamante_1', nombre: 'Diamante', division: 1, emoji: '💎', color: '#b9f2ff', colorSecundario: '#00bcd4', marcoGradient: 'linear-gradient(135deg, #b9f2ff, #00bcd4, #b9f2ff)', xpMinimo: 25000, xpMaximo: 39999, icono: '💎' },
  { id: 'diamante_2', nombre: 'Diamante', division: 2, emoji: '💎', color: '#b9f2ff', colorSecundario: '#00bcd4', marcoGradient: 'linear-gradient(135deg, #e0f7fa, #0097a7, #e0f7fa)', xpMinimo: 40000, xpMaximo: 59999, icono: '💎' },
  { id: 'diamante_3', nombre: 'Diamante', division: 3, emoji: '💎', color: '#b9f2ff', colorSecundario: '#00bcd4', marcoGradient: 'linear-gradient(135deg, #b9f2ff, #006064, #b9f2ff)', xpMinimo: 60000, xpMaximo: 74999, icono: '💎' },
  // ── HIMMY (el mítico) ──
  { id: 'himmy',      nombre: 'Himmy',    division: 1, emoji: '👑', color: '#f5c842', colorSecundario: '#ff4d6d', marcoGradient: 'linear-gradient(135deg, #f5c842, #ff4d6d, #a78bfa, #f5c842)', xpMinimo: 75000, xpMaximo: Infinity, icono: '👑' },
];

export const getRango = (xpTotal: number): Rango => {
  // Buscar de mayor a menor
  for (let i = RANGOS.length - 1; i >= 0; i--) {
    if (xpTotal >= RANGOS[i].xpMinimo) return RANGOS[i];
  }
  return RANGOS[0];
};

export const getRangoById = (id: string): Rango | undefined => {
  return RANGOS.find(r => r.id === id);
};

export const getProgresoRango = (xpTotal: number): {
  rango: Rango;
  xpEnRango: number;
  xpRangoTotal: number;
  porcentaje: number;
  siguienteRango: Rango | null;
} => {
  const rango = getRango(xpTotal);
  const xpEnRango = xpTotal - rango.xpMinimo;
  const xpRangoTotal = rango.xpMaximo === Infinity ? 999999 : rango.xpMaximo - rango.xpMinimo;
  const porcentaje = rango.xpMaximo === Infinity ? 100 : Math.min(100, Math.round((xpEnRango / xpRangoTotal) * 100));
  const idx = RANGOS.findIndex(r => r.id === rango.id);
  const siguienteRango = idx < RANGOS.length - 1 ? RANGOS[idx + 1] : null;
  return { rango, xpEnRango, xpRangoTotal, porcentaje, siguienteRango };
};

// ============================================================
// SISTEMA DE LOGROS
// ============================================================

export interface Logro {
  id: string;
  nombre: string;
  descripcion: string;
  emoji: string;
  color: string;
  recompensa: string;       // qué desbloquea (descripción)
  recompensaTipo: 'marco' | 'badge' | 'titulo' | 'emoji_perfil';
  recompensaValor: string;  // valor de la recompensa
  condicion: (stats: LogroStats) => boolean;
  secreto?: boolean;
}

export interface LogroStats {
  xpTotal: number;
  flashcardsEstudiadas: number;
  quizzesCompletados: number;
  rachaActual: number;
  mejorRacha: number;
  precision: number;        // 0-100
  materiasCreadas: number;
  postsCreados: number;
  rangoId: string;
}

export const LOGROS: Logro[] = [
  // ── PRIMEROS PASOS ──
  {
    id: 'primera_flashcard',
    nombre: 'Primer Paso',
    descripcion: 'Estudia tu primera flashcard',
    emoji: '🌱',
    color: '#4ade80',
    recompensa: 'Badge "Estudiante Novel"',
    recompensaTipo: 'badge',
    recompensaValor: 'novel',
    condicion: (s) => s.flashcardsEstudiadas >= 1,
  },
  {
    id: 'primer_quiz',
    nombre: 'Primera Prueba',
    descripcion: 'Completa tu primer quiz',
    emoji: '🎯',
    color: '#f5c842',
    recompensa: 'Badge "Quiz Master Jr"',
    recompensaTipo: 'badge',
    recompensaValor: 'quiz_jr',
    condicion: (s) => s.quizzesCompletados >= 1,
  },
  // ── FLASHCARDS ──
  {
    id: 'flashcards_50',
    nombre: 'Estudiante Dedicado',
    descripcion: 'Estudia 50 flashcards',
    emoji: '⚡',
    color: '#fbbf24',
    recompensa: 'Marco "Energía"',
    recompensaTipo: 'marco',
    recompensaValor: 'marco_energia',
    condicion: (s) => s.flashcardsEstudiadas >= 50,
  },
  {
    id: 'flashcards_200',
    nombre: 'Imparable',
    descripcion: 'Estudia 200 flashcards',
    emoji: '🔥',
    color: '#f97316',
    recompensa: 'Marco "Llamas"',
    recompensaTipo: 'marco',
    recompensaValor: 'marco_llamas',
    condicion: (s) => s.flashcardsEstudiadas >= 200,
  },
  {
    id: 'flashcards_500',
    nombre: 'Maestro del Mazo',
    descripcion: 'Estudia 500 flashcards',
    emoji: '🃏',
    color: '#a78bfa',
    recompensa: 'Marco "Maestro"',
    recompensaTipo: 'marco',
    recompensaValor: 'marco_maestro',
    condicion: (s) => s.flashcardsEstudiadas >= 500,
  },
  {
    id: 'flashcards_1000',
    nombre: 'Leyenda de las Cards',
    descripcion: 'Estudia 1000 flashcards',
    emoji: '🏆',
    color: '#FFD700',
    recompensa: 'Marco "Leyenda Dorada"',
    recompensaTipo: 'marco',
    recompensaValor: 'marco_leyenda',
    condicion: (s) => s.flashcardsEstudiadas >= 1000,
  },
  // ── PRECISIÓN ──
  {
    id: 'precision_80',
    nombre: 'Mente Afilada',
    descripcion: 'Mantén 80% de precisión global',
    emoji: '🎯',
    color: '#4ade80',
    recompensa: 'Badge "Sharpshooter"',
    recompensaTipo: 'badge',
    recompensaValor: 'sharpshooter',
    condicion: (s) => s.precision >= 80 && s.flashcardsEstudiadas >= 20,
  },
  {
    id: 'precision_95',
    nombre: 'Casi Perfecto',
    descripcion: 'Mantén 95% de precisión global',
    emoji: '💫',
    color: '#f5c842',
    recompensa: 'Título "Perfeccionista"',
    recompensaTipo: 'titulo',
    recompensaValor: 'Perfeccionista',
    condicion: (s) => s.precision >= 95 && s.flashcardsEstudiadas >= 50,
  },
  // ── RACHA ──
  {
    id: 'racha_7',
    nombre: 'Una Semana',
    descripcion: 'Mantén una racha de 7 días',
    emoji: '📅',
    color: '#38bdf8',
    recompensa: 'Badge "Constante"',
    recompensaTipo: 'badge',
    recompensaValor: 'constante',
    condicion: (s) => s.mejorRacha >= 7,
  },
  {
    id: 'racha_30',
    nombre: 'Un Mes Entero',
    descripcion: 'Mantén una racha de 30 días',
    emoji: '🗓️',
    color: '#f472b6',
    recompensa: 'Marco "Consistencia"',
    recompensaTipo: 'marco',
    recompensaValor: 'marco_consistencia',
    condicion: (s) => s.mejorRacha >= 30,
  },
  {
    id: 'racha_100',
    nombre: 'Cien Días',
    descripcion: 'Mantén una racha de 100 días',
    emoji: '💯',
    color: '#ff4d6d',
    recompensa: 'Marco "Centenario" (exclusivo)',
    recompensaTipo: 'marco',
    recompensaValor: 'marco_centenario',
    condicion: (s) => s.mejorRacha >= 100,
  },
  // ── RANGOS ──
  {
    id: 'llegar_plata',
    nombre: 'Subiendo',
    descripcion: 'Alcanza el rango Plata',
    emoji: '🥈',
    color: '#C0C0C0',
    recompensa: 'Marco "Plata" en perfil',
    recompensaTipo: 'marco',
    recompensaValor: 'marco_plata',
    condicion: (s) => s.xpTotal >= 3000,
  },
  {
    id: 'llegar_oro',
    nombre: 'Brilla con Luz Propia',
    descripcion: 'Alcanza el rango Oro',
    emoji: '🥇',
    color: '#FFD700',
    recompensa: 'Marco "Dorado" animado',
    recompensaTipo: 'marco',
    recompensaValor: 'marco_dorado',
    condicion: (s) => s.xpTotal >= 9000,
  },
  {
    id: 'llegar_diamante',
    nombre: 'Diamante en Bruto',
    descripcion: 'Alcanza el rango Diamante',
    emoji: '💎',
    color: '#b9f2ff',
    recompensa: 'Marco "Diamante" exclusivo',
    recompensaTipo: 'marco',
    recompensaValor: 'marco_diamante',
    condicion: (s) => s.xpTotal >= 25000,
  },
  {
    id: 'llegar_himmy',
    nombre: 'Himmy',
    descripcion: 'Alcanza el rango máximo',
    emoji: '👑',
    color: '#f5c842',
    recompensa: 'Marco "Himmy" animado + Título exclusivo',
    recompensaTipo: 'marco',
    recompensaValor: 'marco_himmy',
    condicion: (s) => s.xpTotal >= 75000,
    secreto: false,
  },
  // ── SECRETOS ──
  {
    id: 'madrugador',
    nombre: '???',
    descripcion: 'Secreto — descúbrelo estudiando',
    emoji: '🌙',
    color: '#6366f1',
    recompensa: 'Emoji de perfil "🌙"',
    recompensaTipo: 'emoji_perfil',
    recompensaValor: '🌙',
    condicion: (s) => s.xpTotal >= 500 && s.rachaActual >= 3,
    secreto: true,
  },
  {
    id: 'polymath',
    nombre: '???',
    descripcion: 'Secreto — descúbrelo estudiando',
    emoji: '🧠',
    color: '#a78bfa',
    recompensa: 'Título "Polímata"',
    recompensaTipo: 'titulo',
    recompensaValor: 'Polímata',
    condicion: (s) => s.materiasCreadas >= 5 && s.flashcardsEstudiadas >= 100,
    secreto: true,
  },
];

export const getLogrosObtenidos = (stats: LogroStats): Logro[] => {
  return LOGROS.filter(l => l.condicion(stats));
};

export const getLogrosNoObtenidos = (stats: LogroStats): Logro[] => {
  return LOGROS.filter(l => !l.condicion(stats));
};

// Marcos disponibles según logros obtenidos
export const MARCOS: Record<string, { gradient: string; nombre: string; animado?: boolean }> = {
  default:           { gradient: 'linear-gradient(135deg, #374151, #1f2937)', nombre: 'Predeterminado' },
  marco_energia:     { gradient: 'linear-gradient(135deg, #fbbf24, #f97316)', nombre: 'Energía' },
  marco_llamas:      { gradient: 'linear-gradient(135deg, #f97316, #dc2626, #f97316)', nombre: 'Llamas', animado: true },
  marco_maestro:     { gradient: 'linear-gradient(135deg, #a78bfa, #7c3aed, #a78bfa)', nombre: 'Maestro' },
  marco_leyenda:     { gradient: 'linear-gradient(135deg, #FFD700, #FF8C00, #FFD700)', nombre: 'Leyenda Dorada', animado: true },
  marco_consistencia:{ gradient: 'linear-gradient(135deg, #38bdf8, #0284c7, #38bdf8)', nombre: 'Consistencia' },
  marco_centenario:  { gradient: 'linear-gradient(135deg, #ff4d6d, #f5c842, #4ade80, #ff4d6d)', nombre: 'Centenario', animado: true },
  marco_plata:       { gradient: 'linear-gradient(135deg, #e8e8e8, #a0a0a0, #e8e8e8)', nombre: 'Plata' },
  marco_dorado:      { gradient: 'linear-gradient(135deg, #FFD700, #FFA500, #FFD700)', nombre: 'Dorado', animado: true },
  marco_diamante:    { gradient: 'linear-gradient(135deg, #b9f2ff, #00bcd4, #b9f2ff)', nombre: 'Diamante', animado: true },
  marco_himmy:       { gradient: 'linear-gradient(135deg, #f5c842, #ff4d6d, #a78bfa, #4ade80, #f5c842)', nombre: 'Himmy', animado: true },
};

// ─── RE-EXPORT desde nivelUtils (fuente única de verdad) ───
export { calcularNivel } from './nivelUtils';
