'use client';

import { Materia, Tema, Apunte, Documento } from '../../lib/storage';
import { useIdioma } from '../../hooks/useIdioma';

interface Props {
  materia: Materia;
  tema: Tema;
  onBack: () => void;
  onBackMateria: () => void;
  onAbrirApunte: (a: Apunte) => void;
  onAbrirDocumento: (d: Documento) => void;
  onEliminarApunte: (id: string) => void;
  onEliminarDocumento: (id: string) => void;
  onNuevoApunte: () => void;
  onSubirDocumento: (e: React.ChangeEvent<HTMLInputElement>) => void;
  subiendoDoc: boolean;
}

export default function TemaView({
  materia, tema, onBack, onBackMateria,
  onAbrirApunte, onAbrirDocumento,
  onEliminarApunte, onEliminarDocumento,
  onNuevoApunte, onSubirDocumento, subiendoDoc,
}: Props) {
  const { idioma } = useIdioma();

  const getTipoIcon = (doc: Documento) => {
  if (doc.tipo === 'imagen') return '🖼️';
  if (doc.tipo === 'pdf') return '📄';
  if (doc.tipo === 'word') return '📝';
  if (doc.tipo === 'ppt') return '📊';
  if (doc.tipo === 'audio') return '🎵';
  return '📄';
};

  const ACCEPT = '.pdf,.doc,.docx,.ppt,.pptx,.txt,.jpg,.jpeg,.png,.webp,.mp3,.wav,.m4a,.ogg,.webm,.mp4';

  return (
    <div style={{ maxWidth: '1000px', margin: '0 auto' }}>

      {/* Breadcrumb */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '28px', flexWrap: 'wrap' }}>
        <button onClick={onBack} style={{ background: 'none', border: 'none', color: 'var(--gold)', fontWeight: 700, cursor: 'pointer', fontSize: '14px' }}>
          📚 {idioma === 'en' ? 'Subjects' : 'Materias'}
        </button>
        <span style={{ color: 'var(--text-faint)' }}>/</span>
        <button onClick={onBackMateria} style={{ background: 'none', border: 'none', color: materia.color, fontWeight: 700, cursor: 'pointer', fontSize: '14px' }}>
          {materia.emoji} {materia.nombre}
        </button>
        <span style={{ color: 'var(--text-faint)' }}>/</span>
        <span style={{ color: tema.color, fontWeight: 700, fontSize: '14px' }}>📁 {tema.nombre}</span>
      </div>

      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '32px', flexWrap: 'wrap', gap: '12px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <div style={{ width: '6px', height: '40px', background: tema.color, borderRadius: '3px' }} />
          <div>
            <h1 style={{ fontSize: '24px', fontWeight: 900, color: 'var(--text-primary)', margin: 0 }}>{tema.nombre}</h1>
            <p style={{ color: 'var(--text-muted)', fontSize: '13px', margin: 0 }}>
              {tema.apuntes.length} {idioma === 'en' ? 'notes' : 'apuntes'} · {tema.documentos.length} {idioma === 'en' ? 'files' : 'archivos'}
            </p>
          </div>
        </div>
        <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
          <button onClick={onNuevoApunte}
            style={{ padding: '10px 20px', borderRadius: '10px', border: `2px solid ${tema.color}`, background: 'transparent', color: tema.color, fontSize: '13px', fontWeight: 800, cursor: 'pointer' }}>
            ✏️ {idioma === 'en' ? 'New Note' : 'Nuevo Apunte'}
          </button>
          <label htmlFor="doc-upload"
            style={{ padding: '10px 20px', borderRadius: '10px', border: 'none', background: tema.color, color: '#000', fontSize: '13px', fontWeight: 800, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '6px' }}>
            {subiendoDoc
              ? (idioma === 'en' ? '⏳ Uploading...' : '⏳ Subiendo...')
              : (idioma === 'en' ? '📤 Upload File' : '📤 Subir Archivo')}
            <input
              id="doc-upload"
              type="file"
              accept={ACCEPT}
              onChange={onSubirDocumento}
              style={{ display: 'none' }}
            />
          </label>
        </div>
      </div>

      {/* Hint de formatos */}
      <div style={{ background: 'var(--bg-secondary)', borderRadius: '10px', padding: '10px 16px', marginBottom: '24px', display: 'flex', alignItems: 'center', gap: '8px', border: '1px solid var(--border-color)' }}>
        <span style={{ fontSize: '16px' }}>📁</span>
        <p style={{ fontSize: '12px', color: 'var(--text-faint)', margin: 0 }}>
          {idioma === 'en'
            ? 'Supported: PDF, Word, PowerPoint (.pptx), TXT, JPG, PNG, WebP, Audio — AI analyzes all formats'
            : 'Soportado: PDF, Word, PowerPoint (.pptx), TXT, JPG, PNG, WebP, Audio — la AI analiza todos los formatos'}
        </p>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '24px' }}>

        {/* APUNTES */}
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '16px' }}>
            <div style={{ width: '4px', height: '20px', background: tema.color, borderRadius: '2px' }} />
            <h2 style={{ fontSize: '16px', fontWeight: 800, color: 'var(--text-primary)', margin: 0 }}>
              ✏️ {idioma === 'en' ? 'Notes' : 'Apuntes'} ({tema.apuntes.length})
            </h2>
          </div>

          {tema.apuntes.length === 0 ? (
            <div style={{ background: 'var(--bg-card)', borderRadius: '16px', border: '2px dashed var(--border-color)', padding: '40px 20px', textAlign: 'center' }}>
              <div style={{ fontSize: '40px', marginBottom: '12px' }}>✏️</div>
              <p style={{ color: 'var(--text-faint)', fontSize: '14px', fontWeight: 600, marginBottom: '12px' }}>
                {idioma === 'en' ? 'No notes yet' : 'No hay apuntes'}
              </p>
              <button onClick={onNuevoApunte}
                style={{ padding: '8px 16px', borderRadius: '8px', border: 'none', background: tema.color, color: '#000', fontSize: '13px', fontWeight: 700, cursor: 'pointer' }}>
                + {idioma === 'en' ? 'Create note' : 'Crear apunte'}
              </button>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              {tema.apuntes.map(apunte => (
                <div key={apunte.id}
                  style={{ background: 'var(--bg-card)', borderRadius: '12px', border: '1px solid var(--border-color)', padding: '16px 20px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', transition: 'all 0.2s', cursor: 'pointer' }}
                  onMouseEnter={e => (e.currentTarget as HTMLDivElement).style.borderColor = tema.color}
                  onMouseLeave={e => (e.currentTarget as HTMLDivElement).style.borderColor = 'var(--border-color)'}
                >
                  <div onClick={() => onAbrirApunte(apunte)} style={{ flex: 1 }}>
                    <p style={{ fontSize: '15px', fontWeight: 700, color: 'var(--text-primary)', margin: '0 0 4px 0' }}>
                      📝 {apunte.titulo}
                    </p>
                    <p style={{ fontSize: '11px', color: 'var(--text-faint)', margin: 0 }}>
                      {apunte.fechaModificacion} · {apunte.contenido
                        ? (() => {
                            try {
                              const parsed = JSON.parse(apunte.contenido);
                              if (parsed.bloques) {
                                const texto = parsed.bloques
                                  .filter((b: any) => b.tipo === 'texto')
                                  .map((b: any) => b.html?.replace(/<[^>]*>/g, '') || '')
                                  .join(' ');
                                return `${texto.split(' ').filter(Boolean).length} ${idioma === 'en' ? 'words' : 'palabras'}`;
                              }
                            } catch {}
                            return `${apunte.contenido.split(' ').filter(Boolean).length} ${idioma === 'en' ? 'words' : 'palabras'}`;
                          })()
                        : `0 ${idioma === 'en' ? 'words' : 'palabras'}`}
                    </p>
                  </div>
                  <button onClick={() => onEliminarApunte(apunte.id)}
                    style={{ background: 'none', border: 'none', color: 'var(--text-faint)', cursor: 'pointer', fontSize: '16px', flexShrink: 0 }}>
                    🗑️
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* DOCUMENTOS */}
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '16px' }}>
            <div style={{ width: '4px', height: '20px', background: 'var(--blue)', borderRadius: '2px' }} />
            <h2 style={{ fontSize: '16px', fontWeight: 800, color: 'var(--text-primary)', margin: 0 }}>
              📁 {idioma === 'en' ? 'Files' : 'Archivos'} ({tema.documentos.length})
            </h2>
          </div>

          {tema.documentos.length === 0 ? (
            <div style={{ background: 'var(--bg-card)', borderRadius: '16px', border: '2px dashed var(--border-color)', padding: '40px 20px', textAlign: 'center' }}>
              <div style={{ fontSize: '40px', marginBottom: '12px' }}>📁</div>
              <p style={{ color: 'var(--text-faint)', fontSize: '14px', fontWeight: 600, marginBottom: '4px' }}>
                {idioma === 'en' ? 'No files yet' : 'No hay archivos'}
              </p>
              <p style={{ color: 'var(--text-faint)', fontSize: '12px', marginBottom: '12px' }}>
                PDF, Word, PowerPoint, TXT, JPG, PNG, Audio
              </p>
              <label htmlFor="doc-upload2"
                style={{ padding: '8px 16px', borderRadius: '8px', border: 'none', background: 'var(--blue)', color: '#000', fontSize: '13px', fontWeight: 700, cursor: 'pointer', display: 'inline-block' }}>
                📤 {idioma === 'en' ? 'Upload file' : 'Subir archivo'}
                <input
                  id="doc-upload2"
                  type="file"
                  accept={ACCEPT}
                  onChange={onSubirDocumento}
                  style={{ display: 'none' }}
                />
              </label>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              {tema.documentos.map(doc => (
                <div key={doc.id}
                  style={{ background: 'var(--bg-card)', borderRadius: '12px', border: '1px solid var(--border-color)', padding: '16px 20px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', transition: 'all 0.2s', cursor: 'pointer' }}
                  onMouseEnter={e => (e.currentTarget as HTMLDivElement).style.borderColor = 'var(--blue)'}
                  onMouseLeave={e => (e.currentTarget as HTMLDivElement).style.borderColor = 'var(--border-color)'}
                >
                  <div onClick={() => onAbrirDocumento(doc)} style={{ flex: 1, minWidth: 0 }}>
                    <p style={{ fontSize: '15px', fontWeight: 700, color: 'var(--text-primary)', margin: '0 0 4px 0', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {getTipoIcon(doc)} {doc.nombre}
                    </p>
                    <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', alignItems: 'center' }}>
                      <span style={{ fontSize: '11px', color: 'var(--text-faint)' }}>{doc.fechaSubida}</span>
                      <span style={{
                        fontSize: '10px',
                        background: doc.tipo === 'imagen' ? '#f472b620'
                          : doc.tipo === 'ppt' ? '#f9731620'
                          : 'var(--blue-dim)',
                        color: doc.tipo === 'imagen' ? 'var(--pink)'
                          : doc.tipo === 'ppt' ? '#f97316'
                          : 'var(--blue)',
                        padding: '1px 6px', borderRadius: '4px', fontWeight: 700, textTransform: 'uppercase',
                      }}>
                        {doc.tipo}
                      </span>
                      {doc.analisis && (
                        <span style={{ fontSize: '10px', background: '#4ade8015', color: '#4ade80', padding: '1px 6px', borderRadius: '4px', fontWeight: 700 }}>
                          ✓ {idioma === 'en' ? 'Analyzed' : 'Analizado'}
                        </span>
                      )}
                      {doc.flashcards && doc.flashcards.length > 0 && (
                        <span style={{ fontSize: '10px', background: 'var(--pink-dim)', color: 'var(--pink)', padding: '1px 6px', borderRadius: '4px', fontWeight: 700 }}>
                          🎴 {doc.flashcards.length}
                        </span>
                      )}
                    </div>
                  </div>
                  <button onClick={() => onEliminarDocumento(doc.id)}
                    style={{ background: 'none', border: 'none', color: 'var(--text-faint)', cursor: 'pointer', fontSize: '16px', flexShrink: 0, marginLeft: '8px' }}>
                    🗑️
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}