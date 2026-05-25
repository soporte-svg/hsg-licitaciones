/** Índice de la `}` que cierra el objeto que abre en `openBraceIdx` (respetando strings JSON). */
function findBalancedBraceEnd(s: string, openBraceIdx: number): number {
  let depth = 0
  let inString = false
  let escape = false
  for (let i = openBraceIdx; i < s.length; i++) {
    const c = s[i]!
    if (inString) {
      if (escape) {
        escape = false
      } else if (c === '\\') {
        escape = true
      } else if (c === '"') {
        inString = false
      }
      continue
    }
    if (c === '"') {
      inString = true
      continue
    }
    if (c === '{') depth++
    else if (c === '}') {
      depth--
      if (depth === 0) return i
    }
  }
  return -1
}

/** Quita comas finales antes de `}` o `]` (errores frecuentes del modelo), sin tocar comas dentro de strings. */
function stripTrailingCommas(s: string): string {
  const out: string[] = []
  let i = 0
  let inString = false
  let escape = false
  while (i < s.length) {
    const c = s[i]!
    if (inString) {
      out.push(c)
      if (escape) escape = false
      else if (c === '\\') escape = true
      else if (c === '"') inString = false
      i++
      continue
    }
    if (c === '"') {
      out.push(c)
      inString = true
      i++
      continue
    }
    if (c === ',') {
      let j = i + 1
      while (j < s.length && (/\s/.test(s[j]!) || s[j] === ',')) j++
      if (j < s.length && (s[j] === '}' || s[j] === ']')) {
        i = j
        continue
      }
    }
    out.push(c)
    i++
  }
  return out.join('')
}

function tryParseJsonSlice(slice: string): unknown {
  const variants = [slice, stripTrailingCommas(slice)]
  let lastErr: unknown
  for (const v of variants) {
    try {
      return JSON.parse(v)
    } catch (e) {
      lastErr = e
    }
  }
  const hint =
    lastErr instanceof SyntaxError
      ? `${lastErr.message} (posición ${(lastErr as Error & { position?: number }).position ?? '?'})`
      : String(lastErr)
  const posMatch = /position (\d+)/i.exec(String((lastErr as SyntaxError)?.message ?? ''))
  const pos = posMatch ? Number(posMatch[1]) : Math.min(120, slice.length)
  const snipStart = Math.max(0, pos - 80)
  const snip = slice.slice(snipStart, snipStart + 160).replace(/\s+/g, ' ')
  throw new Error(`JSON inválido del modelo: ${hint}${snip ? ` …fragmento: «${snip}»` : ''}`)
}

function parseJsonObjectFromCandidate(candidate: string): unknown {
  const start = candidate.indexOf('{')
  if (start === -1) {
    throw new Error('La respuesta del modelo no contiene un objeto JSON reconocible.')
  }
  const end = findBalancedBraceEnd(candidate, start)
  if (end === -1) {
    throw new Error(
      'JSON del modelo incompleto o llaves desbalanceadas (¿respuesta cortada por max_tokens?).',
    )
  }
  return tryParseJsonSlice(candidate.slice(start, end + 1))
}

/** Extrae el primer objeto JSON de una respuesta de modelo (con o sin fence ```). */
export function extractJsonObject(text: string): unknown {
  const trimmed = text.trim()
  const candidates: string[] = []
  const fences = [...trimmed.matchAll(/```(?:json)?\s*([\s\S]*?)```/gi)]
  for (const m of fences) {
    const inner = m[1]?.trim()
    if (inner) candidates.push(inner)
  }
  candidates.push(trimmed)
  const braceIdx = trimmed.indexOf('{')
  if (braceIdx >= 0) candidates.push(trimmed.slice(braceIdx))

  let lastErr: unknown
  for (const candidate of candidates) {
    try {
      return parseJsonObjectFromCandidate(candidate)
    } catch (e) {
      lastErr = e
    }
  }
  throw lastErr instanceof Error
    ? lastErr
    : new Error('La respuesta del modelo no contiene un objeto JSON reconocible.')
}
