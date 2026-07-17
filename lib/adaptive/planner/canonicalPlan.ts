import type { StudyPlan } from './types'
export function isCanonicalStudyPlan(value: unknown): value is StudyPlan {
  return Boolean(value && typeof value === 'object' && Reflect.get(value, 'source') === 'canonical_study_plan_v1' && Array.isArray(Reflect.get(value, 'sessions')))
}
