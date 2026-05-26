import pathlib

path = pathlib.Path('components/materias/FlashcardsPage.tsx')
text = path.read_text(encoding='utf-8')

# Fix: incluir el ID real en el header del material para que la IA lo copie
old = '''      // Si ya viene con texto pre-extraído (del enfoque), usarlo directo
      if ((sel as any)?.text) {
        const txt = String((sel as any).text || '').trim();
        if (txt) {
          console.log(`✅ Material ${i + 1}: usando texto pre-extraído (${txt.length} chars)`);
          texts.push(`[Material ${i + 1}: ${mat?.nombre || matId}${pages.length ? ` | páginas ${pages.join(', ')}` : ''}]
${txt}`);
          continue;
        }
      }'''

new = '''      // Si ya viene con texto pre-extraído (del enfoque), usarlo directo
      if ((sel as any)?.text) {
        const txt = String((sel as any).text || '').trim();
        if (txt) {
          console.log(`✅ Material ${i + 1}: usando texto pre-extraído (${txt.length} chars)`);
          texts.push(`[Material ${i + 1}: ID=${matId} | ${mat?.nombre || matId}${pages.length ? ` | páginas ${pages.join(', ')}` : ''}]
${txt}`);
          continue;
        }
      }'''

if old in text:
    text = text.replace(old, new)
    print("✅ Fix 3a: ID real en texto pre-extraído")
else:
    print("❌ No encontré bloque texto pre-extraído")

old2 = '''        texts.push(`[Material ${i + 1}: ${mat?.nombre || matId} | páginas ${pages.join(', ')}]
${filtered}`);
      } else {
        console.log(`📄 Material ${i + 1}: texto completo (${fullText.length} chars)`);
        texts.push(`[Material ${i + 1}: ${mat?.nombre || matId} | documento completo]
${fullText}`);
      }'''

new2 = '''        texts.push(`[Material ${i + 1}: ID=${matId} | ${mat?.nombre || matId} | páginas ${pages.join(', ')}]
${filtered}`);
      } else {
        console.log(`📄 Material ${i + 1}: texto completo (${fullText.length} chars)`);
        texts.push(`[Material ${i + 1}: ID=${matId} | ${mat?.nombre || matId} | documento completo]
${fullText}`);
      }'''

if old2 in text:
    text = text.replace(old2, new2)
    print("✅ Fix 3b: ID real en texto por páginas y completo")
else:
    print("❌ No encontré bloque texto por páginas")

path.write_text(text, encoding='utf-8')
