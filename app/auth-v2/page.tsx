import AuthSessionProvider from "@/components/auth/AuthSessionProvider"
import StudyALAuthV2 from "@/components/auth/StudyALAuthV2"

export default function AuthV2Page() {
  return (
    <AuthSessionProvider>
      <StudyALAuthV2 />
    </AuthSessionProvider>
  )
}
