import re

path = "components/materias/FlashcardsPage.tsx"
with open(path, "r", encoding="utf-8") as f:
    code = f.read()

# 1. Reemplazar NotebookCard (sintaxis JSX rota)
notebook_card_start = "// ═══════════════════════════════════════════════════════════════\n// ─── TARJETA CUADERNO ESTILO PAPEL ────────────────────────────"
notebook_card_end = "// ─── BOTÓN PUNTEADO ESTILO CUADERNO ────────────────────────────"

new_notebook_card = """// ═══════════════════════════════════════════════════════════════
// ─── TARJETA CUADERNO ESTILO PAPEL ────────────────────────────
function NotebookCard({
  card, color, flipped, onFlip, large = false,
}: {
  card: Flashcard;
  color: string;
  flipped: boolean;
  onFlip: () => void;
  large?: boolean;
}) {
  const isAnswer = flipped;
  return (
    <div
      onClick={onFlip}
      style={{
        position: 'relative',
        width: '100%',
        maxWidth: large ? 680 : '100%',
        cursor: 'pointer',
        transition: 'transform 0.2s ease',
      }}
      onMouseEnter={(e) => {
        (e.currentTarget as HTMLElement).style.transform = 'translateY(-3px)';
      }}
      onMouseLeave={(e) => {
        (e.currentTarget as HTMLElement).style.transform = 'translateY(0)';
      }}
    >
      {/* Hoja de papel cuaderno OSCURA estilo Notion/midnight */}
      <div style={{
        minHeight: large ? 340 : 220,
        backgroundColor: '#0f1117',
        borderRadius: 14,
        border: isAnswer ? `1px solid ${color}44` : '1px solid rgba(255,255,255,0.06)',
        boxShadow: isAnswer
          ? `0 12px 32px rgba(0,0,0,0.5), 0 0 20px ${color}22, inset 0 0 0 1px ${color}11`
          : '0 8px 24px rgba(0,0,0,0.4)',
        padding: large ? '30px 38px 24px 78px' : '24px 24px 20px 62px',
        display: 'flex', flexDirection: 'column',
        overflow: 'hidden',
        transition: 'all 0.3s ease',
        backgroundImage: `linear-gradient(to bottom, transparent 0, transparent ${large ? 38 : 30}px, rgba(255,255,255,0.04) ${large ? 38 : 30}px, rgba(255,255,255,0.04) ${large ? 39 : 31}px, transparent ${large ? 39 : 31}px)`,
        backgroundSize: `100% ${large ? 39 : 31}px`,
        backgroundPosition: `0 ${large ? 50 : 40}px`,
        backgroundRepeat: 'repeat',
      }}>
        {/* Línea margen rojo vertical */}
        <div style={{
          position: 'absolute',
          left: large ? 56 : 46, top: 0, bottom: 0,
          width: 1.5,
          background: 'linear-gradient(to bottom, transparent 0%, rgba(239, 68, 68, 0.5) 8%, rgba(239, 68, 68, 0.5) 92%, transparent 100%)',
          boxShadow: '0 0 6px rgba(239, 68, 68, 0.25)',
        }} />
        {/* Agujeros de carpeta */}
        <div style={{
          position: 'absolute',
          left: large ? 18 : 14, top: '50%',
          transform: 'translateY(-50%)',
          display: 'flex', flexDirection: 'column',
          gap: large ? 38 : 28,
        }}>
          {[0, 1, 2].map(i => (
            <div key={i} style={{
              width: large ? 14 : 10, height: large ? 14 : 10,
              borderRadius: '50%',
              background: '#0a0a0c',
              boxShadow: 'inset 0 2px 4px rgba(0,0,0,0.6), 0 1px 0 rgba(255,255,255,0.04)',
            }} />
          ))}
        </div>
        {/* Etiqueta PREGUNTA / RESPUESTA */}
        <div style={{
          display: 'inline-flex', alignItems: 'center', gap: 6,
          alignSelf: 'flex-start',
          padding: large ? '6px 16px' : '5px 13px',
          background: isAnswer
            ? `linear-gradient(135deg, ${color} 0%, ${color}dd 100%)`
            : 'linear-gradient(135deg, #ffffff 0%, #f0f0f0 100%)',
          border: `2px solid ${isAnswer ? color : '#2a2a2a'}`,
          borderRadius: 8,
          fontFamily: HAND,
          fontSize: large ? 18 : 15,
          fontWeight: 700,
          color: isAnswer ? '#000' : '#1a1a1a',
          transform: isAnswer ? 'rotate(2deg)' : 'rotate(-2deg)',
          boxShadow: isAnswer
            ? `2px 3px 0 rgba(0,0,0,0.4), 0 0 16px ${color}66`
            : '2px 3px 0 rgba(0,0,0,0.35)',
          marginBottom: large ? 24 : 18,
          marginLeft: large ? -4 : -2,
          letterSpacing: '0.5px',
          whiteSpace: 'nowrap',
        }}>
          {isAnswer ? '✓ RESPUESTA' : '✏️ PREGUNTA'}
        </div>
        {/* Contenido */}
        <div style={{
          flex: 1,
          display: 'flex',
          alignItems: 'center',
          paddingLeft: 4,
          paddingRight: 8,
          overflow: 'auto',
          minHeight: large ? 180 : 100,
        }}>
          <div style={{
            fontFamily: BODY,
            fontSize: large ? 30 : 22,
            lineHeight: 1.45,
            color: isAnswer ? '#ffffff' : '#e8e8ed',
            fontWeight: 500,
            width: '100%',
            textShadow: isAnswer ? '0 1px 2px rgba(0,0,0,0.3)' : 'none',
          }}>
            <MathText text={cleanFlashcardText(isAnswer ? card.answer : card.question)} />
          </div>
        </div>
        {/* Hint solo en grande */}
        {large && (
          <div style={{
            textAlign: 'center', fontFamily: HAND, fontSize: 16,
            color: 'rgba(255,255,255,0.25)', marginTop: 10,
            letterSpacing: '0.5px',
          }}>
            ~ ← → flechas · espacio voltear ~
          </div>
        )}
      </div>
    </div>
  );
}
// ─── BOTÓN PUNTEADO ESTILO CUADERNO ────────────────────────────"""

code = code.replace(notebook_card_start + "\n" + notebook_card_end, new_notebook_card + "\n" + notebook_card_end)

# Si el replace exacto falla, intentamos por bloques
if notebook_card_start not in code:
    start_idx = code.find("// ═══════════════════════════════════════════════════════════════")
    end_idx = code.find("// ─── BOTÓN PUNTEADO ESTILO CUADERNO ────────────────────────────")
    if start_idx != -1 and end_idx != -1:
        code = code[:start_idx] + new_notebook_card + "\n" + code[end_idx:]

# 2. Reemplazar DashedButton
dashed_start = "function DashedButton({\n  children, onClick, color, active = false, disabled = false, fontSize = 14,"
dashed_end = "// ─── MENÚ FLOTANTE ⋮ ───────────────────────────────────────────"

new_dashed = """function DashedButton({
  children, onClick, color, active = false, disabled = false, fontSize = 14,
}: {
  children: React.ReactNode;
  onClick: () => void;
  active?: boolean;
  disabled?: boolean;
  fontSize?: number;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{
        padding: '9px 18px',
        borderRadius: 12,
        border: `1.5px dashed ${color}`,
        background: active ? `${color}33` : 'transparent',
        color: color,
        fontFamily: HAND,
        fontSize: fontSize,
        fontWeight: 700,
        cursor: disabled ? 'default' : 'pointer',
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        transition: 'all 0.2s ease',
        opacity: disabled ? 0.4 : 1,
        boxShadow: active ? `0 4px 16px ${color}33` : 'none',
        letterSpacing: '0.3px',
      }}
      onMouseEnter={(e) => {
        if (!disabled && !active) {
          (e.currentTarget as HTMLElement).style.background = `${color}15`;
        }
      }}
      onMouseLeave={(e) => {
        (e.currentTarget as HTMLElement).style.background = 'transparent';
      }}
    >
      {children}
    </button>
  );
}
// ─── MENÚ FLOTANTE ⋮ ───────────────────────────────────────────"""

if dashed_start in code:
    start_idx = code.find(dashed_start)
    end_idx = code.find(dashed_end)
    if start_idx != -1 and end_idx != -1:
        code = code[:start_idx] + new_dashed + "\n" + code[end_idx:]

with open(path, "w", encoding="utf-8") as f:
    f.write(code)

print("✅ Sintaxis JSX de NotebookCard y DashedButton reconstruida exitosamente.")
