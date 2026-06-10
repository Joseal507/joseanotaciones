import type { NextAuthOptions } from "next-auth"
import GoogleProvider from "next-auth/providers/google"

export const authOptions: NextAuthOptions = {
  providers: [
    GoogleProvider({
      clientId: process.env.GOOGLE_CLIENT_ID || "",
      clientSecret: process.env.GOOGLE_CLIENT_SECRET || "",
    }),
  ],
  session: { strategy: "jwt" },
  pages: { signIn: "/auth-v2" },
  secret: process.env.NEXTAUTH_SECRET,
  callbacks: {
    async signIn({ user, account }) {
      if (!user?.email) return false

      const apiUrl = process.env.STUDYAL_API_URL
      if (!apiUrl) return true

      try {
        await fetch(`${apiUrl}/users/upsert`, {
          method: "POST",
          headers: { "content-type": "application/json" },
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
            `${process.env.STUDYAL_API_URL}/users/by-email?email=${encodeURIComponent(token.email)}`
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
