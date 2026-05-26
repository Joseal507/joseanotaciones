'use client';

const HAND = "'Caveat',cursive";
const BODY = "'Inter', system-ui, sans-serif";

interface Props {
  documento: any;
  tema: any;
  idioma: string;
  isMobile: boolean;
  analizando: boolean;
  recommendedCount: number | null;
  recommendedReason: string;
  flashcardsLength: number;
  tr: (key: string) => string;
  onAnalizar: () => void;
  onVerFlashcards: () => void;
  onVerDoc: () => void;
  esImagen: boolean;
}

export default function TabAnalisis({
  documento, tema, idioma, isMobile, analizando, recommendedCount, recommendedReason,
  flashcardsLength, tr, onAnalizar, onVerFlashcards, onVerDoc, esImagen,
}: Props) {

  if (!documento.analisis) {
    return (
      <div style={{
        textAlign: 'center', padding: '50px 20px',
        background: 'var(--bg-card)',
        border: '2.5px dashed var(--border-color)',
        borderRadius: 14,
        transform: 'rotate(-0.5deg)',
        position: 'relative', overflow: 'hidden',
      }}>
        {[35, 55, 75].map(pct => (
          <div key={pct} style={{
            position: 'absolute', left: '8%', right: '8%',
            top: `${pct}%`, height: 1,
            background: 'var(--border-color)', opacity: 0.4,
            pointerEvents: 'none',
          }}/>
        ))}
        <div style={{ fontSize: 60, marginBottom: 12, position: 'relative' }}>{esImagen ? '🖼️' : '🔍'}</div>
        <h3 style={{
          fontFamily: HAND, fontSize: 28, fontWeight: 900,
          color: 'var(--text-primary)', margin: '0 0 8px',
          transform: 'rotate(-1deg)', display: 'inline-block',
          position: 'relative',
        }}>
          {tr('sinAnalisis')}
        </h3>
        <p style={{
          fontFamily: BODY, fontSize: 18, fontStyle: 'italic',
          color: 'var(--text-muted)', margin: '0 0 4px',
          position: 'relative',
        }}>
          ~ {esImagen
            ? (idioma === 'en' ? 'AI will extract text and identify key concepts' : 'la AI extraerá texto e identificará conceptos clave')
            : tr('tocaAnalizar')} ~
        </p>
        <p style={{
          fontFamily: BODY, fontSize: 14,
          color: 'var(--text-faint)', margin: '0 0 22px',
          position: 'relative',
        }}>
          💡 {idioma === 'en' ? 'Uses GPT-OSS-120B + Kimi-K2 + Llama-3.3-70B' : 'Usa GPT-OSS-120B + Kimi-K2 + Llama-3.3-70B'}
        </p>
        <button onClick={onAnalizar} disabled={analizando}
          style={{
            padding: '12px 28px',
            borderRadius: 12,
            border: '2.5px solid var(--text-primary)',
            background: 'var(--gold)', color: '#000',
            fontFamily: HAND, fontSize: 20, fontWeight: 800,
            cursor: 'pointer',
            boxShadow: '3px 4px 0 var(--text-primary)',
            transform: 'rotate(-1.5deg)',
            transition: 'all 0.25s cubic-bezier(.25,.8,.25,1)',
            position: 'relative',
          }}
          onMouseEnter={(e:any)=>{
            if (!analizando) {
              e.currentTarget.style.transform = 'rotate(0deg) translateY(-2px)';
              e.currentTarget.style.boxShadow = '4px 6px 0 var(--text-primary)';
            }
          }}
          onMouseLeave={(e:any)=>{
            e.currentTarget.style.transform = 'rotate(-1.5deg)';
            e.currentTarget.style.boxShadow = '3px 4px 0 var(--text-primary)';
          }}
        >
          {analizando ? '⏳ ' + tr('analizando') : esImagen ? '🖼️ ' + (idioma === 'en' ? 'Analyze Image' : 'Analizar Imagen') : '🔍 ' + tr('analizarDocumento')}
        </button>
      </div>
    );
  }

  const a = documento.analisis as any;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>

      {/* Banner recomendación */}
      {recommendedCount && (
        <NotebookCard color={tema.color} bandaEmoji="🤖" bandaTexto={idioma === 'en' ? 'AI Recommendation' : 'Recomendación de la AI'} rot={-0.5}>
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 14 }}>
            <div style={{ fontSize: 38 }}>🤖</div>
            <div style={{ flex: 1 }}>
              <p style={{
                fontFamily: HAND, fontSize: 20, fontWeight: 800,
                color: 'var(--text-primary)', margin: '0 0 4px', lineHeight: 1.15,
              }}>
                {idioma === 'en'
                  ? `${recommendedCount} unique flashcards covering 100% of content`
                  : `${recommendedCount} flashcards únicas cubriendo el 100% del contenido`}
              </p>
              {recommendedReason && (
                <p style={{
                  fontFamily: BODY, fontSize: 16,
                  color: 'var(--text-muted)', fontStyle: 'italic',
                  margin: 0, lineHeight: 1.3,
                }}>
                  ~ {recommendedReason} ~
                </p>
              )}
              <button onClick={onVerFlashcards}
                style={{
                  marginTop: 10,
                  padding: '7px 16px',
                  borderRadius: 10,
                  border: '2.5px solid var(--text-primary)',
                  background: tema.color, color: '#000',
                  fontFamily: HAND, fontSize: 17, fontWeight: 800,
                  cursor: 'pointer',
                  boxShadow: '2px 3px 0 var(--text-primary)',
                  transform: 'rotate(-1.5deg)',
                  transition: 'all 0.25s cubic-bezier(.25,.8,.25,1)',
                }}
                onMouseEnter={(e:any)=>{e.currentTarget.style.transform='rotate(0deg) translateY(-2px)';}}
                onMouseLeave={(e:any)=>{e.currentTarget.style.transform='rotate(-1.5deg)';}}
              >
                🎴 {idioma === 'en' ? 'View Flashcards' : 'Ver Flashcards'} ({flashcardsLength})
              </button>
            </div>
          </div>
        </NotebookCard>
      )}

      {/* Resumen */}
      <NotebookCard color={tema.color} bandaEmoji="📋" bandaTexto={tr('resumenDocumento')} rot={0.4}>
        <p style={{
          fontFamily: BODY, fontSize: 18, fontWeight: 600,
          color: 'var(--text-secondary)', lineHeight: 1.55,
          margin: 0,
        }}>
          {a.summary}
        </p>
      </NotebookCard>

      {/* Keywords y frases lado a lado */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr',
        gap: 16,
      }}>
        <NotebookCard color="var(--blue)" bandaEmoji="🔑" bandaTexto={`${tr('palabrasClave')} (${a.keywords?.length || 0})`} rot={-0.6}>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {a.keywords?.map((k: string, i: number) => (
              <span key={i} style={{
                background: 'var(--blue)', color: '#000',
                border: '2px solid var(--text-primary)',
                boxShadow: '2px 2px 0 var(--text-primary)',
                padding: '3px 10px', borderRadius: 8,
                fontFamily: HAND, fontSize: 15, fontWeight: 800,
                transform: `rotate(${(i % 5 - 2) * 0.7}deg)`,
                cursor: 'default',
                transition: 'transform 0.25s',
              }}
                onMouseEnter={(e:any)=>e.currentTarget.style.transform='rotate(0deg) scale(1.08)'}
                onMouseLeave={(e:any)=>e.currentTarget.style.transform=`rotate(${(i % 5 - 2) * 0.7}deg)`}
              >
                {k}
              </span>
            ))}
          </div>
        </NotebookCard>

        <NotebookCard color={tema.color} bandaEmoji="✨" bandaTexto={`${tr('frasesImportantes')} (${a.important_phrases?.length || 0})`} rot={0.6}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
            {a.important_phrases?.map((p: string, i: number) => (
              <div key={i} style={{
                background: tema.color, color: '#000',
                border: '2px solid var(--text-primary)',
                boxShadow: '2px 2px 0 var(--text-primary)',
                padding: '8px 12px', borderRadius: 8,
                fontFamily: HAND, fontSize: 15, fontWeight: 700,
                lineHeight: 1.35,
                transform: `rotate(${(i % 3 - 1) * 0.5}deg)`,
              }}>
                "{p}"
              </div>
            ))}
          </div>
        </NotebookCard>
      </div>

      {/* Conceptos clave y nivel */}
      {(a.key_concepts?.length > 0 || a.difficulty_level) && (
        <div style={{
          display: 'grid',
          gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr',
          gap: 16,
        }}>
          {a.key_concepts?.length > 0 && (
            <NotebookCard color="#f472b6" bandaEmoji="🧠" bandaTexto={idioma === 'en' ? 'Key Concepts' : 'Conceptos Clave'} rot={-0.5}>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {a.key_concepts?.map((c: string, i: number) => (
                  <span key={i} style={{
                    background: 'color-mix(in srgb,#f472b6 18%,transparent)',
                    border: '2px dashed #f472b6',
                    color: '#f472b6',
                    padding: '4px 10px', borderRadius: 8,
                    fontFamily: HAND, fontSize: 15, fontWeight: 700,
                    transform: `rotate(${(i % 3 - 1) * 0.6}deg)`,
                  }}>
                    {c}
                  </span>
                ))}
              </div>
            </NotebookCard>
          )}
          {(a.difficulty_level || a.topics?.length > 0) && (
            <NotebookCard color="#a78bfa" bandaEmoji="📊" bandaTexto={idioma === 'en' ? 'Level & Topics' : 'Nivel y Temas'} rot={0.5}>
              {a.difficulty_level && (
                <span style={{
                  display: 'inline-block',
                  background: '#a78bfa', color: '#000',
                  border: '2px solid var(--text-primary)',
                  boxShadow: '2px 2px 0 var(--text-primary)',
                  padding: '4px 12px', borderRadius: 8,
                  fontFamily: HAND, fontSize: 16, fontWeight: 800,
                  marginBottom: 10,
                  transform: 'rotate(-2deg)',
                }}>
                  {a.difficulty_level}
                </span>
              )}
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
                {a.topics?.map((t: string, i: number) => (
                  <span key={i} style={{
                    background: 'var(--bg-secondary)',
                    color: 'var(--text-muted)',
                    padding: '3px 9px', borderRadius: 6,
                    fontFamily: HAND, fontSize: 14, fontWeight: 700,
                    border: '1.5px dashed var(--border-color)',
                    transform: `rotate(${(i % 3 - 1) * 0.5}deg)`,
                  }}>
                    {t}
                  </span>
                ))}
              </div>
            </NotebookCard>
          )}
        </div>
      )}

      {/* Study tips */}
      {a.study_tips?.length > 0 && (
        <NotebookCard color="#4ade80" bandaEmoji="💡" bandaTexto={idioma === 'en' ? 'Study Tips' : 'Consejos de Estudio'} rot={-0.4}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {a.study_tips?.map((tip: string, i: number) => (
              <div key={i} style={{
                display: 'flex', gap: 10, alignItems: 'flex-start',
              }}>
                <span style={{
                  color: '#4ade80', fontWeight: 900,
                  flexShrink: 0, fontSize: 18, lineHeight: 1,
                }}>✦</span>
                <p style={{
                  fontFamily: BODY, fontSize: 17, fontWeight: 600,
                  color: 'var(--text-secondary)',
                  margin: 0, lineHeight: 1.4,
                }}>
                  {tip}
                </p>
              </div>
            ))}
          </div>
        </NotebookCard>
      )}

      {/* Visual elements */}
      {a.visual_elements?.length > 0 && (
        <NotebookCard color="var(--gold)" bandaEmoji="🖼️" bandaTexto={idioma === 'en' ? 'Visual Elements' : 'Elementos Visuales'} rot={0.4}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {a.visual_elements?.map((v: string, i: number) => (
              <div key={i} style={{
                background: 'color-mix(in srgb,var(--gold) 14%,transparent)',
                border: '2px dashed var(--gold)',
                color: 'var(--text-primary)',
                padding: '8px 12px', borderRadius: 8,
                fontFamily: HAND, fontSize: 16, fontWeight: 600,
                transform: `rotate(${(i % 3 - 1) * 0.4}deg)`,
              }}>
                {v}
              </div>
            ))}
          </div>
        </NotebookCard>
      )}

      {/* Conexiones */}
      {a.connections?.length > 0 && (
        <NotebookCard color="#38bdf8" bandaEmoji="🔗" bandaTexto={idioma === 'en' ? 'Connections' : 'Conexiones entre conceptos'} rot={-0.4}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
            {a.connections?.map((c: string, i: number) => (
              <div key={i} style={{
                display: 'flex', gap: 8, alignItems: 'flex-start',
              }}>
                <span style={{
                  color: '#38bdf8', fontWeight: 900,
                  flexShrink: 0, fontSize: 18, lineHeight: 1,
                }}>→</span>
                <p style={{
                  fontFamily: BODY, fontSize: 17, fontWeight: 600,
                  color: 'var(--text-secondary)',
                  margin: 0, lineHeight: 1.4,
                }}>
                  {c}
                </p>
              </div>
            ))}
          </div>
        </NotebookCard>
      )}

      <div style={{ textAlign: 'center', marginTop: 8 }}>
        <button onClick={onVerDoc}
          style={{
            padding: '12px 26px',
            borderRadius: 12,
            border: '2.5px solid var(--text-primary)',
            background: tema.color, color: '#000',
            fontFamily: HAND, fontSize: 20, fontWeight: 800,
            cursor: 'pointer',
            boxShadow: '3px 4px 0 var(--text-primary)',
            transform: 'rotate(-1deg)',
            transition: 'all 0.25s cubic-bezier(.25,.8,.25,1)',
          }}
          onMouseEnter={(e:any)=>{
            e.currentTarget.style.transform = 'rotate(0deg) translateY(-2px)';
            e.currentTarget.style.boxShadow = '4px 6px 0 var(--text-primary)';
          }}
          onMouseLeave={(e:any)=>{
            e.currentTarget.style.transform = 'rotate(-1deg)';
            e.currentTarget.style.boxShadow = '3px 4px 0 var(--text-primary)';
          }}
        >
          {esImagen
            ? (idioma === 'en' ? '🖼️ View Image' : '🖼️ Ver Imagen')
            : '📖 ' + tr('leerConHighlights')}
        </button>
      </div>
    </div>
  );
}

// ── Card cuaderno reutilizable ──
function NotebookCard({ children, color, bandaEmoji, bandaTexto, rot }: {
  children: React.ReactNode;
  color: string;
  bandaEmoji: string;
  bandaTexto: string;
  rot: number;
}) {
  return (
    <div style={{
      background: 'var(--bg-card)',
      border: '2.5px solid var(--text-primary)',
      borderRadius: 12,
      boxShadow: `4px 5px 0 ${color}`,
      transform: `rotate(${rot}deg)`,
      overflow: 'hidden',
      transition: 'transform 0.25s',
    }}>
      <div style={{
        background: color,
        padding: '6px 14px',
        borderBottom: '2px solid var(--text-primary)',
      }}>
        <span style={{
          fontFamily: HAND, fontSize: 16, fontWeight: 800,
          color: '#000', fontStyle: 'italic',
        }}>
          {bandaEmoji} {bandaTexto}
        </span>
      </div>
      <div style={{ padding: '16px 18px' }}>
        {children}
      </div>
    </div>
  );
}