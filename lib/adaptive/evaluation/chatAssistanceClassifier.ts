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
//
// AUDITORÍA ADVERSARIAL (post-7a3c3f7, Finding 2 CONFIRMED): la versión
// anterior usaba substring regex abiertos como /cu[aá]nto\s+(falta|queda|tiempo)/
// que coincidían con CUALQUIER "cuánto falta/queda/tiempo", sin importar el
// objeto de la pregunta — "¿cuánto falta para llegar al equilibrio?" y
// "¿cuánto tiempo tarda esta reacción?" (preguntas académicas reales) se
// clasificaban como administrativas, permitiendo que ayuda académica real
// contara como evidencia independiente. Fix: cada patrón de "cantidad/tiempo/
// progreso" ahora EXIGE que el mensaje mencione explícitamente el objeto
// administrativo (la sesión, sus preguntas, sus pasos, "mi progreso") en la
// misma oración — nunca solo la estructura interrogativa "cuánto X" aislada,
// que es indistinguible entre una pregunta de navegación y una de contenido.
const SESSION_OBJECT = /(?:la\s+)?sesi[oó]n\b/
const ADMINISTRATIVE_PATTERNS: RegExp[] = [
  // "cuánto falta/queda/tiempo/llevo/voy ... la sesión" o "la sesión ... cuánto falta" —
  // exige mención EXPLÍCITA de "sesión" en la misma oración, no solo la estructura interrogativa.
  new RegExp(`cu[aá]nto\\s+(falta|queda|tiempo|llevo|voy)\\b[^.?!]*${SESSION_OBJECT.source}`, 'i'),
  new RegExp(`${SESSION_OBJECT.source}[^.?!]*cu[aá]nto\\s+(falta|queda|tiempo|llevo|voy)`, 'i'),
  // "cuántas preguntas quedan/faltan" — se refiere al banco de preguntas de
  // ESTA sesión de evaluación, no a contenido académico (nunca aparece un
  // ejemplo académico real con "preguntas" como objeto en la matriz adversarial).
  /cu[aá]nta[s]?\s+preguntas?\s+(falta|quedan|m[aá]s)/i,
  // "en qué paso voy/estoy" — navegación de la sesión, estructura fija y
  // acotada (distinta de "qué paso sigue en este cálculo", que NO matchea).
  /en\s+qu[eé]\s+paso\s+(voy|estoy)\b/i,
  // "mi progreso" / "progreso de la sesión" — inequívocamente administrativo,
  // ningún ejemplo académico usa "mi progreso" para referirse al contenido.
  /\bmi\s+progreso\b|\bprogreso\s+de\s+la\s+sesi[oó]n\b/i,
  // cómo cierro/salgo/pauso/guardo/continúo LA SESIÓN — exige mención de "sesión".
  /c[oó]mo\s+(cierro|salgo|pauso|guardo|contin[uú]o)\s+(la\s+)?sesi[oó]n/i,
  // reportes de bug de la app — inequívoco, sin relación con contenido académico.
  /\b(bug|error de la app|no carga|se cong(e|ó)l|pantalla en blanco)\b/i,
]

export function isAdministrativeQuery(message: string): boolean {
  const trimmed = message.trim()
  if (!trimmed) return true
  return ADMINISTRATIVE_PATTERNS.some(pattern => pattern.test(trimmed))
}
