import type { NextAuthOptions } from "next-auth"
import GoogleProvider from "next-auth/providers/google"
import CredentialsProvider from "next-auth/providers/credentials"
import { workerAuthHeaders } from "../worker/auth"
import { verifyPassword } from "./password"

export const authOptions: NextAuthOptions = {
  providers: [
    GoogleProvider({
      clientId: process.env.GOOGLE_CLIENT_ID || "",
      clientSecret: process.env.GOOGLE_CLIENT_SECRET || "",
    }),
    CredentialsProvider({
      name: "Credentials",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials) {
        const email = String(credentials?.email || "").toLowerCase().trim()
        const password = String(credentials?.password || "")
        if (!email || !password) return null

        const apiUrl = process.env.STUDYAL_API_URL
        if (!apiUrl) return null

        try {
          const userRes = await fetch(`${apiUrl}/users/by-email?email=${encodeURIComponent(email)}`, {
            headers: workerAuthHeaders(),
          })
          const userData = await userRes.json() as { user?: { id?: string; email?: string; name?: string; image?: string } | null }
          const dbUser = userData?.user
          if (!dbUser?.id) return null

          const credRes = await fetch(`${apiUrl}/credentials/by-user?userId=${encodeURIComponent(dbUser.id)}`, {
            headers: workerAuthHeaders(),
          })
          const credData = await credRes.json() as { credential?: { password_hash?: string } | null }
          const storedHash = credData?.credential?.password_hash
          if (!storedHash) return null

          const valid = await verifyPassword(password, storedHash)
          if (!valid) return null

          return { id: dbUser.id, email: dbUser.email, name: dbUser.name, image: dbUser.image }
        } catch (error) {
          console.error("StudyAL credentials authorize failed:", error)
          return null
        }
      },
    }),
  ],
  session: { strategy: "jwt" },
  pages: { signIn: "/auth-v2" },
  secret: process.env.NEXTAUTH_SECRET,
  callbacks: {
    async signIn({ user, account, profile }) {
      if (!user?.email) return false

      // Credentials sign-in already resolved (and password-verified) an
      // existing D1 user inside authorize() — re-upserting here would
      // needlessly overwrite provider/provider_account_id on every password
      // login of a user whose account originated on Google.
      if (account?.provider === "credentials") return true

      const apiUrl = process.env.STUDYAL_API_URL
      if (!apiUrl) return true

      // SECURITY: matching email strings is NOT a trustworthy linking
      // signal on its own — Google only earns the right to reuse an
      // existing users.id when it explicitly attests email_verified=true
      // (this is the RAW OAuth profile, not the `user` object next-auth's
      // Google provider hands back, which drops this field entirely).
      // Without this check, a Google account whose email isn't verified
      // could silently take over an existing password-protected account
      // just by claiming the same email string.
      if (account?.provider === "google") {
        const emailVerified = (profile as { email_verified?: boolean } | undefined)?.email_verified === true
        if (!emailVerified) {
          try {
            const existingRes = await fetch(`${apiUrl}/users/by-email?email=${encodeURIComponent(user.email)}`, {
              headers: workerAuthHeaders(),
            })
            const existingData = await existingRes.json().catch(() => ({}))
            if (existingData?.user?.id) {
              console.warn("StudyAL: blocked Google sign-in — unverified email would have linked to an existing account")
              return false
            }
          } catch (error) {
            // Can't prove this wouldn't silently take over an existing
            // account — fail closed rather than risk a bad link.
            console.error("StudyAL: pre-link ownership check failed, blocking sign-in:", error)
            return false
          }
        }
      }

      try {
        await fetch(`${apiUrl}/users/upsert`, {
          method: "POST",
          headers: workerAuthHeaders({ "content-type": "application/json" }),
          body: JSON.stringify({
            email: user.email,
            name: user.name,
            image: user.image,
            provider: account?.provider || "google",
            providerAccountId: account?.providerAccountId,
          }),
        })
      } catch (error) {
        console.error("StudyAL D1 user sync failed:", error)
      }

      return true
    },
    async jwt({ token }) {
      if (token.email && process.env.STUDYAL_API_URL) {
        try {
          const res = await fetch(
            `${process.env.STUDYAL_API_URL}/users/by-email?email=${encodeURIComponent(token.email)}`,
            { headers: workerAuthHeaders() }
          )
          const data = await res.json() as { user?: { id?: string } | null }
          if (data.user?.id) token.sub = data.user.id
        } catch {}
      }

      return token
    },
    async session({ session, token }) {
      if (session.user && token.sub) {
        ;(session.user as any).id = token.sub
      }
      return session
    },
  },
}
