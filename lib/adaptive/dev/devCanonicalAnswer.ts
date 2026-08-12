import type { CanonicalQuestion, CanonicalUserAnswer } from '../evaluation/questionContract'
import type { VisualInteractionVerb, VisualSpec } from '../visual/visualContract'

// Herramienta DEV-ONLY (ver lib/dev/devTools.ts) para recorrer sesiones rápido en
// QA/UX sin responder manualmente decenas de preguntas. Construye la respuesta
// CANÓNICA correcta en el MISMO formato/shape que produciría la interacción real
// del estudiante para cada tipo de pregunta — NUNCA marca correct=true
// directamente ni toca mastery/evidence aquí: el valor que devuelve esta función
// se envía por el pipeline real (session-check -> scoring.ts ->
// recordAssessmentEvidence), exactamente como cualquier respuesta real tecleada
// por un estudiante. Un formato no cubierto lanza en vez de degradar
// silenciosamente a una respuesta adivinada.
export function buildDevCanonicalAnswer(question: CanonicalQuestion): CanonicalUserAnswer {
  switch (question.format) {
    case 'multiple_choice':
    case 'scenario':
    case 'find_the_error':
      return question.correctAnswer
    case 'multi_select':
      return [...question.correctAnswer]
    case 'true_false':
      return question.correctAnswer
    case 'word_bank':
    case 'ordering':
      return [...question.correctAnswer]
    case 'matching':
    case 'classify':
      return { ...question.correctAnswer }
    case 'numeric_problem': {
      const { value, unit } = question.correctAnswer
      return unit ? `${value} ${unit}` : String(value)
    }
    case 'short_response':
      return question.correctAnswer
    default: {
      const exhaustive: never = question
      throw new Error(`DEV_CANONICAL_ANSWER_UNSUPPORTED_FORMAT:${(exhaustive as CanonicalQuestion).format}`)
    }
  }
}

// Contraparte para checkpoints visuales (required_for_mastery incluido): construye
// (verb, response) leyendo la solución estructurada YA presente en el VisualSpec
// (el mismo dato que gradeVisualInteraction usa como autoridad server-side) —
// nunca "marca aprobado", envía la solución real por el mismo endpoint
// determinista /api/adaptive/visual-check que usaría la interacción real.
export function buildDevCanonicalVisualResponse(spec: VisualSpec): { verb: VisualInteractionVerb; response: unknown } {
  switch (spec.engine) {
    case 'graph_2d': {
      const point = spec.data.points[0] ?? { x: (spec.data.domain[0] + spec.data.domain[1]) / 2, y: 0 }
      return { verb: 'select_region', response: { x: point.x, y: point.y } }
    }
    case 'structured_grid':
      return {
        verb: 'fill_cell',
        response: Object.fromEntries(spec.data.species.map(id => [id, String(spec.data.equilibrium[id] ?? '')])),
      }
    case 'spatial_vector':
      return {
        verb: 'place_vector',
        response: Object.fromEntries(spec.data.forces.map(force => [
          force.id,
          { angleDeg: force.angleDeg, ...(force.magnitude !== null ? { magnitude: force.magnitude } : {}) },
        ])),
      }
    case 'chemistry_2d':
      return {
        verb: 'label_structure',
        response: Object.fromEntries(spec.data.atoms.map(atom => [atom.id, atom.element])),
      }
    case 'code_execution': {
      const step = spec.data.steps.find(candidate => candidate.output !== undefined) ?? spec.data.steps[0]
      const variable = step?.output !== undefined ? 'output' : Object.keys(step?.variables || {})[0]
      const value = variable === 'output' ? step?.output : step?.variables?.[variable || '']
      return { verb: 'predict_output', response: { line: step?.line, variable, value: value !== undefined ? String(value) : '' } }
    }
    case 'timeline':
      return {
        verb: 'order_sequence',
        response: [...spec.data.events].sort((a, b) => a.order - b.order).map(event => event.id),
      }
    case 'geometry_canvas':
      return { verb: 'select_point', response: spec.data.points[0]?.id }
    case 'structure_graph':
      return { verb: 'select_node', response: spec.data.nodes[0]?.id }
    case 'flow_state':
      return { verb: 'select_stage', response: spec.data.stages[0]?.id }
    case 'equation_expression':
      return { verb: 'transform_expression', response: spec.data.steps.at(-1)?.expression }
    case 'source_image':
      return { verb: 'select_hotspot', response: spec.data.hotspots[0]?.id }
    default: {
      const exhaustive: never = spec
      throw new Error(`DEV_CANONICAL_VISUAL_RESPONSE_UNSUPPORTED_ENGINE:${(exhaustive as VisualSpec).engine}`)
    }
  }
}
