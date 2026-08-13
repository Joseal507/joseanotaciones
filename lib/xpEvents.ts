import { calcularXpFlashcards, calcularXpQuiz } from './xpSystem';

export type XPAction =
  | 'assignment_completed'
  | 'objective_completed'
  | 'quiz_completed'
  | 'exam_completed'
  | 'flashcards_completed'
  | 'community_post_created'
  | 'daily_streak'
  | 'daily_reward_claimed';

export interface XPEventRequest {
  eventId: string;
  action: XPAction;
  entityType?: string;
  entityId?: string;
  metadata?: Record<string, unknown>;
}

export interface XPEventResult {
  success: boolean;
  applied: boolean;
  eventId: string;
  awardedXP: number;
  totalXP: number;
  nivel: number;
  subioNivel: boolean;
}

const cleanPart = (value: unknown) => String(value ?? '')
  .trim()
  .toLowerCase()
  .replace(/[^a-z0-9:_-]+/g, '-')
  .replace(/^-+|-+$/g, '')
  .slice(0, 160);

export function stableXPContentId(value: unknown): string {
  const input = typeof value === 'string' ? value : JSON.stringify(value);
  let hash = 2166136261;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

export function xpEventId(action: XPAction, entityId: unknown): string {
  const canonicalEntity = cleanPart(entityId);
  if (!canonicalEntity) throw new Error('xp_entity_id_required');
  return `${action}:${canonicalEntity}`;
}

const numberMeta = (metadata: Record<string, unknown>, key: string) => {
  const value = Number(metadata[key]);
  return Number.isFinite(value) ? value : 0;
};

export function resolveServerXPAmount(
  action: XPAction,
  metadata: Record<string, unknown>,
  context: { streak: number; allowedDailyPrizes?: number[] },
): number {
  if (action === 'assignment_completed' || action === 'objective_completed') {
    const size = String(metadata.size || '');
    const values: Record<string, number> = { 'pequeño': 50, mediano: 120, grande: 250 };
    if (!values[size]) throw new Error('xp_invalid_goal_size');
    return values[size];
  }
  if (action === 'quiz_completed' || action === 'exam_completed') {
    const total = Math.max(0, Math.floor(numberMeta(metadata, 'total')));
    const correct = Math.max(0, Math.min(total, Math.floor(numberMeta(metadata, 'correct'))));
    if (total < 1 || total > 200) throw new Error('xp_invalid_quiz_result');
    return calcularXpQuiz({
      preguntasTotales: total,
      correctas: correct,
      nivel: action === 'exam_completed' ? 'dificil' : 'intermedio',
      esRepeticion: false,
      streakQuizzes: 0,
    }).total;
  }
  if (action === 'flashcards_completed') {
    const reviewed = Math.max(0, Math.floor(numberMeta(metadata, 'reviewed')));
    const correct = Math.max(0, Math.min(reviewed, Math.floor(numberMeta(metadata, 'correct'))));
    if (reviewed < 1 || reviewed > 1000) throw new Error('xp_invalid_flashcard_result');
    return calcularXpFlashcards({ tarjetasRevisadas: reviewed, correctas: correct }).total;
  }
  if (action === 'community_post_created') return 15;
  if (action === 'daily_streak') {
    const streak = Math.max(1, Math.floor(context.streak));
    const base = streak >= 30 ? 150 : streak >= 7 ? 50 : streak >= 3 ? 20 : 10;
    const milestone: Record<number, number> = { 3: 30, 7: 75, 14: 100, 30: 200, 60: 350, 100: 500 };
    return base + (milestone[streak] ?? 0);
  }
  if (action === 'daily_reward_claimed') {
    const prize = Math.trunc(numberMeta(metadata, 'prize'));
    if (!context.allowedDailyPrizes?.includes(prize)) throw new Error('xp_invalid_daily_prize');
    return prize;
  }
  throw new Error('xp_action_not_supported');
}

export function xpSourceForAction(action: XPAction): string {
  if (action === 'assignment_completed' || action === 'objective_completed') return 'objetivo';
  if (action === 'quiz_completed' || action === 'exam_completed') return 'quiz';
  if (action === 'flashcards_completed') return 'flashcards';
  if (action === 'community_post_created') return 'post';
  return 'racha';
}
