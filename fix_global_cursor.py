import pathlib

# El problema: cuando estás en la última página del material 1
# y haces scroll abajo, FlashcardsPDFViewer dispara onRequestNext()
# que es goToGlobalSelection(globalSelectedCursor + 1)
# 
# PERO globalSelectedCursor está sincronizado con la PÁGINA visible
# (porque el useEffect arriba lo actualiza al cambiar de página)
# Entonces al estar en la última página del material 1,
# globalSelectedCursor ya está en la última de M1
# +1 te debería llevar a la primera de M2 ✓
#
# El problema real: cuando el cursor avanza a M2, currentGlobalEntry.materialIndex
# cambia, forcedPage cambia... pero ANTES de eso el scroll auto del fondo
# puede dispararse de nuevo en M2.
#
# Mejor solución: que onRequestNext en FlashcardsPage detecte si ya estamos
# en la última y solo entonces avance al siguiente material

path = pathlib.Path('components/materias/FlashcardsPage.tsx')
text = path.read_text(encoding='utf-8')

# Ver cómo está el useEffect que sincroniza globalSelectedCursor con activeMaterialIndex
print("=== Estado actual del useEffect ===")
idx = text.find('const goToGlobalSelection')
print(text[idx-600:idx+200])
