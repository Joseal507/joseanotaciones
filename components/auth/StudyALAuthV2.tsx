"use client"

import { useState } from "react"
import { signIn, signOut, useSession } from "next-auth/react"

export default function StudyALAuthV2() {
  const [mode, setMode] = useState<"login" | "register">("login")
  const [showPassword, setShowPassword] = useState(false)
  const { data: session, status } = useSession()

  function handleEmailSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    alert("El acceso con email se activará en la siguiente fase. Por ahora usa Google.")
  }

  if (session?.user) {
    return (
      <main style={page}>
        <section style={shell}>
          <Brand />
          <div style={card}>
            <div style={tape} />
            <h2 style={cardTitle}>Sesión iniciada</h2>
            <p style={muted}>{session.user.name || session.user.email}</p>
            <button style={goldButton} onClick={() => signOut({ callbackUrl: "/auth-v2" })}>
              Cerrar sesión
            </button>
          </div>
        </section>
      </main>
    )
  }

  return (
    <main style={page}>
      <FloatingIcons />
      <section style={shell}>
        <Brand />

        <div style={card}>
          <div style={tape} />

          <div style={tabs}>
            <button
              type="button"
              onClick={() => setMode("login")}
              style={mode === "login" ? tabActive : tab}
            >
              🔑 Iniciar sesión
            </button>
            <button
              type="button"
              onClick={() => setMode("register")}
              style={mode === "register" ? tabActive : tab}
            >
              ✨ Registrarse
            </button>
          </div>

          <div style={sectionTitleWrap}>
            <span style={line} />
            <strong>{mode === "login" ? "Entra con tu cuenta" : "Crea tu cuenta"}</strong>
            <span style={line} />
          </div>

          <button
            type="button"
            onClick={() => signIn("google", { callbackUrl: "/" })}
            style={googleButton}
            disabled={status === "loading"}
          >
            <span style={googleG}>G</span>
            {status === "loading" ? "Cargando..." : "Continuar con Google"}
          </button>

          <div style={divider}>
            <span style={dividerLine} />
            <span style={dot}>o</span>
            <span style={dividerLine} />
          </div>

          <form onSubmit={handleEmailSubmit} style={form}>
            <label style={label}>Email</label>
            <div style={inputWrap}>
              <input style={input} type="email" placeholder="tu@email.com" required />
              <span>✉️</span>
            </div>

            <label style={label}>Contraseña</label>
            <div style={inputWrap}>
              <input style={input} type={showPassword ? "text" : "password"} placeholder="••••••••" required />
              <button
                type="button"
                onClick={() => setShowPassword(v => !v)}
                style={eyeButton}
                aria-label={showPassword ? "Ocultar contraseña" : "Ver contraseña"}
              >
                {showPassword ? "🙈" : "👁️"}
              </button>
            </div>

            <button type="submit" style={goldButton}>
              🚀🚀 {mode === "login" ? "Iniciar sesión" : "Crear cuenta"}
            </button>
          </form>

          <button
            type="button"
            onClick={() => alert("Luego conectamos recuperación de contraseña con el sistema de email.")}
            style={forgot}
          >
            🔑 ¿Olvidaste tu contraseña?
          </button>
        </div>

        <p style={safe}>🔒 ~ Tus datos están seguros y encriptados 🔒 ~</p>
      </section>
    </main>
  )
}

function Brand() {
  return (
    <>
      <h1 style={title}>Study<span style={{ color: "#ef4444" }}>A</span>L</h1>
      <p style={subtitle}>~ Tu plataforma de estudio definitiva ~</p>
    </>
  )
}

function FloatingIcons() {
  return (
    <>
      <span style={float("9%", "17%")}>📚</span>
      <span style={float("90%", "28%")}>✏️</span>
      <span style={float("12%", "50%")}>🎯</span>
      <span style={float("86%", "62%")}>💡</span>
      <span style={float("18%", "78%")}>⭐</span>
      <span style={float("80%", "91%")}>🔥</span>
    </>
  )
}

const page: React.CSSProperties = {
  minHeight: "100vh",
  display: "grid",
  placeItems: "center",
  background: "#000",
  color: "#fff",
  padding: 24,
  overflow: "hidden",
  position: "relative",
  fontFamily: "var(--font-global-g)",
}

const shell: React.CSSProperties = {
  width: "100%",
  maxWidth: 520,
  textAlign: "center",
  position: "relative",
  zIndex: 2,
}

const logo: React.CSSProperties = {
  width: 96,
  height: 96,
  objectFit: "contain",
  borderRadius: 999,
  filter: "drop-shadow(0 0 22px rgba(216,181,102,.45))",
}

const title: React.CSSProperties = {
  margin: "12px 0 0",
  fontSize: 42,
  fontWeight: 950,
  letterSpacing: "-1.5px",
}

const subtitle: React.CSSProperties = {
  margin: "8px 0 28px",
  opacity: 0.68,
  fontStyle: "italic",
  fontSize: 16,
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

const tabs: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "1fr 1fr",
  border: "1px solid rgba(255,255,255,.16)",
  borderRadius: 8,
  overflow: "hidden",
  marginBottom: 26,
}

const tab: React.CSSProperties = {
  padding: "16px 10px",
  background: "rgba(255,255,255,.035)",
  color: "rgba(255,255,255,.75)",
  border: 0,
  fontWeight: 900,
  fontSize: 18,
  cursor: "pointer",
}

const tabActive: React.CSSProperties = {
  ...tab,
  background: "rgba(216,181,102,.12)",
  color: "#fff",
  outline: "1px solid #d8b566",
}

const sectionTitleWrap: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "1fr auto 1fr",
  alignItems: "center",
  gap: 14,
  marginBottom: 22,
}

const line: React.CSSProperties = {
  height: 1,
  background: "linear-gradient(90deg, transparent, #d8b566, transparent)",
}

const googleButton: React.CSSProperties = {
  width: "100%",
  padding: "16px 18px",
  borderRadius: 10,
  border: "2px solid rgba(255,255,255,.82)",
  background: "linear-gradient(180deg, rgba(255,255,255,.055), rgba(255,255,255,.015))",
  color: "#fff",
  fontWeight: 950,
  fontSize: 18,
  cursor: "pointer",
  display: "flex",
  justifyContent: "center",
  alignItems: "center",
  gap: 14,
}

const googleG: React.CSSProperties = {
  fontWeight: 950,
  fontSize: 26,
  color: "#fff",
}

const divider: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "1fr auto 1fr",
  alignItems: "center",
  gap: 16,
  margin: "24px 0",
}

const dividerLine: React.CSSProperties = {
  height: 1,
  background: "rgba(255,255,255,.28)",
}

const dot: React.CSSProperties = {
  color: "#d8b566",
  fontWeight: 900,
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

const forgot: React.CSSProperties = {
  marginTop: 20,
  background: "transparent",
  border: 0,
  color: "#fff",
  textDecoration: "underline",
  fontWeight: 800,
  cursor: "pointer",
  fontSize: 15,
}

const safe: React.CSSProperties = {
  fontSize: 14,
  opacity: 0.55,
  marginTop: 28,
  fontStyle: "italic",
}

const muted: React.CSSProperties = {
  opacity: 0.75,
  marginBottom: 20,
}

const cardTitle: React.CSSProperties = {
  fontSize: 28,
  marginTop: 10,
}

function float(left: string, top: string): React.CSSProperties {
  return {
    position: "absolute",
    left,
    top,
    fontSize: 28,
    opacity: 0.32,
    transform: "translate(-50%, -50%)",
  }
}
