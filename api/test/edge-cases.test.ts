import { describe, expect, it } from 'vitest'
import { type Bill, call, createBill, createHome, type Share } from './helpers'

function pay(billId: string, shareId: string, key: string) {
  return call<Share>('POST', `/api/bills/${billId}/shares/${shareId}/pay`, {
    headers: { 'Idempotency-Key': key },
  })
}

describe('input checks', () => {
  it.each([{}, { name: '' }, { name: '   ' }, { name: 42 }, { name: 'x'.repeat(101) }])(
    'rejects the home body %j with a JSON error',
    async (body) => {
      const home = await call<{ error: string }>('POST', '/api/homes', { body })
      expect(home.status).toBe(422)
      expect(home.body.error).toEqual(expect.any(String))
    },
  )

  it('rejects a body that is not JSON', async () => {
    const { homeId } = await createHome(['Asha'])
    const bill = await call('POST', `/api/homes/${homeId}/bills`, { body: undefined })
    expect(bill.status).toBe(422)
  })

  it('rejects a missing title', async () => {
    const { homeId } = await createHome(['Asha'])
    const bill = await call('POST', `/api/homes/${homeId}/bills`, { body: { totalCents: 100 } })
    expect(bill.status).toBe(422)
  })

  it.each([Number.MAX_SAFE_INTEGER + 2, Number.POSITIVE_INFINITY, true, [100]])(
    'rejects the amount %j',
    async (totalCents) => {
      const { homeId } = await createHome(['Asha'])
      const bill = await call('POST', `/api/homes/${homeId}/bills`, {
        body: { title: 'Rent', totalCents },
      })
      expect(bill.status).toBe(422)
    },
  )

  it('trims names', async () => {
    const home = await call<{ name: string }>('POST', '/api/homes', { body: { name: '  Flat 2 ' } })
    expect(home.body.name).toBe('Flat 2')
  })

  it('answers an unknown route with a JSON 404', async () => {
    const response = await call<{ error: string }>('GET', '/api/nope')
    expect(response.status).toBe(404)
    expect(response.body.error).toEqual(expect.any(String))
  })
})

describe('splitting', () => {
  it('gives a 1 cent bill to the first member and 0 to the others', async () => {
    const { homeId } = await createHome(['Asha', 'Ben', 'Chitra'])
    const bill = await createBill(homeId, 1)
    expect(bill.body.shares.map((share) => share.amountCents)).toEqual([1, 0, 0])
  })

  it('keeps the order of members added at the same time unique', async () => {
    const home = await call<{ id: string }>('POST', '/api/homes', { body: { name: 'Race' } })
    const added = await Promise.all(
      ['A', 'B', 'C', 'D', 'E'].map((name) =>
        call('POST', `/api/homes/${home.body.id}/members`, { body: { name } }),
      ),
    )
    expect(added.every((response) => response.status === 201)).toBe(true)
    const bill = await createBill(home.body.id, 5)
    expect(bill.body.shares).toHaveLength(5)
  })
})

describe('paying', () => {
  async function setup() {
    const { homeId } = await createHome(['Asha', 'Ben'])
    const bill = await createBill(homeId, 1000)
    const share = bill.body.shares[0]
    if (!share) throw new Error('bill has no shares')
    return { homeId, billId: bill.body.id, share }
  }

  it('lets only one of two payments sent at the same time succeed', async () => {
    const { billId, share } = await setup()

    const results = await Promise.all([
      pay(billId, share.id, crypto.randomUUID()),
      pay(billId, share.id, crypto.randomUUID()),
    ])

    expect(results.map((result) => result.status).sort()).toEqual([200, 409])
  })

  it('answers both copies of the same request sent at the same time with the same result', async () => {
    const { billId, share } = await setup()
    const key = crypto.randomUUID()

    const [first, second] = await Promise.all([
      pay(billId, share.id, key),
      pay(billId, share.id, key),
    ])

    expect(first.status).toBe(200)
    expect(second.status).toBe(200)
    expect(second.body.paidAt).toBe(first.body.paidAt)
  })

  it('returns 404 when the share belongs to another bill', async () => {
    const a = await setup()
    const b = await setup()
    const paid = await pay(a.billId, b.share.id, crypto.randomUUID())
    expect(paid.status).toBe(404)
  })

  it('treats a blank key as missing', async () => {
    const { billId, share } = await setup()
    const paid = await pay(billId, share.id, '   ')
    expect(paid.status).toBe(400)
  })

  it('shows the paid share in the bill list', async () => {
    const { homeId, billId, share } = await setup()
    await pay(billId, share.id, crypto.randomUUID())

    const list = await call<{ bills: Bill[] }>('GET', `/api/homes/${homeId}/bills`)

    expect(list.status).toBe(200)
    expect(list.body.bills[0]?.shares[0]?.paidAt).toEqual(expect.any(String))
    expect(list.body.bills[0]?.shares[1]?.paidAt).toBeNull()
  })
})
