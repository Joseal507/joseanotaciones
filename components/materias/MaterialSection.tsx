'use client';
import { useRef } from 'react';

export default function MaterialSection({
  materiales,
  onUpload,
}: {
  materiales: any[];
  onUpload: (files: FileList) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);

  return (
    <div style={{ marginTop: 30 }}>
      <h3>📂 Material</h3>

      <button
        onClick={() => inputRef.current?.click()}
        style={{
          padding: 12,
          borderRadius: 10,
          border: '2px solid var(--text-primary)',
          background: 'var(--gold)',
          fontWeight: 800,
        }}
      >
        + Subir Material (máx 5 archivos)
      </button>

      <input
        ref={inputRef}
        type="file"
        multiple
        style={{ display: 'none' }}
        onChange={(e) => {
          if (!e.target.files) return;
          if (e.target.files.length > 5) {
            alert('Máximo 5 archivos.');
            return;
          }
          onUpload(e.target.files);
        }}
      />

      <div style={{ marginTop: 20 }}>
        {materiales?.map((m: any) => (
          <div key={m.id} style={{ marginBottom: 10 }}>
            📦 {m.titulo} ({m.archivos?.length || 0} archivos)
          </div>
        ))}
      </div>
    </div>
  );
}
