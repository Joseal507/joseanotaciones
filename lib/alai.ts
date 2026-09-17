import OpenAI from 'openai';
import {
  classifyProviderFailure,
  sanitizedProviderMessage,
  shouldFallbackToGroq,
  type ProviderError,
} from './ai/providerPolicy';

type Role = 'system' | 'user' | 'assistant';

export interface ALAIParams {
  messages: { role: Role; content: string }[];
  temperature?: number;
  maxTokens?: number;
  json?: boolean;
  /** Explicit opt-in for providers normally excluded from native JSON mode. */
  forceJsonTransport?: boolean;
  /** ALAI-only opt-in; other modules retain their json_object behavior. */
  responseJsonSchema?: { name: string; strict: boolean; schema: Record<string, unknown> };
  excludeProviders?: string[];
  excludeModels?: string[];
  maxProviderAttempts?: number;
  /** Explicit transport budget for callers that reserve attempts durably. */
  transportRetries?: number;
  timeoutMs?: number;
  signal?: AbortSignal;
  fallbackError?: ProviderError;
  taskType?: string;
  stage?: string;
}

export interface ALAIResult {
  text: string;
  provider: string;
  model: string;
  completion?: ALAICompletionMetadata;
}

export interface ALAICompletionMetadata {
  finishReason: string | null;
  transportComplete: boolean;
  provider: string;
  model: string;
  usage: { promptTokens: number | null; completionTokens: number | null; totalTokens: number | null; reasoningTokens: number | null };
}

type Provider =
  | 'openrouter'
  | 'groq'
  | 'github'
  | 'gemini'
  | 'cerebras'
  | 'sambanova'
  | 'hf'
  | 'mistral'
  | 'cloudflare';

type QueueEntry = {
  provider: Provider;
  key: string;
  model: string;
  client: any;
};

const blocked = new Map<string, number>();
const cursor: Record<string, number> = {};

const disabledProviders = new Set(
  (process.env.ALAI_DISABLED_PROVIDERS || '')
    .split(',')
    .map(x => x.trim().toLowerCase())
    .filter(Boolean)
);

function unique(arr: string[]) {
  return Array.from(new Set(arr.map(x => x.trim()).filter(Boolean)));
}

function envKeys(base: string): string[] {
  const exact = process.env[base];
  const numbered = Object.keys(process.env)
    .filter(k => {
      if (k !== base && !k.startsWith(`${base}_`)) return false;
      if (k.endsWith('_TEST')) return false;
      return true;
    })
    .sort((a, b) => {
      const na = Number(a.replace(`${base}_`, '').replace(base, '1')) || 1;
      const nb = Number(b.replace(`${base}_`, '').replace(base, '1')) || 1;
      return na - nb;
    })
    .map(k => process.env[k] || '');

  return unique([exact || '', ...numbered]);
}

function envKeysLoose(prefix: string): string[] {
  return unique(
    Object.keys(process.env)
      .filter(k => k === prefix || /^JIT\d+$/.test(k))
      .sort((a, b) => {
        const na = a === prefix ? 1 : Number(a.replace(prefix, '')) || 1;
        const nb = b === prefix ? 1 : Number(b.replace(prefix, '')) || 1;
        return na - nb;
      })
      .map(k => process.env[k] || '')
  );
}

function isBlocked(key: string) {
  const until = blocked.get(key);
  if (!until) return false;
  if (Date.now() >= until) {
    blocked.delete(key);
    return false;
  }
  return true;
}

export function blockALAIKey(key: string, seconds = 60) {
  if (!key) return;
  blocked.set(key, Date.now() + seconds * 1000);
  console.warn(`🔴 ALAI: key bloqueada ${seconds}s → ${key.slice(0, 10)}...`);
}

function rotate<T extends QueueEntry>(entries: T[], provider: Provider): T[] {
  if (!entries.length) return entries;
  const i = cursor[provider] || 0;
  cursor[provider] = (i + 1) % entries.length;
  return [...entries.slice(i), ...entries.slice(0, i)];
}

function modelFor(provider: Provider): string {
  switch (provider) {
    case 'openrouter':
      return 'google/gemini-2.5-flash';
    case 'groq':
      return process.env.GROQ_MODEL || 'llama-3.3-70b-versatile';
    case 'github':
      return process.env.JIT_MODEL || process.env.GITHUB_MODEL || 'openai/gpt-4.1-mini';
    case 'gemini':
      return process.env.GEMINI_MODEL || 'gemini-2.0-flash';
    case 'cerebras':
      return process.env.CEREBRAS_MODEL || 'qwen-3-235b-a22b-instruct-2507';
    case 'sambanova':
      return process.env.SAMBANOVA_MODEL || 'Meta-Llama-3.3-70B-Instruct';
    case 'hf':
      return process.env.HF_MODEL || 'meta-llama/Llama-3.3-70B-Instruct';
    case 'mistral':
      return process.env.MISTRAL_MODEL || 'mistral-small-latest';
    case 'cloudflare':
      return process.env.CLOUDFLARE_MODEL || '@cf/meta/llama-3.1-8b-instruct';
  }
}

function openAIClient(key: string, baseURL: string) {
  return new OpenAI({ apiKey: key, baseURL });
}

function geminiClient(key: string, model: string) {
  return {
    chat: {
      completions: {
        create: async (p: any) => {
          const prompt = p.messages
            .map((m: any) => `${m.role}: ${typeof m.content === 'string' ? m.content : JSON.stringify(m.content)}`)
            .join('\n');

          const res = await fetch(
            `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`,
            {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                contents: [{ parts: [{ text: prompt }] }],
                generationConfig: {
                  maxOutputTokens: p.max_tokens || 8192,
                  temperature: p.temperature ?? 0.7,
                },
              }),
            }
          );

          if (!res.ok) {
            const text = await res.text();
            const e: any = new Error(text || `Gemini ${res.status}`);
            e.status = res.status;
            throw e;
          }

          const data = await res.json();
          const text = data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
          return { choices: [{ message: { content: text } }] };
        },
      },
    },
  };
}

function cloudflareClient(model: string) {
  const account = process.env.CLOUDFLARE_ACCOUNT_ID || '';
  const token = process.env.CLOUDFLARE_API_TOKEN || '';

  return {
    chat: {
      completions: {
        create: async (p: any) => {
          if (!account || !token) throw new Error('Cloudflare no configurado');

          const res = await fetch(
            `https://api.cloudflare.com/client/v4/accounts/${account}/ai/run/${model}`,
            {
              method: 'POST',
              headers: {
                Authorization: `Bearer ${token}`,
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({
                messages: p.messages.map((m: any) => ({
                  role: m.role,
                  content: typeof m.content === 'string' ? m.content : JSON.stringify(m.content),
                })),
              }),
            }
          );

          const data = await res.json() as any;
          if (!res.ok || !data?.result?.response) {
            const e: any = new Error(JSON.stringify(data).slice(0, 400));
            e.status = res.status;
            throw e;
          }

          return { choices: [{ message: { content: data.result.response } }] };
        },
      },
    },
  };
}

function buildQueue(): QueueEntry[] {
  const queue: QueueEntry[] = [];

  const addOpenAIProvider = (
    provider: Provider,
    keys: string[],
    baseURL: string,
  ) => {
    if (disabledProviders.has(provider)) return;

    const model = modelFor(provider);
    for (const key of keys) {
      queue.push({
        provider,
        key,
        model,
        client: openAIClient(key, baseURL),
      });
    }
  };

  const openrouterKey = process.env.OPENROUTER_API_KEY || '';
  if (openrouterKey && !disabledProviders.has('openrouter')) {
    queue.push({
      provider: 'openrouter',
      key: openrouterKey,
      model: modelFor('openrouter'),
      client: openAIClient(openrouterKey, 'https://openrouter.ai/api/v1'),
    });
  }

  addOpenAIProvider('groq', envKeys('GROQ_API_KEY'), 'https://api.groq.com/openai/v1');
  addOpenAIProvider('github', envKeysLoose('JIT'), 'https://models.github.ai/inference');
  addOpenAIProvider('cerebras', envKeys('CEREBRAS_API_KEY'), 'https://api.cerebras.ai/v1');

  if (!process.env.HF_DISABLED) {
    addOpenAIProvider('hf', envKeys('HF_API_KEY'), 'https://router.huggingface.co/v1');
  }
  if (!process.env.SAMBANOVA_DISABLED) {
    addOpenAIProvider('sambanova', envKeys('SAMBANOVA_API_KEY'), 'https://api.sambanova.ai/v1');
  }

  const geminiModel = modelFor('gemini');
  const geminiDisabled = disabledProviders.has('gemini') || !!process.env.GEMINI_DISABLED;
  if (!geminiDisabled) {
    const geminiKeys = [
      ...envKeys('GEMINI_API_KEY'),
      ...(process.env.GEMINI_PREMIUM_KEY ? [process.env.GEMINI_PREMIUM_KEY] : []),
    ].filter(Boolean);
    for (const key of unique(geminiKeys)) {
      queue.push({
        provider: 'gemini',
        key,
        model: geminiModel,
        client: geminiClient(key, geminiModel),
      });
    }
  }

  const mistralKey = process.env.MISTRAL_API_KEY || '';
  if (mistralKey && !disabledProviders.has('mistral')) {
    queue.push({
      provider: 'mistral',
      key: mistralKey,
      model: modelFor('mistral'),
      client: openAIClient(mistralKey, 'https://api.mistral.ai/v1'),
    });
  }

  if (process.env.CLOUDFLARE_ACCOUNT_ID && process.env.CLOUDFLARE_API_TOKEN && !disabledProviders.has('cloudflare')) {
    const model = modelFor('cloudflare');
    queue.push({
      provider: 'cloudflare',
      key: process.env.CLOUDFLARE_API_TOKEN,
      model,
      client: cloudflareClient(model),
    });
  }

  const order: Provider[] = [
    'openrouter',
    'groq',
    'github',
    'hf',
    'mistral',
    'sambanova',
    'gemini',
    'cerebras',
    'cloudflare',
  ];

  return order.flatMap(provider =>
    rotate(queue.filter(x => x.provider === provider), provider)
  );
}

function shouldUseJson(provider: Provider, params: ALAIParams) {
  if (!params.json) return false;

  // Some providers are historically excluded from native JSON mode.
  // Callers may opt in explicitly when that provider/model path has been
  // certified for structured JSON transport.
  if (params.forceJsonTransport) {
    return provider !== 'gemini' &&
      provider !== 'cloudflare' &&
      provider !== 'cerebras';
  }

  return provider !== 'gemini' &&
    provider !== 'cloudflare' &&
    provider !== 'cerebras' &&
    provider !== 'openrouter';
}

export function providerMaxTokens(provider: Provider, requested?: number) {
  // OpenRouter: honour explicit caller budgets; default high only when none given.
  if (provider === 'openrouter') return requested ?? 8192;

  const base = requested ?? 4096;
  if (provider === 'cerebras') return Math.max(base, 4000);
  return base;
}

function retrySeconds(err: any) {
  const h = err?.headers;
  const raw =
    h?.['retry-after'] ||
    h?.get?.('retry-after') ||
    err?.response?.headers?.['retry-after'];
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.min(n, 3600) : 60;
}

function isRateLimit(err: any) {
  const status = err?.status || err?.statusCode;
  const msg = String(err?.message || '').toLowerCase();
  return status === 429 || msg.includes('rate') || msg.includes('quota') || msg.includes('too many');
}

function isAuthError(err: any) {
  const status = err?.status || err?.statusCode;
  return status === 401 || status === 403;
}

function isProviderUnavailable(err: any) {
  const status = err?.status || err?.statusCode;
  const msg = String(err?.message || '').toLowerCase();
  // 429 = rate limit, nunca provider unavailable
  if (status === 429) return false;
  // 404 con "no endpoints" o "model not found" = MODEL_NOT_AVAILABLE
  // No bloquear key: es un error de configuración, no financiero ni de autenticación
  if (status === 404) return false;
  return status === 402 || status === 410 ||
    msg.includes('depleted');
}

function isModelNotAvailable(err: any) {
  const status = err?.status || err?.statusCode;
  const msg = String(err?.message || '').toLowerCase();
  return status === 404 ||
    (msg.includes('model') && msg.includes('not found')) ||
    msg.includes('no endpoints');
}

function normalizedProviderError(error: any, provider: Provider): ProviderError {
  return {
    provider,
    status: Number(error?.status || error?.statusCode || error?.response?.status || 0),
    message: String(error?.message || ''),
    body: error?.body || error?.error || error?.response?.data,
  };
}

function providerTelemetry(
  event: string,
  entry: Pick<QueueEntry, 'provider' | 'model'>,
  params: ALAIParams,
  details: Record<string, unknown>,
) {
  console.info('[provider-policy]', JSON.stringify({
    event,
    provider: entry.provider,
    model: entry.model,
    stage: params.stage || 'normal',
    taskType: params.taskType || 'unspecified',
    ...details,
  }));
}

// ── ZERO-PAID-PROVIDER TEST GUARD ──────────────────────────────────
// STUDYAL_TEST_NO_PROVIDER_CALLS is set ONLY by playwright.config.ts's
// webServer.env (a local dev-only Playwright process spawn) — it does not
// exist in .env, .env.local, .env.production, or any deployed environment,
// so this can never fire in production and production provider behavior/
// policy is completely unchanged when unset. When set, it makes the SINGLE
// canonical provider chokepoint (alai()) fail loudly and immediately,
// BEFORE any real network call, whenever a Playwright test's route mocks
// have a gap and a request would otherwise reach a real paid provider
// (OpenRouter/Groq/etc). This is a server-side backstop independent of
// per-test page.route() completeness — see tests/e2e/_shared/noPaidProviderGuard.ts
// for the client-side assertion that also fails the test explicitly.
function assertNoRealProviderCallsInTestMode() {
  if (process.env.STUDYAL_TEST_NO_PROVIDER_CALLS === '1') {
    throw new Error(
      'STUDYAL_TEST_MODE: blocked a real AI provider call. This route was not ' +
      'mocked in the current Playwright test — add a page.route() fixture for ' +
      'the endpoint that triggers alai()/alaiJson() instead of letting the ' +
      'request reach the real provider.',
    );
  }
}

export async function alai(params: ALAIParams): Promise<ALAIResult> {
  assertNoRealProviderCallsInTestMode();
  const fallbackAllowed = Boolean(params.fallbackError && shouldFallbackToGroq(params.fallbackError));
  const requestedExclusions = (params.excludeProviders || []).map(value => value.toLowerCase());
  if (requestedExclusions.includes('openrouter') && !fallbackAllowed) {
    throw new Error('PROVIDER_POLICY_VIOLATION:openrouter_exclusion_without_credits_exhausted');
  }
  const excludedProviders = new Set(fallbackAllowed ? ['openrouter'] : requestedExclusions.filter(value => value !== 'openrouter'));
  const excludedModels = new Set(params.excludeModels || []);
  const selectedProvider: Provider = fallbackAllowed ? 'groq' : 'openrouter';
  const queue = buildQueue().filter(entry => entry.provider === selectedProvider && !excludedProviders.has(entry.provider) && !excludedModels.has(entry.model));
  let lastError: any;
  let providerAttempts = 0;

  if (!queue.length) {
    throw new Error(`ALAI: proveedor canónico ${selectedProvider} no configurado`);
  }

  for (const entry of queue) {
    const { client, provider, key, model } = entry;
    if (key && isBlocked(key)) continue;

    try {
      providerAttempts += 1;
      providerTelemetry('provider_call_started', entry, params, {
        status: null, normalizedFailureReason: null, fallbackAllowed,
        fallbackTarget: fallbackAllowed ? 'groq' : null, excludedProviders: [...excludedProviders], rawProviderMessage: '',
      });
      // The OpenAI SDK's per-request `timeout` option is validated with
      // `if ('timeout' in options) validatePositiveInteger(...)` — the KEY
      // merely being present (even set to `undefined`, as an unconditional
      // `timeout: params.timeoutMs` always leaves it) is enough to trigger
      // "timeout must be an integer" and fail the call before it ever
      // reaches the network. `maxRetries` has no such presence check (it
      // falls back via `??` to the client default), so only `timeout` is
      // conditional here.
      const requestOptions: { maxRetries?: number; timeout?: number; signal?: AbortSignal } = { maxRetries: params.transportRetries };
      if (Number.isInteger(params.timeoutMs)) requestOptions.timeout = params.timeoutMs;
      if (params.signal) requestOptions.signal = params.signal;
      const res = await client.chat.completions.create({
        model,
        messages: params.messages,
        temperature: params.temperature ?? 0.7,
        max_tokens: providerMaxTokens(provider, params.maxTokens),
        ...(params.responseJsonSchema && provider === 'openrouter'
          ? { response_format: { type: 'json_schema', json_schema: params.responseJsonSchema }, provider: { require_parameters: true } }
          : shouldUseJson(provider, params)
          ? { response_format: { type: 'json_object' } }
          : {}),
      }, requestOptions);

      const text =
        res?.choices?.[0]?.message?.content ??
        res?.choices?.[0]?.delta?.content ??
        res?.choices?.[0]?.text ??
        res?.content ??
        res?.response ??
        res?.output_text ??
        '';

      if (!String(text).trim()) {
        const e: any = new Error('ALAI_EMPTY_RESPONSE');
        e.status = 204;
        throw e;
      }

      console.log(`✅ ALAI: ${provider} OK · ${model}`);

      // Safe completion diagnostics: metadata only, never academic content.
      const finishReason =
        res?.choices?.[0]?.finish_reason ??
        res?.choices?.[0]?.finishReason ??
        null;

      // Safe transport diagnostics: metadata/lengths only, never response content.
      const responseAny: any = res as any;
      const messageContent = responseAny?.choices?.[0]?.message?.content;
      const usage = responseAny?.usage || {};
      const completionDetails =
        usage?.completion_tokens_details ??
        usage?.completionTokensDetails ??
        {};

      const safeText = String(text);

      const transportDiagnostics = {
        promptTokens:
          usage?.prompt_tokens ??
          usage?.promptTokens ??
          null,
        completionTokens:
          usage?.completion_tokens ??
          usage?.completionTokens ??
          null,
        totalTokens:
          usage?.total_tokens ??
          usage?.totalTokens ??
          null,
        reasoningTokens:
          completionDetails?.reasoning_tokens ??
          completionDetails?.reasoningTokens ??
          null,

        contentType: Array.isArray(messageContent)
          ? 'array'
          : typeof messageContent,
        contentIsArray: Array.isArray(messageContent),
        contentPartCount: Array.isArray(messageContent)
          ? messageContent.length
          : null,

        messageReasoningChars:
          typeof responseAny?.choices?.[0]?.message?.reasoning === 'string'
            ? responseAny.choices[0].message.reasoning.length
            : null,

        trimmedOutputChars: safeText.trim().length,
        nonWhitespaceOutputChars: safeText.replace(/\s/g, '').length,
        outputLineCount: safeText ? safeText.split('\n').length : 0,
      };

      providerTelemetry('provider_call_succeeded', entry, params, {
        status: 200, normalizedFailureReason: null, fallbackAllowed,
        fallbackTarget: fallbackAllowed ? 'groq' : null,
        excludedProviders: [...excludedProviders],
        rawProviderMessage: '',
        finishReason,
        outputChars: safeText.length,
        ...transportDiagnostics,
        requestedMaxTokens: params.maxTokens ?? null,
        effectiveMaxTokens: providerMaxTokens(provider, params.maxTokens),
      });

      return { text, provider, model, completion: {
        finishReason, transportComplete: finishReason === 'stop', provider, model,
        usage: {
          promptTokens: transportDiagnostics.promptTokens,
          completionTokens: transportDiagnostics.completionTokens,
          totalTokens: transportDiagnostics.totalTokens,
          reasoningTokens: transportDiagnostics.reasoningTokens,
        },
      } };
    } catch (err: any) {
      lastError = err;
      err.alaiProvider = provider;
      const policyError = normalizedProviderError(err, provider);
      err.providerError = policyError;
      const normalizedFailureReason = classifyProviderFailure(policyError);
      providerTelemetry('provider_call_failed', entry, params, {
        status: policyError.status || 0, normalizedFailureReason,
        fallbackAllowed: shouldFallbackToGroq(policyError),
        fallbackTarget: shouldFallbackToGroq(policyError) ? 'groq' : null,
        excludedProviders: [...excludedProviders], rawProviderMessage: sanitizedProviderMessage(policyError),
      });
      if (isRateLimit(err)) {
        blockALAIKey(key, retrySeconds(err));
        console.warn(`⚠️ ALAI: rate/quota ${provider} · ${model}`);
      } else if (isAuthError(err)) {
        blockALAIKey(key, 3600);
        console.warn(`⚠️ ALAI: auth error ${provider} · ${model}`);
      } else if (isModelNotAvailable(err)) {
        // MODEL_NOT_AVAILABLE: error de configuración, no financiero
        // NO bloquear key, NO habilitar Groq — reportar y fallar limpio
        console.error(`🔴 ALAI: MODEL_NOT_AVAILABLE ${provider} · ${model} — verifica OPENROUTER_MODEL o modelFor()`);
      } else if (isProviderUnavailable(err)) {
        blockALAIKey(key, 300);
        console.warn(`⚠️ ALAI: provider unavailable ${provider} · ${model}`);
      }
      if (providerAttempts >= Math.max(1, params.maxProviderAttempts ?? 1)) break;
    }
  }

  throw lastError || new Error('ALAI: todos los proveedores fallaron');
}

export async function alaiJson<T = any>(params: ALAIParams): Promise<T> {
  const result = await alai({ ...params, json: true });
  const parsed = safeParseJson(result.text);
  if (parsed === null) {
    const failureClass = classifyJsonParseFailure(result.text);
    // DEV-only diagnostic: failure class + length only, never the raw
    // provider text (which may embed authorized academic source content).
    if (process.env.NODE_ENV !== 'production') {
      console.warn('[alaiJson] INVALID_JSON', JSON.stringify({
        provider: result.provider, model: result.model, failureClass, rawLength: result.text.length,
      }));
    }
    const err: any = new Error(`ALAI: INVALID_JSON de ${result.provider} · ${result.model} (${failureClass})`);
    err.code = 'INVALID_JSON';
    err.jsonFailureClass = failureClass;
    throw err;
  }
  return parsed as T;
}

export const alaiRequest = async <T>(
  fn: (client: any, model: (m?: string) => string) => Promise<T>,
): Promise<T> => {
  const openrouter = buildQueue().find(entry => entry.provider === 'openrouter' && !isBlocked(entry.key));
  if (!openrouter) throw new Error('ALAI: proveedor canónico openrouter no configurado');
  try {
    const result = await fn(openrouter.client, () => openrouter.model);
    return result;
  } catch (error: any) {
    const policyError = normalizedProviderError(error, 'openrouter');
    if (!shouldFallbackToGroq(policyError)) throw error;
    console.info('[provider-policy]', JSON.stringify({
      event: 'openrouter_credits_exhausted', provider: 'openrouter', model: openrouter.model,
      status: policyError.status, normalizedFailureReason: 'OPENROUTER_CREDITS_EXHAUSTED', fallbackAllowed: true,
      fallbackTarget: 'groq', excludedProviders: ['openrouter'], rawProviderMessage: sanitizedProviderMessage(policyError),
    }));
    const groq = buildQueue().find(entry => entry.provider === 'groq' && !isBlocked(entry.key));
    if (!groq) throw error;
    return await fn(groq.client, () => groq.model);
  }
};

export const getALAIClient = () => {
  const first = buildQueue().find(x => x.provider === 'openrouter' && !isBlocked(x.key));
  return first?.client || null;
};

// Deterministic scanner to escape literal control characters (LF, CR, TAB)
// and unescaped quotes inside JSON string literals without altering structural JSON.
export function sanitizeJsonStringLiterals(raw: string, fixQuotes = false): string {
  let inString = false;
  let escapeNext = false;
  let result = '';
  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i];
    if (!inString) {
      if (ch === '"') inString = true;
      result += ch;
    } else {
      if (escapeNext) {
        escapeNext = false;
        result += ch;
      } else if (ch === '\\') {
        escapeNext = true;
        result += ch;
      } else if (ch === '"') {
        if (fixQuotes) {
          let j = i + 1;
          while (j < raw.length && (raw[j] === ' ' || raw[j] === '\t' || raw[j] === '\r' || raw[j] === '\n')) j++;
          const nextChar = raw[j];
          if (nextChar === ',' || nextChar === '}' || nextChar === ']' || nextChar === ':' || j >= raw.length) {
            inString = false;
            result += ch;
          } else {
            result += '\\"';
          }
        } else {
          inString = false;
          result += ch;
        }
      } else if (ch === '\n') {
        result += '\\n';
      } else if (ch === '\r') {
        if (raw[i + 1] === '\n') {
          result += '\\r\\n';
          i++;
        } else {
          result += '\\r';
        }
      } else if (ch === '\t') {
        result += '\\t';
      } else {
        result += ch;
      }
    }
  }
  return result;
}

// Locates the first COMPLETE, balanced top-level JSON value (object or array)
// embedded in arbitrary surrounding text by scanning depth while respecting string
// literals and escapes — immune to inner code fences contained inside string fields.
export function extractBalancedJsonObject(text: string): string | null {
  const startBrace = text.indexOf('{');
  const startBracket = text.indexOf('[');
  let start = -1;
  let opener = '{';
  let closer = '}';
  if (startBrace >= 0 && (startBracket < 0 || startBrace < startBracket)) {
    start = startBrace;
    opener = '{';
    closer = '}';
  } else if (startBracket >= 0) {
    start = startBracket;
    opener = '[';
    closer = ']';
  } else {
    return null;
  }

  let depth = 0;
  let inString = false;
  let escapeNext = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (escapeNext) { escapeNext = false; continue; }
    if (ch === '\\' && inString) { escapeNext = true; continue; }
    if (ch === '"') { inString = !inString; continue; }
    if (inString) continue;
    if (ch === opener) depth++;
    else if (ch === closer) {
      depth--;
      if (depth === 0) {
        // Reject as ambiguous if ANOTHER top-level JSON value starts
        // after this one closes (ignoring trailing whitespace/fences/prose)
        const rest = text.slice(i + 1).trim();
        const restAfterFence = rest.replace(/^```[a-zA-Z]*/, '').trim();
        if (restAfterFence && /^[{[]/.test(restAfterFence)) return null;
        return text.slice(start, i + 1);
      }
    }
  }
  return null; // unbalanced (e.g. truncated mid-object) — no complete object found
}

// Deterministic truncation repair: when generation was cut off mid-object
// (hit maxTokens), the raw text is a well-formed JSON *prefix* — every
// container opened up to some point closes cleanly, then breaks off
// mid-value. This walks the text once, recording every point where a
// nested object/array just closed (a structurally "safe" cut point) along
// with what is still open at that point, then tries the LATEST safe cut
// first, closing the remaining open containers and stripping a dangling
// trailing comma. It never invents field values — it only truncates
// incomplete trailing content and closes brackets — and the result is
// only ever used if it round-trips through JSON.parse successfully, so a
// wrong guess simply fails closed instead of returning bad data.
function closeTruncatedJson(text: string): string | null {
  const start = text.indexOf('{');
  if (start < 0) return null;
  const stack: Array<'{' | '['> = [];
  let inString = false;
  let escapeNext = false;
  const safeCuts: Array<{ index: number; openStack: Array<'{' | '['> }> = [];
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (escapeNext) { escapeNext = false; continue; }
    if (ch === '\\' && inString) { escapeNext = true; continue; }
    if (ch === '"') { inString = !inString; continue; }
    if (inString) continue;
    if (ch === '{' || ch === '[') { stack.push(ch); continue; }
    if (ch === '}' || ch === ']') {
      stack.pop();
      safeCuts.push({ index: i + 1, openStack: stack.slice() });
    }
  }
  if (!stack.length || !safeCuts.length) return null; // not actually truncated, or no safe boundary found
  for (let k = safeCuts.length - 1; k >= 0; k--) {
    const { index, openStack } = safeCuts[k];
    if (!openStack.length) continue;
    const closers = openStack.slice().reverse().map(c => (c === '{' ? '}' : ']')).join('');
    const candidate = text.slice(start, index).replace(/,\s*$/, '') + closers;
    // Repair first: JSON accepts \f as form feed even in a LaTeX command.
    try { return JSON.parse(repairJson(candidate)); } catch {}
    try { return JSON.parse(candidate); } catch {}
  }
  return null;
}

export type JsonParseFailureClass =
  | 'EMPTY'
  | 'AMBIGUOUS_MULTIPLE_OBJECTS'
  | 'TRUNCATED'
  | 'MALFORMED';

/** DEV-safe diagnostic classification — never used to decide parsing, only to log/report why parsing failed. */
export function classifyJsonParseFailure(raw: string): JsonParseFailureClass {
  if (!raw || !raw.trim()) return 'EMPTY';
  const cleaned = raw.replace(/^﻿/, '').trim();
  const candidate = extractBalancedJsonObject(cleaned) ?? cleaned;
  const start = candidate.search(/[{[]/);
  if (start < 0) return 'MALFORMED';
  let depth = 0;
  let inString = false;
  let escapeNext = false;
  let closedOnce = false;
  for (let i = start; i < candidate.length; i++) {
    const ch = candidate[i];
    if (escapeNext) { escapeNext = false; continue; }
    if (ch === '\\' && inString) { escapeNext = true; continue; }
    if (ch === '"') { inString = !inString; continue; }
    if (inString) continue;
    if (ch === '{' || ch === '[') depth++;
    else if (ch === '}' || ch === ']') {
      depth--;
      if (depth === 0) {
        closedOnce = true;
        const rest = candidate.slice(i + 1).trim();
        const restAfterFence = rest.replace(/^```[a-zA-Z]*/, '').trim();
        if (restAfterFence && /^[{[]/.test(restAfterFence)) return 'AMBIGUOUS_MULTIPLE_OBJECTS';
      }
    }
  }
  if (!closedOnce || depth > 0) return 'TRUNCATED';
  return 'MALFORMED';
}

export function safeParseJson(raw: string): any {
  if (!raw) return null;
  // BOM / stray leading whitespace some providers prepend before the
  // actual fence or object.
  const cleaned = raw.replace(/^﻿/, '').trim();
  if (!cleaned) return null;

  // Prefer balanced extraction using string/escape-aware scanning rather
  // than a naive non-greedy fence regex which severs on inner markdown fences.
  const balanced = extractBalancedJsonObject(cleaned);
  const candidate = balanced ?? cleaned;

  // Progressive parsing attempts with string control-character sanitization,
  // backslash command repair, and quote recovery.
  // Note: repairJson runs BEFORE sanitizeJsonStringLiterals so LaTeX commands
  // like \rightleftharpoons are protected before literal control characters (LF, CR)
  // are escaped to \n, \r.
  const parseAttempts = [
    () => JSON.parse(sanitizeJsonStringLiterals(repairJson(candidate), false)),
    () => JSON.parse(sanitizeJsonStringLiterals(repairJson(candidate), true)),
    () => JSON.parse(repairJson(candidate)),
    () => JSON.parse(candidate),
  ];

  for (const attempt of parseAttempts) {
    try { return attempt(); } catch {}
  }

  // If candidate was balanced slice from raw, also attempt repairs on cleaned raw
  if (candidate !== cleaned) {
    const fromRawAttempts = [
      () => JSON.parse(sanitizeJsonStringLiterals(repairJson(cleaned), false)),
      () => JSON.parse(sanitizeJsonStringLiterals(repairJson(cleaned), true)),
      () => JSON.parse(repairJson(cleaned)),
      () => JSON.parse(cleaned),
    ];
    for (const attempt of fromRawAttempts) {
      try { return attempt(); } catch {}
    }
  }

  // Deterministic truncation repair — only reached once every ambiguity-
  // preserving attempt above has failed. Still parse-verified, never
  // fabricates content.
  const closed = closeTruncatedJson(candidate);
  if (closed !== null) return closed;
  if (candidate !== cleaned) {
    const closedFromRaw = closeTruncatedJson(cleaned);
    if (closedFromRaw !== null) return closedFromRaw;
  }
  return null;
}

// Root-cause fix (real production corruption: "\rightleftharpoons"
// mutilated into a stray line-break + "ightleftharpoons"): the model
// routinely emits LaTeX/math commands (\rightleftharpoons, \Delta,
// \times, \frac, \rightarrow, ...) inside a JSON string without
// doubling the backslash the way JSON requires. `\r` (and `\n`/`\t`/
// `\b`/`\f`) IS a syntactically valid single-character JSON escape, so
// JSON.parse never throws on it — it silently consumes exactly that
// one letter as a control character and leaves the remaining letters
// ("ightleftharpoons") as plain trailing text. This is undetectable
// AFTER parsing (the corrupted string is syntactically fine), so it
// must be fixed BEFORE parsing. The escape-doubling below was
// previously scoped to string literals located by a SEPARATE regex —
// fragile, because any other minor defect earlier in a multi-field
// batch response (a stray unescaped quote, mismatched escape) can throw
// that string-boundary detection off, silently skipping the very
// command it was meant to protect. Applying the SAME fix globally
// removes that dependency entirely: valid JSON syntax never contains a
// backslash outside a string value, so a global pass is exactly
// equivalent to a per-string pass wherever the JSON is well-formed, and
// strictly safer wherever it isn't. Only backslash+2-OR-MORE letters is
// touched — every real single-character JSON escape (\", \\, \/, \b,
// \f, \n, \r, \t) is exactly one letter/symbol and is never matched.
function repairJson(raw: string): string {
  let s = raw;
  // Backslash-run PARITY matters: an ODD run (1, 3, 5... backslashes)
  // ending right before 2+ letters is a dangling single-char escape
  // that will eat the first letter (\r, \t, \f, \b...) — double just its
  // LAST backslash so the command survives intact. An EVEN run is
  // already a correctly-escaped literal backslash followed by plain
  // text (e.g. the model already wrote "\\times" for \times) — touching
  // it again would over-escape and corrupt an already-correct command,
  // so it is left untouched.
  // Standard JSON newline escapes (\r\n or \n followed by prose) must NOT
  // be doubled into literal backslash+n unless they are explicit LaTeX commands.
  const latexNCommands = /^(nabla|neq|not|neg|nu|natural|nearrow|nwarrow|ni|notin|nLeftarrow|nRightarrow|nsubseteq|nsupseteq)\b/;
  s = s.replace(/(\\+)([a-zA-Z][a-zA-Z]+)/g, (_: string, slashes: string, cmd: string) => {
    if (slashes.length % 2 === 1) {
      if (/^rn[a-zA-Z]*/.test(cmd)) return slashes + cmd;
      if (cmd.startsWith('n') && !latexNCommands.test(cmd)) {
        return slashes + cmd;
      }
      return slashes + '\\' + cmd;
    }
    return slashes + cmd;
  });
  s = s.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');
  s = s.replace(/,\s*([}\]])/g, '$1');
  return s.trim();
}

export function cleanText(s: any): string {
  if (typeof s !== 'string') return '';
  return s.replace(/[\x00-\x08\x0B-\x1F\x7F]/g, '').trim();
}

export function cleanDeep(obj: any): any {
  if (typeof obj === 'string') return cleanText(obj);
  if (Array.isArray(obj)) return obj.map(cleanDeep);
  if (obj && typeof obj === 'object') {
    const out: any = {};
    for (const k of Object.keys(obj)) out[k] = cleanDeep(obj[k]);
    return out;
  }
  return obj;
}
