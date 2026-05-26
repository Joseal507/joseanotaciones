from pathlib import Path

path = Path("components/materias/QuizPage.tsx")
text = path.read_text(encoding='utf-8')

# Cambiar el badge de expiración para que se vea mejor
old_badge = """                      {esTemp && (
                        <div style={{
                          position: 'absolute',
                          top: -7, right: 8,
                          background: '#f5c842',
                          color: '#000',
                          fontSize: 9, fontWeight: 900,
                          padding: '1px 7px', borderRadius: 4,
                          fontFamily: HAND, letterSpacing: 0.3,
                          textTransform: 'uppercase',
                        }}>
                          ⏳ {tiempoExp || '24h'}
                        </div>
                      )}"""

new_badge = """                      {esTemp && (
                        <div style={{
                          display: 'flex', alignItems: 'center', gap: 4,
                          marginBottom: 6,
                          background: 'rgba(245,200,66,0.12)',
                          border: '1px dashed rgba(245,200,66,0.5)',
                          borderRadius: 6,
                          padding: '3px 8px',
                          width: 'fit-content',
                        }}>
                          <span style={{ fontSize: 11 }}>⏳</span>
                          <span style={{
                            fontFamily: HAND, fontSize: 12, fontWeight: 800,
                            color: '#f5c842',
                          }}>
                            expira en {tiempoExp || '24h'}
                          </span>
                        </div>
                      )}"""

if old_badge in text:
    text = text.replace(old_badge, new_badge, 1)
    print("✅ Badge de expiración mejorado")
else:
    print("❌ No matcheó el badge")
    # Buscar fragmento para debug
    idx = text.find("esTemp && (")
    if idx != -1:
        print("  fragmento encontrado en pos", idx)
        print(repr(text[idx:idx+300]))

path.write_text(text, encoding='utf-8')
