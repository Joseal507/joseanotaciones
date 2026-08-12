import type { ClassifiableStep } from './visualNeedClassifier'
import { visualNeedCandidates } from './visualNeedClassifier'
import { buildVisualSpec } from './visualSpecBuilder'
import type { VisualCompositionPlan } from './visualContract'

/** Deterministic, bounded composition. Unsupported candidates disappear fail-closed. */
export function buildVisualCompositionPlan(step: ClassifiableStep): VisualCompositionPlan | null {
  const source = `${step.title}\n${step.content}\n${step.keyPoints.join('\n')}`
  const built = visualNeedCandidates(step)
    .map(requirement => {
      const spec = buildVisualSpec(requirement, source, step.sourceStepId)
      return spec ? { requirement, spec } : null
    })
    .filter((entry): entry is NonNullable<typeof entry> => entry !== null)
    .slice(0, 3)
  if (built.length === 0) return null
  return {
    primary: built[0].spec,
    supporting: built.slice(1).map(entry => entry.spec),
    purpose: built.length > 1 ? 'Connect complementary grounded representations' : 'Make the grounded relation explorable',
    complexity: built.length,
  }
}
