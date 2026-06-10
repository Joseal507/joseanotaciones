"use client"

import { signIn, signOut, useSession } from "next-auth/react"

export default function GoogleSignInButton() {
  const { data: session, status } = useSession()

  if (status === "loading") return <button style={buttonStyle}>Cargando...</button>

  if (session?.user) {
    return (
      <div style={{ display: "grid", gap: 12 }}>
        <div style={cardStyle}>
          <strong>Sesión iniciada</strong>
          <div>{session.user.name || session.user.email}</div>
        </div>
        <button onClick={() => signOut({ callbackUrl: "/auth-v2" })} style={buttonStyle}>
          Cerrar sesión
        </button>
      </div>
    )
  }

  return (
    <button onClick={() => signIn("google", { callbackUrl: "/" })} style={buttonStyle}>
      Continuar con Google
    </button>
  )
}

const buttonStyle: React.CSSProperties = {
  width: "100%",
  padding: "14px 18px",
  borderRadius: 16,
  border: "1px solid rgba(255,255,255,0.16)",
  background: "linear-gradient(135deg, #ef4444, #d4af37)",
  color: "white",
  fontWeight: 900,
  cursor: "pointer",
  fontSize: 16,
}

const cardStyle: React.CSSProperties = {
  padding: 16,
  borderRadius: 16,
  border: "1px solid rgba(255,255,255,0.12)",
  background: "rgba(255,255,255,0.06)",
  color: "white",
}
