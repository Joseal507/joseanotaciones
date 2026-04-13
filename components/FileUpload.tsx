'use client';

import { useState } from 'react';

interface FileUploadProps {
  onContentExtracted: (content: string) => void;
  onFlashcardsGenerated: (cards: any[]) => void;
}

export default function FileUpload({ onContentExtracted, onFlashcardsGenerated }: FileUploadProps) {
  const [file, setFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      setFile(e.target.files[0]);
      setMessage('');
    }
  };

  const handleUpload = async () => {
    if (!file) {
      setMessage('⚠️ Por favor selecciona un archivo');
      return;
    }

    setLoading(true);
    setMessage('📤 Subiendo archivo...');

    const formData = new FormData();
    formData.append('file', file);

    try {
      // Subir y extraer texto
      const uploadRes = await fetch('/api/upload', {
        method: 'POST',
        body: formData,
      });

      const uploadData = await uploadRes.json();

      if (!uploadData.success) {
        throw new Error(uploadData.error);
      }

      setMessage('🤖 Analizando contenido...');
      onContentExtracted(uploadData.content);

      // Generar flashcards
      const flashcardsRes = await fetch('/api/flashcards', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: uploadData.content }),
      });

      const flashcardsData = await flashcardsRes.json();

      if (flashcardsData.success) {
        onFlashcardsGenerated(flashcardsData.flashcards);
        setMessage('✅ ¡Archivo procesado exitosamente!');
      }

    } catch (error: any) {
      setMessage(`❌ Error: ${error.message}`);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="max-w-2xl mx-auto">
      <div className="bg-gray-900 rounded-2xl border border-gray-800 p-8 shadow-2xl">
        <h2 className="text-2xl font-bold mb-6 text-center">
          Sube tu documento
        </h2>

        {/* Zona de arrastrar */}
        <div className="border-2 border-dashed border-gray-700 rounded-xl p-12 text-center hover:border-blue-500 transition-colors duration-200">
          <input
            type="file"
            accept=".pdf,.doc,.docx,.txt"
            onChange={handleFileChange}
            className="hidden"
            id="file-upload"
          />
          <label
            htmlFor="file-upload"
            className="cursor-pointer flex flex-col items-center"
          >
            <div className="text-6xl mb-4">📄</div>
            <p className="text-lg text-gray-300 mb-2">
              {file ? file.name : 'Haz clic o arrastra tu archivo'}
            </p>
            <p className="text-sm text-gray-500">
              PDF, Word o TXT
            </p>
          </label>
        </div>

        {/* Botón de subida */}
        <button
          onClick={handleUpload}
          disabled={!file || loading}
          className="w-full mt-6 bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-700 hover:to-purple-700 disabled:from-gray-700 disabled:to-gray-800 disabled:cursor-not-allowed text-white font-semibold py-4 rounded-xl transition-all duration-200 transform hover:scale-105"
        >
          {loading ? '⏳ Procesando...' : '🚀 Analizar Documento'}
        </button>

        {/* Mensaje de estado */}
        {message && (
          <div className={`mt-4 p-4 rounded-lg ${
            message.includes('✅') ? 'bg-green-900/30 border border-green-700' :
            message.includes('❌') ? 'bg-red-900/30 border border-red-700' :
            'bg-blue-900/30 border border-blue-700'
          }`}>
            <p className="text-center">{message}</p>
          </div>
        )}
      </div>
    </div>
  );
}