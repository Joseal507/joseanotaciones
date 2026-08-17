"use client"

import { useState, Suspense } from "react"
import { useSearchParams } from "next/navigation"

function ResetPasswordForm() {
  const token = useSearchParams().get("token") || ""
  const [password, setPassword] = useState("")
  const [confirmPassword, setConfirmPassword] = useState("")
  const [showPassword, setShowPassword] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState("")
  const [done, setDone] = useState(false)

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setError("")

    if (password !== confirmPassword) {
      setError("Las contraseñas no coinciden")
      return
    }

    setSubmitting(true)
    try {
      const res = await fetch("/api/auth/reset-password", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token, password, confirmPassword }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok || !data.success) {
        setError(data.error || "No se pudo actualizar la contraseña")
        return
      }
      setDone(true)
    } catch {
      setError("Error de conexión — intenta de nuevo")
    } finally {
      setSubmitting(false)
    }
  }

  if (!token) {
    return (
      <main style={page}>
        <section style={shell}>
          <h1 style={title}>Study<span style={{ color: "#ef4444" }}>A</span>L</h1>
          <div style={card}>
            <div style={tape} />
            <h2 style={cardTitle}>Enlace inválido</h2>
            <p style={muted}>Este enlace no tiene un token de recuperación. Pedí uno nuevo desde la pantalla de inicio de sesión.</p>
            <a href="/auth-v2" style={{ ...goldButton, display: "block", textAlign: "center", textDecoration: "none", boxSizing: "border-box" }}>
              Volver a inicio de sesión
            </a>
          </div>
        </section>
      </main>
    )
  }

  if (done) {
    return (
      <main style={page}>
        <section style={shell}>
          <h1 style={title}>Study<span style={{ color: "#ef4444" }}>A</span>L</h1>
          <div style={card}>
            <div style={tape} />
            <h2 style={cardTitle}>✅ Contraseña actualizada</h2>
            <p style={muted}>Ya podés iniciar sesión con tu contraseña nueva.</p>
            <a href="/auth-v2" style={{ ...goldButton, display: "block", textAlign: "center", textDecoration: "none", boxSizing: "border-box" }}>
              Iniciar sesión
            </a>
          </div>
        </section>
      </main>
    )
  }

  return (
    <main style={page}>
      <section style={shell}>
        <h1 style={title}>Study<span style={{ color: "#ef4444" }}>A</span>L</h1>
        <div style={card}>
          <div style={tape} />
          <h2 style={cardTitle}>Elegí tu nueva contraseña</h2>

          <form onSubmit={handleSubmit} style={form}>
            <label style={label}>Contraseña nueva</label>
            <div style={inputWrap}>
              <input
                style={input}
                type={showPassword ? "text" : "password"}
                placeholder="Min 8, letras y números"
                value={password}
                onChange={e => setPassword(e.target.value)}
                autoComplete="new-password"
                required
              />
              <button
                type="button"
                onClick={() => setShowPassword(v => !v)}
                style={eyeButton}
                aria-label={showPassword ? "Ocultar contraseña" : "Ver contraseña"}
              >
                {showPassword ? "🙈" : "👁️"}
              </button>
            </div>

            <label style={label}>Confirmar contraseña</label>
            <div style={inputWrap}>
              <input
                style={input}
                type={showPassword ? "text" : "password"}
                placeholder="••••••••"
                value={confirmPassword}
                onChange={e => setConfirmPassword(e.target.value)}
                autoComplete="new-password"
                required
              />
            </div>

            {error && <p style={errorText}>⚠️ {error}</p>}

            <button type="submit" style={goldButton} disabled={submitting}>
              {submitting ? "Guardando..." : "Guardar contraseña"}
            </button>
          </form>
        </div>
      </section>
    </main>
  )
}

export default function ResetPasswordPage() {
  return (
    <Suspense fallback={null}>
      <ResetPasswordForm />
    </Suspense>
  )
}

const page: React.CSSProperties = {
  minHeight: "100vh",
  display: "grid",
  placeItems: "center",
  background: "#000",
  color: "#fff",
  padding: 24,
  fontFamily: "var(--font-global-g)",
}

const shell: React.CSSProperties = {
  width: "100%",
  maxWidth: 480,
  textAlign: "center",
}

const title: React.CSSProperties = {
  margin: "0 0 24px",
  fontSize: 36,
  fontWeight: 950,
  letterSpacing: "-1.5px",
}

const card: React.CSSProperties = {
  position: "relative",
  border: "2px solid rgba(255,255,255,.9)",
  borderRadius: 12,
  background: "linear-gradient(180deg, rgba(11,12,27,.98), rgba(3,3,12,.98))",
  boxShadow: "9px 9px 0 #d8b566, 0 26px 90px rgba(0,0,0,.75)",
  padding: "32px 32px 26px",
}

const tape: React.CSSProperties = {
  position: "absolute",
  top: -9,
  left: "41%",
  width: 96,
  height: 19,
  background: "rgba(216,181,102,.72)",
  transform: "rotate(-4deg)",
}

const cardTitle: React.CSSProperties = {
  fontSize: 24,
  margin: "10px 0 12px",
}

const muted: React.CSSProperties = {
  opacity: 0.75,
  marginBottom: 20,
  lineHeight: 1.5,
}

const form: React.CSSProperties = {
  display: "grid",
  gap: 10,
  textAlign: "left",
}

const label: React.CSSProperties = {
  fontWeight: 850,
  color: "#fff",
  marginTop: 4,
}

const inputWrap: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "1fr auto",
  alignItems: "center",
  gap: 8,
  border: "1px solid rgba(255,255,255,.28)",
  borderRadius: 9,
  background: "linear-gradient(180deg, rgba(255,255,255,.09), rgba(255,255,255,.04))",
  padding: "0 14px",
  marginBottom: 8,
}

const input: React.CSSProperties = {
  height: 50,
  background: "transparent",
  border: 0,
  outline: "none",
  color: "#fff",
  fontSize: 16,
  fontWeight: 700,
}

const eyeButton: React.CSSProperties = {
  background: "transparent",
  border: 0,
  color: "#fff",
  cursor: "pointer",
  fontSize: 18,
}

const goldButton: React.CSSProperties = {
  width: "100%",
  padding: "16px 18px",
  borderRadius: 10,
  border: "1px solid #f1d17a",
  background: "linear-gradient(180deg, #f1d17a, #d8b566)",
  color: "#050505",
  fontWeight: 950,
  fontSize: 20,
  cursor: "pointer",
  boxShadow: "0 5px 0 rgba(0,0,0,.3)",
}

const errorText: React.CSSProperties = {
  color: "#f87171",
  fontSize: 14,
  fontWeight: 700,
  margin: "2px 0 4px",
}
