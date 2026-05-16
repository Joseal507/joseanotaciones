'use client';

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

export default function TabAnalisis({ documento, tema, idioma, isMobile, analizando, recommendedCount, recommendedReason, flashcardsLength, tr, onAnalizar, onVerFlashcards, onVerDoc, esImagen }: Props) {
  if (!documento.analisis) {
    return (
      <div style={{ textAlign: 'center', padding: '60px 0' }}>
        <div style={{ fontSize: '60px', marginBottom: '16px' }}>{esImagen ? '🖼️' : '🔍'}</div>
        <h3 style={{ fontSize: '20px', fontWeight: 800, color: 'var(--text-primary)', margin: '0 0 8px' }}>{tr('sinAnalisis')}</h3>
        <p style={{ color: 'var(--text-muted)', marginBottom: '8px' }}>
          {esImagen ? (idioma === 'en' ? 'AI will extract text and identify key concepts' : 'La AI extraerá texto e identificará conceptos clave') : tr('tocaAnalizar')}
        </p>
        <p style={{ color: 'var(--text-faint)', fontSize: '13px', marginBottom: '24px' }}>
          {idioma === 'en' ? '💡 Uses GPT-OSS-120B + Kimi-K2 + Llama-3.3-70B for deep analysis' : '💡 Usa GPT-OSS-120B + Kimi-K2 + Llama-3.3-70B para análisis profundo'}
        </p>
        <button onClick={onAnalizar} disabled={analizando}
          style={{ padding: '14px 28px', borderRadius: '12px', border: 'none', background: 'var(--gold)', color: '#000', fontSize: '15px', fontWeight: 800, cursor: 'pointer' }}>
          {analizando ? tr('analizando') : esImagen ? '🖼️ ' + (idioma === 'en' ? 'Analyze Image' : 'Analizar Imagen') : '🔍 ' + tr('analizarDocumento')}
        </button>
      </div>
    );
  }

  const a = documento.analisis as any;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>

      {/* Banner recomendación */}
      {recommendedCount && (
        <div style={{ background: tema.color + '15', border: `2px solid ${tema.color}44`, borderRadius: '16px', padding: '20px', display: 'flex', alignItems: 'flex-start', gap: '16px' }}>
          <div style={{ fontSize: '36px' }}>🤖</div>
          <div style={{ flex: 1 }}>
            <h3 style={{ fontSize: '15px', fontWeight: 800, color: tema.color, margin: '0 0 6px' }}>
              {idioma === 'en' ? 'AI Recommendation' : 'Recomendación de la AI'}
            </h3>
            <p style={{ fontSize: '14px', color: 'var(--text-primary)', margin: '0 0 6px', fontWeight: 700 }}>
              {idioma === 'en' ? `${recommendedCount} unique flashcards covering 100% of content` : `${recommendedCount} flashcards únicas cubriendo el 100% del contenido`}
            </p>
            {recommendedReason && <p style={{ fontSize: '13px', color: 'var(--text-muted)', margin: 0 }}>{recommendedReason}</p>}
            <button onClick={onVerFlashcards} style={{ marginTop: '10px', padding: '7px 18px', borderRadius: '8px', border: 'none', background: tema.color, color: '#000', fontSize: '12px', fontWeight: 800, cursor: 'pointer' }}>
              🎴 {idioma === 'en' ? 'View Flashcards' : 'Ver Flashcards'} ({flashcardsLength})
            </button>
          </div>
        </div>
      )}

      {/* Resumen */}
      <div style={{ background: 'var(--bg-card)', borderRadius: '16px', border: `2px solid ${tema.color}44`, overflow: 'hidden' }}>
        <div style={{ height: '4px', background: tema.color }} />
        <div style={{ padding: '20px' }}>
          <h3 style={{ fontSize: '13px', fontWeight: 800, color: tema.color, textTransform: 'uppercase', letterSpacing: '1px', margin: '0 0 10px' }}>{tr('resumenDocumento')}</h3>
          <p style={{ fontSize: '15px', color: 'var(--text-secondary)', lineHeight: 1.7, margin: 0 }}>{a.summary}</p>
        </div>
      </div>

      {/* Keywords y frases */}
      <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr', gap: '16px' }}>
        <div style={{ background: 'var(--bg-card)', borderRadius: '16px', border: '1px solid var(--border-color)', overflow: 'hidden' }}>
          <div style={{ height: '4px', background: 'var(--blue)' }} />
          <div style={{ padding: '18px' }}>
            <h3 style={{ fontSize: '13px', fontWeight: 800, color: 'var(--blue)', textTransform: 'uppercase', letterSpacing: '1px', margin: '0 0 12px' }}>
              {tr('palabrasClave')} ({a.keywords?.length || 0})
            </h3>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
              {a.keywords?.map((k: string, i: number) => (
                <span key={i} style={{ background: 'var(--blue)', color: '#000', padding: '4px 10px', borderRadius: '20px', fontSize: '12px', fontWeight: 700 }}>{k}</span>
              ))}
            </div>
          </div>
        </div>
        <div style={{ background: 'var(--bg-card)', borderRadius: '16px', border: `2px solid ${tema.color}44`, overflow: 'hidden' }}>
          <div style={{ height: '4px', background: tema.color }} />
          <div style={{ padding: '18px' }}>
            <h3 style={{ fontSize: '13px', fontWeight: 800, color: tema.color, textTransform: 'uppercase', letterSpacing: '1px', margin: '0 0 12px' }}>
              {tr('frasesImportantes')} ({a.important_phrases?.length || 0})
            </h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              {a.important_phrases?.map((p: string, i: number) => (
                <div key={i} style={{ background: tema.color, color: '#000', padding: '8px 12px', borderRadius: '8px', fontSize: '12px', fontWeight: 600, lineHeight: 1.4 }}>"{p}"</div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Conceptos clave y nivel */}
      {(a.key_concepts?.length > 0 || a.difficulty_level) && (
        <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr', gap: '16px' }}>
          {a.key_concepts?.length > 0 && (
            <div style={{ background: 'var(--bg-card)', borderRadius: '16px', border: '1px solid var(--border-color)', overflow: 'hidden' }}>
              <div style={{ height: '4px', background: '#f472b6' }} />
              <div style={{ padding: '18px' }}>
                <h3 style={{ fontSize: '13px', fontWeight: 800, color: '#f472b6', textTransform: 'uppercase', letterSpacing: '1px', margin: '0 0 12px' }}>🧠 {idioma === 'en' ? 'Key Concepts' : 'Conceptos Clave'}</h3>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                  {a.key_concepts?.map((c: string, i: number) => (
                    <span key={i} style={{ background: '#f472b620', border: '1px solid #f472b644', color: '#f472b6', padding: '4px 10px', borderRadius: '8px', fontSize: '12px', fontWeight: 600 }}>{c}</span>
                  ))}
                </div>
              </div>
            </div>
          )}
          {(a.difficulty_level || a.topics?.length > 0) && (
            <div style={{ background: 'var(--bg-card)', borderRadius: '16px', border: '1px solid var(--border-color)', overflow: 'hidden' }}>
              <div style={{ height: '4px', background: '#a78bfa' }} />
              <div style={{ padding: '18px' }}>
                <h3 style={{ fontSize: '13px', fontWeight: 800, color: '#a78bfa', textTransform: 'uppercase', letterSpacing: '1px', margin: '0 0 12px' }}>📊 {idioma === 'en' ? 'Level & Topics' : 'Nivel y Temas'}</h3>
                {a.difficulty_level && <span style={{ display: 'inline-block', background: '#a78bfa', color: '#000', padding: '4px 12px', borderRadius: '20px', fontSize: '12px', fontWeight: 700, marginBottom: '8px' }}>{a.difficulty_level}</span>}
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
                  {a.topics?.map((t: string, i: number) => (
                    <span key={i} style={{ background: 'var(--bg-secondary)', color: 'var(--text-muted)', padding: '3px 8px', borderRadius: '6px', fontSize: '11px', border: '1px solid var(--border-color)' }}>{t}</span>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Study tips */}
      {a.study_tips?.length > 0 && (
        <div style={{ background: 'var(--bg-card)', borderRadius: '16px', border: '1px solid var(--border-color)', overflow: 'hidden' }}>
          <div style={{ height: '4px', background: '#4ade80' }} />
          <div style={{ padding: '18px' }}>
            <h3 style={{ fontSize: '13px', fontWeight: 800, color: '#4ade80', textTransform: 'uppercase', letterSpacing: '1px', margin: '0 0 12px' }}>💡 {idioma === 'en' ? 'Study Tips' : 'Consejos de Estudio'}</h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {a.study_tips?.map((tip: string, i: number) => (
                <div key={i} style={{ display: 'flex', gap: '10px', alignItems: 'flex-start' }}>
                  <span style={{ color: '#4ade80', fontWeight: 900, flexShrink: 0 }}>•</span>
                  <p style={{ fontSize: '13px', color: 'var(--text-secondary)', margin: 0, lineHeight: 1.5 }}>{tip}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Visual elements */}
      {a.visual_elements?.length > 0 && (
        <div style={{ background: 'var(--bg-card)', borderRadius: '16px', border: '1px solid var(--border-color)', overflow: 'hidden' }}>
          <div style={{ height: '4px', background: 'var(--gold)' }} />
          <div style={{ padding: '18px' }}>
            <h3 style={{ fontSize: '13px', fontWeight: 800, color: 'var(--gold)', textTransform: 'uppercase', letterSpacing: '1px', margin: '0 0 12px' }}>🖼️ {idioma === 'en' ? 'Visual Elements' : 'Elementos Visuales'}</h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              {a.visual_elements?.map((v: string, i: number) => (
                <div key={i} style={{ background: 'var(--gold-dim)', border: '1px solid var(--gold-border)', color: 'var(--text-primary)', padding: '8px 12px', borderRadius: '8px', fontSize: '13px' }}>{v}</div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Conexiones */}
      {a.connections?.length > 0 && (
        <div style={{ background: 'var(--bg-card)', borderRadius: '16px', border: '1px solid var(--border-color)', overflow: 'hidden' }}>
          <div style={{ height: '4px', background: '#38bdf8' }} />
          <div style={{ padding: '18px' }}>
            <h3 style={{ fontSize: '13px', fontWeight: 800, color: '#38bdf8', textTransform: 'uppercase', letterSpacing: '1px', margin: '0 0 12px' }}>🔗 {idioma === 'en' ? 'Connections' : 'Conexiones entre conceptos'}</h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              {a.connections?.map((c: string, i: number) => (
                <div key={i} style={{ display: 'flex', gap: '8px', alignItems: 'flex-start' }}>
                  <span style={{ color: '#38bdf8', fontWeight: 900, flexShrink: 0 }}>→</span>
                  <p style={{ fontSize: '13px', color: 'var(--text-secondary)', margin: 0, lineHeight: 1.5 }}>{c}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      <div style={{ textAlign: 'center' }}>
        <button onClick={onVerDoc} style={{ padding: '12px 28px', borderRadius: '12px', border: 'none', background: tema.color, color: '#000', fontSize: '14px', fontWeight: 800, cursor: 'pointer' }}>
          {esImagen ? (idioma === 'en' ? '🖼️ View Image' : '🖼️ Ver Imagen') : tr('leerConHighlights')}
        </button>
      </div>
    </div>
  );
}