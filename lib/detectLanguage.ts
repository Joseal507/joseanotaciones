export function detectLanguage(text: string, fallback?: 'es' | 'en'): 'es' | 'en' {
  if (!text) return fallback || 'es';

  const sample = text.slice(0, 2000).toLowerCase();

  const spanishWords = [
    ' el ', ' la ', ' los ', ' las ', ' que ', ' de ', ' y ',
    ' en ', ' un ', ' una ', ' para ', ' con ', ' por ',
    ' es ', ' se ', ' del ', ' al '
  ];

  const englishWords = [
    ' the ', ' and ', ' of ', ' to ', ' in ', ' is ',
    ' that ', ' for ', ' with ', ' as ', ' on ', ' by ',
    ' an ', ' be ', ' this '
  ];

  let spanishScore = 0;
  let englishScore = 0;

  spanishWords.forEach(word => { if (sample.includes(word)) spanishScore++; });
  englishWords.forEach(word => { if (sample.includes(word)) englishScore++; });

  if (spanishScore === 0 && englishScore === 0) return fallback || 'es';

  return englishScore > spanishScore ? 'en' : 'es';
}

// Versión que acepta múltiples textos
export function detectLanguageFromMany(texts: string[], fallback?: 'es' | 'en'): 'es' | 'en' {
  const combined = texts.filter(Boolean).join(' ');
  return detectLanguage(combined, fallback);
}

// Aliases para compatibilidad con todos los imports existentes
export const detectContentLanguage = detectLanguage;
export const detect = detectLanguage;
