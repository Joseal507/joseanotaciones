import pathlib
import re

path = pathlib.Path('components/materias/FlashcardSourceViewer.tsx')
text = path.read_text(encoding='utf-8')

m = re.search(r"<Page\s+pageNumber=\{resolvedPage\}[^/]*/>", text)
if m:
    start = max(0, m.start() - 400)
    end = min(len(text), m.end() + 400)
    print("=== CONTEXTO DEL <Page> ===")
    print(text[start:end])
    print("=== FIN ===")
