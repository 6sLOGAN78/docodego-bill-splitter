// All SQL lives here. Routes call these functions and never build SQL themselves.

export type Home = { id: string; name: string }
export type Member = { id: string; homeId: string; name: string }
export type Share = { id: string; memberId: string; amountCents: number; paidAt: string | null }
export type Bill = {
  id: string
  homeId: string
  title: string
  totalCents: number
  shares: Share[]
}
export type Balance = { memberId: string; name: string; outstandingCents: number }

type ShareRow = {
  id: string
  bill_id: string
  member_id: string
  amount_cents: number
  paid_at: string | null
  idempotency_key: string | null
}

function toShare(row: ShareRow): Share {
  return { id: row.id, memberId: row.member_id, amountCents: row.amount_cents, paidAt: row.paid_at }
}

export async function homeExists(db: D1Database, homeId: string): Promise<boolean> {
  const row = await db.prepare('SELECT 1 AS found FROM homes WHERE id = ?').bind(homeId).first()
  return row !== null
}

export async function insertHome(db: D1Database, name: string): Promise<Home> {
  const id = crypto.randomUUID()
  await db.prepare('INSERT INTO homes (id, name) VALUES (?, ?)').bind(id, name).run()
  return { id, name }
}

/**
 * Adds a member at the next position of the home. The position is read and written
 * in one statement, so two members added at the same time cannot get the same number.
 * If that ever happened anyway, the UNIQUE (home_id, position) rule would reject it.
 */
export async function insertMember(db: D1Database, homeId: string, name: string): Promise<Member> {
  const id = crypto.randomUUID()
  await db
    .prepare(
      `INSERT INTO members (id, home_id, name, position)
       SELECT ?1, ?2, ?3, COALESCE(MAX(position), 0) + 1 FROM members WHERE home_id = ?2`,
    )
    .bind(id, homeId, name)
    .run()
  return { id, homeId, name }
}

export async function listMembers(db: D1Database, homeId: string): Promise<Member[]> {
  const { results } = await db
    .prepare('SELECT id, home_id, name FROM members WHERE home_id = ? ORDER BY position')
    .bind(homeId)
    .all<{ id: string; home_id: string; name: string }>()
  return results.map((row) => ({ id: row.id, homeId: row.home_id, name: row.name }))
}

/** Saves the bill and all its shares in one batch: either everything is saved or nothing is. */
export async function insertBill(
  db: D1Database,
  input: { homeId: string; title: string; totalCents: number },
  split: { memberId: string; amountCents: number }[],
): Promise<Bill> {
  const billId = crypto.randomUUID()
  const shares: Share[] = split.map((part) => ({
    id: crypto.randomUUID(),
    memberId: part.memberId,
    amountCents: part.amountCents,
    paidAt: null,
  }))

  await db.batch([
    db
      .prepare('INSERT INTO bills (id, home_id, title, total_cents) VALUES (?, ?, ?, ?)')
      .bind(billId, input.homeId, input.title, input.totalCents),
    ...shares.map((share) =>
      db
        .prepare('INSERT INTO shares (id, bill_id, member_id, amount_cents) VALUES (?, ?, ?, ?)')
        .bind(share.id, billId, share.memberId, share.amountCents),
    ),
  ])

  return { id: billId, ...input, shares }
}

export async function listBills(db: D1Database, homeId: string): Promise<Bill[]> {
  const [bills, shares] = await db.batch<
    { id: string; home_id: string; title: string; total_cents: number } | ShareRow
  >([
    db
      .prepare(
        'SELECT id, home_id, title, total_cents FROM bills WHERE home_id = ? ORDER BY created_at, rowid',
      )
      .bind(homeId),
    db
      .prepare(
        `SELECT s.id, s.bill_id, s.member_id, s.amount_cents, s.paid_at, s.idempotency_key
         FROM shares s
         JOIN bills b ON b.id = s.bill_id
         JOIN members m ON m.id = s.member_id
         WHERE b.home_id = ?
         ORDER BY m.position`,
      )
      .bind(homeId),
  ])

  const billRows = (bills?.results ?? []) as {
    id: string
    home_id: string
    title: string
    total_cents: number
  }[]
  const shareRows = (shares?.results ?? []) as ShareRow[]

  return billRows.map((bill) => ({
    id: bill.id,
    homeId: bill.home_id,
    title: bill.title,
    totalCents: bill.total_cents,
    shares: shareRows.filter((share) => share.bill_id === bill.id).map(toShare),
  }))
}

export async function billExists(db: D1Database, billId: string): Promise<boolean> {
  const row = await db.prepare('SELECT 1 AS found FROM bills WHERE id = ?').bind(billId).first()
  return row !== null
}

export async function findShare(
  db: D1Database,
  billId: string,
  shareId: string,
): Promise<ShareRow | null> {
  return db
    .prepare(
      'SELECT id, bill_id, member_id, amount_cents, paid_at, idempotency_key FROM shares WHERE id = ? AND bill_id = ?',
    )
    .bind(shareId, billId)
    .first<ShareRow>()
}

export type PayOutcome =
  | { kind: 'paid'; share: Share }
  | { kind: 'not_found' }
  | { kind: 'conflict' }

/**
 * Pays a share exactly once.
 *
 * The UPDATE only changes a share that is still unpaid (`paid_at IS NULL`). SQLite runs
 * writes one at a time, so if two requests race, only the first UPDATE changes a row.
 * The loser then reads the share: same key means it is a retry (answer with the saved
 * result), a different key means someone else already paid (conflict).
 */
export async function payShare(
  db: D1Database,
  billId: string,
  shareId: string,
  idempotencyKey: string,
): Promise<PayOutcome> {
  const updated = await db
    .prepare(
      `UPDATE shares SET paid_at = ?, idempotency_key = ?
       WHERE id = ? AND bill_id = ? AND paid_at IS NULL
       RETURNING id, bill_id, member_id, amount_cents, paid_at, idempotency_key`,
    )
    .bind(new Date().toISOString(), idempotencyKey, shareId, billId)
    .first<ShareRow>()
  if (updated) return { kind: 'paid', share: toShare(updated) }

  const current = await findShare(db, billId, shareId)
  if (!current) return { kind: 'not_found' }
  if (current.idempotency_key === idempotencyKey) return { kind: 'paid', share: toShare(current) }
  return { kind: 'conflict' }
}

export async function listBalances(db: D1Database, homeId: string): Promise<Balance[]> {
  const { results } = await db
    .prepare(
      `SELECT m.id AS member_id, m.name,
              COALESCE(SUM(CASE WHEN s.paid_at IS NULL THEN s.amount_cents ELSE 0 END), 0)
                AS outstanding_cents
       FROM members m
       LEFT JOIN shares s ON s.member_id = m.id
       WHERE m.home_id = ?
       GROUP BY m.id, m.name, m.position
       ORDER BY m.position`,
    )
    .bind(homeId)
    .all<{ member_id: string; name: string; outstanding_cents: number }>()
  return results.map((row) => ({
    memberId: row.member_id,
    name: row.name,
    outstandingCents: row.outstanding_cents,
  }))
}
