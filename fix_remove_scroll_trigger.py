from pathlib import Path

path = Path("components/materias/FlashcardsPDFViewer.tsx")
text = path.read_text(encoding='utf-8')

# Buscar y eliminar el bloque del scroll trigger
start_marker = "  // ── Detectar scroll al final → siguiente material ──"
end_marker = "  // ── Scroll a forcedPage cuando cambia"

start_idx = text.find(start_marker)
end_idx = text.find(end_marker)

if start_idx >= 0 and end_idx >= 0 and end_idx > start_idx:
    text = text[:start_idx] + text[end_idx:]
    print("✅ Eliminado scroll-al-fondo trigger")
else:
    print(f"❌ No encontrado. start={start_idx}, end={end_idx}")
    # Buscar manualmente
    if "checkBottom" in text:
        print("   'checkBottom' existe en el archivo")
    if "Detectar scroll al final" in text:
        print("   El comentario existe")

path.write_text(text, encoding='utf-8')
print("🎉 Listo")
