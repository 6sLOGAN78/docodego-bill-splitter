// Typed client for the bill splitter API.
// Every call has a timeout, and every failure becomes an ApiError with a readable message,
// so the page never has to deal with raw network errors or unknown JSON.

export type Share = { id: string; memberId: string; amountCents: number; paidAt: string | null }
export type Bill = {
  id: string
  homeId: string
  title: string
  totalCents: number
  shares: Share[]
}
export type Member = { id: string; homeId: string; name: string }

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number | null,
  ) {
    super(message)
    this.name = 'ApiError'
  }
}

const TIMEOUT_MS = 8000

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

async function request(method: 'GET' | 'POST', path: string, init: RequestInit = {}) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
  let response: Response
  try {
    response = await fetch(path, {
      ...init,
      method,
      headers: { 'content-type': 'application/json', ...init.headers },
      signal: controller.signal,
    })
  } catch (error) {
    const timedOut = error instanceof DOMException && error.name === 'AbortError'
    throw new ApiError(
      timedOut ? 'The server took too long to answer.' : 'Could not reach the server.',
      null,
    )
  } finally {
    clearTimeout(timer)
  }

  let body: unknown = null
  try {
    body = await response.json()
  } catch {
    // Not JSON (for example an HTML error page from a proxy). Handled below.
  }

  if (!response.ok) {
    const message =
      isRecord(body) && typeof body.error === 'string'
        ? body.error
        : `The server answered with an error (${response.status}).`
    throw new ApiError(message, response.status)
  }
  return body
}

function isShare(value: unknown): value is Share {
  return (
    isRecord(value) &&
    typeof value.id === 'string' &&
    typeof value.memberId === 'string' &&
    typeof value.amountCents === 'number' &&
    (value.paidAt === null || typeof value.paidAt === 'string')
  )
}

function isBill(value: unknown): value is Bill {
  return (
    isRecord(value) &&
    typeof value.id === 'string' &&
    typeof value.title === 'string' &&
    typeof value.totalCents === 'number' &&
    Array.isArray(value.shares) &&
    value.shares.every(isShare)
  )
}

function isMember(value: unknown): value is Member {
  return isRecord(value) && typeof value.id === 'string' && typeof value.name === 'string'
}

function unexpected(): never {
  throw new ApiError('The server sent an answer the page did not understand.', null)
}

export async function getBills(homeId: string): Promise<Bill[]> {
  const body = await request('GET', `/api/homes/${encodeURIComponent(homeId)}/bills`)
  if (!isRecord(body) || !Array.isArray(body.bills) || !body.bills.every(isBill)) unexpected()
  return body.bills
}

export async function getMembers(homeId: string): Promise<Member[]> {
  const body = await request('GET', `/api/homes/${encodeURIComponent(homeId)}/members`)
  if (!isRecord(body) || !Array.isArray(body.members) || !body.members.every(isMember)) {
    unexpected()
  }
  return body.members
}

export async function payShare(billId: string, shareId: string, key: string): Promise<Share> {
  const body = await request(
    'POST',
    `/api/bills/${encodeURIComponent(billId)}/shares/${encodeURIComponent(shareId)}/pay`,
    { headers: { 'Idempotency-Key': key } },
  )
  if (!isShare(body)) unexpected()
  return body
}

/** Creates a home with three members and two bills, so the page has something to show. */
export async function createSampleHome(): Promise<string> {
  const home = await request('POST', '/api/homes', { body: JSON.stringify({ name: 'Flat 4B' }) })
  if (!isRecord(home) || typeof home.id !== 'string') unexpected()
  const homeId = home.id
  for (const name of ['Asha', 'Ben', 'Chitra']) {
    await request('POST', `/api/homes/${homeId}/members`, { body: JSON.stringify({ name }) })
  }
  for (const [title, totalCents] of [
    ['Electricity', 1000],
    ['Internet', 2999],
  ] as const) {
    await request('POST', `/api/homes/${homeId}/bills`, {
      body: JSON.stringify({ title, totalCents }),
    })
  }
  return homeId
}

export function formatCents(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`
}
