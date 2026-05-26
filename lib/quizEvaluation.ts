import { semanticMatch } from './semanticMatch';

export function evaluateWritten(expected: string[], answer: string) {
  const result = semanticMatch(expected, answer);

  return {
    ...result,
    label:
      result.status === 'correct'
        ? 'CORRECTO'
        : result.status === 'partial'
        ? 'MEDIO CORRECTO'
        : 'INCORRECTO',
    explanation:
      result.status === 'correct'
        ? 'Tu respuesta expresa la misma idea principal.'
        : result.status === 'partial'
        ? `Tu respuesta se acerca, pero falta: ${result.missing.join(', ')}`
        : 'Tu respuesta no coincide lo suficiente con la respuesta esperada.',
  };
}
