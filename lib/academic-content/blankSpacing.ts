const spacedScript = /[\p{Script=Latin}\p{Script=Greek}\p{Script=Cyrillic}\p{N}]/u
const leadingPunctuation = /^[\p{P}]/u

const lastCharacter = (value: string): string => Array.from(value.trimEnd()).at(-1) ?? ''
const firstCharacter = (value: string): string => Array.from(value.trimStart())[0] ?? ''

export interface BlankSpacing {
  before: string
  after: string
}

export function semanticBlankSpacing(previous: string, answer: string, next: string): BlankSpacing {
  const previousEndsWithSpace = /\s$/u.test(previous)
  const nextStartsWithSpace = /^\s/u.test(next)
  const before = !previousEndsWithSpace &&
    spacedScript.test(lastCharacter(previous)) &&
    spacedScript.test(firstCharacter(answer))
    ? ' '
    : ''
  const after = !nextStartsWithSpace &&
    !leadingPunctuation.test(next.trimStart()) &&
    spacedScript.test(lastCharacter(answer)) &&
    spacedScript.test(firstCharacter(next))
    ? ' '
    : ''
  return { before, after }
}
