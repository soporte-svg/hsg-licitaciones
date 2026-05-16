import Anthropic from '@anthropic-ai/sdk'
import OpenAI, { APIError } from 'openai'

export type LlmProviderId = 'anthropic' | 'openai'

export type LlmUserBlock =
  | { type: 'text'; text: string }
  | { type: 'pdf'; filename: string; base64: string }

/** Texto plano o bloques (PDF + texto) para el mensaje usuario. */
export type LlmUserContent = string | LlmUserBlock[]

const DEFAULT_ANTHROPIC_MODEL = 'claude-sonnet-4-6'
const DEFAULT_OPENAI_MODEL = 'gpt-4o'

export function getLlmProvider(): LlmProviderId {
  const raw = (process.env.LLM_PROVIDER ?? process.env.IA_LLM_PROVIDER ?? 'anthropic')
    .toString()
    .trim()
    .toLowerCase()
  if (raw === 'openai' || raw === 'chatgpt' || raw === 'gpt') return 'openai'
  if (raw === 'anthropic' || raw === 'claude' || raw === '') return 'anthropic'
  throw new Error(`LLM_PROVIDER desconocido: "${raw}". Usa "anthropic" u "openai".`)
}

function llmTimeoutMs(): number {
  return Number(process.env.LLM_TIMEOUT_MS) || Number(process.env.ANTHROPIC_TIMEOUT_MS) || 5 * 60 * 1000
}

function anthropicModel(): string {
  return process.env.ANTHROPIC_MODEL?.trim() || DEFAULT_ANTHROPIC_MODEL
}

function openaiModel(): string {
  return process.env.OPENAI_MODEL?.trim() || DEFAULT_OPENAI_MODEL
}

let anthropicClient: Anthropic | null = null
function getAnthropic(): Anthropic {
  if (!anthropicClient) {
    const apiKey = process.env.ANTHROPIC_API_KEY?.trim()
    if (!apiKey) throw new Error('ANTHROPIC_API_KEY no está configurada (LLM_PROVIDER=anthropic).')
    anthropicClient = new Anthropic({ apiKey, timeout: llmTimeoutMs() })
  }
  return anthropicClient
}

let openaiClient: OpenAI | null = null
function getOpenAI(): OpenAI {
  if (!openaiClient) {
    const apiKey = process.env.OPENAI_API_KEY?.trim()
    if (!apiKey) throw new Error('OPENAI_API_KEY no está configurada (LLM_PROVIDER=openai).')
    const baseURL = process.env.OPENAI_BASE_URL?.trim()
    openaiClient = new OpenAI({
      apiKey,
      timeout: llmTimeoutMs(),
      ...(baseURL ? { baseURL } : {}),
    })
  }
  return openaiClient
}

function blocksToAnthropic(user: LlmUserContent): Anthropic.MessageCreateParams['messages'][0]['content'] {
  if (typeof user === 'string') return user
  return user.map((b) => {
    if (b.type === 'text') return { type: 'text' as const, text: b.text }
    return {
      type: 'document' as const,
      source: {
        type: 'base64' as const,
        media_type: 'application/pdf' as const,
        data: b.base64,
      },
      title: b.filename,
    }
  })
}

/** OpenAI exige `file_data` como data URL, no solo base64 crudo. */
function openAiPdfFileData(rawBase64: string): string {
  const t = rawBase64.trim()
  if (t.startsWith('data:application/pdf;base64,')) return t
  return `data:application/pdf;base64,${t}`
}

function blocksToOpenAI(user: LlmUserContent): OpenAI.ChatCompletionUserMessageParam['content'] {
  if (typeof user === 'string') return user
  return user.map((b) => {
    if (b.type === 'text') return { type: 'text' as const, text: b.text }
    return {
      type: 'file' as const,
      file: {
        filename: b.filename || 'documento.pdf',
        file_data: openAiPdfFileData(b.base64),
      },
    }
  })
}

export async function completeLlmText(args: {
  system?: string
  user: LlmUserContent
  label?: string
  maxTokens?: number
}): Promise<{ text: string; stopReason: string | null }> {
  const provider = getLlmProvider()
  const maxTokens = args.maxTokens ?? 8192
  const t0 = Date.now()
  const tag = provider === 'openai' ? 'openai' : 'claude'
  if (args.label) console.log(`[ia/${tag}] inicio: ${args.label}`)

  if (provider === 'anthropic') {
    const client = getAnthropic()
    const userContent = blocksToAnthropic(args.user)
    const message = await client.messages.create({
      model: anthropicModel(),
      max_tokens: maxTokens,
      temperature: 0.2,
      ...(args.system ? { system: args.system } : {}),
      messages: [{ role: 'user', content: userContent }],
    })
    if (message.stop_reason === 'max_tokens') {
      console.warn(
        `[ia/${tag}] advertencia: ${args.label ?? 'llamada'} terminó por max_tokens (${maxTokens}) — revisa JSON incompleto.`,
      )
    }
    const text = message.content
      .filter((b): b is Anthropic.TextBlock => b.type === 'text')
      .map((b) => b.text)
      .join('\n')
      .trim()
    if (!text) throw new Error('El modelo no devolvió texto.')
    if (args.label) console.log(`[ia/${tag}] listo: ${args.label} (${((Date.now() - t0) / 1000).toFixed(1)}s)`)
    return { text, stopReason: message.stop_reason }
  }

  const client = getOpenAI()
  const userContent = blocksToOpenAI(args.user)
  const messages: OpenAI.ChatCompletionMessageParam[] = []
  if (args.system) messages.push({ role: 'system', content: args.system })
  messages.push({ role: 'user', content: userContent })

  const completion = await client.chat.completions.create({
    model: openaiModel(),
    max_tokens: maxTokens,
    temperature: 0.2,
    messages,
  })
  const choice = completion.choices[0]
  const finish = choice?.finish_reason ?? null
  if (finish === 'length') {
    console.warn(
      `[ia/${tag}] advertencia: ${args.label ?? 'llamada'} terminó por límite de salida (${maxTokens} max_tokens).`,
    )
  }
  const content = choice?.message?.content
  const text =
    typeof content === 'string'
      ? content.trim()
      : Array.isArray(content)
        ? content
            .filter((p): p is OpenAI.ChatCompletionContentPartText => p.type === 'text')
            .map((p) => p.text)
            .join('\n')
            .trim()
        : ''
  if (!text) throw new Error('El modelo no devolvió texto.')
  if (args.label) console.log(`[ia/${tag}] listo: ${args.label} (${((Date.now() - t0) / 1000).toFixed(1)}s)`)
  return { text, stopReason: finish }
}

/** Mensaje legible para errores de la API (Anthropic u OpenAI). */
export function formatLlmError(e: unknown): string {
  if (e instanceof APIError) return e.message
  if (e && typeof e === 'object' && 'status' in e && (e as { status?: number }).status === 404) {
    const raw = e instanceof Error ? e.message : String(e)
    if (raw.includes('model:') || raw.includes('not_found_error')) {
      return getLlmProvider() === 'openai'
        ? `Modelo de OpenAI no disponible (${openaiModel()}). Revisa OPENAI_MODEL en .env.`
        : `Modelo de Claude no disponible (${anthropicModel()}). Define ANTHROPIC_MODEL en .env, por ejemplo ${DEFAULT_ANTHROPIC_MODEL}.`
    }
  }
  return e instanceof Error ? e.message : 'Error al llamar al modelo de IA.'
}
