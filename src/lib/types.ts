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
  memberIds: string[];
  members: Record<string, GroupMember>;
  createdBy: string;
  createdAt: number;
  inviteCode: string;
}

export type SplitType = "equal" | "exact" | "percentage";

export interface ExpenseSplit {
  uid: string;
  amount: number; // amount this user owes for this expense
}

export interface Expense {
  id: string;
  groupId: string;
  description: string;
  amount: number;
  paidBy: string;
  splitType: SplitType;
  splits: ExpenseSplit[];
  receiptUrl?: string;
  createdBy: string;
  createdAt: number;
  category?: string;
}

export interface Settlement {
  id: string;
  groupId: string;
  fromUid: string;
  toUid: string;
  amount: number;
  createdAt: number;
  note?: string;
  receiptUrl?: string;
}

export interface Balance {
  uid: string;
  netAmount: number; // positive = is owed money, negative = owes money
}

export interface SimplifiedTransaction {
  fromUid: string;
  toUid: string;
  amount: number;
}
