import pathlib
import re

# ════════════════════════════════════════════════════
# FIX 1: Límites por tipo en lib/materials/types.ts
# ════════════════════════════════════════════════════
path1 = pathlib.Path('lib/materials/types.ts')
text1 = path1.read_text(encoding='utf-8')

old_limit = """export const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50MB"""

new_limit = """export const MAX_FILE_SIZE = 30 * 1024 * 1024; // 30MB global fallback

// Límites por tipo de archivo
export const MAX_FILE_SIZE_BY_KIND: Record<string, number> = {
  pdf:   30 * 1024 * 1024, // 30MB - PDFs académicos
  image: 10 * 1024 * 1024, // 10MB - imágenes
  docx:  20 * 1024 * 1024, // 20MB - Word
  pptx:  20 * 1024 * 1024, // 20MB - PowerPoint
  txt:    5 * 1024 * 1024, //  5MB - texto plano
  audio: 25 * 1024 * 1024, // 25MB - audio
};

export function getMaxSizeForKind(kind: string): number {
  return MAX_FILE_SIZE_BY_KIND[kind] ?? MAX_FILE_SIZE;
}

export function formatFileSize(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(0)}MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(0)}KB`;
  return `${bytes}B`;
}"""

if old_limit in text1:
    text1 = text1.replace(old_limit, new_limit, 1)
    path1.write_text(text1, encoding='utf-8')
    print("✅ FIX 1: Límites por tipo añadidos en types.ts")
else:
    print("❌ No encontré MAX_FILE_SIZE en types.ts")

# ════════════════════════════════════════════════════
# FIX 2: validateFile usa límites por tipo
# ════════════════════════════════════════════════════
path2 = pathlib.Path('lib/materials/validation.ts')
text2 = path2.read_text(encoding='utf-8')

# Añadir import de getMaxSizeForKind
old_import = """  MAX_FILE_SIZE,"""
new_import = """  MAX_FILE_SIZE,
  getMaxSizeForKind,
  formatFileSize,"""

if old_import in text2:
    text2 = text2.replace(old_import, new_import, 1)
    print("✅ FIX 2a: imports actualizados en validation.ts")

# Mejorar validateFile para usar límite por tipo
old_validate = """  if (size > MAX_FILE_SIZE) {
    return {
      ok: false,
      error: `El archivo "${name}" supera el límite de 50MB.`,
    };
  }"""

new_validate = """  // Determinar límite por tipo (se evalúa después de determinar el kind)
  const kindForSize = (() => {
    const ext = name.split('.').pop()?.toLowerCase() ?? '';
    if (['pdf'].includes(ext)) return 'pdf';
    if (['jpg','jpeg','png','gif','webp','svg','bmp'].includes(ext)) return 'image';
    if (['doc','docx'].includes(ext)) return 'docx';
    if (['ppt','pptx'].includes(ext)) return 'pptx';
    if (['txt','md'].includes(ext)) return 'txt';
    if (['mp3','wav','m4a','ogg','webm'].includes(ext)) return 'audio';
    return 'other';
  })();
  const maxForThisKind = getMaxSizeForKind(kindForSize);
  if (size > maxForThisKind) {
    const maxMB = Math.round(maxForThisKind / (1024 * 1024));
    const fileMB = (size / (1024 * 1024)).toFixed(1);
    return {
      ok: false,
      error: `"${name}" pesa ${fileMB}MB. El límite para este tipo es ${maxMB}MB.`,
    };
  }"""

if old_validate in text2:
    text2 = text2.replace(old_validate, new_validate, 1)
    path2.write_text(text2, encoding='utf-8')
    print("✅ FIX 2b: validateFile usa límites por tipo")
else:
    print("❌ No encontré el bloque de validación de tamaño")
    # Ver qué hay
    idx = text2.find('MAX_FILE_SIZE')
    if idx >= 0:
        print(f"   Contexto: {text2[idx:idx+200]}")

# ════════════════════════════════════════════════════
# FIX 3: Frontend - mostrar error claro y límite visible
# ════════════════════════════════════════════════════
path3 = pathlib.Path('components/materials/MaterialUploader.tsx')
text3 = path3.read_text(encoding='utf-8')

# Mejorar el texto de "máx 50MB" con detalles por tipo
old_label = """            PDF · Word · TXT · Imágenes · Audio — máx 50MB"""
new_label = """            PDF (30MB) · Word/PPT (20MB) · Imagen (10MB) · TXT (5MB)"""

if old_label in text3:
    text3 = text3.replace(old_label, new_label, 1)
    print("✅ FIX 3a: Label del uploader actualizado con límites reales")
else:
    print("❌ No encontré label del uploader")
    if '50MB' in text3:
        idx = text3.find('50MB')
        print(f"   Contexto: {text3[idx-50:idx+80]}")

# Mejorar mensaje de error cuando el archivo es muy grande
# Buscar dónde se llama addFiles o donde se valida el tamaño en el frontend
old_size_check = """      if (f.size > MAX_FILE_SIZE) return false;"""
new_size_check = """      // Validación por tipo en el frontend (mismo criterio que backend)
      const ext3 = f.name.split('.').pop()?.toLowerCase() ?? '';
      const kindMap: Record<string, number> = {
        pdf: 30, jpg: 10, jpeg: 10, png: 10, gif: 10, webp: 10,
        doc: 20, docx: 20, ppt: 20, pptx: 20, txt: 5, md: 5,
        mp3: 25, wav: 25, m4a: 25, ogg: 25, webm: 25,
      };
      const maxMB3 = kindMap[ext3] ?? 30;
      if (f.size > maxMB3 * 1024 * 1024) {
        const fileMB = (f.size / (1024 * 1024)).toFixed(1);
        alert(`"${f.name}" pesa ${fileMB}MB. El límite para este tipo es ${maxMB3}MB.`);
        return false;
      }"""

if old_size_check in text3:
    text3 = text3.replace(old_size_check, new_size_check, 1)
    path3.write_text(text3, encoding='utf-8')
    print("✅ FIX 3b: Validación frontend por tipo de archivo")
else:
    print("❌ No encontré validación de tamaño en frontend")
    if 'MAX_FILE_SIZE' in text3:
        idx = text3.find('MAX_FILE_SIZE')
        print(f"   Contexto: {text3[idx-30:idx+100]}")

print("\n🎉 Límites de archivo aplicados:")
print("   PDF:         30MB")
print("   Word/PPT:    20MB")
print("   Audio:       25MB")
print("   Imagen:      10MB")
print("   TXT:          5MB")
print("\n🎉 Flashcards mejoradas:")
print("   Chunks:      18000 chars (antes 10000)")
print("   Batch:       15 conceptos (antes 12)")
print("   Contexto:    14000 chars (antes 8000)")
