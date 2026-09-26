-- =====================================================================
-- SplitIt — 0002_invariants.sql
--
-- The reason this migration exists.
--
-- The money arithmetic in the current app is correct: a full replay of the live
-- data against src/lib/balance.ts found zero discrepancies. What is NOT correct
-- is that the invariants the arithmetic depends on are enforced nowhere. They
-- live as prose in TypeScript comments and as a cap inside a React component.
-- Every stranded rupee in the live data traces back to that:
--
--   * An unbacked Rs 5.31 transfer leg written 2026-09-02 into a group where
--     nothing was owed in either direction. It predates buildAllocationPlan()
--     (2026-09-05) by three days: before that commit, booking consumed the
--     whole transfer with no cap at all. A ledger written by an older client
--     could not be rejected, because nothing outside the client was checking.
--
--   * firestore.rules states plainly that it cannot bound the sum of the
--     `allocations` map: "rules cannot iterate a map ... That is deliberately
--     accepted rather than papered over." Over-allocation was reachable by
--     design, detectable only by a nightly script.
--
-- Below, each becomes a constraint the database enforces. A violating
-- transaction fails to commit. No client version, no hand-typed psql session
-- and no future migration script can write a ledger that breaks them.
--
-- All are CONSTRAINT TRIGGERs, DEFERRABLE INITIALLY DEFERRED, because they are
-- cross-row: an expense and its splits arrive as separate statements and are
-- only consistent once the transaction completes.
-- =====================================================================


-- ── Migration escape hatch ───────────────────────────────────────────
-- The bulk load must insert history that predates these rules, including the
-- known-bad Rs 5.31 leg. The loader sets this flag so the legacy ledger is
-- carried over *faithfully* rather than silently repaired — the violations are
-- then reported by db/verify/*.sql so they can be decided on deliberately.
--
-- Deliberately a session GUC rather than a table: it cannot be left switched on
-- by accident, because it dies with the connection.
CREATE OR REPLACE FUNCTION migrating() RETURNS boolean
LANGUAGE sql STABLE AS $$
  SELECT COALESCE(current_setting('splitit.migrating', true), 'off') = 'on';
$$;


-- ── Shared: pairwise net ─────────────────────────────────────────────
-- How much `p_debtor` owes `p_creditor` inside one group, in paise. Negative
-- means the creditor owes the debtor.
--
-- Pairwise means only these two people's shares count — a debt is never routed
-- through a third party. That is what makes the figure comparable across
-- groups, and it is the number an allocation cap must be measured against.
--
-- `p_exclude_settlement` lets a trigger ask "what was owed here, ignoring the
-- leg currently being written", which is the only meaningful question at insert
-- time.
CREATE OR REPLACE FUNCTION pair_net_paise(
  p_group_id            text,
  p_debtor              text,
  p_creditor            text,
  p_exclude_settlement  text DEFAULT NULL
) RETURNS bigint
LANGUAGE sql STABLE AS $$
  WITH from_expenses AS (
    SELECT COALESCE(SUM(
             CASE
               WHEN e.paid_by = p_creditor AND s.uid = p_debtor   THEN  s.amount_paise
               WHEN e.paid_by = p_debtor   AND s.uid = p_creditor THEN -s.amount_paise
               ELSE 0
             END), 0) AS net
      FROM expense e
      JOIN expense_split s ON s.expense_id = e.id
     WHERE e.group_id = p_group_id
       AND e.deleted_at IS NULL
       AND s.uid <> e.paid_by
  ),
  from_settlements AS (
    -- A payment from the debtor to the creditor reduces what the debtor owes.
    SELECT COALESCE(SUM(
             CASE
               WHEN st.from_uid = p_debtor   AND st.to_uid = p_creditor THEN -st.amount_paise
               WHEN st.from_uid = p_creditor AND st.to_uid = p_debtor   THEN  st.amount_paise
               ELSE 0
             END), 0) AS net
      FROM settlement st
     WHERE st.group_id = p_group_id
       AND st.status   = 'approved'
       AND (p_exclude_settlement IS NULL OR st.id <> p_exclude_settlement)
  )
  SELECT (SELECT net FROM from_expenses) + (SELECT net FROM from_settlements);
$$;


-- ── Invariant 1: splits must sum to the expense total ────────────────
-- sum(expense_split.amount_paise) = expense.amount_paise
--
-- Every "who owes whom" view is built from split amounts, while the group total
-- reads `amount`. When the two disagree the payer keeps a residual no
-- settlement can clear, because nobody carries the other side of it.
-- scripts/audit-balances.mjs exists to hunt this; the check now runs before the
-- data can be written rather than after.
CREATE OR REPLACE FUNCTION assert_expense_splits_balance() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_expense_id text;
  v_amount     bigint;
  v_sum        bigint;
BEGIN
  IF migrating() THEN RETURN NULL; END IF;

  -- Resolved with separate statements per branch, not one CASE expression.
  -- plpgsql compiles a CASE into a single SQL statement and must therefore
  -- resolve every field it mentions, so `NEW.expense_id` fails to compile when
  -- the trigger fires on `expense` (which has no such column).
  IF TG_TABLE_NAME = 'expense' THEN
    IF TG_OP = 'DELETE' THEN
      v_expense_id := OLD.id;
    ELSE
      v_expense_id := NEW.id;
    END IF;
  ELSE
    IF TG_OP = 'DELETE' THEN
      v_expense_id := OLD.expense_id;
    ELSE
      v_expense_id := NEW.expense_id;
    END IF;
  END IF;

  -- The expense may have been deleted in this same transaction, taking its
  -- splits with it by cascade. Nothing left to verify.
  SELECT amount_paise INTO v_amount FROM expense WHERE id = v_expense_id;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  SELECT COALESCE(SUM(amount_paise), 0) INTO v_sum
    FROM expense_split WHERE expense_id = v_expense_id;

  IF v_sum <> v_amount THEN
    RAISE EXCEPTION
      'expense %: splits total % paise but amount is % paise (off by %)',
      v_expense_id, v_sum, v_amount, v_amount - v_sum
      USING ERRCODE = 'check_violation',
            HINT = 'Splits must sum exactly to the expense total; see allocatePaise() in src/lib/money.ts.';
  END IF;

  RETURN NULL;
END $$;

CREATE CONSTRAINT TRIGGER trg_expense_splits_balance
  AFTER INSERT OR UPDATE OF amount_paise ON expense
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION assert_expense_splits_balance();

CREATE CONSTRAINT TRIGGER trg_expense_split_balance
  AFTER INSERT OR UPDATE OR DELETE ON expense_split
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION assert_expense_splits_balance();


-- ── Invariant 2: allocations cannot exceed the transfer ─────────────
-- sum(transfer_allocation.amount_paise) <= transfer.amount_paise
--
-- The one firestore.rules gave up on. Booking more than was sent writes off
-- more of the sender's debt than the money that actually moved.
CREATE OR REPLACE FUNCTION assert_transfer_allocation_bounded() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_transfer_id text;
  v_amount      bigint;
  v_allocated   bigint;
BEGIN
  IF migrating() THEN RETURN NULL; END IF;

  v_transfer_id := COALESCE(NEW.transfer_id, OLD.transfer_id);

  SELECT amount_paise INTO v_amount FROM transfer WHERE id = v_transfer_id;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  SELECT COALESCE(SUM(amount_paise), 0) INTO v_allocated
    FROM transfer_allocation WHERE transfer_id = v_transfer_id;

  IF v_allocated > v_amount THEN
    RAISE EXCEPTION
      'transfer %: allocated % paise across groups but only % paise was sent (over by %)',
      v_transfer_id, v_allocated, v_amount, v_allocated - v_amount
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NULL;
END $$;

CREATE CONSTRAINT TRIGGER trg_transfer_allocation_bounded
  AFTER INSERT OR UPDATE OR DELETE ON transfer_allocation
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION assert_transfer_allocation_bounded();


-- ── Invariant 3: a leg must match its transfer, and must not exceed
--                what the sender actually owed in that group ─────────
--
-- (a) Shape: the backing settlement must be 'transfer' kind, between the same
--     two people, in the named group, for the leg's exact amount.
--     firestore.rules checked this once at create time via
--     backedByMyTransfer(); here it holds for the row's lifetime.
--
-- (b) Cap: the leg cannot exceed what the sender owed the receiver in that
--     group. This check only ever existed inside buildAllocationPlan() in a
--     React component, which is why an older client wrote the unbacked
--     Rs 5.31 leg into an empty ledger. A settlement credits the payer, so
--     booking one into a group where the payer was already owed money pushes
--     the balance further the wrong way instead of clearing it.
CREATE OR REPLACE FUNCTION assert_allocation_backed_and_capped() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_t    transfer%ROWTYPE;
  v_s    settlement%ROWTYPE;
  v_owed bigint;
BEGIN
  IF migrating() THEN RETURN NULL; END IF;

  SELECT * INTO v_t FROM transfer WHERE id = NEW.transfer_id;
  IF NOT FOUND THEN RETURN NULL; END IF;

  SELECT * INTO v_s FROM settlement WHERE id = NEW.settlement_id;
  IF NOT FOUND THEN RETURN NULL; END IF;

  -- (a) shape
  IF v_s.kind <> 'transfer' THEN
    RAISE EXCEPTION 'allocation %: backing settlement is kind=%, must be ''transfer''',
      NEW.settlement_id, v_s.kind USING ERRCODE = 'check_violation';
  END IF;
  IF v_s.group_id <> NEW.group_id THEN
    RAISE EXCEPTION 'allocation %: names group % but its settlement lives in group %',
      NEW.settlement_id, NEW.group_id, v_s.group_id USING ERRCODE = 'check_violation';
  END IF;
  IF v_s.amount_paise <> NEW.amount_paise THEN
    RAISE EXCEPTION 'allocation %: says % paise but its settlement records % paise',
      NEW.settlement_id, NEW.amount_paise, v_s.amount_paise USING ERRCODE = 'check_violation';
  END IF;
  IF v_s.from_uid <> v_t.from_uid OR v_s.to_uid <> v_t.to_uid THEN
    RAISE EXCEPTION 'allocation %: settlement is between different people than transfer %',
      NEW.settlement_id, NEW.transfer_id USING ERRCODE = 'check_violation';
  END IF;

  -- (b) cap, measured against the ledger as it stands without this leg
  v_owed := pair_net_paise(NEW.group_id, v_t.from_uid, v_t.to_uid, NEW.settlement_id);

  IF v_owed <= 0 THEN
    RAISE EXCEPTION
      'allocation %: % owes nothing to % in group % (net % paise) — no balance here for this payment to settle',
      NEW.settlement_id, v_t.from_uid, v_t.to_uid, NEW.group_id, v_owed
      USING ERRCODE = 'check_violation',
            HINT = 'Leave the remainder unallocated; booking it here would push the balance the wrong way.';
  END IF;

  IF NEW.amount_paise > v_owed THEN
    RAISE EXCEPTION
      'allocation %: booking % paise into group % but only % paise was owed there (over by %)',
      NEW.settlement_id, NEW.amount_paise, NEW.group_id, v_owed, NEW.amount_paise - v_owed
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NULL;
END $$;

CREATE CONSTRAINT TRIGGER trg_allocation_backed_and_capped
  AFTER INSERT OR UPDATE ON transfer_allocation
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION assert_allocation_backed_and_capped();
