// Invariantes Plan <-> Session (misión: auditoría de ciclo de vida, sección 12).
// Función pura, read-only — nunca muta el journey ni la sesión. Detecta
// EXPLÍCITAMENTE los casos que antes solo se manifestaban como un crash o un
// "session not found" tardío en loadContext, para poder diagnosticarlos y (cuando
// sea seguro) reconciliarlos antes de mostrarle nada al usuario.
export interface PlanSessionConsistencyIssue {
  chapterNumber: number
  code: 'DUPLICATE_CHAPTER_NUMBER' | 'MISSING_CHAPTER_ID' | 'ORPHAN_SESSION_CONTENT' | 'SESSION_CONTENT_CHAPTER_MISMATCH'
  detail: string
}

export interface PlanSessionConsistencyReport {
  valid: boolean
  issues: PlanSessionConsistencyIssue[]
}

// Verifica, para un journey completo y el sessionContent ya persistido:
//   - cada chapter tiene un id y un chapterNumber únicos y resolubles (nunca dos
//     chapters compartiendo chapterNumber — "Sesión 2 disponible" dejaría de ser
//     ambiguo sobre CUÁL sesión 2);
//   - todo sessionContent[N] persistido corresponde a un chapterNumber que
//     REALMENTE existe en el journey actual (contenido huérfano de una versión
//     de journey anterior, nunca se sirve silenciosamente);
//   - el sessionId embebido en el contenido preparado (classContent.sessionId,
//     que es el chapter.id) coincide con el chapter.id real del chapterNumber
//     correspondiente — detecta plans reconstruidos/regenerados donde los IDs de
//     chapter cambiaron pero el contenido viejo se preservó bajo el mismo número.
export function validatePlanSessionConsistency(params: {
  journey: { chapters?: Array<{ id?: string; chapterNumber?: number }> } | null | undefined
  sessionContent?: Record<string, { sessionId?: string } | undefined> | null
}): PlanSessionConsistencyReport {
  const issues: PlanSessionConsistencyIssue[] = []
  const chapters = params.journey?.chapters || []
  const seenNumbers = new Map<number, string>()

  for (const chapter of chapters) {
    const chapterNumber = Number(chapter.chapterNumber)
    if (!chapter.id) {
      issues.push({ chapterNumber, code: 'MISSING_CHAPTER_ID', detail: `chapter #${chapterNumber} no tiene id — no puede resolverse a un sessionId real` })
    }
    if (seenNumbers.has(chapterNumber)) {
      issues.push({ chapterNumber, code: 'DUPLICATE_CHAPTER_NUMBER', detail: `chapterNumber ${chapterNumber} aparece en más de un chapter (ids: ${seenNumbers.get(chapterNumber)}, ${chapter.id}) — "abrir sesión ${chapterNumber}" sería ambiguo` })
    } else {
      seenNumbers.set(chapterNumber, String(chapter.id))
    }
  }

  const chapterByNumber = new Map(chapters.map(chapter => [Number(chapter.chapterNumber), chapter]))
  for (const [key, content] of Object.entries(params.sessionContent || {})) {
    if (!content) continue
    const chapterNumber = Number(key)
    const chapter = chapterByNumber.get(chapterNumber)
    if (!chapter) {
      issues.push({ chapterNumber, code: 'ORPHAN_SESSION_CONTENT', detail: `sessionContent['${key}'] existe pero ningún chapter del journey actual tiene chapterNumber=${chapterNumber} — contenido de una versión de journey anterior` })
      continue
    }
    if (content.sessionId && chapter.id && content.sessionId !== chapter.id) {
      issues.push({ chapterNumber, code: 'SESSION_CONTENT_CHAPTER_MISMATCH', detail: `sessionContent['${key}'].sessionId=${content.sessionId} no coincide con chapter.id=${chapter.id} del journey actual — el journey fue regenerado sin invalidar el contenido viejo` })
    }
  }

  return { valid: issues.length === 0, issues }
}
