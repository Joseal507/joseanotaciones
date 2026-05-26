import pathlib

path = pathlib.Path('components/materias/FlashcardSourceViewer.tsx')
text = path.read_text(encoding='utf-8')

# 1) Hacer que el contenedor del PDF tenga scroll y altura limitada
# Buscar el div que envuelve <Page> y darle overflow-auto + maxHeight
import re

# Estrategia: buscar el ref del pageRef y el contenedor scrollable
# Vamos a añadir un useEffect que haga scroll al highlight cuando aparezca

# Añadir scroll automático al primer highlight
needle_useeffect = """  }, [isScanned, resolvedPage, card.sourceText]);"""

if needle_useeffect in text:
    add_scroll = """  }, [isScanned, resolvedPage, card.sourceText]);

  // ── Auto-scroll al highlight cuando aparece ──
  useEffect(() => {
    if (!pageRef.current) return;
    const t = setTimeout(() => {
      const root = pageRef.current;
      if (!root) return;
      const hl = root.querySelector('[data-flashka-highlight="1"]') as HTMLElement | null;
      if (hl) {
        // Buscar el contenedor scrollable más cercano
        let scrollParent: HTMLElement | null = root.parentElement;
        while (scrollParent) {
          const style = window.getComputedStyle(scrollParent);
          if (style.overflowY === 'auto' || style.overflowY === 'scroll') break;
          scrollParent = scrollParent.parentElement;
        }
        if (scrollParent) {
          const hlRect = hl.getBoundingClientRect();
          const parentRect = scrollParent.getBoundingClientRect();
          const offset = (hlRect.top - parentRect.top) + scrollParent.scrollTop - (parentRect.height / 2) + (hlRect.height / 2);
          scrollParent.scrollTo({ top: Math.max(0, offset), behavior: 'smooth' });
          console.log('📍 Scroll al highlight:', offset);
        } else {
          hl.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
      }
    }, 800);
    return () => clearTimeout(t);
  }, [isScanned, resolvedPage, card.sourceText]);"""
    text = text.replace(needle_useeffect, add_scroll, 1)
    print("✅ Auto-scroll al highlight añadido")
else:
    print("❌ No encontré useEffect de Tesseract")

# 2) Marcar los highlights con data-attribute para poder localizarlos
# Buscar donde se crean los overlays de highlight y añadir el atributo
old_overlay = """overlay.style.background = 'rgba(99, 102, 241, 0.35)';"""
new_overlay = """overlay.style.background = 'rgba(99, 102, 241, 0.35)';
        overlay.setAttribute('data-flashka-highlight', '1');"""

if old_overlay in text:
    text = text.replace(old_overlay, new_overlay)
    print("✅ data-flashka-highlight añadido a overlays")
else:
    # Buscar variaciones
    matches = re.findall(r"overlay\.style\.background\s*=\s*['\"][^'\"]+['\"]", text)
    print(f"❌ No encontré overlay exacto. Encontradas {len(matches)} variantes:", matches[:3])

path.write_text(text, encoding='utf-8')
