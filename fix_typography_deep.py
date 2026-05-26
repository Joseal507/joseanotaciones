from pathlib import Path
import re

BODY = "'Inter', system-ui, sans-serif"
HAND = "'Caveat', cursive"

# Todos los archivos con HAND
files = list(Path("components").rglob("*.tsx")) + list(Path("app").rglob("*.tsx"))

# ══════════════════════════════════════════════
# Contextos donde fontFamily: HAND → BODY
# Regla: si fontSize <= 16 Y el contexto NO es
# título/label/badge/número → usar BODY
# ══════════════════════════════════════════════

# Patrones inline style que son claramente texto de contenido
CONTENT_PATTERNS = [
    # Párrafos de texto
    (r"(fontFamily:\s*HAND,\s*fontSize:\s*1[0-6],\s*(?:fontWeight:\s*[4-7]00,\s*)?(?:fontStyle:\s*'normal',\s*)?color:[^}]{0,60}lineHeight:)", "BODY"),
    # fontStyle italic pequeño = decorativo, queda en HAND
    # Descripciones / subtítulos de contenido (no labels)  
    (r"(<(?:p|span|div)[^>]*style=\{[^}]{0,80}fontFamily:\s*)HAND([^}]{0,80}fontSize:\s*1[234],)", "BODY"),
]

def should_be_body(line: str, context_lines: list[str]) -> bool:
    """Determina si un uso de HAND en esta línea debe ser BODY"""
    line_lower = line.lower()
    
    # SIEMPRE Caveat: títulos grandes, números de score, badges
    hand_keywords = [
        'fontsize: 2', 'fontsize: 3', 'fontsize: 4', 'fontsize: 5', 'fontsize: 6', 'fontsize: 7',
        'fontweight: 900', 'fontweight: 800',
        'letterspacing', 'texttransform',
        'rotate(', 'transform:',
        '# ', 'título', 'titulo', 'header',
    ]
    for kw in hand_keywords:
        if kw in line_lower:
            return False
    
    # SIEMPRE Inter: texto de contenido
    body_keywords = [
        'explicacion', 'explicación', 'pregunta', 'respuesta', 'answer', 'question',
        'descripcion', 'descripción', 'content', 'texto', 'parrafo', 'párrafo',
        'lineheight: 1.', 'fontweight: 400', 'fontweight: 500',
        'opacity', 'rgba(255,255,255,0.', 'rgba(0,0,0,0.',
        'var(--text-',
    ]
    for kw in body_keywords:
        if kw in line_lower:
            return True
    
    return False

def patch_file(fp: Path) -> int:
    text = fp.read_text(encoding='utf-8')
    original = text
    changes = 0
    
    # 1) Asegurar BODY definido
    if "const HAND" in text and "const BODY" not in text:
        for variant in [
            "const HAND = \"'Caveat', cursive\";",
            "const HAND = \"'Caveat',cursive\";",
            "const HAND = \"'Caveat', cursive\"",
        ]:
            if variant in text:
                text = text.replace(variant, variant + "\nconst BODY = \"'Inter', system-ui, sans-serif\";", 1)
                changes += 1
                break
    
    # 2) Reemplazos específicos por contexto semántico
    lines = text.split('\n')
    new_lines = []
    
    for i, line in enumerate(lines):
        new_line = line
        
        if 'fontFamily: HAND' in line or "fontFamily:HAND" in line:
            ctx = lines[max(0,i-3):i+4]
            ctx_str = ' '.join(ctx).lower()
            
            # Texto claramente de contenido → BODY
            body_triggers = [
                'lineheight: 1.5', 'lineheight: 1.6', 'lineheight: 1.7', 'lineheight: 1.65',
                'lineheight: 1.4', 'lineheight: 1.45', 'lineheight: 1.3',
                'fontweight: 400', 'fontweight: 500', 'fontweight: 600',
                'explicaci', 'descripci', 'pregunta', 'respuesta',
                'text-secondary', 'text-muted', 'text-faint',
                "'rgba(255,255,255,0.5)'", "'rgba(255,255,255,0.6)'",
                "'rgba(255,255,255,0.7)'", "'rgba(255,255,255,0.75)'",
                "'rgba(255,255,255,0.4)'",
                'var(--text-secondary)', 'var(--text-muted)', 'var(--text-faint)',
            ]
            
            # Títulos/labels que deben quedar en HAND
            hand_triggers = [
                'fontsize: 2', 'fontsize: 3', 'fontsize: 4', 'fontsize: 5',
                'fontsize: 6', 'fontsize: 7', 'fontsize: 8',
                'fontweight: 900', 'fontweight: 800',
                'letterspacing', 'texttransform',
                'rotate(',
            ]
            
            is_body = any(t in ctx_str for t in body_triggers)
            is_hand = any(t in ctx_str for t in hand_triggers)
            
            if is_body and not is_hand:
                new_line = line.replace('fontFamily: HAND', 'fontFamily: BODY')
                new_line = new_line.replace('fontFamily:HAND', 'fontFamily:BODY')
                if new_line != line:
                    changes += 1
        
        new_lines.append(new_line)
    
    text = '\n'.join(new_lines)
    
    # 3) Reemplazos directos para patrones muy comunes de texto de contenido
    
    # Texto de párrafos con opacity/muted
    text = re.sub(
        r"fontFamily:\s*HAND,(\s*fontSize:\s*1[0-6],\s*(?:fontWeight:\s*[456]00,\s*)?color:\s*'rgba\(255,255,255,0\.[3-7]\)')",
        r"fontFamily: BODY,\1",
        text
    )
    
    # var(--text-*) contexts
    text = re.sub(
        r"fontFamily:\s*HAND,(\s*fontSize:\s*1[0-6][^,]*,\s*color:\s*'var\(--text-(?:secondary|muted|faint)\)')",
        r"fontFamily: BODY,\1",
        text
    )
    
    # lineHeight presente = texto corrido
    text = re.sub(
        r"fontFamily:\s*HAND,(\s*fontSize:\s*1[234],\s*(?:fontWeight:\s*[456]00,\s*)?(?:color:[^,]+,\s*)?lineHeight:\s*1\.[4-8])",
        r"fontFamily: BODY,\1",
        text
    )
    
    if text != original:
        fp.write_text(text, encoding='utf-8')
    
    return changes

total = 0
patched = 0
for fp in files:
    if 'node_modules' in str(fp):
        continue
    try:
        c = patch_file(fp)
        if c > 0:
            total += c
            patched += 1
            print(f"  ✓ {fp} ({c} cambios)")
    except Exception as e:
        print(f"  ⚠ {fp}: {e}")

print(f"\n✅ {patched} archivos, {total} usos de HAND → BODY")
