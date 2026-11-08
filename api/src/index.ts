import { Hono } from 'hono'
import type { ContentfulStatusCode } from 'hono/utils/http-status'
import {
  billExists,
  findShare,
  homeExists,
  insertBill,
  insertHome,
  insertMember,
  listBalances,
  listBills,
  listMembers,
  payShare,
} from './db'
import { splitCents } from './split'
import { parseBillBody, parseNameBody } from './validate'

const app = new Hono<{ Bindings: Env }>()

const MAX_IDEMPOTENCY_KEY_LENGTH = 200

function fail(status: ContentfulStatusCode, message: string) {
  return Response.json({ error: message }, { status })
}

/** Reads the body as JSON. A body that is not JSON becomes `undefined` and fails validation. */
async function readJson(request: Request): Promise<unknown> {
  try {
    return await request.json()
  } catch {
    return undefined
  }
}

app.get('/api/health', (c) => c.json({ status: 'ok' }))

app.post('/api/homes', async (c) => {
  const input = parseNameBody(await readJson(c.req.raw))
  if (!input.ok) return fail(422, input.error)
  return c.json(await insertHome(c.env.DB, input.value.name), 201)
})

app.post('/api/homes/:homeId/members', async (c) => {
  const homeId = c.req.param('homeId')
  if (!(await homeExists(c.env.DB, homeId))) return fail(404, 'Home not found')
  const input = parseNameBody(await readJson(c.req.raw))
  if (!input.ok) return fail(422, input.error)
  return c.json(await insertMember(c.env.DB, homeId, input.value.name), 201)
})

app.get('/api/homes/:homeId/members', async (c) => {
  const homeId = c.req.param('homeId')
  if (!(await homeExists(c.env.DB, homeId))) return fail(404, 'Home not found')
  return c.json({ members: await listMembers(c.env.DB, homeId) })
})

app.post('/api/homes/:homeId/bills', async (c) => {
  const homeId = c.req.param('homeId')
  if (!(await homeExists(c.env.DB, homeId))) return fail(404, 'Home not found')

  const input = parseBillBody(await readJson(c.req.raw))
  if (!input.ok) return fail(422, input.error)

  const members = await listMembers(c.env.DB, homeId)
  if (members.length === 0) return fail(422, 'The home has no members to split the bill between')

  const amounts = splitCents(input.value.totalCents, members.length)
  const split = members.map((member, index) => ({
    memberId: member.id,
    amountCents: amounts[index] ?? 0,
  }))

  const bill = await insertBill(c.env.DB, { homeId, ...input.value }, split)
  return c.json(bill, 201)
})

app.get('/api/homes/:homeId/bills', async (c) => {
  const homeId = c.req.param('homeId')
  if (!(await homeExists(c.env.DB, homeId))) return fail(404, 'Home not found')
  return c.json({ bills: await listBills(c.env.DB, homeId) })
})

app.post('/api/bills/:billId/shares/:shareId/pay', async (c) => {
  const key = c.req.header('Idempotency-Key')?.trim()
  if (!key) return fail(400, 'Idempotency-Key header is required')
  if (key.length > MAX_IDEMPOTENCY_KEY_LENGTH) {
    return fail(400, `Idempotency-Key must be at most ${MAX_IDEMPOTENCY_KEY_LENGTH} characters`)
  }

  const billId = c.req.param('billId')
  const shareId = c.req.param('shareId')
  if (!(await billExists(c.env.DB, billId))) return fail(404, 'Bill not found')
  if (!(await findShare(c.env.DB, billId, shareId))) return fail(404, 'Share not found')

  const outcome = await payShare(c.env.DB, billId, shareId, key)
  switch (outcome.kind) {
    case 'paid':
      return c.json(outcome.share, 200)
    case 'not_found':
      return fail(404, 'Share not found')
    case 'conflict':
      return fail(409, 'Share was already paid with a different Idempotency-Key')
  }
})

app.get('/api/homes/:homeId/balances', async (c) => {
  const homeId = c.req.param('homeId')
  if (!(await homeExists(c.env.DB, homeId))) return fail(404, 'Home not found')
  return c.json({ balances: await listBalances(c.env.DB, homeId) })
})

app.notFound(() => fail(404, 'Route not found'))

app.onError((error) => {
  console.error(error)
  return fail(500, 'Something went wrong on the server')
})

export default app
