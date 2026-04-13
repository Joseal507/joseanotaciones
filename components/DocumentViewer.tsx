'use client';

interface DocumentViewerProps {
  content: string;
}

export default function DocumentViewer({ content }: DocumentViewerProps) {
  if (!content) {
    return (
      <div className="max-w-4xl mx-auto text-center py-20">
        <div className="text-6xl mb-4">📭</div>
        <p className="text-gray-400 text-lg">
          Sube un documento para verlo aquí
        </p>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto">
      <div className="bg-gray-900 rounded-2xl border border-gray-800 p-8 shadow-2xl">
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-2xl font-bold">📖 Tu Documento</h2>
          <span className="text-sm text-gray-400">
            {content.split(' ').length} palabras
          </span>
        </div>
        
        <div className="bg-black/50 rounded-xl p-6 max-h-[600px] overflow-y-auto">
          <div className="prose prose-invert max-w-none">
            {content.split('\n').map((paragraph, index) => (
              paragraph.trim() && (
                <p key={index} className="mb-4 text-gray-300 leading-relaxed">
                  {paragraph}
                </p>
              )
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}