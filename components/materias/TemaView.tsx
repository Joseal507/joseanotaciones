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
  const { tr, idioma } = useIdioma();

  return (
    <div style={{ maxWidth: '1000px', margin: '0 auto' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '28px', flexWrap: 'wrap' }}>
        <button onClick={onBack} style={{ background: 'none', border: 'none', color: 'var(--gold)', fontWeight: 700, cursor: 'pointer', fontSize: '14px' }}>
          📚 {tr('materias')}
        </button>
        <span style={{ color: 'var(--text-faint)' }}>/</span>
        <button onClick={onBackMateria} style={{ background: 'none', border: 'none', color: materia.color, fontWeight: 700, cursor: 'pointer', fontSize: '14px' }}>
          {materia.emoji} {materia.nombre}
        </button>
        <span style={{ color: 'var(--text-faint)' }}>/</span>
        <span style={{ color: tema.color, fontWeight: 700, fontSize: '14px' }}>📁 {tema.nombre}</span>
      </div>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '32px', flexWrap: 'wrap', gap: '12px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <div style={{ width: '6px', height: '40px', background: tema.color, borderRadius: '3px' }} />
          <div>
            <h1 style={{ fontSize: '24px', fontWeight: 900, color: 'var(--text-primary)', margin: 0 }}>{tema.nombre}</h1>
            <p style={{ color: 'var(--text-muted)', fontSize: '13px', margin: 0 }}>
              {tema.apuntes.length} {idioma === 'en' ? 'notes' : 'apuntes'} · {tema.documentos.length} {idioma === 'en' ? 'documents' : 'documentos'}
            </p>
          </div>
        </div>
        <div style={{ display: 'flex', gap: '10px' }}>
          <button onClick={onNuevoApunte}
            style={{ padding: '10px 20px', borderRadius: '10px', border: `2px solid ${tema.color}`, background: 'transparent', color: tema.color, fontSize: '13px', fontWeight: 800, cursor: 'pointer' }}>
            ✏️ {idioma === 'en' ? 'New Note' : 'Nuevo Apunte'}
          </button>
          <label htmlFor="doc-upload"
            style={{ padding: '10px 20px', borderRadius: '10px', border: 'none', background: tema.color, color: '#000', fontSize: '13px', fontWeight: 800, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '6px' }}>
            {subiendoDoc ? (idioma === 'en' ? '⏳ Uploading...' : '⏳ Subiendo...') : (idioma === 'en' ? '📤 Upload Document' : '📤 Subir Documento')}
            <input id="doc-upload" type="file" accept=".pdf,.doc,.docx,.txt" onChange={onSubirDocumento} style={{ display: 'none' }} />
          </label>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '24px' }}>

        {/* APUNTES */}
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '16px' }}>
            <div style={{ width: '4px', height: '20px', background: tema.color, borderRadius: '2px' }} />
            <h2 style={{ fontSize: '16px', fontWeight: 800, color: 'var(--text-primary)', margin: 0 }}>{idioma === 'en' ? 'Notes' : 'Apuntes'}</h2>
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
                    <p style={{ fontSize: '15px', fontWeight: 700, color: 'var(--text-primary)', margin: '0 0 4px 0' }}>📝 {apunte.titulo}</p>
                    <p style={{ fontSize: '11px', color: 'var(--text-faint)', margin: 0 }}>
                      {apunte.fechaModificacion} · {apunte.contenido.split(' ').filter(Boolean).length} {idioma === 'en' ? 'words' : 'palabras'}
                    </p>
                  </div>
                  <button onClick={() => onEliminarApunte(apunte.id)}
                    style={{ background: 'none', border: 'none', color: 'var(--text-faint)', cursor: 'pointer', fontSize: '16px' }}>
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
            <h2 style={{ fontSize: '16px', fontWeight: 800, color: 'var(--text-primary)', margin: 0 }}>{idioma === 'en' ? 'Documents' : 'Documentos'}</h2>
          </div>

          {tema.documentos.length === 0 ? (
            <div style={{ background: 'var(--bg-card)', borderRadius: '16px', border: '2px dashed var(--border-color)', padding: '40px 20px', textAlign: 'center' }}>
              <div style={{ fontSize: '40px', marginBottom: '12px' }}>📄</div>
              <p style={{ color: 'var(--text-faint)', fontSize: '14px', fontWeight: 600, marginBottom: '12px' }}>
                {idioma === 'en' ? 'No documents yet' : 'No hay documentos'}
              </p>
              <label htmlFor="doc-upload2"
                style={{ padding: '8px 16px', borderRadius: '8px', border: 'none', background: 'var(--blue)', color: '#000', fontSize: '13px', fontWeight: 700, cursor: 'pointer', display: 'inline-block' }}>
                📤 {idioma === 'en' ? 'Upload document' : 'Subir documento'}
                <input id="doc-upload2" type="file" accept=".pdf,.doc,.docx,.txt" onChange={onSubirDocumento} style={{ display: 'none' }} />
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
                  <div onClick={() => onAbrirDocumento(doc)} style={{ flex: 1 }}>
                    <p style={{ fontSize: '15px', fontWeight: 700, color: 'var(--text-primary)', margin: '0 0 4px 0' }}>📄 {doc.nombre}</p>
                    <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                      <span style={{ fontSize: '11px', color: 'var(--text-faint)' }}>{doc.fechaSubida}</span>
                      {doc.analisis && <span style={{ fontSize: '11px', background: 'var(--blue)', color: '#000', padding: '1px 6px', borderRadius: '4px', fontWeight: 700 }}>{idioma === 'en' ? 'Analyzed ✓' : 'Analizado ✓'}</span>}
                      {doc.flashcards && doc.flashcards.length > 0 && (
                        <span style={{ fontSize: '11px', background: 'var(--pink)', color: '#000', padding: '1px 6px', borderRadius: '4px', fontWeight: 700 }}>
                          {doc.flashcards.length} cards
                        </span>
                      )}
                    </div>
                  </div>
                  <button onClick={() => onEliminarDocumento(doc.id)}
                    style={{ background: 'none', border: 'none', color: 'var(--text-faint)', cursor: 'pointer', fontSize: '16px' }}>
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