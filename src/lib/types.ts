export interface UserProfile {
  uid: string;
  displayName: string;
  email: string;
  photoURL?: string;
  upiId?: string;
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
  memberIds: string[];
  members: Record<string, GroupMember>;
  createdBy: string;
  createdAt: number;
  inviteCode: string;
}

export type SplitType = "equal" | "exact" | "percentage";

export interface ExpenseSplit {
  uid: string;
  amount: number;
}

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
