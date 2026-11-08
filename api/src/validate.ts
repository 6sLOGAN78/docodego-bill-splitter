// Checks the shape of request bodies. Each function returns either the clean value
// or a message that explains what is wrong.

export type Result<T> = { ok: true; value: T } | { ok: false; error: string }

const MAX_NAME_LENGTH = 100

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function readText(body: unknown, field: string): Result<string> {
  if (!isRecord(body)) return { ok: false, error: 'Body must be a JSON object' }
  const value = body[field]
  if (typeof value !== 'string') return { ok: false, error: `${field} must be a string` }
  const trimmed = value.trim()
  if (trimmed.length === 0) return { ok: false, error: `${field} must not be empty` }
  if (trimmed.length > MAX_NAME_LENGTH) {
    return { ok: false, error: `${field} must be at most ${MAX_NAME_LENGTH} characters` }
  }
  return { ok: true, value: trimmed }
}

export function parseNameBody(body: unknown): Result<{ name: string }> {
  const name = readText(body, 'name')
  return name.ok ? { ok: true, value: { name: name.value } } : name
}

export function parseBillBody(body: unknown): Result<{ title: string; totalCents: number }> {
  const title = readText(body, 'title')
  if (!title.ok) return title
  const totalCents = isRecord(body) ? body.totalCents : undefined
  // typeof check first: '1000' (a string) and null are rejected, not converted.
  if (typeof totalCents !== 'number' || !Number.isSafeInteger(totalCents) || totalCents <= 0) {
    return { ok: false, error: 'totalCents must be a positive whole number of cents' }
  }
  return { ok: true, value: { title: title.value, totalCents } }
}
