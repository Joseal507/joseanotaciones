export function hasRealPriorTeaching(turns: Array<{ microId?: string; content?: { type?: string; summary?: string } }>, microId: string): boolean {
  return turns.some(turn => turn.microId === microId && turn.content?.type === 'teaching' && Boolean(turn.content.summary?.trim()))
}
