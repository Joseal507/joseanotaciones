// StudyAL_Visual_System_Stress_Test — Layer B GAP "cancellation" (pedido
// explícito del usuario, sección 9: "Testea directamente el lifecycle/
// token/AbortController que gobierna el estado si ese es el nivel
// correcto... No inventes una UI artificial si el contrato se puede probar
// en el nivel correcto"). Extraído VERBATIM de la lógica que ya vivía
// inline en StudyALAdaptive.tsx (useRef de token + AbortController) — cero
// cambio de comportamiento, solo lo suficiente para poder probarlo sin
// React/DOM/Playwright. StudyALAdaptive.tsx guarda una instancia de esta
// clase en un único useRef y la usa exactamente donde antes usaba
// generationTokenRef/generationControllerRef/beginGenerationAttempt.
//
// Contrato: blueprint -> generate-plan -> session-copy no tenía ninguna
// política de cancelación — salir de la vista a mitad de generación dejaba
// todo el trabajo restante corriendo en segundo plano, y una respuesta
// tardía de un intento abandonado podía sobrescribir un intento nuevo
// (mismo sessionId). Un token identifica el intento VIGENTE; el
// AbortController es el de las llamadas de red de ESE intento. Nunca se
// promete cancelar una llamada YA despachada al proveedor — solo se evita
// aplicar/persistir su resultado si llega tarde (`stillCurrent`), y se
// evita lanzar la SIGUIENTE etapa cara si el intento que la pidió ya no es
// el vigente.
export class GenerationAttemptTracker {
  private token = 0
  private controller: AbortController | null = null

  // Aborta cualquier intento anterior en vuelo, arranca uno nuevo, y
  // devuelve su token + signal. Cada llamada invalida automáticamente el
  // intento previo — no hace falta invalidar manualmente.
  begin(): { token: number; signal: AbortSignal } {
    this.controller?.abort()
    const controller = new AbortController()
    this.controller = controller
    this.token += 1
    return { token: this.token, signal: controller.signal }
  }

  // true solo si `token` sigue siendo el intento vigente — un intento
  // anterior (A) cuya respuesta llega DESPUÉS de que uno nuevo (B) haya
  // empezado (begin() llamado de nuevo) siempre devuelve false para A,
  // incluso si A nunca fue explícitamente abortado a tiempo.
  stillCurrent(token: number): boolean {
    return token === this.token
  }

  // Para cleanup (unmount) — aborta el intento vigente sin iniciar uno nuevo.
  abortCurrent(): void {
    this.controller?.abort()
  }

  get currentToken(): number {
    return this.token
  }

  get currentSignal(): AbortSignal | null {
    return this.controller?.signal ?? null
  }
}
