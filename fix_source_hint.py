import pathlib

path = pathlib.Path('components/materias/FlashcardSourceViewer.tsx')
text = path.read_text(encoding='utf-8')

# Añadir hint de scroll debajo del fragmento exacto
old_hint = """              {resolving && (
                <div style={{ padding: 30, color: '#888', fontFamily: "'Caveat', cursive", fontSize: 16 }}>
                  🔍 Buscando fragmento en los materiales…
                </div>
              )}"""

new_hint = """              {/* Hint de navegación */}
              {!resolving && resolvedPage > 0 && (
                <div style={{
                  width: '100%', maxWidth: containerWidth,
                  background: 'rgba(255,255,255,0.03)',
                  border: '1px solid rgba(255,255,255,0.08)',
                  borderRadius: 10, padding: '10px 14px',
                  display: 'flex', alignItems: 'center', gap: 10,
                  fontFamily: 'Inter, sans-serif',
                }}>
                  <span style={{ fontSize: 18 }}>📄</span>
                  <div style={{ flex: 1 }}>
                    <span style={{ color: '#888', fontSize: 13 }}>
                      El fragmento está en la{' '}
                      <span style={{ color: '#fff', fontWeight: 700 }}>página {resolvedPage}</span>
                      {' '}— búscalo en el PDF de abajo.{' '}
                    </span>
                    <span style={{ color: '#555', fontSize: 12 }}>
                      Si no lo ves de inmediato, desplázate hacia abajo dentro del visor.
                    </span>
                  </div>
                </div>
              )}

              {resolving && (
                <div style={{ padding: 30, color: '#888', fontFamily: "'Caveat', cursive", fontSize: 16 }}>
                  🔍 Buscando fragmento en los materiales…
                </div>
              )}"""

if old_hint in text:
    text = text.replace(old_hint, new_hint, 1)
    print("✅ Hint de navegación añadido")
else:
    print("❌ No encontré el bloque")

# Mover el post-it abajo a la izquierda y hacerlo más visible
old_postit = """                    {/* POST-IT flotante con el fragmento de la flashcard */}
                    {card.sourceText && (
                      <div style={{
                        position: 'absolute',
                        top: 16,
                        right: 16,
                        maxWidth: 260,
                        background: 'linear-gradient(135deg, #fff7a8 0%, #ffe066 100%)',
                        color: '#1a1a1a',
                        padding: '14px 16px',
                        borderRadius: 6,
                        boxShadow: '0 8px 24px rgba(0,0,0,0.25), 0 2px 6px rgba(0,0,0,0.15)',
                        transform: 'rotate(2deg)',
                        zIndex: 10,
                        fontFamily: '"Caveat", "Marker Felt", cursive',
                        fontSize: 15,
                        lineHeight: 1.4,
                        border: '1px solid rgba(0,0,0,0.08)',
                      }}>
                        <div style={{
                          fontSize: 10,
                          fontWeight: 700,
                          textTransform: 'uppercase',
                          letterSpacing: 1,
                          color: '#8a6d00',
                          marginBottom: 6,
                          fontFamily: 'inherit',
                        }}>
                          📌 Fragmento
                        </div>
                        <div style={{
                          fontSize: 14,
                          color: '#2a2a2a',
                          fontStyle: 'italic',
                        }}>
                          "{card.sourceText}"
                        </div>
                      </div>
                    )}"""

new_postit = """                    {/* POST-IT flotante con el fragmento - esquina sup izq para no tapar texto */}
                    {card.sourceText && (
                      <div style={{
                        position: 'absolute',
                        top: 12,
                        left: 12,
                        maxWidth: 240,
                        background: 'linear-gradient(135deg, #fff7a8 0%, #ffe066 100%)',
                        color: '#1a1a1a',
                        padding: '12px 14px',
                        borderRadius: 6,
                        boxShadow: '0 8px 24px rgba(0,0,0,0.35), 0 2px 6px rgba(0,0,0,0.2)',
                        transform: 'rotate(-1.5deg)',
                        zIndex: 10,
                        fontFamily: '"Caveat", "Marker Felt", cursive',
                        fontSize: 14,
                        lineHeight: 1.4,
                        border: '1px solid rgba(0,0,0,0.1)',
                        cursor: 'default',
                      }}>
                        <div style={{
                          fontSize: 10,
                          fontWeight: 700,
                          textTransform: 'uppercase',
                          letterSpacing: 1,
                          color: '#8a6d00',
                          marginBottom: 5,
                          fontFamily: 'inherit',
                          display: 'flex',
                          alignItems: 'center',
                          gap: 4,
                        }}>
                          📌 Busca este fragmento
                        </div>
                        <div style={{
                          fontSize: 13,
                          color: '#2a2a2a',
                          fontStyle: 'italic',
                          maxHeight: 80,
                          overflow: 'hidden',
                        }}>
                          "{card.sourceText.slice(0, 120)}{card.sourceText.length > 120 ? '…' : ''}"
                        </div>
                        <div style={{
                          marginTop: 8,
                          fontSize: 11,
                          color: '#6a5000',
                          fontStyle: 'normal',
                          fontFamily: 'inherit',
                        }}>
                          ↓ desplázate si no lo ves
                        </div>
                      </div>
                    )}"""

if old_postit in text:
    text = text.replace(old_postit, new_postit, 1)
    path.write_text(text, encoding='utf-8')
    print("✅ Post-it mejorado con hint de scroll")
else:
    print("❌ No encontré el post-it")
    if 'POST-IT' in text:
        idx = text.find('POST-IT')
        print(f"   Contexto: {text[idx:idx+200]}")

print("\n🎉 SourceViewer mejorado:")
print("   - Hint arriba: 'El fragmento está en página X'")
print("   - Post-it en esquina superior izquierda")
print("   - Mensaje '↓ desplázate si no lo ves' en el post-it")
