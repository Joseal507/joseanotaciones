export type TeachingLayoutBlock =
  | { kind: 'paragraph'; text: string }
  | { kind: 'bullets' | 'numbered_steps'; items: string[] }
  | { kind: 'definition' | 'formula' | 'worked_example' | 'callout' | 'warning'; text: string }

/** Strict semantic layout: it never accepts or emits HTML. */
export function buildTeachingLayout(input: { type: string; content: string; keyPoints?: string[] }): TeachingLayoutBlock[] {
  const text = input.content.trim()
  if (!text) return []
  const lines = text.split(/\n+/).map(line => line.trim()).filter(Boolean)
  const enumerated = lines.map(line => line.match(/^\d+[.)]\s+(.+)$/)?.[1]).filter((line): line is string => Boolean(line))
  const bullets = lines.map(line => line.match(/^[-•]\s+(.+)$/)?.[1]).filter((line): line is string => Boolean(line))
  const type = input.type.toLowerCase()
  const primary: TeachingLayoutBlock = enumerated.length >= 2
    ? { kind: 'numbered_steps', items: enumerated }
    : bullets.length >= 2
      ? { kind: 'bullets', items: bullets }
      : type === 'formula'
        ? { kind: 'formula', text }
        : type === 'example'
          ? { kind: 'worked_example', text }
          : /error com[uú]n|evita|advertencia/i.test(text)
            ? { kind: 'warning', text }
            : /se define como|definici[oó]n/i.test(text)
              ? { kind: 'definition', text }
              : { kind: 'paragraph', text }
  const keyPoints = (input.keyPoints || []).filter(Boolean)
  return keyPoints.length > 1 ? [primary, { kind: 'callout', text: keyPoints.join(' · ') }] : [primary]
}
