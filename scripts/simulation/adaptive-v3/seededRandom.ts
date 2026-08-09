// ═══════════════════════════════════════════════════════════════
// SEEDED RANDOM — PRNG determinista (Mulberry32)
// Misma seed produce exactamente el mismo recorrido.
// ═══════════════════════════════════════════════════════════════

export class SeededRandom {
  private state: number

  constructor(seed: number) {
    this.state = seed >>> 0
  }

  /** Devuelve float uniforme [0, 1) */
  next(): number {
    this.state |= 0
    this.state = this.state + 0x6d2b79f5 | 0
    let t = Math.imul(this.state ^ this.state >>> 15, 1 | this.state)
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t
    return ((t ^ t >>> 14) >>> 0) / 4294967296
  }

  /** Entero en [min, max] inclusive */
  int(min: number, max: number): number {
    return Math.floor(this.next() * (max - min + 1)) + min
  }

  /** Boolean con probabilidad p de ser true */
  bool(p: number): boolean {
    return this.next() < p
  }

  /** Elemento aleatorio de un array */
  pick<T>(arr: T[]): T {
    return arr[Math.floor(this.next() * arr.length)]
  }

  /** Mezcla un array (Fisher-Yates) */
  shuffle<T>(arr: T[]): T[] {
    const a = [...arr]
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(this.next() * (i + 1))
      ;[a[i], a[j]] = [a[j], a[i]]
    }
    return a
  }

  /** Fork: crea un nuevo PRNG derivado sin avanzar el estado principal */
  fork(offset: number = 1): SeededRandom {
    return new SeededRandom(this.state ^ (offset * 0x9e3779b9))
  }
}

/** Crea PRNG desde seed numérica o string */
export function createRandom(seed: number | string): SeededRandom {
  if (typeof seed === 'string') {
    let h = 0x811c9dc5
    for (let i = 0; i < seed.length; i++) {
      h ^= seed.charCodeAt(i)
      h = (h * 0x01000193) >>> 0
    }
    return new SeededRandom(h)
  }
  return new SeededRandom(seed)
}
