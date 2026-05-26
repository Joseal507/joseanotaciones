export interface SemanticResult {
  score: number;
  matched: string[];
  missing: string[];
  status: 'correct' | 'partial' | 'wrong';
}

const norm = (s: string) =>
  String(s || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9ñ\s]/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const SYNONYMS: Record<string, string[]> = {
  veloz: ['rapido', 'agil', 'rapida'],
  rapido: ['veloz', 'agil'],
  inolvidables: ['momentos inolvidables', 'memorable', 'memorables'],
  receptor: ['recibidor'],
};

export function semanticMatch(expected: string[], user: string): SemanticResult {
  const u = norm(user);
  const targets = expected.map(norm).filter(Boolean);

  let best = 0;
  const matched: string[] = [];
  const missing: string[] = [];

  for (const raw of expected) {
    const e = norm(raw);
    const variants = [e, ...(SYNONYMS[e] || []).map(norm)];

    let score = 0;

    for (const v of variants) {
      if (!v) continue;
      if (u === v) score = Math.max(score, 100);
      else if (u.includes(v) || v.includes(u)) score = Math.max(score, 92);
      else {
        const eWords = v.split(' ').filter(Boolean);
        const uWords = u.split(' ').filter(Boolean);
        const hits = eWords.filter(w => uWords.includes(w)).length;
        score = Math.max(score, Math.round((hits / Math.max(eWords.length, 1)) * 100));
      }
    }

    best = Math.max(best, score);

    if (score >= 60) matched.push(raw);
    else missing.push(raw);
  }

  return {
    score: best,
    matched,
    missing,
    status: best >= 85 ? 'correct' : best >= 60 ? 'partial' : 'wrong',
  };
}
