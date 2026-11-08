# SDE Intern Assignment: Shared Bill Splitter

Welcome. In this assignment you build a small bill splitter for a shared home. It has two parts:

1. **Homes and members:** create a home and add members to it.
2. **Bill splitting:** split a bill between the members. Each member pays their own share.

The assignment is small on purpose. We want correct, safe, and clear code. We do not want many features.

## What we look at

- **Your code passes the tests.** The tests decide, not opinion. You get the visible tests. We also run extra tests that you do not see.
- **Your code is safe when things go wrong.** Wrong input, repeated requests, and two requests at the same time must not break your data.
- **Your code is typed.** Use TypeScript. Do not use `any`.
- **You understand your code.** You record a short video and explain it.

Take your time. A careful, correct solution is better than a fast one. We expect 2 to 3 days of real work.

## Stack (required)

- **API:** Hono on Cloudflare Workers
- **Database:** Cloudflare D1 (SQLite). The binding is `DB` in `api/wrangler.jsonc`.
- **Web:** React, Vite, TanStack Router
- **Language:** TypeScript on both sides
- **Tests:** Vitest, running inside the Workers runtime
- **Quality:** Biome. `pnpm check` and `pnpm typecheck` must pass.

You choose the rest (styling, form library, validation library). Pick tools you can explain.

## The task

The assignment has two parts. Do Part 1 first. Part 2 builds on it.

**Database.** Write the schema as SQL migration files in `api/migrations/`. For example `0001_init.sql`. The tests apply every file in this folder. Your schema must have **at least 3 named constraints** that protect the data. For example a foreign key, a `CHECK`, or a `UNIQUE` key. Be ready to explain what each constraint stops.

**Errors.** Every error response is JSON: `{ "error": "message" }`.

## Part 1: Homes and members

Create a home and add members to it. The order in which members are added matters in Part 2.

#### `POST /api/homes`

- Request: `{ "name": string }`
- Success: `201` `{ id, name }`

#### `POST /api/homes/:homeId/members`

- Request: `{ "name": string }`
- Success: `201` `{ id, homeId, name }`
- Errors: `404` home not found

Visible tests: `api/test/homes.test.ts`.

## Part 2: Bill splitting

Add a bill to a home, split it between the members, and let each member pay their share.

All amounts are whole **cents** (integers). `100` cents is 1 dollar. Never use decimals for money.

#### `POST /api/homes/:homeId/bills`

- Request: `{ "title": string, "totalCents": number }`
- Success: `201` `{ id, homeId, title, totalCents, shares: [{ id, memberId, amountCents, paidAt: null }] }`
- Errors: `404` home not found. `422` total is not a positive whole number, or the home has no members.

#### `POST /api/bills/:billId/shares/:shareId/pay`

- Request: header `Idempotency-Key`
- Success: `200` `{ id, memberId, amountCents, paidAt }`
- Errors: `400` key missing. `404` bill or share not found. `409` share already paid with a different key.

#### `GET /api/homes/:homeId/balances`

- Success: `200` `{ balances: [{ memberId, name, outstandingCents }] }`
- Errors: `404` home not found

**Rules**

- **Split.** A bill is split between all members of the home. The shares always add up to `totalCents`. If the amount does not divide evenly, the extra cents go to the members one by one, in the order the members were added to the home. Example: 1000 cents between 3 members gives `334`, `333`, `333`.
- **Pay.** Paying marks one share as paid and sets `paidAt`. If the same `Idempotency-Key` is sent again for the same share, answer `200` with the same result. Do not pay twice. If two requests pay the same share at the same time, only one may succeed.
- **Balances.** `outstandingCents` is the sum of the member's unpaid shares, across all bills of the home. List the members in the order they were added.

Visible tests: `api/test/bills.test.ts` and `api/test/payments.test.ts`.

#### Web page

Build one page that:

- shows the bills of a home and the shares of each bill,
- lets a member pay a share,
- shows clear **loading**, **empty**, and **error** states,
- keeps the share unpaid and shows an error if the payment fails.

The page must not crash when the API answers with an error or is slow.

## Cases you must handle

You must handle these cases and talk about them in your video:

1. A home with no members.
2. An amount that is zero, negative, or not a whole number.
3. An amount that does not divide evenly.
4. The same payment request sent twice.
5. Two members paying the same share at the same time.
6. A bill or share that does not exist.
7. The API answers with a 500 error or is slow. The web page must not crash.

## Run it

This is a pnpm workspace. Install once at the root.

```bash
pnpm install
pnpm dev          # api on :8787 and web on :5173
```

Open http://localhost:5173. The starter page shows a title. `/api/health` returns `{ "status": "ok" }`.

```bash
pnpm test         # run the visible tests in api/test
pnpm check        # Biome: format and lint. Must pass.
pnpm check:fix    # fix what Biome can fix
pnpm typecheck    # tsc on both packages. Must pass.
pnpm build        # production build of the web app
```

`pnpm dev` applies your migrations to a local database before it starts the API.

If pnpm says some build scripts were ignored, run `pnpm approve-builds` and allow `esbuild` and `workerd`.

When you change `api/wrangler.jsonc`, refresh the `Env` types:

```bash
pnpm --filter bill-splitter-api cf-typegen
```

## Rules for the tests

- The visible tests are in `api/test`. They start with a failing result. Your job is to make them pass.
- Do **not** change the visible tests or `api/test/helpers.ts`. We compare them with the original.
- We run extra tests after you submit. They test the cases in "Cases you must handle" more closely.

## AI policy

You can use AI tools. Tell us which ones and where in your answers on the form.
You must understand every line you submit. We check this with your video and in a live call. "The AI wrote it" is not an answer.

## How to submit

1. Click **Use this template**, then **Create a new repository**. Make the repository **public**.
2. Build your solution in your new repository. Small, clear commits are welcome.
3. Update this README with a short section called **Decisions**. Write 3 decisions you made and why.
4. Record a video of **3 minutes or less** (Loom or unlisted YouTube). Show the architecture, the data flow, and one trade-off you made. Make sure anyone with the link can view it.
5. Paste the repository link and the video link in the application form.

We will run `pnpm install && pnpm check && pnpm typecheck && pnpm test` on your repository.

## Decisions

1. **Paying is one conditional `UPDATE`, not "read, then write".**
   `UPDATE shares SET paid_at = ?, idempotency_key = ? WHERE id = ? AND bill_id = ? AND paid_at IS NULL RETURNING ...`.
   SQLite (D1) runs writes one at a time, so when two payments race only one of them can change the
   row. The loser reads the share back: the same `Idempotency-Key` means it is a retry and gets the
   saved result (`200`, same `paidAt`); a different key means it was already paid (`409`). There is
   no window between a read and a write where two requests can both see "unpaid". The key is stored
   on the share itself, and a `CHECK` makes sure `paid_at` and `idempotency_key` are always set
   together.

2. **Member order is a stored `position`, protected by the database.**
   The split gives leftover cents to members in the order they were added, so that order must be
   exact. Each member gets `position = MAX(position) + 1` in the same `INSERT ... SELECT` statement,
   and `UNIQUE (home_id, position)` makes a duplicate impossible even under concurrent inserts.
   I did not rely on timestamps (two inserts can share a millisecond) or on `rowid` order (not a
   guarantee SQL gives you).

3. **The split is a small pure function, and a bill is saved with one `batch`.**
   `splitCents(total, n)` gives everyone `floor(total / n)` and the first `total % n` members one
   extra cent, so shares always add up to the total and never differ by more than 1 cent. It has its
   own unit tests (including every total from 1 to 500 against 1 to 12 members). The bill row and all
   its share rows go into one `db.batch()`, which D1 runs as a transaction, so a failure can never
   leave a bill without shares.

**Constraints and what each one stops** (`api/migrations/0001_init.sql`):
`*_fk` foreign keys stop members, bills or shares that point to nothing;
`bills_total_positive_integer` and `shares_amount_non_negative_integer` stop decimal, zero or
negative money even if a bug skips the API check; `members_home_position_unique` stops two members
having the same place in the split order; `shares_bill_member_unique` stops a member getting two
shares of one bill; `shares_paid_has_key` stops a share that is "paid" without a key (or the
reverse); `*_not_blank` stop empty names and titles.

**Trade-off.** The bill is split between the members the home has _when the bill is created_. A
member added later does not owe old bills. Reading the members and writing the bill are two steps,
so a member added in the same instant may or may not be included; I accepted that, because changing
an existing bill later would be worse.

**Web page.** Every request has an 8 second timeout and every error is turned into a readable
message, so a `500`, an HTML error page, a slow API or a network failure shows an error instead of
crashing. A share only shows "Paid" after the server confirms it. The page keeps one
`Idempotency-Key` per payment attempt and reuses it on retry, so retrying after a timeout cannot pay
twice. Extra endpoints for the page: `GET /api/homes/:homeId/bills` and
`GET /api/homes/:homeId/members`.

**AI use.** Claude (Anthropic) was used to help write the code, tests and this README. I reviewed
and can explain every line.
