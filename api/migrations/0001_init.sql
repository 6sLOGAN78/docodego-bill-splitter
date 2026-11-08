-- Homes, members, bills and shares for the shared bill splitter.
-- Every rule that protects the data has a name, so an error message says which rule failed.

CREATE TABLE homes (
  id TEXT NOT NULL,
  name TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  CONSTRAINT homes_pk PRIMARY KEY (id),
  CONSTRAINT homes_name_not_blank CHECK (length(trim(name)) > 0)
);

CREATE TABLE members (
  id TEXT NOT NULL,
  home_id TEXT NOT NULL,
  name TEXT NOT NULL,
  -- 1, 2, 3 ... in the order members were added. The split and the balances use this order.
  position INTEGER NOT NULL,
  CONSTRAINT members_pk PRIMARY KEY (id),
  CONSTRAINT members_home_fk FOREIGN KEY (home_id) REFERENCES homes (id),
  CONSTRAINT members_name_not_blank CHECK (length(trim(name)) > 0),
  CONSTRAINT members_position_positive CHECK (typeof(position) = 'integer' AND position > 0),
  -- Two members of one home can never share a position, even if they are added at the same time.
  CONSTRAINT members_home_position_unique UNIQUE (home_id, position)
);

CREATE TABLE bills (
  id TEXT NOT NULL,
  home_id TEXT NOT NULL,
  title TEXT NOT NULL,
  total_cents INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  CONSTRAINT bills_pk PRIMARY KEY (id),
  CONSTRAINT bills_home_fk FOREIGN KEY (home_id) REFERENCES homes (id),
  CONSTRAINT bills_title_not_blank CHECK (length(trim(title)) > 0),
  -- Money is whole cents only: no decimals, no zero, no negative totals.
  CONSTRAINT bills_total_positive_integer CHECK (typeof(total_cents) = 'integer' AND total_cents > 0)
);

CREATE TABLE shares (
  id TEXT NOT NULL,
  bill_id TEXT NOT NULL,
  member_id TEXT NOT NULL,
  amount_cents INTEGER NOT NULL,
  paid_at TEXT,
  idempotency_key TEXT,
  CONSTRAINT shares_pk PRIMARY KEY (id),
  CONSTRAINT shares_bill_fk FOREIGN KEY (bill_id) REFERENCES bills (id),
  CONSTRAINT shares_member_fk FOREIGN KEY (member_id) REFERENCES members (id),
  -- A share can be 0 (a 1 cent bill split between 3 people) but never negative or a decimal.
  CONSTRAINT shares_amount_non_negative_integer CHECK (
    typeof(amount_cents) = 'integer' AND amount_cents >= 0
  ),
  -- A member has at most one share per bill.
  CONSTRAINT shares_bill_member_unique UNIQUE (bill_id, member_id),
  -- A share is either unpaid (no time, no key) or paid (both). Never half of each.
  CONSTRAINT shares_paid_has_key CHECK ((paid_at IS NULL) = (idempotency_key IS NULL))
);

CREATE INDEX bills_home_idx ON bills (home_id, created_at);
CREATE INDEX shares_member_idx ON shares (member_id);
