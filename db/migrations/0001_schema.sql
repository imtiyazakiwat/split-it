-- =====================================================================
-- SplitIt — 0001_schema.sql
-- Core tables. PostgreSQL 14+ (target: 17 on OCI).
--
-- Two rules govern every column here.
--
-- 1. Money is ALWAYS integer paise in a bigint, never a float and never
--    numeric(p,2). The existing client already computes in exact paise
--    (src/lib/money.ts) and that code is correct; the schema mirrors it so
--    there is no representation change at the boundary. Every money column is
--    suffixed `_paise` so a rupee value can never be assigned to one by
--    accident.
--
-- 2. Ids are TEXT and migrated rows keep their original Firestore document id.
--    This is deliberate: existing deep links (/groups/<id>?settlement=<id>)
--    live in already-delivered push notifications and in users' history, and
--    re-keying to fresh uuids would break every one of them. It also makes the
--    migration verifiable 1:1 against the source data.
-- =====================================================================

-- Firestore ids are 20 chars of [A-Za-z0-9]; generated ids match that shape so
-- old and new rows are indistinguishable to the client.
CREATE OR REPLACE FUNCTION new_id() RETURNS text
  LANGUAGE sql VOLATILE AS $$
  SELECT string_agg(
           substr('ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789',
                  (floor(random() * 62) + 1)::int, 1),
           '')
    FROM generate_series(1, 20);
$$;


-- ── Identity ─────────────────────────────────────────────────────────
-- Firebase Auth remains the source of truth for authentication. This table is
-- a profile mirror: it exists so ledger rows can carry a real foreign key
-- instead of a dangling uid string.
CREATE TABLE app_user (
  uid           text PRIMARY KEY,
  display_name  text NOT NULL,
  email         text,
  photo_url     text,
  upi_id        text,
  fcm_token     text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX ix_app_user_email ON app_user (lower(email));


-- ── Groups ───────────────────────────────────────────────────────────
CREATE TABLE grp (
  id                    text PRIMARY KEY DEFAULT new_id(),
  name                  text NOT NULL CHECK (length(btrim(name)) > 0),
  description           text,
  photo_url             text,
  created_by            text NOT NULL REFERENCES app_user (uid),
  invite_code           text NOT NULL,
  use_simplified_debts  boolean NOT NULL DEFAULT false,
  created_at            timestamptz NOT NULL,
  updated_at            timestamptz NOT NULL DEFAULT now(),
  -- Soft delete. Hard-deleting a group is exactly what orphaned five ledgers
  -- in Firestore (~Rs 150 of live balances made permanently unreachable,
  -- because the security rules gate subcollection reads on the parent doc).
  -- Nothing in this schema ever hard-deletes a group.
  deleted_at            timestamptz
);

-- Invite codes must be unique among *live* groups only; a deleted group must
-- not hold its code hostage forever.
CREATE UNIQUE INDEX ux_grp_invite_code
  ON grp (upper(invite_code)) WHERE deleted_at IS NULL;


CREATE TABLE group_member (
  group_id     text NOT NULL REFERENCES grp (id) ON DELETE CASCADE,
  uid          text NOT NULL REFERENCES app_user (uid),
  -- Per-member view preference. Never affects a balance; only which tab the
  -- group appears under for this one person.
  archived_at  timestamptz,
  joined_at    timestamptz NOT NULL DEFAULT now(),
  -- Set when a member is removed. Their expenses and splits stay in the
  -- ledger, so their share of the debt remains visible and settleable. The
  -- Firestore version deleted them from `members` outright, which is why
  -- balances with ex-members could be displayed but not cleared.
  left_at      timestamptz,
  PRIMARY KEY (group_id, uid)
);

CREATE INDEX ix_group_member_uid ON group_member (uid) WHERE left_at IS NULL;


-- ── Expenses ─────────────────────────────────────────────────────────
CREATE TABLE expense (
  id            text PRIMARY KEY DEFAULT new_id(),
  group_id      text   NOT NULL REFERENCES grp (id) ON DELETE CASCADE,
  description   text   NOT NULL,
  amount_paise  bigint NOT NULL CHECK (amount_paise > 0),
  paid_by       text   NOT NULL REFERENCES app_user (uid),
  split_type    text   NOT NULL CHECK (split_type IN ('equal', 'exact', 'percentage')),
  category      text,
  created_by    text   NOT NULL REFERENCES app_user (uid),
  created_at    timestamptz NOT NULL,
  updated_at    timestamptz,
  -- Replaces the `editAction` sentinel string. In Firestore, editAction was
  -- set to 'edited' on every update and 'deleted' on removal, and one early
  -- version treated ANY truthy editAction as "ignore this row" — silently
  -- dropping every edited expense out of the balances. Separating "was it
  -- edited" from "is it gone" makes that mistake unrepresentable.
  deleted_at    timestamptz,
  edited_at     timestamptz
);

-- Covers the dominant read: one group's live expenses, newest first.
CREATE INDEX ix_expense_group_live
  ON expense (group_id, created_at DESC) WHERE deleted_at IS NULL;
CREATE INDEX ix_expense_paid_by ON expense (paid_by) WHERE deleted_at IS NULL;


CREATE TABLE expense_split (
  expense_id    text   NOT NULL REFERENCES expense (id) ON DELETE CASCADE,
  uid           text   NOT NULL REFERENCES app_user (uid),
  -- Zero is legitimate: it records that this person was on the bill but owed
  -- nothing. Testing `> 0` elsewhere dropped such rows from the statement and
  -- from the shared-expense count.
  amount_paise  bigint NOT NULL CHECK (amount_paise >= 0),
  PRIMARY KEY (expense_id, uid)
);

CREATE INDEX ix_expense_split_uid ON expense_split (uid);


-- ── Direct person-to-person transfers ────────────────────────────────
-- A transfer is the sender's *claim* that money moved, not a ledger entry.
-- Only the receiver can decide what it becomes.
CREATE TABLE transfer (
  id            text PRIMARY KEY DEFAULT new_id(),
  from_uid      text   NOT NULL REFERENCES app_user (uid),
  to_uid        text   NOT NULL REFERENCES app_user (uid),
  amount_paise  bigint NOT NULL CHECK (amount_paise > 0),
  status        text   NOT NULL
                  CHECK (status IN ('pending', 'accepted', 'declined', 'cancelled')),
  note          text,
  created_at    timestamptz NOT NULL,
  updated_at    timestamptz,
  CONSTRAINT transfer_not_self CHECK (from_uid <> to_uid)
);

CREATE INDEX ix_transfer_from ON transfer (from_uid, created_at DESC);
CREATE INDEX ix_transfer_to   ON transfer (to_uid,   created_at DESC);


-- ── Settlements ──────────────────────────────────────────────────────
CREATE TABLE settlement (
  id            text PRIMARY KEY DEFAULT new_id(),
  group_id      text   NOT NULL REFERENCES grp (id) ON DELETE CASCADE,
  from_uid      text   NOT NULL REFERENCES app_user (uid),
  to_uid        text   NOT NULL REFERENCES app_user (uid),
  amount_paise  bigint NOT NULL CHECK (amount_paise > 0),
  -- A missing status meant "approved" in Firestore (records predating the
  -- approval flow). The migration resolves that to an explicit value so no
  -- reader has to know the history.
  status        text   NOT NULL CHECK (status IN ('pending', 'approved', 'rejected')),
  -- 'payment'  real money moved inside the group
  -- 'offset'   no money moved; opposing balances cancelled across groups
  -- 'transfer' a direct transfer the receiver booked into this group's ledger
  kind          text   NOT NULL CHECK (kind IN ('payment', 'offset', 'transfer')),
  created_by    text   NOT NULL REFERENCES app_user (uid),
  transfer_id   text   REFERENCES transfer (id),
  note          text,
  created_at    timestamptz NOT NULL,
  updated_at    timestamptz,
  CONSTRAINT settlement_not_self CHECK (from_uid <> to_uid),
  -- A transfer-backed leg must name its transfer, and nothing else may. In
  -- Firestore this coupling was enforced only by a rules expression that ran
  -- on create and never again.
  CONSTRAINT settlement_transfer_link CHECK (
    (kind = 'transfer' AND transfer_id IS NOT NULL) OR
    (kind <> 'transfer' AND transfer_id IS NULL)
  )
);

CREATE INDEX ix_settlement_group ON settlement (group_id, created_at DESC);
CREATE INDEX ix_settlement_pair  ON settlement (group_id, from_uid, to_uid)
  WHERE status = 'approved';
CREATE INDEX ix_settlement_transfer ON settlement (transfer_id)
  WHERE transfer_id IS NOT NULL;


-- One row per booked leg of a transfer.
--
-- This replaces the Firestore `allocations` map plus its denormalised
-- `allocatedAmount` companion. firestore.rules states outright that it cannot
-- bound the sum of that map ("rules cannot iterate a map... deliberately
-- accepted"), so over-allocation was reachable by design. Here the sum is a
-- deferred constraint (see 0002_invariants.sql) and `allocatedAmount` is
-- derived rather than stored, so the two can never disagree.
CREATE TABLE transfer_allocation (
  settlement_id text   PRIMARY KEY REFERENCES settlement (id) ON DELETE CASCADE,
  transfer_id   text   NOT NULL REFERENCES transfer (id) ON DELETE CASCADE,
  group_id      text   NOT NULL REFERENCES grp (id),
  amount_paise  bigint NOT NULL CHECK (amount_paise > 0)
);

CREATE INDEX ix_alloc_transfer ON transfer_allocation (transfer_id);
-- One transfer contributes at most one leg per group. Enforced here rather
-- than in application code, which is where it lived before.
CREATE UNIQUE INDEX ux_alloc_transfer_group
  ON transfer_allocation (transfer_id, group_id);


-- ── Chat ─────────────────────────────────────────────────────────────
-- Money events are deliberately NOT stored as messages; the conversation view
-- merges transfers, settlements and expenses at read time so a payment can
-- never drift from the ledger.
CREATE TABLE chat_thread (
  id              text PRIMARY KEY,          -- deterministic: sorted uids joined by '_'
  uid_a           text NOT NULL REFERENCES app_user (uid),
  uid_b           text NOT NULL REFERENCES app_user (uid),
  last_message    text,
  last_message_from text REFERENCES app_user (uid),
  last_message_at timestamptz,
  CONSTRAINT chat_thread_ordered CHECK (uid_a < uid_b)
);

CREATE TABLE chat_message (
  id         text PRIMARY KEY DEFAULT new_id(),
  thread_id  text NOT NULL REFERENCES chat_thread (id) ON DELETE CASCADE,
  from_uid   text NOT NULL REFERENCES app_user (uid),
  body       text NOT NULL CHECK (length(body) BETWEEN 1 AND 1000),
  created_at timestamptz NOT NULL
);

CREATE INDEX ix_chat_message_thread ON chat_message (thread_id, created_at DESC);

CREATE TABLE chat_read_marker (
  thread_id text NOT NULL REFERENCES chat_thread (id) ON DELETE CASCADE,
  uid       text NOT NULL REFERENCES app_user (uid),
  read_at   timestamptz NOT NULL,
  PRIMARY KEY (thread_id, uid)
);


-- ── Change feed ──────────────────────────────────────────────────────
-- A single monotonic sequence across all entities. The client keeps the
-- highest `seq` it has seen and asks for everything after it; that is what
-- makes a local-first store possible without polling every table.
--
-- bigserial rather than a timestamp on purpose: wall-clock ordering is not
-- reliable across concurrent transactions, and a sync cursor that can go
-- backwards silently loses writes.
CREATE TABLE change_log (
  seq        bigserial PRIMARY KEY,
  entity     text NOT NULL,
  entity_id  text NOT NULL,
  op         text NOT NULL CHECK (op IN ('insert', 'update', 'delete')),
  group_id   text,
  actor_uid  text,
  changed_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX ix_change_group_seq ON change_log (group_id, seq);
CREATE INDEX ix_change_seq       ON change_log (seq);
