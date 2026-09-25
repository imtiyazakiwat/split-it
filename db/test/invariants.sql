-- =====================================================================
-- Negative tests for db/migrations/0002_invariants.sql
--
-- Each block attempts a write that MUST fail. A schema that has not been shown
-- to reject bad data is documentation, not enforcement.
--
-- Run via db/test/run.sh, which spins up a throwaway cluster, applies the
-- migrations, runs this, and asserts every expected failure actually happened.
-- =====================================================================

\set ON_ERROR_STOP off
\timing off

-- ── Fixtures ─────────────────────────────────────────────────────────
INSERT INTO app_user (uid, display_name) VALUES
  ('u_ganesh', 'Ganesh'), ('u_imtiyaz', 'Imtiyaz'), ('u_akshay', 'Akshay');

INSERT INTO grp (id, name, created_by, invite_code, created_at)
VALUES ('g_trip', 'Trip', 'u_imtiyaz', 'TRIP01', now());

INSERT INTO group_member (group_id, uid) VALUES
  ('g_trip', 'u_imtiyaz'), ('g_trip', 'u_ganesh'), ('g_trip', 'u_akshay');


-- =====================================================================
-- TEST 1  splits must sum to the expense total
-- =====================================================================
\echo '--- TEST 1a: splits under the total must be rejected'
BEGIN;
  INSERT INTO expense (id, group_id, description, amount_paise, paid_by, split_type, created_by, created_at)
  VALUES ('e_bad1', 'g_trip', 'Lunch', 30000, 'u_imtiyaz', 'equal', 'u_imtiyaz', now());
  -- 30000 paise expense, only 20000 allocated
  INSERT INTO expense_split (expense_id, uid, amount_paise) VALUES
    ('e_bad1', 'u_imtiyaz', 10000),
    ('e_bad1', 'u_ganesh',  10000);
COMMIT;   -- EXPECT: ERROR  splits total 20000 but amount is 30000

\echo '--- TEST 1b: splits over the total must be rejected'
BEGIN;
  INSERT INTO expense (id, group_id, description, amount_paise, paid_by, split_type, created_by, created_at)
  VALUES ('e_bad2', 'g_trip', 'Dinner', 10000, 'u_imtiyaz', 'exact', 'u_imtiyaz', now());
  INSERT INTO expense_split (expense_id, uid, amount_paise) VALUES
    ('e_bad2', 'u_imtiyaz', 9000),
    ('e_bad2', 'u_ganesh',  9000);
COMMIT;   -- EXPECT: ERROR

\echo '--- TEST 1c: an expense with NO splits must be rejected'
BEGIN;
  INSERT INTO expense (id, group_id, description, amount_paise, paid_by, split_type, created_by, created_at)
  VALUES ('e_bad3', 'g_trip', 'Orphan', 5000, 'u_imtiyaz', 'equal', 'u_imtiyaz', now());
COMMIT;   -- EXPECT: ERROR  splits total 0 but amount is 5000

\echo '--- TEST 1d: editing the amount without restating splits must be rejected'
BEGIN;
  INSERT INTO expense (id, group_id, description, amount_paise, paid_by, split_type, created_by, created_at)
  VALUES ('e_ok1', 'g_trip', 'Cab', 30000, 'u_imtiyaz', 'equal', 'u_imtiyaz', now());
  INSERT INTO expense_split (expense_id, uid, amount_paise) VALUES
    ('e_ok1', 'u_imtiyaz', 15000), ('e_ok1', 'u_ganesh', 15000);
COMMIT;   -- EXPECT: success
BEGIN;
  -- This is the real regression from the Firestore version: doubling the amount
  -- and leaving the splits alone. The payer silently became owed the difference.
  UPDATE expense SET amount_paise = 60000 WHERE id = 'e_ok1';
COMMIT;   -- EXPECT: ERROR  splits total 30000 but amount is 60000

\echo '--- TEST 1e: deleting a split must be rejected (leaves a gap)'
BEGIN;
  DELETE FROM expense_split WHERE expense_id = 'e_ok1' AND uid = 'u_ganesh';
COMMIT;   -- EXPECT: ERROR

\echo '--- TEST 1f: soft-deleting the expense is fine, splits stay consistent'
BEGIN;
  UPDATE expense SET deleted_at = now() WHERE id = 'e_ok1';
COMMIT;   -- EXPECT: success
BEGIN;
  UPDATE expense SET deleted_at = NULL WHERE id = 'e_ok1';
COMMIT;   -- EXPECT: success (restore, splits still balance)


-- =====================================================================
-- TEST 2  allocations cannot exceed the transfer
-- Build a real debt first: Ganesh owes Imtiyaz 20000 paise (Rs 200).
-- =====================================================================
\echo '--- setup: Imtiyaz pays 400, split evenly -> Ganesh owes 200'
BEGIN;
  INSERT INTO expense (id, group_id, description, amount_paise, paid_by, split_type, created_by, created_at)
  VALUES ('e_meal', 'g_trip', 'Meal', 40000, 'u_imtiyaz', 'equal', 'u_imtiyaz', now());
  INSERT INTO expense_split (expense_id, uid, amount_paise) VALUES
    ('e_meal', 'u_imtiyaz', 20000), ('e_meal', 'u_ganesh', 20000);
COMMIT;   -- EXPECT: success

-- Sanity: the pairwise helper must agree. Ganesh owes Imtiyaz for two live
-- expenses at this point — the Cab from TEST 1d (30000 split evenly -> 15000)
-- which TEST 1f soft-deleted and then restored, plus this Meal (-> 20000).
-- Asserted rather than printed, so a regression fails the run.
DO $$
DECLARE v bigint;
BEGIN
  v := pair_net_paise('g_trip', 'u_ganesh', 'u_imtiyaz');
  IF v <> 35000 THEN
    RAISE EXCEPTION 'ASSERTION FAILED: pair_net expected 35000, got %', v;
  END IF;
  RAISE NOTICE 'pair_net before booking = % paise (Cab 15000 + Meal 20000)', v;
END $$;

\echo '--- TEST 2a: booking more than was sent must be rejected'
BEGIN;
  INSERT INTO transfer (id, from_uid, to_uid, amount_paise, status, created_at)
  VALUES ('t_small', 'u_ganesh', 'u_imtiyaz', 5000, 'accepted', now());
  INSERT INTO settlement (id, group_id, from_uid, to_uid, amount_paise, status, kind, created_by, transfer_id, created_at)
  VALUES ('s_over', 'g_trip', 'u_ganesh', 'u_imtiyaz', 9000, 'approved', 'transfer', 'u_imtiyaz', 't_small', now());
  -- transfer was 5000 paise; trying to book 9000
  INSERT INTO transfer_allocation (settlement_id, transfer_id, group_id, amount_paise)
  VALUES ('s_over', 't_small', 'g_trip', 9000);
COMMIT;   -- EXPECT: ERROR  allocated 9000 but only 5000 was sent


-- =====================================================================
-- TEST 3  a leg must be backed, and capped by what was owed
-- =====================================================================
\echo '--- TEST 3a: leg exceeding the debt must be rejected'
BEGIN;
  INSERT INTO transfer (id, from_uid, to_uid, amount_paise, status, created_at)
  VALUES ('t_big', 'u_ganesh', 'u_imtiyaz', 50000, 'accepted', now());
  INSERT INTO settlement (id, group_id, from_uid, to_uid, amount_paise, status, kind, created_by, transfer_id, created_at)
  VALUES ('s_toobig', 'g_trip', 'u_ganesh', 'u_imtiyaz', 50000, 'approved', 'transfer', 'u_imtiyaz', 't_big', now());
  -- only 20000 was owed in this group
  INSERT INTO transfer_allocation (settlement_id, transfer_id, group_id, amount_paise)
  VALUES ('s_toobig', 't_big', 'g_trip', 50000);
COMMIT;   -- EXPECT: ERROR  booking 50000 but only 20000 was owed

\echo '--- TEST 3b: THE LIVE BUG — a leg into a group with no debt at all'
BEGIN;
  INSERT INTO grp (id, name, created_by, invite_code, created_at)
  VALUES ('g_empty', 'Empty', 'u_imtiyaz', 'EMPTY1', now());
  INSERT INTO group_member (group_id, uid) VALUES
    ('g_empty', 'u_imtiyaz'), ('g_empty', 'u_ganesh');
  INSERT INTO transfer (id, from_uid, to_uid, amount_paise, status, created_at)
  VALUES ('t_531', 'u_imtiyaz', 'u_ganesh', 531, 'accepted', now());
  INSERT INTO settlement (id, group_id, from_uid, to_uid, amount_paise, status, kind, created_by, transfer_id, created_at)
  VALUES ('s_531', 'g_empty', 'u_imtiyaz', 'u_ganesh', 531, 'approved', 'transfer', 'u_ganesh', 't_531', now());
  INSERT INTO transfer_allocation (settlement_id, transfer_id, group_id, amount_paise)
  VALUES ('s_531', 't_531', 'g_empty', 531);
COMMIT;   -- EXPECT: ERROR  owes nothing in this group — this is the Rs 5.31 leg

\echo '--- TEST 3c: amount disagreeing with its settlement must be rejected'
BEGIN;
  INSERT INTO transfer (id, from_uid, to_uid, amount_paise, status, created_at)
  VALUES ('t_mm', 'u_ganesh', 'u_imtiyaz', 20000, 'accepted', now());
  INSERT INTO settlement (id, group_id, from_uid, to_uid, amount_paise, status, kind, created_by, transfer_id, created_at)
  VALUES ('s_mm', 'g_trip', 'u_ganesh', 'u_imtiyaz', 15000, 'approved', 'transfer', 'u_imtiyaz', 't_mm', now());
  INSERT INTO transfer_allocation (settlement_id, transfer_id, group_id, amount_paise)
  VALUES ('s_mm', 't_mm', 'g_trip', 12000);   -- 12000 <> settlement's 15000
COMMIT;   -- EXPECT: ERROR

\echo '--- TEST 3d: non-transfer settlement cannot back a leg'
BEGIN;
  INSERT INTO transfer (id, from_uid, to_uid, amount_paise, status, created_at)
  VALUES ('t_kind', 'u_ganesh', 'u_imtiyaz', 10000, 'accepted', now());
  INSERT INTO settlement (id, group_id, from_uid, to_uid, amount_paise, status, kind, created_by, created_at)
  VALUES ('s_plain', 'g_trip', 'u_ganesh', 'u_imtiyaz', 10000, 'approved', 'payment', 'u_ganesh', now());
  INSERT INTO transfer_allocation (settlement_id, transfer_id, group_id, amount_paise)
  VALUES ('s_plain', 't_kind', 'g_trip', 10000);
COMMIT;   -- EXPECT: ERROR (kind=payment, and settlement_transfer_link already bites)

\echo '--- TEST 3e: THE HAPPY PATH — a correct partial booking must succeed'
BEGIN;
  -- Mirrors the real Rs 130 transfer: book exactly what is owed, leave the rest.
  INSERT INTO transfer (id, from_uid, to_uid, amount_paise, status, created_at)
  VALUES ('t_130', 'u_ganesh', 'u_imtiyaz', 13000, 'accepted', now());
  INSERT INTO settlement (id, group_id, from_uid, to_uid, amount_paise, status, kind, created_by, transfer_id, created_at)
  VALUES ('s_130', 'g_trip', 'u_ganesh', 'u_imtiyaz', 20000, 'approved', 'transfer', 'u_imtiyaz', 't_130', now());
  INSERT INTO transfer_allocation (settlement_id, transfer_id, group_id, amount_paise)
  VALUES ('s_130', 't_130', 'g_trip', 20000);
COMMIT;   -- EXPECT: ERROR — 20000 booked but only 13000 was sent (invariant 2)

\echo '--- TEST 3f: correct booking, within both the debt and the transfer'
BEGIN;
  INSERT INTO transfer (id, from_uid, to_uid, amount_paise, status, created_at)
  VALUES ('t_good', 'u_ganesh', 'u_imtiyaz', 13000, 'accepted', now());
  INSERT INTO settlement (id, group_id, from_uid, to_uid, amount_paise, status, kind, created_by, transfer_id, created_at)
  VALUES ('s_good', 'g_trip', 'u_ganesh', 'u_imtiyaz', 13000, 'approved', 'transfer', 'u_imtiyaz', 't_good', now());
  INSERT INTO transfer_allocation (settlement_id, transfer_id, group_id, amount_paise)
  VALUES ('s_good', 't_good', 'g_trip', 13000);
COMMIT;   -- EXPECT: success  (13000 <= 20000 owed, 13000 <= 13000 sent)

-- 35000 owed, 13000 booked by the leg above -> 22000 still outstanding.
DO $$
DECLARE v bigint;
BEGIN
  v := pair_net_paise('g_trip', 'u_ganesh', 'u_imtiyaz');
  IF v <> 22000 THEN
    RAISE EXCEPTION 'ASSERTION FAILED: pair_net after booking expected 22000, got %', v;
  END IF;
  RAISE NOTICE 'pair_net after booking = % paise (35000 owed - 13000 booked)', v;
END $$;


-- =====================================================================
-- TEST 4  the migration escape hatch
-- =====================================================================
\echo '--- TEST 4: with splitit.migrating=on, legacy bad data loads'
BEGIN;
  SET LOCAL splitit.migrating = 'on';
  INSERT INTO expense (id, group_id, description, amount_paise, paid_by, split_type, created_by, created_at)
  VALUES ('e_legacy', 'g_trip', 'Legacy gap', 99999, 'u_imtiyaz', 'equal', 'u_imtiyaz', now());
  INSERT INTO expense_split (expense_id, uid, amount_paise) VALUES ('e_legacy', 'u_ganesh', 1);
COMMIT;   -- EXPECT: success (deliberate bypass for faithful history)

\echo '--- TEST 4b: the same write WITHOUT the flag must still be rejected'
BEGIN;
  INSERT INTO expense (id, group_id, description, amount_paise, paid_by, split_type, created_by, created_at)
  VALUES ('e_legacy2', 'g_trip', 'Legacy gap 2', 99999, 'u_imtiyaz', 'equal', 'u_imtiyaz', now());
  INSERT INTO expense_split (expense_id, uid, amount_paise) VALUES ('e_legacy2', 'u_ganesh', 1);
COMMIT;   -- EXPECT: ERROR  — proves the flag is not sticky across transactions


-- =====================================================================
-- TEST 5  cascade behaviour — the orphaned-group bug
-- =====================================================================
\echo '--- TEST 5: deleting a group cascades instead of orphaning its ledger'
BEGIN;
  DELETE FROM grp WHERE id = 'g_empty';
COMMIT;   -- EXPECT: success, and zero rows left behind

SELECT 'orphaned expenses (expect 0): ' || count(*) AS check_orphans
  FROM expense e LEFT JOIN grp g ON g.id = e.group_id WHERE g.id IS NULL;
SELECT 'orphaned settlements (expect 0): ' || count(*) AS check_orphans2
  FROM settlement s LEFT JOIN grp g ON g.id = s.group_id WHERE g.id IS NULL;
