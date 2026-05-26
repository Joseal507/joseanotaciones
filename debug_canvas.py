import pathlib

path = pathlib.Path('components/materias/FlashcardSourceViewer.tsx')
text = path.read_text(encoding='utf-8')

# Mejorar la búsqueda del canvas y añadir debug
old = """    const canvas = pageRef.current.querySelector('canvas') as HTMLCanvasElement | null;
    if (!canvas) {
      console.warn('⚠️ No hay canvas para OCR');
      return;
    }"""

new = """    // Buscar el canvas correcto (react-pdf renderiza el PDF en .react-pdf__Page__canvas)
    const allCanvas = Array.from(pageRef.current.querySelectorAll('canvas')) as HTMLCanvasElement[];
    console.log('🎨 Canvas encontrados:', allCanvas.length, allCanvas.map(c => ({ w: c.width, h: c.height, class: c.className })));

    // Usar el canvas más grande (el del PDF, no el del textLayer)
    const canvas = allCanvas
      .filter(c => c.width > 100 && c.height > 100)
      .sort((a, b) => (b.width * b.height) - (a.width * a.height))[0];

    if (!canvas) {
      console.warn('⚠️ No hay canvas válido para OCR');
      return;
    }
    console.log('✅ Canvas seleccionado:', canvas.width, 'x', canvas.height);"""

if old in text:
    text = text.replace(old, new)
    print("✅ Debug canvas mejorado")
else:
    print("❌ No encontré bloque canvas")

# Aumentar delay antes de OCR a 1500ms para asegurar render
old2 = """      const timer = setTimeout(() => {
        if (typeof runTesseractHighlight === 'function') {
          runTesseractHighlight();
        }
      }, 500);"""

new2 = """      const timer = setTimeout(() => {
        if (typeof runTesseractHighlight === 'function') {
          runTesseractHighlight();
        }
      }, 1500);"""

if old2 in text:
    text = text.replace(old2, new2)
    print("✅ Delay aumentado a 1500ms")
else:
    print("❌ No encontré timeout")

path.write_text(text, encoding='utf-8')
