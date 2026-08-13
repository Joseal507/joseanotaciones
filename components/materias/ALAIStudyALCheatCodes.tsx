"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { buildSourceSelectionFromMaterials, type SourceSelectionSnapshot } from "../../lib/adaptive/sourceSelection";
import { useAuthorizedSource } from "../../lib/materials/useAuthorizedSource";
import { sourceScopedKey } from "../../lib/materials/authorizedSource";

const PDFViewer = dynamic(() => import("./FlashcardsPDFViewer"), {
  ssr: false,
});

type CardType =
  | "cheat_code"
  | "ejemplo_click"
  | "analogia"
  | "error_clasico"
  | "examen_tip"
  | "palabras_gatillo"
  | "no_confundir"
  | "regla_oro"
  | "solo_una_cosa"
  | "cadena_logica"
  | "como_piensa_alai"
  | "combo"
  | "dato_inesperado"
  | "respuesta_perfecta"
  | "trampa_examen"
  | "feynman"
  | "diez_segundos"
  | "cinco_segundos"
  | "si_yo_fuera_tu"
  | "tesis_central"
  | "premisa_clave"
  | "como_defender"
  | "linea_causal"
  | "figura_clave"
  | "antes_despues"
  | "momento_decisivo";

interface CheatCard {
  id: string;
  type: CardType;
  stage?: "entiende" | "recuerda" | "no_confundas" | "examen";
  title: string;
  content: string;
  concept?: string;
  difficulty?: 1 | 2 | 3 | 4 | 5;
  forgetRisk?: 1 | 2 | 3 | 4 | 5;
  sourcePages?: number[];
  sourceMaterial?: string;
  sourceMaterialName?: string;
  tags?: string[];
}

interface ProfessorAdvice {
  title: string;
  bullets: string[];
  closing?: string;
}

interface Props {
  materiales: any[];
  seleccion?: any[] | null;
  tema: any;
  materia: any;
  onBack: () => void;
  onMasteryEvent?: (event: any) => void;
  masteryContext?: any;
  sessionId?: string | null;
  sourceSelection?: SourceSelectionSnapshot;
}

type QuickFilter = "all" | "favorites" | "hard" | "exam" | "memory";

const TYPE_META: Record<
  CardType,
  { icon: string; label: string; accent: string; bg: string }
> = {
  cheat_code: {
    icon: "🧠",
    label: "Truquito",
    accent: "#d6b26f",
    bg: "#17141f",
  },
  ejemplo_click: {
    icon: "💡",
    label: "El ejemplo que hace click",
    accent: "#38bdf8",
    bg: "#111827",
  },
  analogia: { icon: "🪝", label: "Analogía", accent: "#a78bfa", bg: "#1a1328" },
  error_clasico: {
    icon: "⚠️",
    label: "Error clásico",
    accent: "#ef4444",
    bg: "#231315",
  },
  examen_tip: {
    icon: "🚨",
    label: "Si esto sale en el examen",
    accent: "#fb923c",
    bg: "#22170f",
  },
  palabras_gatillo: {
    icon: "⚡",
    label: "Palabras gatillo",
    accent: "#4ade80",
    bg: "#102018",
  },
  no_confundir: {
    icon: "🔀",
    label: "Cómo NO confundirlos",
    accent: "#22d3ee",
    bg: "#102026",
  },
  regla_oro: {
    icon: "🎯",
    label: "Regla de oro",
    accent: "#facc15",
    bg: "#221f11",
  },
  solo_una_cosa: {
    icon: "⭐",
    label: "Si solo recuerdas una cosa",
    accent: "#f472b6",
    bg: "#24121d",
  },
  cadena_logica: {
    icon: "🔗",
    label: "Cadena lógica",
    accent: "#5eead4",
    bg: "#0f1f20",
  },
  como_piensa_alai: {
    icon: "🧠",
    label: "Cómo lo piensa ALAI",
    accent: "#d6b26f",
    bg: "#17141f",
  },
  combo: { icon: "🎮", label: "Combo", accent: "#f472b6", bg: "#201119" },
  dato_inesperado: {
    icon: "🤯",
    label: "Dato inesperado",
    accent: "#4ade80",
    bg: "#101d13",
  },
  respuesta_perfecta: {
    icon: "📝",
    label: "Cómo responder perfecto",
    accent: "#a3e635",
    bg: "#17200f",
  },
  trampa_examen: {
    icon: "🎯",
    label: "Trampa del examen",
    accent: "#fb923c",
    bg: "#23160f",
  },
  feynman: {
    icon: "🪜",
    label: "Método Feynman",
    accent: "#818cf8",
    bg: "#121629",
  },
  diez_segundos: {
    icon: "🔥",
    label: "En 10 segundos",
    accent: "#fb923c",
    bg: "#24160f",
  },
  cinco_segundos: {
    icon: "⚡",
    label: "En 5 segundos",
    accent: "#4ade80",
    bg: "#102114",
  },
  si_yo_fuera_tu: {
    icon: "🧠",
    label: "Si yo fuera tú",
    accent: "#d6b26f",
    bg: "#17141f",
  },
  tesis_central:     { icon: '💬', label: 'Tesis central',               accent: '#d6b26f', bg: '#1a1400' },
  premisa_clave:     { icon: '🧱', label: 'Premisa clave',               accent: '#38bdf8', bg: '#0a1828' },
  como_defender:     { icon: '🛡️', label: 'Cómo defender este argumento', accent: '#4ade80', bg: '#0a1a10' },
  linea_causal:      { icon: '⏩', label: 'Línea causal',                accent: '#fb923c', bg: '#1a0f00' },
  figura_clave:      { icon: '👤', label: 'Figura clave',                accent: '#a78bfa', bg: '#140a2a' },
  antes_despues:     { icon: '↔️', label: 'Antes vs Después',            accent: '#22d3ee', bg: '#081820' },
  momento_decisivo:  { icon: '⚡', label: 'Momento decisivo',            accent: '#ef4444', bg: '#1f0808' },
};

function clamp1to5(value: any): 1 | 2 | 3 | 4 | 5 {
  const n = Number(value);
  if (!Number.isFinite(n)) return 3;
  if (n <= 1) return 1;
  if (n >= 5) return 5;
  return Math.round(n) as 1 | 2 | 3 | 4 | 5;
}

function normalizePages(value: any): number[] {
  if (Array.isArray(value)) {
    return Array.from(
      new Set(value.map(Number).filter((n) => Number.isFinite(n) && n > 0)),
    ).sort((a, b) => a - b);
  }
  if (value && typeof value === "object") {
    const start = Number(
      value.start ?? value.from ?? value.startPage ?? value.paginaInicial,
    );
    const end = Number(
      value.end ?? value.to ?? value.endPage ?? value.paginaFinal,
    );
    if (
      Number.isFinite(start) &&
      Number.isFinite(end) &&
      start > 0 &&
      end >= start
    ) {
      return Array.from({ length: end - start + 1 }, (_, i) => start + i);
    }
  }
  return [];
}

function getSelectionPages(item: any): number[] {
  if (!item) return [];
  return (
    [
      item.pages,
      item.selectedPages,
      item.paginasSeleccionadas,
      item.paginas,
      item.pageNumbers,
      item.range,
      item.selection,
    ]
      .map(normalizePages)
      .find((arr) => arr.length > 0) || []
  );
}

function getSelectionText(item: any): string {
  return String(
    item?.text ||
      item?.texto ||
      item?.content ||
      item?.contenido ||
      item?.selectedText ||
      item?.rawText ||
      item?.extract ||
      "",
  ).trim();
}

function getIds(item: any): string[] {
  const nested =
    item?.material ||
    item?.documento ||
    item?.doc ||
    item?.source ||
    item?.file ||
    null;
  return [
    item?.materialId,
    item?.material_id,
    item?.documentId,
    item?.document_id,
    item?.docId,
    item?.doc_id,
    item?.id,
    nested?.materialId,
    nested?.material_id,
    nested?.id,
  ]
    .filter(Boolean)
    .map((v: any) => String(v));
}

function findSelectionForMaterial(
  materiales: any[],
  mat: any,
  index: number,
  seleccion?: any[] | null,
) {
  if (!Array.isArray(seleccion) || !seleccion.length) return null;
  const matIds = getIds(mat);
  return (
    seleccion.find((s: any) => Number(s?.materialIndex) === index) ||
    seleccion.find((s: any) => getIds(s).some((id) => matIds.includes(id))) ||
    seleccion[index] ||
    null
  );
}

function filterTextByPages(fullText: string, pages: number[]): string {
  if (!fullText || !pages.length) return fullText || "";
  const sortedPages = Array.from(
    new Set(pages.map(Number).filter((n) => Number.isFinite(n) && n > 0)),
  ).sort((a, b) => a - b);
  if (!sortedPages.length) return fullText;
  const result: string[] = [];
  const markerRegex =
    /(?:^|\n)\s*(?:\[\s*(?:P[aá]gina|Pagina|Page)\s+(\d+)\s*\]|---\s*(?:p[aá]gina|page)\s*(\d+)\s*---)\s*/gi;
  const matches = Array.from(fullText.matchAll(markerRegex));
  if (matches.length > 0) {
    for (let i = 0; i < matches.length; i++) {
      const match = matches[i];
      const page = Number(match[1] || match[2]);
      if (!sortedPages.includes(page)) continue;
      const start = (match.index || 0) + match[0].length;
      const end =
        i + 1 < matches.length
          ? matches[i + 1].index || fullText.length
          : fullText.length;
      const chunk = fullText.slice(start, end).trim();
      if (chunk) result.push(`[Pagina ${page}]\n${chunk}`);
    }
    if (result.length > 0) return result.join("\n\n");
  }
  const pageChunks = fullText.split("\f");
  if (pageChunks.length > 1) {
    for (const page of sortedPages) {
      const chunk = pageChunks[page - 1];
      if (chunk?.trim()) result.push(`[Pagina ${page}]\n${chunk.trim()}`);
    }
  }
  return result.join("\n\n");
}

function formatPages(pages?: number[]) {
  const clean = Array.from(
    new Set(
      (pages || []).map(Number).filter((n) => Number.isFinite(n) && n > 0),
    ),
  ).sort((a, b) => a - b);
  if (!clean.length) return "";
  if (clean.length === 1) return `Página ${clean[0]}`;
  return `Páginas ${clean.join(", ")}`;
}

function storageKeyFor(materiales: any[], temaId: string) {
  const ids = materiales
    .map((m: any) => String(m?.materialId || m?.material_id || m?.id || ""))
    .filter(Boolean)
    .sort()
    .join("|");
  return `studyal_truquitos_v1_${temaId}_${ids}`;
}

function stars(n?: number) {
  const value = clamp1to5(n);
  return "★".repeat(value) + "☆".repeat(5 - value);
}

function stageMeta(stage?: string) {
  if (stage === "entiende") return { icon: "1️⃣", label: "Primero entiende" };
  if (stage === "recuerda") return { icon: "2️⃣", label: "Luego recuerda" };
  if (stage === "no_confundas") return { icon: "3️⃣", label: "Ahora no lo confundas" };
  if (stage === "examen") return { icon: "4️⃣", label: "Si esto sale en examen" };
  return { icon: "🧠", label: "Truco útil" };
}

function renderCardContent(card: CheatCard, accent: string) {
  const lines = String(card.content || "")
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);

  if (card.type === "cadena_logica" || card.type === "como_piensa_alai") {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        {lines.map((line, i) => (
          <div
            key={i}
            style={{ display: "flex", flexDirection: "column", gap: 6 }}
          >
            <div
              style={{
                display: "inline-flex",
                alignSelf: "flex-start",
                background: `color-mix(in srgb, ${accent} 16%, transparent)`,
                border: `1px solid ${accent}44`,
                color: accent,
                borderRadius: 10,
                padding: "7px 12px",
                fontSize: 13,
                fontWeight: 900,
                lineHeight: 1.35,
              }}
            >
              {line}
            </div>
            {i < lines.length - 1 && (
              <div
                style={{
                  color: accent,
                  fontSize: 18,
                  fontWeight: 900,
                  paddingLeft: 10,
                  opacity: 0.8,
                }}
              >
                ↓
              </div>
            )}
          </div>
        ))}
      </div>
    );
  }

  if (card.type === "palabras_gatillo") {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {lines.map((line, i) => {
          const parts = line
            .split(/→|->/)
            .map((p) => p.trim())
            .filter(Boolean);
          if (parts.length <= 1) {
            return (
              <div
                key={i}
                style={{
                  fontSize: 13.5,
                  lineHeight: 1.5,
                  color: "var(--text-secondary)",
                }}
              >
                {line}
              </div>
            );
          }
          return (
            <div
              key={i}
              style={{
                display: "flex",
                alignItems: "center",
                flexWrap: "wrap",
                gap: 6,
              }}
            >
              {parts.map((part, idx) => (
                <div
                  key={idx}
                  style={{ display: "flex", alignItems: "center", gap: 6 }}
                >
                  <span
                    style={{
                      background:
                        idx === 0
                          ? `color-mix(in srgb, ${accent} 18%, transparent)`
                          : "var(--bg-secondary)",
                      border: `1px solid ${idx === 0 ? accent + "44" : "var(--border-color2)"}`,
                      color: idx === 0 ? accent : "var(--text-secondary)",
                      borderRadius: 999,
                      padding: "5px 11px",
                      fontSize: 12.5,
                      fontWeight: 800,
                    }}
                  >
                    {part}
                  </span>
                  {idx < parts.length - 1 && (
                    <span style={{ color: accent, fontWeight: 900 }}>→</span>
                  )}
                </div>
              ))}
            </div>
          );
        })}
      </div>
    );
  }

  if (card.type === "no_confundir") {
    const vsIndex = lines.findIndex((l) => l.toUpperCase() === "VS");
    if (vsIndex > 0) {
      const left = lines.slice(0, vsIndex).join(" ");
      const right = lines.slice(vsIndex + 1).join(" ");
      return (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr auto 1fr",
            gap: 10,
            alignItems: "start",
          }}
        >
          <div
            style={{
              background: `color-mix(in srgb, ${accent} 14%, transparent)`,
              border: `1px solid ${accent}40`,
              borderRadius: 12,
              padding: "10px 12px",
              fontSize: 12.8,
              lineHeight: 1.5,
              color: "var(--text-secondary)",
              fontWeight: 700,
            }}
          >
            {left}
          </div>
          <div
            style={{
              color: accent,
              fontWeight: 900,
              paddingTop: 12,
              fontSize: 16,
            }}
          >
            VS
          </div>
          <div
            style={{
              background: "var(--bg-secondary)",
              border: "1px solid var(--border-color2)",
              borderRadius: 12,
              padding: "10px 12px",
              fontSize: 12.8,
              lineHeight: 1.5,
              color: "var(--text-muted)",
              fontWeight: 700,
            }}
          >
            {right}
          </div>
        </div>
      );
    }
  }

  if (card.type === "cheat_code") {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {lines.map((line, i) => (
          <div
            key={i}
            style={{
              fontSize: i === 0 ? 15.5 : 13.5,
              lineHeight: 1.5,
              fontWeight: i === 0 ? 900 : 700,
              color: i === 0 ? accent : "var(--text-secondary)",
            }}
          >
            {line}
          </div>
        ))}
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
      {lines.map((line, i) => {
        if (line.startsWith("• ") || line.startsWith("- ")) {
          return (
            <div
              key={i}
              style={{ display: "flex", gap: 8, alignItems: "flex-start" }}
            >
              <span style={{ color: accent, fontWeight: 900 }}>•</span>
              <span
                style={{
                  fontSize: 13.5,
                  lineHeight: 1.5,
                  color: "var(--text-secondary)",
                }}
              >
                {line.replace(/^[•-]\s*/, "")}
              </span>
            </div>
          );
        }
        return (
          <div
            key={i}
            style={{
              fontSize: 13.5,
              lineHeight: 1.55,
              color: "var(--text-secondary)",
            }}
          >
            {line}
          </div>
        );
      })}
    </div>
  );
}

function CheatCardView({
  card,
  index,
  isFavorite,
  isKnown,
  isSaved,
  variant,
  variantLoading,
  onToggleFavorite,
  onToggleKnown,
  onSaveNote,
  onCopy,
  onShare,
  onJumpToSource,
  onAnotherTrick,
  onAnotherAnalogy,
  onExplainSimple,
}: {
  card: CheatCard;
  index: number;
  isFavorite: boolean;
  isKnown: boolean;
  isSaved: boolean;
  variant?: CheatCard | null;
  variantLoading?: boolean;
  onToggleFavorite: () => void;
  onToggleKnown: () => void;
  onSaveNote: () => void;
  onCopy: () => void;
  onShare: () => void;
  onJumpToSource: () => void;
  onAnotherTrick: () => void;
  onAnotherAnalogy: () => void;
  onExplainSimple: () => void;
}) {
  const [hovered, setHovered] = useState(false);
  const meta = TYPE_META[card.type] || TYPE_META.cheat_code;
  const important = [
    "cheat_code",
    "solo_una_cosa",
    "regla_oro",
    "si_yo_fuera_tu",
  ].includes(card.type);

  return (
    <article
      className={`cc-card ${important ? "important" : ""} ${isKnown ? "known" : ""}`}
      style={
        {
          "--accent": meta.accent,
          "--card-bg": meta.bg,
          animationDelay: `${index * 55}ms`,
        } as any
      }
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <div className="cc-card-glow" />
      <div className="cc-card-tape" />

      <div className="cc-card-head">
        <div className="cc-card-icon">{meta.icon}</div>
        <div className="cc-card-head-text">
          <div className="cc-card-type">{meta.label}</div>
          <h3>{card.title}</h3>
          {card.concept && <p>{card.concept}</p>}
        </div>
        <button
          className={`cc-fav-btn ${isFavorite ? "active" : ""}`}
          onClick={onToggleFavorite}
          title="Marcar favorita"
        >
          {isFavorite ? "★" : "☆"}
        </button>
      </div>

      <div className="cc-badges">
        <span className="cc-badge">🧠 {stars(card.difficulty)}</span>
        <span className="cc-badge">📈 {stars(card.forgetRisk)}</span>
        {card.sourcePages?.length ? (
          <button className="cc-badge source" onClick={onJumpToSource}>
            📄 {formatPages(card.sourcePages)}
          </button>
        ) : null}
      </div>

      <div className="cc-card-body">{renderCardContent(card, meta.accent)}</div>

      {(card.sourceMaterialName || card.tags?.length) && (
        <div className="cc-card-foot">
          {card.sourceMaterialName && (
            <span className="cc-source-chip">{card.sourceMaterialName}</span>
          )}
          {card.tags?.slice(0, 3).map((tag) => (
            <span key={tag} className="cc-tag-chip">
              {tag}
            </span>
          ))}
        </div>
      )}

      <div className={`cc-card-actions ${hovered ? "show" : ""}`}>
        <button onClick={onSaveNote} className={isSaved ? "active" : ""}>
          {isSaved ? "✓ Guardado" : "Guardar"}
        </button>
        <button onClick={onCopy}>Copiar</button>
        <button onClick={onShare}>Compartir</button>
        <button onClick={onToggleKnown} className={isKnown ? "active" : ""}>
          {isKnown ? "✓ Ya me lo sé" : "Ya me lo sé"}
        </button>
        <button onClick={onAnotherTrick} disabled={variantLoading}>
          {variantLoading ? "..." : "Otro truco"}
        </button>
        <button onClick={onAnotherAnalogy} disabled={variantLoading}>
          {variantLoading ? "..." : "Otra analogía"}
        </button>
        <button onClick={onExplainSimple} disabled={variantLoading}>
          {variantLoading ? "..." : "Como niño"}
        </button>
      </div>

      {variant && (
        <div className="cc-variation">
          <div className="cc-variation-head">
            <span>✨</span>
            <strong>Otra forma de recordarlo</strong>
          </div>
          <div className="cc-variation-body">
            <h4>{variant.title}</h4>
            {renderCardContent(variant, meta.accent)}
          </div>
        </div>
      )}
    </article>
  );
}

export default function ALAIStudyALCheatCodes({
  materiales,
  seleccion,
  tema,
  materia,
  onBack,
  onMasteryEvent,
  masteryContext,
  sessionId,
  sourceSelection,
}: Props) {
  const [cards, setCards] = useState<CheatCard[]>([]);
  const [materialText, setMaterialText] = useState("");
  const [loadingText, setLoadingText] = useState(true);
  const [loadingCards, setLoadingCards] = useState(false);
  const [error, setError] = useState("");
  const [ready, setReady] = useState(false);
  const [requestedInitial, setRequestedInitial] = useState(false);

  const [pdfUrl, setPdfUrl] = useState<string | null>(null);
  const [pdfCollapsed, setPdfCollapsed] = useState(false);
  const [activeMaterialIndex, setActiveMaterialIndex] = useState(0);
  const [forcedPage, setForcedPage] = useState<number | undefined>(undefined);
  const [scrollTrigger, setScrollTrigger] = useState(0);
  const [, setNumPages] = useState(0);

  const [favorites, setFavorites] = useState<string[]>([]);
  const [known, setKnown] = useState<string[]>([]);
  const [saved, setSaved] = useState<string[]>([]);
  const [quickFilter, setQuickFilter] = useState<QuickFilter>("all");
  const [toast, setToast] = useState("");
  const [professorAdvice, setProfessorAdvice] = useState<ProfessorAdvice | null>(null);
  const [variants, setVariants] = useState<Record<string, CheatCard | null>>({});
  const [variantLoadingId, setVariantLoadingId] = useState<string | null>(null);

  const toastTimer = useRef<number | null>(null);
  const effectiveSourceSelection = useMemo(
    () => sourceSelection || buildSourceSelectionFromMaterials(materiales, seleccion),
    [sourceSelection, materiales, seleccion],
  );
  const { result: authorizedSource, status: authorizedStatus, error: authorizedError } = useAuthorizedSource(effectiveSourceSelection);

  const activeMaterial =
    materiales[activeMaterialIndex] || materiales[0] || null;
  const activeMaterialId = String(
    activeMaterial?.materialId ||
      activeMaterial?.material_id ||
      activeMaterial?.id ||
      "",
  );

  const storageKey = useMemo(
    () => sourceScopedKey('studyal_truquitos_v2', effectiveSourceSelection, {
      temaId: tema?.id || tema?.nombre,
      sessionId,
    }),
    [effectiveSourceSelection.fingerprint, tema?.id, tema?.nombre, sessionId],
  );

  const selectionSequence = useMemo(() => {
    const seq: { materialIndex: number; page: number }[] = [];
    materiales.forEach((mat: any, i: number) => {
      const sel = findSelectionForMaterial(materiales, mat, i, seleccion);
      const pages = getSelectionPages(sel);
      pages.forEach((page) => seq.push({ materialIndex: i, page }));
    });
    return seq;
  }, [materiales, seleccion]);

  const activeSelectedPages = useMemo(() => {
    const sel = findSelectionForMaterial(
      materiales,
      activeMaterial,
      activeMaterialIndex,
      seleccion,
    );
    return getSelectionPages(sel);
  }, [materiales, activeMaterial, activeMaterialIndex, seleccion]);

  const viewerPages = useMemo(() => {
    const extra = forcedPage && Number.isFinite(forcedPage) ? [forcedPage] : [];
    return Array.from(new Set([...activeSelectedPages, ...extra])).sort(
      (a, b) => a - b,
    );
  }, [activeSelectedPages, forcedPage]);

  const totalSelectedPages = useMemo(
    () => selectionSequence.length || activeSelectedPages.length,
    [selectionSequence.length, activeSelectedPages.length],
  );

  const stats = useMemo(() => {
    return {
      total: cards.length,
      favorites: favorites.length,
      hard: cards.filter((c) => clamp1to5(c.difficulty) >= 4).length,
      memory: cards.filter((c) =>
        [
          "cheat_code",
          "analogia",
          "palabras_gatillo",
          "regla_oro",
          "solo_una_cosa",
        ].includes(c.type),
      ).length,
      exam: cards.filter((c) =>
        ["examen_tip", "respuesta_perfecta", "trampa_examen"].includes(c.type),
      ).length,
    };
  }, [cards, favorites.length]);

  const filteredCards = useMemo(() => {
    if (quickFilter === "favorites") {
      return cards.filter((c) => favorites.includes(c.id));
    }
    if (quickFilter === "hard") {
      return cards.filter((c) => clamp1to5(c.difficulty) >= 4);
    }
    if (quickFilter === "exam") {
      return cards.filter((c) =>
        ["examen_tip", "respuesta_perfecta", "trampa_examen"].includes(c.type),
      );
    }
    if (quickFilter === "memory") {
      return cards.filter((c) =>
        [
          "cheat_code",
          "analogia",
          "palabras_gatillo",
          "regla_oro",
          "solo_una_cosa",
          "cadena_logica",
          "como_piensa_alai",
        ].includes(c.type),
      );
    }
    return cards;
  }, [cards, quickFilter, favorites]);

  const allPagesLabel = useMemo(() => {
    const pages = selectionSequence.map((x) => x.page);
    return pages.length
      ? formatPages(pages.slice(0, 18)) + (pages.length > 18 ? "…" : "")
      : "documento completo";
  }, [selectionSequence]);

  const showToast = useCallback((message: string) => {
    setToast(message);
    if (toastTimer.current) window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(""), 1800);
  }, []);

  const saveState = useCallback(
    (next: { favorites?: string[]; known?: string[]; saved?: string[] }) => {
      try {
        const current = JSON.parse(localStorage.getItem(storageKey) || "{}");
        localStorage.setItem(
          storageKey,
          JSON.stringify({
            favorites: next.favorites ?? current.favorites ?? [],
            known: next.known ?? current.known ?? [],
            saved: next.saved ?? current.saved ?? [],
          }),
        );
      } catch {}
    },
    [storageKey],
  );

  const toggleId = useCallback((list: string[], id: string) => {
    return list.includes(id) ? list.filter((x) => x !== id) : [...list, id];
  }, []);

  const generateCheatCodes = useCallback(async () => {
    if (!materialText.trim()) return;
    setLoadingCards(true);
    setError("");
    try {
      const res = await fetch("/api/alai-studyal-cheat-codes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          materialText,
          materia: materia?.nombre || "",
          tema: tema?.nombre || "",
          masteryContext,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.success)
        throw new Error(data.error || `Error ${res.status}`);
      setCards(Array.isArray(data.cards) ? data.cards : []);

      if (!Array.isArray(data.cards) || data.cards.length === 0) {
        setError(
          "No se pudieron generar Truquitos útiles con este material.",
        );
      }
    } catch (e: any) {
      setError(e?.message || "Error generando Truquitos.");
      setCards([]);
    } finally {
      setLoadingCards(false);
    }
  }, [materialText, materia?.nombre, tema?.nombre]);

  const jumpToSource = useCallback(
    (card: CheatCard) => {
      const page =
        Array.isArray(card.sourcePages) && card.sourcePages.length
          ? Number(card.sourcePages[0])
          : undefined;
      const materialId = String(card.sourceMaterial || "");

      if (materialId) {
        const idx = materiales.findIndex(
          (m: any) =>
            String(m?.materialId || m?.material_id || m?.id || "") ===
            materialId,
        );
        if (idx >= 0) setActiveMaterialIndex(idx);
      }

      if (page && Number.isFinite(page)) {
        setForcedPage(page);
        setScrollTrigger((x) => x + 1);
        setPdfCollapsed(false);
      }
    },
    [materiales],
  );

  const generateVariant = useCallback(async (
    card: CheatCard,
    action: "another_trick" | "another_analogy" | "simple"
  ) => {
    if (!materialText.trim()) return;
    try {
      setVariantLoadingId(card.id);
      const res = await fetch("/api/alai-studyal-cheat-codes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode: "variant",
          materialText,
          card,
          action,
        }),
      });

      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || `Error ${res.status}`);

      setVariants((prev) => ({
        ...prev,
        [card.id]: data.card || null,
      }));

      showToast(
        action === "simple"
          ? "Versión simple lista"
          : action === "another_analogy"
            ? "Otra analogía lista"
            : "Otro truquito listo"
      );
    } catch (e: any) {
      showToast(e?.message || "No se pudo generar otra versión");
    } finally {
      setVariantLoadingId(null);
    }
  }, [materialText, showToast]);

  const handleShare = useCallback(
    async (card: CheatCard) => {
      const meta = TYPE_META[card.type] || TYPE_META.cheat_code;
      const text = `${meta.icon} ${meta.label}\n\n${card.title}\n\n${card.content}`;
      try {
        if ((navigator as any).share) {
          await (navigator as any).share({
            title: `Truquito · ${tema?.nombre || "StudyAL"}`,
            text,
          });
          showToast("Compartido");
        } else {
          await navigator.clipboard.writeText(text);
          showToast("Copiado para compartir");
        }
      } catch {
        showToast("No se pudo compartir");
      }
    },
    [tema?.nombre, showToast],
  );

  useEffect(() => {
    const t = setTimeout(() => setReady(true), 80);
    return () => clearTimeout(t);
  }, []);

  useEffect(() => {
    try {
      const raw = JSON.parse(localStorage.getItem(storageKey) || "{}");
      setFavorites(Array.isArray(raw?.favorites) ? raw.favorites : []);
      setKnown(Array.isArray(raw?.known) ? raw.known : []);
      setSaved(Array.isArray(raw?.saved) ? raw.saved : []);
    } catch {}
  }, [storageKey]);

  useEffect(() => {
    return () => {
      if (toastTimer.current) window.clearTimeout(toastTimer.current);
    };
  }, []);

  useEffect(() => {
    if (authorizedStatus === 'loading' || authorizedStatus === 'idle') {
      setLoadingText(true);
      return;
    }
    setLoadingText(false);
    if (authorizedStatus === 'error' || !authorizedSource) {
      setError(authorizedError || 'No se pudo resolver la fuente autorizada.');
      setMaterialText('');
      return;
    }
    setError('');
    setMaterialText(authorizedSource.combinedText);
  }, [authorizedStatus, authorizedSource, authorizedError]);

  useEffect(() => {
    let cancelled = false;
    async function loadPdf() {
      setPdfUrl(null);
      if (!activeMaterialId) return;
      try {
        const res = await fetch(
          `/api/materials/${activeMaterialId}/download-url`,
          { credentials: "same-origin" },
        );
        const data = await res.json();
        if (!cancelled) setPdfUrl(data?.url || null);
      } catch {
        if (!cancelled) setPdfUrl(null);
      }
    }
    loadPdf();
    return () => {
      cancelled = true;
    };
  }, [activeMaterialId]);

  useEffect(() => {
    if (!loadingText && materialText && !requestedInitial) {
      setRequestedInitial(true);
      generateCheatCodes();
    }
  }, [loadingText, materialText, requestedInitial, generateCheatCodes]);

  return (
    <div className="cc-screen">
      <div className="cc-bg-radial" />
      <div className="cc-bg-grid" />

      <div className="cc-topbar">
        <button className="cc-back" onClick={onBack}>
          ← volver al proceso
        </button>

        <div className="cc-hero">
          <h1>Truquitos</h1>
          <svg
            width="230"
            height="10"
            viewBox="0 0 230 10"
            className="cc-underline"
          >
            <path
              d="M4 6 Q 70 1 116 5 T 226 4"
              stroke="var(--gold)"
              strokeWidth="2.5"
              fill="none"
              strokeLinecap="round"
            />
          </svg>
          <p>
            Aprende a recordar, entender y responder este tema con menos
            esfuerzo.
          </p>
          <small>
            {loadingText ? "Analizando material..." : allPagesLabel}
          </small>
        </div>

        <div className="cc-topbar-right">
          <button
            className="cc-regen-btn"
            onClick={generateCheatCodes}
            disabled={loadingText || loadingCards}
          >
            {loadingCards ? "Generando..." : "↺ Regenerar truquitos"}
          </button>
        </div>
      </div>

      <main
        className={`cc-main ${ready ? "ready" : ""} ${pdfCollapsed ? "pdf-collapsed" : ""}`}
      >
        <aside className="cc-pdf-panel">
          <div className="cc-pdf-card">
            <div className="cc-pdf-head">
              <div className="cc-pdf-icon">📄</div>
              <div className="cc-pdf-info">
                <strong>
                  {activeMaterial?.nombre || activeMaterial?.name || "Material"}
                </strong>
                <span>
                  {activeSelectedPages.length
                    ? formatPages(activeSelectedPages)
                    : "documento completo"}
                </span>
              </div>
              <button
                className="cc-collapse-btn"
                onClick={() => setPdfCollapsed(!pdfCollapsed)}
                title={pdfCollapsed ? "Expandir" : "Colapsar"}
              >
                {pdfCollapsed ? "→" : "←"}
              </button>
            </div>

            {materiales.length > 1 && (
              <div className="cc-mat-tabs">
                {materiales.map((m: any, i: number) => (
                  <button
                    key={m?.id || i}
                    onClick={() => setActiveMaterialIndex(i)}
                    className={`cc-mat-tab ${i === activeMaterialIndex ? "active" : ""}`}
                  >
                    {i + 1}. {(m?.nombre || m?.name || "Material").slice(0, 18)}
                  </button>
                ))}
              </div>
            )}

            <div className="cc-pdf-viewer">
              {pdfUrl ? (
                <PDFViewer
                  key={`${activeMaterialIndex}-${activeMaterialId}-${pdfUrl}`}
                  url={pdfUrl}
                  selectedPages={viewerPages}
                  themeColor="#d6b26f"
                  onTotalPages={setNumPages}
                  totalSelectedPages={totalSelectedPages}
                  activeMaterialIndex={activeMaterialIndex}
                  materialesCount={materiales.length}
                  forcedPage={forcedPage}
                  currentQuestionPage={forcedPage}
                  scrollTrigger={scrollTrigger}
                />
              ) : (
                <div className="cc-pdf-loading">
                  <div style={{ fontSize: 40 }}>📄</div>
                  <div>Cargando documento...</div>
                </div>
              )}
            </div>
          </div>
        </aside>

        <section className="cc-content">
          {loadingText || loadingCards ? (
            <div className="cc-loading-card">
              <div className="cc-loading-icon">🧠</div>
              <h2>
                {loadingText
                  ? "Leyendo tu material..."
                  : "ALAI está buscando los mejores hacks del tema"}
              </h2>
              <p>
                {loadingText
                  ? "Extrayendo solo el texto seleccionado."
                  : "Priorizando conceptos difíciles, confusiones clásicas y atajos mentales memorables."}
              </p>
              <div className="cc-dots">
                <i />
                <i />
                <i />
              </div>
            </div>
          ) : error ? (
            <div className="cc-error-card">
              <div style={{ fontSize: 44 }}>⚠️</div>
              <h2>No pude generar los Truquitos</h2>
              <p>{error}</p>
              <button className="cc-retry-btn" onClick={generateCheatCodes}>
                Reintentar
              </button>
            </div>
          ) : (
            <>
              <div className="cc-intro">
                <div className="cc-intro-left">
                  <span className="cc-intro-label">
                    libreta secreta de truquitos
                  </span>
                  <h2>No es teoría. Son atajos mentales para recordarlo mejor.</h2>
                  <p>
                    Esta herramienta no intenta explicarte más. Intenta darte{" "}
                    <b>formas fáciles de recordar</b>, <b>no confundir</b> y{" "}
                    <b>responder mejor</b>.
                  </p>
                </div>

                <div className="cc-intro-stats">
                  <div className="cc-stat-box">
                    <strong>{cards.filter(c => ["tesis_central","regla_oro","solo_una_cosa"].includes(c.type)).length}</strong>
                    <span>🔥 esenciales</span>
                  </div>
                  <div className="cc-stat-box">
                    <strong>{cards.filter(c => !["tesis_central","regla_oro","solo_una_cosa","examen_tip","trampa_examen","respuesta_perfecta","como_defender"].includes(c.type)).length}</strong>
                    <span>🧠 estratégicos</span>
                  </div>
                  <div className="cc-stat-box">
                    <strong>{cards.filter(c => ["examen_tip","trampa_examen","respuesta_perfecta","como_defender"].includes(c.type)).length}</strong>
                    <span>🎓 de examen</span>
                  </div>
                </div>
              </div>

              <div className="cc-filter-row">
                {[
                  { key: "all", label: `Todos (${cards.length})` },
                  { key: "favorites", label: `⭐ Favoritas (${favorites.length})` },
                ].map((item) => (
                  <button
                    key={item.key}
                    className={`cc-filter-pill ${quickFilter === item.key ? "active" : ""}`}
                    onClick={() => setQuickFilter(item.key as QuickFilter)}
                  >
                    {item.label}
                  </button>
                ))}
              </div>

              
              {(() => {
                const esenciales = filteredCards.filter(c =>
                  ["tesis_central","regla_oro","solo_una_cosa"].includes(c.type)
                );

                const examen = filteredCards.filter(c =>
                  ["examen_tip","trampa_examen","respuesta_perfecta","como_defender"].includes(c.type)
                );

                const estrategicos = filteredCards.filter(c =>
                  !["tesis_central","regla_oro","solo_una_cosa","examen_tip","trampa_examen","respuesta_perfecta","como_defender"].includes(c.type)
                );

                const renderGroup = (title, icon, color, subtitle, list) => (
                  list.length > 0 && (
                    <>
                      <div style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 10,
                        marginTop: 28,
                        marginBottom: 14,
                        paddingBottom: 10,
                        borderBottom: `2px solid ${color}33`,
                      }}>
                        <span style={{ fontSize: 22 }}>{icon}</span>
                        <div>
                          <div style={{
                            fontSize: 17,
                            fontWeight: 900,
                            color,
                            lineHeight: 1.1,
                          }}>{title}</div>
                          <div style={{
                            fontSize: 11.5,
                            color: 'var(--text-faint)',
                            fontWeight: 700,
                            marginTop: 2,
                          }}>{subtitle}</div>
                        </div>
                      </div>
                      <div className="cc-grid">
                        {list.map((card, index) => (
                          <CheatCardView
                            key={card.id}
                            card={card}
                            index={index}
                            isFavorite={favorites.includes(card.id)}
                            isKnown={known.includes(card.id)}
                            isSaved={saved.includes(card.id)}
                            variant={variants[card.id] || null}
                            variantLoading={variantLoadingId === card.id}
                            onToggleFavorite={() => {
                              const next = toggleId(favorites, card.id);
                              setFavorites(next);
                              saveState({ favorites: next });
                            }}
                            onToggleKnown={() => {
                              const next = toggleId(known, card.id);
                              setKnown(next);
                              saveState({ known: next });
                            }}
                            onSaveNote={() => {
                              const next = toggleId(saved, card.id);
                              setSaved(next);
                              saveState({ saved: next });
                              showToast("Guardado");
                            }}
                            onCopy={async () => {
                              const meta = TYPE_META[card.type] || TYPE_META.cheat_code;
                              await navigator.clipboard.writeText(
                                `${meta.icon} ${meta.label}\n\n${card.title}\n\n${card.content}`
                              );
                              showToast("Copiado");
                            }}
                            onShare={() => handleShare(card)}
                            onJumpToSource={() => jumpToSource(card)}
                            onAnotherTrick={() => generateVariant(card, "another_trick")}
                            onAnotherAnalogy={() => generateVariant(card, "another_analogy")}
                            onExplainSimple={() => generateVariant(card, "simple")}
                          />
                        ))}
                      </div>
                    </>
                  )
                );

                return (
                  <>
                    {renderGroup("Esenciales", "🔥", "var(--gold)", "Lo que no puedes olvidar", esenciales)}
                    {renderGroup("Estratégicos", "🧠", "var(--blue)", "Atajos para entender y recordar mejor", estrategicos)}
                    {renderGroup("De Examen", "🎓", "var(--red)", "Cómo responder cuando esto salga", examen)}
                  </>
                );
              })()}


              {professorAdvice && (
                <div className="cc-intro" style={{ marginTop: 20 }}>
                  <div className="cc-intro-left">
                    <span className="cc-intro-label">últimos 5 minutos antes del examen</span>
                    <h2>{professorAdvice.title || "Lo que un profesor te diría antes del examen"}</h2>
                    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                      {(professorAdvice.bullets || []).map((b, i) => (
                        <div key={i} style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
                          <span style={{ color: "var(--gold)", fontWeight: 900 }}>{i + 1}.</span>
                          <span style={{ color: "var(--text-secondary)", lineHeight: 1.55 }}>{b}</span>
                        </div>
                      ))}
                    </div>
                    {professorAdvice.closing && (
                      <p style={{ marginTop: 12 }}><b>{professorAdvice.closing}</b></p>
                    )}
                  </div>
                </div>
              )}

              <div className="cc-footer-note">
                ✨ Truquitos generados desde tu material · StudyAL × ALAI
              </div>
            </>
          )}
        </section>
      </main>

      {toast && <div className="cc-toast">{toast}</div>}

      <style>{`
        .cc-screen {
          position: fixed;
          inset: 0;
          background: var(--bg-primary);
          color: var(--text-primary);
          z-index: 9999;
          display: flex;
          flex-direction: column;
          overflow: hidden;
        }

        .cc-bg-radial {
          position: absolute; inset: 0; pointer-events: none;
          background:
            radial-gradient(circle at 50% 30%, color-mix(in srgb, var(--gold) 7%, transparent), transparent 55%),
            radial-gradient(circle at 85% 80%, color-mix(in srgb, var(--blue) 4%, transparent), transparent 50%),
            radial-gradient(circle at 15% 75%, color-mix(in srgb, var(--red) 3%, transparent), transparent 50%);
        }

        .cc-bg-grid {
          position: absolute; inset: 0; pointer-events: none;
          opacity: .05;
          background-image:
            linear-gradient(to right, color-mix(in srgb, var(--text-primary) 18%, transparent) 1px, transparent 1px),
            linear-gradient(to bottom, color-mix(in srgb, var(--text-primary) 18%, transparent) 1px, transparent 1px);
          background-size: 40px 40px;
        }

        .cc-topbar {
          position: relative;
          z-index: 10;
          display: grid;
          grid-template-columns: 200px 1fr 180px;
          gap: 18px;
          align-items: start;
          padding: 14px 24px 12px;
          flex-shrink: 0;
        }

        .cc-back {
          border: 2px solid var(--text-primary);
          background: var(--bg-card);
          color: var(--text-primary);
          border-radius: 14px;
          padding: 9px 14px;
          font-size: 13px;
          font-weight: 800;
          cursor: pointer;
          box-shadow: 3px 4px 0 var(--text-primary);
          transition: transform .2s ease, box-shadow .2s ease;
          width: fit-content;
          justify-self: start;
          align-self: center;
        }

        .cc-back:hover {
          transform: translate(-2px, -2px);
          box-shadow: 5px 6px 0 var(--text-primary);
        }

        .cc-hero { text-align: center; }

        .cc-hero h1 {
          margin: 0;
          font-size: 30px;
          font-weight: 900;
          line-height: 1;
          letter-spacing: -0.8px;
          color: var(--gold);
        }

        .cc-underline {
          display: block;
          margin: 2px auto 6px;
        }

        .cc-hero p {
          margin: 0;
          font-size: 14px;
          font-weight: 800;
          color: var(--text-primary);
        }

        .cc-hero small {
          display: block;
          margin-top: 4px;
          font-size: 11.5px;
          color: var(--text-faint);
        }

        .cc-topbar-right {
          display: flex;
          justify-content: flex-end;
          align-self: center;
        }

        .cc-regen-btn {
          border: 1.5px solid var(--gold);
          background: color-mix(in srgb, var(--gold) 12%, transparent);
          color: var(--gold);
          border-radius: 12px;
          padding: 8px 13px;
          font-size: 12px;
          font-weight: 900;
          cursor: pointer;
          transition: all .2s ease;
        }

        .cc-regen-btn:hover:not(:disabled) {
          transform: translateY(-2px);
          background: color-mix(in srgb, var(--gold) 18%, transparent);
        }

        .cc-regen-btn:disabled {
          opacity: 0.5;
          cursor: not-allowed;
        }

        .cc-main {
          flex: 1;
          min-height: 0;
          position: relative;
          z-index: 5;
          display: grid;
          grid-template-columns: minmax(360px, 40%) 1fr;
          gap: 16px;
          padding: 0 24px 16px;
          opacity: 0;
          transform: translateY(8px);
          transition: opacity .5s ease, transform .5s ease;
        }

        .cc-main.ready {
          opacity: 1;
          transform: none;
        }

        .cc-main.pdf-collapsed {
          grid-template-columns: 48px 1fr;
        }

        .cc-main.pdf-collapsed .cc-pdf-card > *:not(.cc-pdf-head) { display: none; }
        .cc-main.pdf-collapsed .cc-pdf-info { display: none; }
        .cc-main.pdf-collapsed .cc-pdf-icon { margin: 0 auto; }

        .cc-pdf-panel {
          display: flex;
          flex-direction: column;
          min-height: 0;
        }

        .cc-pdf-card {
          flex: 1;
          min-height: 0;
          background: var(--bg-card);
          border: 1.5px solid var(--border-color2);
          border-radius: 14px;
          box-shadow: 0 8px 24px rgba(0,0,0,.25);
          display: flex;
          flex-direction: column;
          overflow: hidden;
        }

        .cc-pdf-head {
          display: flex;
          align-items: center;
          gap: 10px;
          padding: 12px;
          border-bottom: 1px solid var(--border-color2);
          flex-shrink: 0;
        }

        .cc-pdf-icon {
          font-size: 18px;
          width: 36px; height: 36px;
          display: grid; place-items: center;
          background: var(--bg-secondary);
          border: 1.5px solid var(--border-color);
          border-radius: 9px;
          flex-shrink: 0;
        }

        .cc-pdf-info {
          flex: 1;
          min-width: 0;
        }

        .cc-pdf-info strong {
          display: block;
          font-size: 13px;
          font-weight: 900;
          color: var(--text-primary);
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }

        .cc-pdf-info span {
          display: block;
          font-size: 10.5px;
          color: var(--text-faint);
          font-weight: 700;
        }

        .cc-collapse-btn {
          background: var(--bg-secondary);
          border: 1.5px solid var(--border-color2);
          border-radius: 8px;
          width: 28px; height: 28px;
          color: var(--text-muted);
          cursor: pointer;
          font-weight: 900;
          font-size: 14px;
          transition: all .2s ease;
        }

        .cc-collapse-btn:hover {
          color: var(--gold);
          border-color: var(--gold);
        }

        .cc-mat-tabs {
          display: flex;
          gap: 4px;
          padding: 8px 8px 0;
          overflow-x: auto;
          flex-shrink: 0;
        }

        .cc-mat-tab {
          border: 1.5px solid var(--border-color2);
          background: var(--bg-card);
          color: var(--text-faint);
          border-radius: 8px;
          padding: 5px 10px;
          font-size: 11px;
          font-weight: 800;
          cursor: pointer;
          white-space: nowrap;
          transition: all .2s ease;
        }

        .cc-mat-tab:hover { color: var(--text-secondary); border-color: var(--text-faint); }

        .cc-mat-tab.active {
          color: var(--gold);
          border-color: var(--gold);
          background: color-mix(in srgb, var(--gold) 14%, transparent);
        }

        .cc-pdf-viewer {
          flex: 1;
          min-height: 0;
          overflow: hidden;
        }

        .cc-pdf-loading {
          height: 100%;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          gap: 12px;
          color: var(--text-faint);
          font-size: 13px;
        }

        .cc-content {
          min-height: 0;
          overflow-y: auto;
          padding-right: 4px;
          display: flex;
          flex-direction: column;
          gap: 12px;
          scrollbar-width: thin;
          scrollbar-color: var(--border-color2) transparent;
        }

        .cc-content::-webkit-scrollbar { width: 6px; }
        .cc-content::-webkit-scrollbar-thumb { background: var(--border-color2); border-radius: 3px; }

        .cc-loading-card,
        .cc-error-card,
        .cc-intro {
          background: var(--bg-card);
          border: 1.5px solid var(--border-color2);
          border-radius: 16px;
          box-shadow: 0 8px 24px rgba(0,0,0,.25);
        }

        .cc-loading-card,
        .cc-error-card {
          flex: 1;
          min-height: 280px;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          text-align: center;
          gap: 12px;
          padding: 28px;
        }

        .cc-loading-icon {
          font-size: 56px;
          filter: drop-shadow(0 0 14px rgba(214,178,111,.4));
          animation: ccFloat 2.2s ease-in-out infinite;
        }

        @keyframes ccFloat {
          0%, 100% { transform: translateY(0); }
          50% { transform: translateY(-6px); }
        }

        .cc-loading-card h2,
        .cc-error-card h2 {
          margin: 0;
          font-size: 22px;
          font-weight: 900;
          color: var(--text-primary);
        }

        .cc-loading-card p,
        .cc-error-card p {
          margin: 0;
          max-width: 520px;
          font-size: 13px;
          line-height: 1.5;
          color: var(--text-muted);
        }

        .cc-dots {
          display: flex;
          gap: 6px;
          margin-top: 6px;
        }

        .cc-dots i {
          width: 8px;
          height: 8px;
          border-radius: 50%;
          background: var(--gold);
          animation: ccDot 1.2s ease infinite;
        }

        .cc-dots i:nth-child(2) { animation-delay: .15s; }
        .cc-dots i:nth-child(3) { animation-delay: .3s; }

        @keyframes ccDot {
          0%, 80%, 100% { opacity: 0.3; transform: scale(0.7); }
          40% { opacity: 1; transform: scale(1.1); }
        }

        .cc-retry-btn {
          background: var(--bg-card2);
          border: 1.5px solid var(--gold);
          color: var(--gold);
          border-radius: 12px;
          padding: 10px 16px;
          font-size: 12px;
          font-weight: 900;
          cursor: pointer;
          transition: all .2s ease;
        }

        .cc-retry-btn:hover {
          transform: translateY(-2px);
          background: color-mix(in srgb, var(--gold) 10%, transparent);
        }

        .cc-intro {
          padding: 16px;
          display: grid;
          grid-template-columns: 1fr auto;
          gap: 14px;
          align-items: center;
        }

        .cc-intro-left h2 {
          margin: 0 0 6px;
          font-size: 22px;
          line-height: 1.1;
          font-weight: 900;
          color: var(--text-primary);
        }

        .cc-intro-left p {
          margin: 0;
          color: var(--text-muted);
          font-size: 13px;
          line-height: 1.55;
          max-width: 700px;
        }

        .cc-intro-left b { color: var(--gold); }

        .cc-intro-label {
          display: inline-flex;
          margin-bottom: 8px;
          padding: 5px 10px;
          border-radius: 999px;
          border: 1px solid var(--gold-border);
          background: color-mix(in srgb, var(--gold) 10%, transparent);
          color: var(--gold);
          font-size: 10.5px;
          font-weight: 900;
          letter-spacing: .4px;
          text-transform: uppercase;
        }

        .cc-intro-stats {
          display: flex;
          gap: 10px;
        }

        .cc-stat-box {
          min-width: 82px;
          background: var(--bg-card2);
          border: 1px solid var(--border-color2);
          border-radius: 14px;
          padding: 10px 12px;
          text-align: center;
        }

        .cc-stat-box strong {
          display: block;
          font-size: 20px;
          line-height: 1;
          color: var(--gold);
          font-weight: 900;
        }

        .cc-stat-box span {
          display: block;
          font-size: 10.5px;
          margin-top: 4px;
          color: var(--text-faint);
          font-weight: 800;
        }

        .cc-filter-row {
          display: flex;
          gap: 8px;
          flex-wrap: wrap;
        }

        .cc-filter-pill {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          border: 1.5px solid var(--border-color2);
          background: var(--bg-card);
          color: var(--text-secondary);
          border-radius: 999px;
          padding: 7px 14px;
          font-size: 12px;
          font-weight: 800;
          cursor: pointer;
          transition: all .2s ease;
        }

        .cc-filter-pill:hover {
          transform: translateY(-1px);
          border-color: var(--gold);
          color: var(--gold);
        }

        .cc-filter-pill.active {
          border-color: var(--gold);
          color: var(--gold);
          background: color-mix(in srgb, var(--gold) 8%, transparent);
        }

        .cc-grid {
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 14px;
          padding-bottom: 14px;
        }

        .cc-card {
          position: relative;
          background: linear-gradient(180deg, color-mix(in srgb, var(--card-bg) 100%, #000) 0%, color-mix(in srgb, var(--card-bg) 90%, #000) 100%);
          border: 1.5px solid color-mix(in srgb, var(--accent) 24%, var(--border-color2));
          border-radius: 16px;
          padding: 16px;
          box-shadow: 0 10px 26px rgba(0,0,0,.34);
          overflow: hidden;
          transform: translateY(12px);
          opacity: 0;
          animation: ccCardIn .45s cubic-bezier(.22,1,.36,1) forwards;
          transition: transform .22s ease, box-shadow .22s ease, border-color .22s ease, opacity .22s ease;
        }

        .cc-card:hover {
          transform: translateY(-4px);
          box-shadow: 0 18px 36px rgba(0,0,0,.45), 0 0 24px color-mix(in srgb, var(--accent) 15%, transparent);
          border-color: color-mix(in srgb, var(--accent) 45%, var(--border-color2));
        }

        .cc-card.important {
          box-shadow: 0 12px 30px rgba(0,0,0,.42), 0 0 18px color-mix(in srgb, var(--accent) 14%, transparent);
        }

        .cc-card.known {
          opacity: 0.68;
        }

        @keyframes ccCardIn {
          to { opacity: 1; transform: translateY(0); }
        }

        .cc-card-glow {
          position: absolute;
          top: -40%;
          right: -20%;
          width: 180px;
          height: 180px;
          background: radial-gradient(circle, color-mix(in srgb, var(--accent) 16%, transparent), transparent 70%);
          pointer-events: none;
          opacity: .8;
        }

        .cc-card-tape {
          position: absolute;
          top: -9px;
          left: 50%;
          transform: translateX(-50%) rotate(-3deg);
          width: 56px;
          height: 15px;
          background: color-mix(in srgb, var(--accent) 50%, #e5dcc8);
          opacity: .88;
          box-shadow: 0 3px 8px rgba(0,0,0,.25);
        }

        .cc-card-head {
          display: grid;
          grid-template-columns: 42px 1fr 28px;
          gap: 10px;
          align-items: start;
        }

        .cc-card-icon {
          width: 42px;
          height: 42px;
          border-radius: 12px;
          background: color-mix(in srgb, var(--accent) 14%, transparent);
          border: 1.5px solid color-mix(in srgb, var(--accent) 30%, transparent);
          display: grid;
          place-items: center;
          font-size: 19px;
          box-shadow: 0 0 12px color-mix(in srgb, var(--accent) 12%, transparent);
        }

        .cc-card-head-text h3 {
          margin: 2px 0 4px;
          font-size: 18px;
          font-weight: 900;
          line-height: 1.15;
          color: var(--text-primary);
        }

        .cc-card-head-text p {
          margin: 0;
          font-size: 12px;
          color: var(--text-faint);
          font-weight: 700;
          line-height: 1.35;
        }

        .cc-card-type {
          font-size: 10.5px;
          font-weight: 900;
          color: var(--accent);
          text-transform: uppercase;
          letter-spacing: .4px;
        }

        .cc-fav-btn {
          border: none;
          background: transparent;
          color: var(--text-faint);
          font-size: 20px;
          line-height: 1;
          cursor: pointer;
          padding: 0;
          transition: all .2s ease;
        }

        .cc-fav-btn:hover { color: var(--accent); transform: scale(1.06); }
        .cc-fav-btn.active { color: var(--accent); }

        .cc-badges {
          display: flex;
          gap: 8px;
          flex-wrap: wrap;
          margin-top: 12px;
        }

        .cc-badge {
          border: 1px solid color-mix(in srgb, var(--accent) 24%, var(--border-color2));
          background: color-mix(in srgb, var(--accent) 8%, transparent);
          color: var(--text-secondary);
          border-radius: 999px;
          padding: 5px 10px;
          font-size: 10.5px;
          font-weight: 900;
        }

        .cc-badge.source {
          cursor: pointer;
          transition: all .2s ease;
        }

        .cc-badge.source:hover {
          transform: translateY(-1px);
          color: var(--accent);
          border-color: var(--accent);
        }

        .cc-card-body {
          margin-top: 14px;
          background: rgba(255,255,255,0.02);
          border: 1px dashed rgba(255,255,255,0.06);
          border-radius: 12px;
          padding: 12px;
        }

        .cc-card-foot {
          margin-top: 12px;
          display: flex;
          flex-wrap: wrap;
          gap: 6px;
        }

        .cc-source-chip,
        .cc-tag-chip {
          border-radius: 999px;
          padding: 5px 10px;
          font-size: 10.5px;
          font-weight: 800;
        }

        .cc-source-chip {
          background: color-mix(in srgb, var(--accent) 12%, transparent);
          border: 1px solid color-mix(in srgb, var(--accent) 28%, transparent);
          color: var(--accent);
        }

        .cc-tag-chip {
          background: var(--bg-secondary);
          border: 1px solid var(--border-color2);
          color: var(--text-faint);
        }

        .cc-card-actions {
          display: flex;
          flex-wrap: wrap;
          gap: 8px;
          margin-top: 14px;
          opacity: 0.75;
          transition: opacity .2s ease;
        }

        .cc-card-actions.show { opacity: 1; }

        .cc-card-actions button {
          background: var(--bg-secondary);
          border: 1px solid var(--border-color2);
          color: var(--text-secondary);
          border-radius: 10px;
          padding: 7px 10px;
          font-size: 11.5px;
          font-weight: 800;
          cursor: pointer;
          transition: all .2s ease;
        }

        .cc-card-actions button:hover {
          transform: translateY(-1px);
          border-color: var(--accent);
          color: var(--accent);
        }

        .cc-card-actions button.active {
          background: color-mix(in srgb, var(--accent) 12%, transparent);
          border-color: var(--accent);
          color: var(--accent);
        }

        .cc-footer-note {
          text-align: center;
          color: var(--text-faint);
          font-size: 11px;
          font-weight: 800;
          padding-bottom: 8px;
        }

        .cc-toast {
          position: fixed;
          bottom: 18px;
          left: 50%;
          transform: translateX(-50%);
          background: var(--gold);
          color: #171717;
          border-radius: 999px;
          padding: 10px 18px;
          font-size: 12px;
          font-weight: 900;
          box-shadow: 0 12px 30px rgba(0,0,0,.35);
          z-index: 10050;
        }

        @media (max-width: 1280px) {
          .cc-grid { grid-template-columns: 1fr; }
        }

        @media (max-width: 1100px) {
          .cc-topbar { grid-template-columns: auto 1fr; }
          .cc-topbar-right { display: none; }
          .cc-main { grid-template-columns: minmax(320px, 38%) 1fr; }
        }

        @media (max-width: 800px) {
          .cc-main { grid-template-columns: 1fr; overflow-y: auto; padding: 0 16px 16px; }
          .cc-pdf-panel { min-height: 360px; }
          .cc-intro { grid-template-columns: 1fr; }
          .cc-intro-stats { justify-content: flex-start; }
          .cc-topbar { padding: 14px 16px 10px; }
        }
      `}</style>
    </div>
  );
}
