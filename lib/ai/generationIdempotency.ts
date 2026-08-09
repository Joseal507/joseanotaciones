const activeGenerations = new Map<string, Promise<unknown>>()

export function runIdempotentGeneration<T>(
  generationKey: string | undefined,
  generate: () => Promise<T>,
  onDuplicate?: () => void,
): Promise<T> {
  if (!generationKey) return generate()
  const active = activeGenerations.get(generationKey)
  if (active) {
    onDuplicate?.()
    return active as Promise<T>
  }
  const operation = generate()
  activeGenerations.set(generationKey, operation)
  void operation.finally(() => {
    if (activeGenerations.get(generationKey) === operation) {
      activeGenerations.delete(generationKey)
    }
  }).catch(() => undefined)
  return operation
}

