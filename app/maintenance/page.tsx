import Image from "next/image"

export const metadata = {
  title: "Mantenimiento — StudyAL",
  description: "StudyAL está en mantenimiento temporal.",
}

export default function MaintenancePage() {
  return (
    <main className="min-h-screen bg-black text-white relative overflow-hidden">
      <div className="absolute inset-0 pointer-events-none">
        <div className="absolute -top-40 -left-32 h-96 w-96 rounded-full bg-red-900/25 blur-3xl" />
        <div className="absolute top-20 left-1/2 h-[520px] w-[520px] -translate-x-1/2 rounded-full bg-[#d8b76a]/10 blur-3xl" />
        <div className="absolute -bottom-52 -right-40 h-[420px] w-[420px] rounded-full bg-[#d8b76a]/15 blur-3xl" />
      </div>

      <header className="relative z-10 flex items-center justify-center border-b border-[#d8b76a]/70 bg-black/80 px-5 py-3 backdrop-blur">
        <div className="flex items-center gap-3">
          <div className="relative h-12 w-12 overflow-hidden rounded-full border border-[#d8b76a] shadow-[0_0_18px_rgba(216,183,106,0.35)]">
            <Image
              src="/studyal-logo.png"
              alt="StudyAL"
              fill
              className="object-cover"
              priority
            />
          </div>

          <div className="text-3xl font-extrabold tracking-tight">
            <span>Study</span>
            <span className="text-red-600">A</span>
            <span>L</span>
          </div>
        </div>

        
      </header>

      <div className="relative z-10 h-4 overflow-hidden border-b border-white/20">
        <div className="absolute left-0 top-1/2 h-[2px] w-full -translate-y-1/2 bg-white/70" />
        <div className="absolute left-0 top-0 h-4 w-full opacity-70">
          <svg viewBox="0 0 1200 40" preserveAspectRatio="none" className="h-full w-full">
            <path
              d="M0,20 C80,5 160,35 240,20 C320,5 400,35 480,20 C560,5 640,35 720,20 C800,5 880,35 960,20 C1040,5 1120,35 1200,20"
              fill="none"
              stroke="white"
              strokeWidth="2"
              opacity="0.55"
            />
          </svg>
        </div>
      </div>

      <section className="relative z-10 flex min-h-[calc(100vh-86px)] items-center justify-center px-6 py-16">
        <div className="mx-auto flex max-w-4xl flex-col items-center text-center">
          <div className="relative mb-8">
            <div className="absolute inset-0 rounded-full bg-[#d8b76a]/20 blur-3xl" />
            <div className="relative h-56 w-56 overflow-hidden rounded-full border-4 border-[#d8b76a] bg-zinc-950 shadow-[0_0_40px_rgba(216,183,106,0.35)] sm:h-72 sm:w-72">
              <Image
                src="/studyal-logo.png"
                alt="Logo StudyAL"
                fill
                className="object-cover"
                priority
              />
            </div>
          </div>

          <h1 className="mb-3 text-4xl font-black tracking-tight sm:text-6xl">
            Study<span className="text-red-600">A</span>L está en mantenimiento
          </h1>

          <h2 className="mb-5 text-2xl font-bold italic text-white sm:text-3xl">
            Tu plataforma de estudio completa
          </h2>

          <p className="mb-8 max-w-2xl text-lg italic leading-relaxed text-zinc-300 sm:text-2xl">
            Estamos arreglando y mejorando el sitio para darte una mejor experiencia.
            <br />
            Volveremos pronto con nuevas funciones y mejoras. ✨
          </p>

          <div className="mb-8 inline-flex items-center gap-2 rounded-full border border-[#d8b76a]/60 bg-[#d8b76a]/10 px-5 py-2 text-sm font-bold text-[#f4d88a]">
            <span className="h-2 w-2 animate-pulse rounded-full bg-red-500" />
            Sitio temporalmente en mantenimiento
          </div>

          <div className="h-3 w-full max-w-xl overflow-hidden rounded-full bg-zinc-900 ring-1 ring-white/10">
            <div className="h-full w-4/5 rounded-full bg-gradient-to-r from-red-700 via-red-500 to-[#d8b76a] shadow-[0_0_20px_rgba(216,183,106,0.35)]" />
          </div>

          <p className="mt-8 text-sm text-zinc-500">
            Gracias por tu paciencia.
          </p>

          <p className="mt-10 text-xs text-zinc-600">
            © {new Date().getFullYear()} StudyAL
          </p>
        </div>
      </section>
    </main>
  )
}
