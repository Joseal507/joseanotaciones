export type AppLang = "es" | "en";

const EN = new Set(["the","is","are","was","were","have","has","this","that","with","from","they","what","which","when","how","can","will","would","should","could","about","there","their","hello","hi","hey","thanks","please","explain","analyze","question","answer","good","help","need","want","tell","make","get","know","think","see","a","an","of","in","to","for","on","at","by","or","and","but","if","it","we","our","us","them","your","who","not","just","now","also","than","more","some","any","all","each","do","does","did"]);
const ES = new Set(["que","con","para","por","una","los","las","del","son","como","pero","muy","todo","este","esta","tambien","hacer","tiene","pueden","cuando","donde","porque","aunque","se","lo","le","su","el","la","de","en","un","es","al","si","ya","me","mi","tu","yo","hay","fue","ser","estar","bien","hoy","algo","nada","puedo","quiero","necesito","ayuda","gracias","bueno","dame","dime","explica","analiza","pregunta","respuesta","hola","favor"]);

const norm = (t: string) => String(t||"").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g,"");

export function detectContentLanguage(text?: string, fallback: AppLang = "es"): AppLang {
  const raw = String(text||"").trim();
  if (!raw) return fallback;
  const tokens = norm(raw).slice(0,3000).split(/[^a-z0-9]+/).filter(Boolean);
  if (!tokens.length) return /[áéíóúüñ]/i.test(raw) ? "es" : fallback;
  let en = 0, es = 0;
  for (const t of tokens) {
    if (EN.has(t)) en += t.length <= 3 ? 1 : 2;
    if (ES.has(t)) es += t.length <= 3 ? 1 : 2;
  }
  if (/[áéíóúüñ¿¡]/i.test(raw)) es += 4;
  if (/\b(hello|hi|hey|thanks|please|explain|analyze|question|answer)\b/i.test(raw)) en += 3;
  if (/\b(hola|gracias|explica|analiza|pregunta|respuesta)\b/i.test(raw)) es += 3;
  if (en === 0 && es === 0) return /^[\x00-\x7F\s.,!?'"():;\-_/]+$/.test(raw) ? "en" : fallback;
  return en >= es ? "en" : "es";
}

export function detectLanguageFromMany(values: Array<string|null|undefined>, fallback: AppLang = "es"): AppLang {
  return detectContentLanguage(values.filter(Boolean).map(v => String(v).slice(0,1200)).join("\n"), fallback);
}
