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

export type SettlementMode = "simplified" | "direct";

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
  // "simplified" (default): debts are auto-chained into the fewest payments.
  // "direct": you settle each person based on the expenses you actually shared.
  settlementMode?: SettlementMode;
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
  // When set, this settlement was created by forwarding an incoming payment
  // (option b): it points to the settlement whose funds are being passed on.
  forwardedFromSettlementId?: string;
}

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
