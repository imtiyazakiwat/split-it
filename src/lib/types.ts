export interface UserProfile {
  uid: string;
  displayName: string;
  email: string;
  photoURL?: string;
  upiId?: string;
  fcmToken?: string;
}

export interface GroupMember {
  displayName: string;
  email: string;
  photoURL?: string;
  upiId?: string;
}

export interface Group {
  id: string;
  name: string;
  description?: string;
  photoURL?: string;
  memberIds: string[];
  members: Record<string, GroupMember>;
  createdBy: string;
  createdAt: number;
  inviteCode: string;
  // Off by default: everyone settles directly with the people they actually
  // shared expenses with. When on, debts are chained through third parties to
  // reduce the number of payments — fewer transfers, but you can be asked to
  // pay someone you never shared a bill with.
  useSimplifiedDebts?: boolean;
  /**
   * @deprecated Superseded by `useSimplifiedDebts`. Groups created before the
   * rename still carry `settlementMode: "simplified" | "direct"` on the stored
   * document, and dropping it outright silently flipped those groups back to
   * direct settlement — changing who owes whom. `toGroup()` maps it onto
   * `useSimplifiedDebts` at read time; nothing writes it any more.
   */
  settlementMode?: "simplified" | "direct";
}

export type SplitType = "equal" | "exact" | "percentage";

export interface ExpenseSplit {
  uid: string;
  amount: number;
}

export type EditAction = "edited" | "deleted";

export interface Expense {
  id: string;
  groupId: string;
  description: string;
  amount: number;
  paidBy: string;
  splitType: SplitType;
  splits: ExpenseSplit[];
  receiptUrls: string[];
  createdBy: string;
  createdAt: number;
  updatedAt?: number;
  editAction?: EditAction;
  category?: string;
}

export type SettlementStatus = "pending" | "approved" | "rejected";

export interface Settlement {
  id: string;
  groupId: string;
  fromUid: string;
  toUid: string;
  amount: number;
  status: SettlementStatus;
  createdAt: number;
  updatedAt?: number;
  note?: string;
  receiptUrls: string[];
  expenseIds?: string[];
  // Who raised this record. Needed because either side can create a
  // settlement now (you can pay someone, or write off what someone owes you),
  // and the *other* party is always the one who approves it. Legacy documents
  // without this field are treated as created by `fromUid`.
  createdBy?: string;
  // When set, this settlement was created by forwarding an incoming payment
  // (option b): it points to the settlement whose funds are being passed on.
  forwardedFromSettlementId?: string;
  // ── Cross-group settlement ──
  // "payment"  — real money moved (or is claimed to have moved).
  // "offset"   — no money moved: a balance in this group was cancelled
  //              against an opposing balance with the same person in another
  //              group. Offsets are always created as a linked set.
  kind?: SettlementKind;
  // Set only on `kind: "transfer"` records: the direct transfer this settlement
  // was created from. The security rules read this document to check the payee,
  // the payer and the amount all match, which is what makes it safe for one
  // party to write an already-approved settlement.
  transferId?: string;
  // Links the legs of one cross-group action together. This is only a grouping
  // hint, never a trust boundary: legs are matched on creator and counterparty
  // as well, so a third party can't smuggle a record into someone else's set.
  crossGroupId?: string;
  // How many legs the set should contain, so a partially loaded (or partially
  // written) set can be detected instead of being approved piecemeal.
  crossGroupLegCount?: number;
}

/**
 * "payment"  — real money moved (or is claimed to have moved) inside the group.
 * "offset"   — no money moved: opposing balances with the same person in two
 *              groups were cancelled against each other.
 * "transfer" — a direct person-to-person payment (see `DirectTransfer`) that the
 *              *receiver* chose to book into this group's ledger. These are born
 *              approved, because the only person who can create one is the payee
 *              confirming money they already have.
 */
export type SettlementKind = "payment" | "offset" | "transfer";

export interface Balance {
  uid: string;
  netAmount: number;
}

export interface SimplifiedTransaction {
  fromUid: string;
  toUid: string;
  amount: number;
}

export interface NotificationPayload {
  title: string;
  body: string;
  icon?: string;
  link?: string;
}

// ── Direct transfers ────────────────────────────────────────

export type TransferStatus = "pending" | "accepted" | "declined" | "cancelled";

/**
 * Money sent straight to another person, outside any group.
 *
 * A transfer is a *claim* by the sender ("I paid you ₹500"), not a ledger entry.
 * Nothing moves in any group until the receiver decides what it was:
 *
 *   declined  — "I never got this."
 *   accepted  — received, but purely personal: no group balance changes.
 *   accepted + appliedGroupId — received *and* booked into that group's ledger,
 *               where it settles what the sender owed the receiver.
 *
 * Keeping the decision with the receiver is the same trust rule the group
 * settlement flow uses: the person who benefits from a balance moving is never
 * the person who gets to move it.
 */
export interface DirectTransfer {
  id: string;
  fromUid: string;
  toUid: string;
  /** Exactly [fromUid, toUid]. Lets either side query with array-contains. */
  participants: string[];
  amount: number;
  note?: string;
  receiptUrls: string[];
  status: TransferStatus;
  /** Always the sender. Only the sender can raise a transfer. */
  createdBy: string;
  createdAt: number;
  updatedAt?: number;
  /** The group this transfer was booked into, once the receiver chose one. */
  appliedGroupId?: string;
  /** The settlement created in that group, for deep-linking back to it. */
  appliedSettlementId?: string;
}

// ── Chat ────────────────────────────────────────────────────

/**
 * One text message in a two-person thread. Money events are *not* stored here:
 * the conversation view merges transfers, settlements and shared expenses with
 * these at render time, so a payment is never duplicated as chat state that
 * could drift from the ledger.
 */
export interface ChatMessage {
  id: string;
  fromUid: string;
  text: string;
  createdAt: number;
}

export interface ChatThread {
  /** Deterministic: the two uids sorted and joined, so both sides derive it. */
  id: string;
  participants: string[];
  lastMessage?: string;
  lastMessageFrom?: string;
  lastMessageAt?: number;
  /** uid → timestamp of the newest message that uid has seen. */
  lastRead?: Record<string, number>;
}
