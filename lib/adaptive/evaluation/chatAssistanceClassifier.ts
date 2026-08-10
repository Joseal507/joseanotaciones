// CHAT Y EVIDENCE (crítico): distingue una consulta administrativa/de uso de
// la sesión ("¿cuánto falta de la sesión?", "¿cómo pauso esto?") de una
// consulta con contenido académico real. Heurística GENÉRICA, no ligada a
// ningún dominio/material específico — nunca reconoce vocabulario de una
// materia, solo patrones sobre el USO de la sesión misma.
//
// Diseño deliberadamente CONSERVADOR (AGENTS.md: mantener false mastery = 0):
// si el mensaje no es CLARAMENTE administrativo, se trata como ayuda
// académica real. El default es "cuenta como asistencia", nunca lo
// contrario — un falso positivo aquí (tratar una pregunta administrativa
// como académica) solo cuesta una reevaluación de más; un falso negativo
// (dejar pasar ayuda académica real como si no contara) arriesgaría mastery
// falso, que es el error que este sistema nunca puede cometer.
const ADMINISTRATIVE_PATTERNS: RegExp[] = [
  /cu[aá]nto\s+(falta|queda|tiempo)/i,
  /cu[aá]nta[s]?\s+(preguntas?|pasos?)\s+(falta|quedan|m[aá]s)/i,
  /(en\s+qu[eé]\s+)?paso\s+(voy|estoy)\b/i,
  /c[oó]mo\s+(cierro|salgo|pauso|guardo|contin[uú]o)\s+(la\s+)?sesi[oó]n/i,
  /\bcu[aá]nto\s+(llevo|voy)\b/i,
  /progreso\s+de\s+la\s+sesi[oó]n/i,
  /\b(bug|error de la app|no carga|se cong(e|ó)l|pantalla en blanco)\b/i,
]

export function isAdministrativeQuery(message: string): boolean {
  const trimmed = message.trim()
  if (!trimmed) return true
  return ADMINISTRATIVE_PATTERNS.some(pattern => pattern.test(trimmed))
}
