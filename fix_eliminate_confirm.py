import pathlib

path = pathlib.Path('app/materias/page.tsx')
text = path.read_text(encoding='utf-8')

# Remover el confirm() de eliminarDocumento
# porque TemaView ya tiene su propio modal bonito
old_fn = """const eliminarDocumento = async (id: string) => {
  if (!confirm(idioma === 'en' ? 'Delete this file?' : '¿Eliminar este archivo?')) return;
  if (!temaActual) return;"""

new_fn = """const eliminarDocumento = async (id: string) => {
  // Sin confirm() nativo - TemaView tiene su propio modal de confirmación
  if (!temaActual) return;"""

if old_fn in text:
    text = text.replace(old_fn, new_fn, 1)
    path.write_text(text, encoding='utf-8')
    print("✅ confirm() nativo removido de eliminarDocumento")
    print("   TemaView ya tiene modal bonito de confirmación")
else:
    print("❌ No encontré el bloque exacto")
    if 'eliminarDocumento' in text:
        idx = text.find('const eliminarDocumento')
        print(f"   Actual:\n{text[idx:idx+200]}")
