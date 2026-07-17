export type PedagogicalObjective =
  | 'teach' | 'diagnose' | 'recognize' | 'retrieve' | 'discriminate' | 'organize' | 'explain'
  | 'apply' | 'integrate' | 'transfer' | 'repair' | 'review' | 'exam' | 'metacognition'

const aliases: Record<string, PedagogicalObjective> = {
  verify_understanding: 'recognize', active_recall: 'retrieve', differentiation: 'discriminate',
  application: 'apply', synthesis: 'integrate', retention: 'review', simulation: 'exam',
}
export function normalizePedagogicalObjective(value: string): PedagogicalObjective {
  if (aliases[value]) return aliases[value]
  const supported: PedagogicalObjective[] = ['teach','diagnose','recognize','retrieve','discriminate','organize','explain','apply','integrate','transfer','repair','review','exam','metacognition']
  return supported.includes(value as PedagogicalObjective) ? value as PedagogicalObjective : 'recognize'
}
