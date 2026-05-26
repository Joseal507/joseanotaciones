with open('components/materias/QuizPage.tsx', 'r', encoding='utf-8') as f:
    src = f.read()

# Buscar la línea exacta donde está la destructuración de QuestionCard
# y agregar onSkip si no está

# Verificar si onSkip ya está en la destructuración
if 'onSkip,' not in src and 'onSkip }' not in src:
    print("⚠️  onSkip no está en la destructuración, agregando...")
    
    # Buscar el patrón de destructuración que sí existe
    old = '''  onVerify,
  onNext,
  isLast,
}: {'''
    new = '''  onVerify,
  onSkip,
  onNext,
  isLast,
}: {'''
    
    if old in src:
        src = src.replace(old, new, 1)
        print("✅ Destructuración corregida")
    else:
        print("❌ No encontré el patrón, buscando alternativas...")
        # Buscar contexto
        idx = src.find('onVerify,')
        if idx >= 0:
            print(f"   onVerify encontrado en posición {idx}")
            print(f"   Contexto: {repr(src[idx-50:idx+100])}")
else:
    print("✅ onSkip ya está en la destructuración")

with open('components/materias/QuizPage.tsx', 'w', encoding='utf-8') as f:
    f.write(src)
