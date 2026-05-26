import pathlib

path = pathlib.Path('components/materias/FlashcardSourceViewer.tsx')
text = path.read_text(encoding='utf-8')

# El problema: en Tesseract.js v5+, hay que pedir 'words' explícitamente con output options
old = """      const result = await Tesseract.recognize(canvas, 'spa+eng', {
        logger: (m: any) => {
          if (m.status === 'recognizing text' && typeof m.progress === 'number') {
            setOcrProgress(Math.round(m.progress * 100));
          }
        },
      });

      const words: any[] = (result.data as any).words || [];
      console.log('📝 ' + words.length + ' palabras detectadas');"""

new = """      // Crear worker manualmente para tener control de output
      const worker = await Tesseract.createWorker(['spa', 'eng'], 1, {
        logger: (m: any) => {
          if (m.status === 'recognizing text' && typeof m.progress === 'number') {
            setOcrProgress(Math.round(m.progress * 100));
          }
        },
      });

      // Activar output de palabras con bboxes
      await worker.setParameters({
        tessedit_pageseg_mode: '6' as any, // assume single uniform block
      });

      const result = await worker.recognize(canvas, {}, {
        text: true,
        blocks: true,
      } as any);

      let words: any[] = (result.data as any).words || [];

      // Si no hay 'words' directo, extraerlos de blocks > paragraphs > lines > words
      if (!words.length && (result.data as any).blocks) {
        const blocks = (result.data as any).blocks || [];
        for (const blk of blocks) {
          for (const par of (blk.paragraphs || [])) {
            for (const ln of (par.lines || [])) {
              for (const w of (ln.words || [])) {
                words.push(w);
              }
            }
          }
        }
      }

      console.log('📝 ' + words.length + ' palabras detectadas');
      await worker.terminate();"""

if old in text:
    text = text.replace(old, new)
    print("✅ API de Tesseract actualizada a v5+")
else:
    print("❌ No encontré bloque Tesseract.recognize")

path.write_text(text, encoding='utf-8')
