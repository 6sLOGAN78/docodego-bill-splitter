import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useCallback, useEffect, useRef, useState } from 'react'
import {
  ApiError,
  type Bill,
  createSampleHome,
  formatCents,
  getBills,
  getMembers,
  payShare,
  type Share,
} from '../api'

type Search = { homeId?: string }

export const Route = createFileRoute('/')({
  validateSearch: (search: Record<string, unknown>): Search =>
    typeof search.homeId === 'string' && search.homeId.length > 0 ? { homeId: search.homeId } : {},
  component: BillsPage,
})

type LoadState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; bills: Bill[]; names: Map<string, string> }

function message(error: unknown): string {
  return error instanceof ApiError ? error.message : 'Something unexpected went wrong.'
}

function BillsPage() {
  const { homeId } = Route.useSearch()
  return (
    <main className="page">
      <h1>Shared bills</h1>
      {homeId ? <HomeBills key={homeId} homeId={homeId} /> : <PickHome />}
    </main>
  )
}

function PickHome() {
  const navigate = useNavigate({ from: '/' })
  const [homeId, setHomeId] = useState('')
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function createSample() {
    setCreating(true)
    setError(null)
    try {
      const id = await createSampleHome()
      await navigate({ search: { homeId: id } })
    } catch (err) {
      setError(message(err))
      setCreating(false)
    }
  }

  return (
    <section className="card">
      <form
        className="row"
        onSubmit={(event) => {
          event.preventDefault()
          const id = homeId.trim()
          if (id) void navigate({ search: { homeId: id } })
        }}
      >
        <label htmlFor="home-id">Home ID</label>
        <input
          id="home-id"
          value={homeId}
          onChange={(event) => setHomeId(event.target.value)}
          placeholder="Paste a home ID"
        />
        <button type="submit" disabled={homeId.trim().length === 0}>
          Open
        </button>
      </form>
      <p className="muted">or</p>
      <button type="button" onClick={createSample} disabled={creating}>
        {creating ? 'Creating…' : 'Create a sample home'}
      </button>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
    </section>
  )
}

function HomeBills({ homeId }: { homeId: string }) {
  const [state, setState] = useState<LoadState>({ status: 'loading' })
  // Ignore answers from an older load if a newer one has started.
  const loadId = useRef(0)

  const load = useCallback(async () => {
    const id = ++loadId.current
    setState({ status: 'loading' })
    try {
      const [bills, members] = await Promise.all([getBills(homeId), getMembers(homeId)])
      if (id !== loadId.current) return
      setState({
        status: 'ready',
        bills,
        names: new Map(members.map((member) => [member.id, member.name])),
      })
    } catch (error) {
      if (id !== loadId.current) return
      setState({ status: 'error', message: message(error) })
    }
  }, [homeId])

  useEffect(() => {
    void load()
  }, [load])

  const replaceShare = useCallback((billId: string, updated: Share) => {
    setState((current) =>
      current.status !== 'ready'
        ? current
        : {
            ...current,
            bills: current.bills.map((bill) =>
              bill.id !== billId
                ? bill
                : {
                    ...bill,
                    shares: bill.shares.map((share) => (share.id === updated.id ? updated : share)),
                  },
            ),
          },
    )
  }, [])

  if (state.status === 'loading') {
    return (
      <p className="muted" aria-busy="true">
        Loading bills…
      </p>
    )
  }

  if (state.status === 'error') {
    return (
      <div role="alert" className="card error">
        <p>Could not load the bills: {state.message}</p>
        <button type="button" onClick={() => void load()}>
          Try again
        </button>
      </div>
    )
  }

  if (state.bills.length === 0) {
    return (
      <div className="card">
        <p>This home has no bills yet.</p>
      </div>
    )
  }

  return (
    <div className="stack">
      {state.bills.map((bill) => (
        <BillCard
          key={bill.id}
          bill={bill}
          names={state.names}
          onPaid={(share) => replaceShare(bill.id, share)}
        />
      ))}
    </div>
  )
}

function BillCard({
  bill,
  names,
  onPaid,
}: {
  bill: Bill
  names: Map<string, string>
  onPaid: (share: Share) => void
}) {
  return (
    <section className="card">
      <header className="row spread">
        <h2>{bill.title}</h2>
        <strong>{formatCents(bill.totalCents)}</strong>
      </header>
      <ul className="shares">
        {bill.shares.map((share) => (
          <ShareRow
            key={share.id}
            billId={bill.id}
            share={share}
            name={names.get(share.memberId) ?? 'Unknown member'}
            onPaid={onPaid}
          />
        ))}
      </ul>
    </section>
  )
}

function ShareRow({
  billId,
  share,
  name,
  onPaid,
}: {
  billId: string
  share: Share
  name: string
  onPaid: (share: Share) => void
}) {
  const [paying, setPaying] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // One key per payment attempt. A retry after a failure reuses it, so if the first
  // request did reach the server, the retry cannot pay twice.
  const keyRef = useRef<string | null>(null)

  async function pay() {
    keyRef.current ??= crypto.randomUUID()
    setPaying(true)
    setError(null)
    try {
      onPaid(await payShare(billId, share.id, keyRef.current))
    } catch (err) {
      // The share stays unpaid on screen: we only show "Paid" after the server confirms it.
      setError(message(err))
    } finally {
      setPaying(false)
    }
  }

  return (
    <li className="share">
      <span>{name}</span>
      <span>{formatCents(share.amountCents)}</span>
      {share.paidAt ? (
        <span className="paid">Paid</span>
      ) : (
        <button type="button" onClick={pay} disabled={paying}>
          {paying ? 'Paying…' : 'Pay'}
        </button>
      )}
      {error && (
        <span role="alert" className="error share-error">
          {error}
        </span>
      )}
    </li>
  )
}
