export interface ExpenseCategory {
  id: string;
  label: string;
  emoji: string;
}

export const EXPENSE_CATEGORIES: ExpenseCategory[] = [
  { id: "meal", label: "Meal", emoji: "🍽️" },
  { id: "fuel", label: "Fuel", emoji: "⛽" },
  { id: "hotel", label: "Hotel", emoji: "🏨" },
  { id: "transport", label: "Transport", emoji: "🚕" },
  { id: "shopping", label: "Shopping", emoji: "🛍️" },
  { id: "others", label: "Others", emoji: "🧾" },
];

export function categoryMeta(id?: string): ExpenseCategory {
  return EXPENSE_CATEGORIES.find((c) => c.id === id) || EXPENSE_CATEGORIES[EXPENSE_CATEGORIES.length - 1];
}
