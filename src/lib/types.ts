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
  // Links the legs of one cross-group action together. This is only a grouping
  // hint, never a trust boundary: legs are matched on creator and counterparty
  // as well, so a third party can't smuggle a record into someone else's set.
  crossGroupId?: string;
  // How many legs the set should contain, so a partially loaded (or partially
  // written) set can be detected instead of being approved piecemeal.
  crossGroupLegCount?: number;
}

export type SettlementKind = "payment" | "offset";

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
