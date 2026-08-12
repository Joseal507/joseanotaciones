import type { VisualGradingResult, VisualInteractionSubmission, VisualSpec } from './visualContract'
import { gradeGraphInteraction } from './engines/graphEngine'
import { gradeStructuredGridInteraction } from './engines/structuredGridEngine'
import { gradeSpatialVectorInteraction } from './engines/spatialVectorEngine'
import { gradeChemistry2DInteraction } from './engines/chemistry2DEngine'
import { gradeCodeExecutionInteraction } from './engines/codeExecutionEngine'
import { gradeTimelineInteraction } from './engines/timelineEngine'
import { gradeUniversalPrimitive } from './engines/universalPrimitiveEngines'

// Grading determinista server-side: recibe el VisualSpec (autoridad del servidor,
// nunca confiado del cliente) y la interacción del estudiante, y despacha al engine
// correspondiente. Ningún engine llama a un LLM — el grading es 100% determinista.
export function gradeVisualInteraction(spec: VisualSpec, submission: VisualInteractionSubmission): VisualGradingResult {
  if (spec.id !== submission.visualSpecId) {
    return { correct: false, score: 0, evidenceKind: 'textual', feedback: 'Spec no coincide.', errorType: 'spec_mismatch' }
  }
  if (spec.engine === 'graph_2d') return gradeGraphInteraction(spec.data, submission.verb as 'select_region', submission.response)
  if (spec.engine === 'structured_grid') return gradeStructuredGridInteraction(spec.data, submission.verb as 'fill_cell', submission.response)
  if (spec.engine === 'spatial_vector') return gradeSpatialVectorInteraction(spec.data, submission.verb as 'place_vector', submission.response)
  if (spec.engine === 'chemistry_2d') return gradeChemistry2DInteraction(spec.data, submission.verb as 'label_structure', submission.response)
  if (spec.engine === 'code_execution') return gradeCodeExecutionInteraction(spec.data, submission.verb as 'predict_output', submission.response)
  if (spec.engine === 'timeline') return gradeTimelineInteraction(spec.data, submission.verb as 'order_sequence', submission.response)
  return gradeUniversalPrimitive(spec.data, submission.verb, submission.response)
}
