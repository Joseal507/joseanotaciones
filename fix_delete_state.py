import pathlib

path = pathlib.Path('app/materias/page.tsx')
text = path.read_text(encoding='utf-8')

# Ver el final de eliminarDocumento
idx = text.find('const eliminarDocumento')
if idx >= 0:
    chunk = text[idx:idx+1200]
    print("=== eliminarDocumento completa ===")
    print(chunk)
    print("===")
else:
    print("No encontré eliminarDocumento")
