export interface EditorialBudgetTrial { day: string; cny: number | null }

export function parseEditorialBudgetTrial(value: unknown): EditorialBudgetTrial | null {
  if (!value || typeof value !== "object") return null;
  const { day, cny } = value as Record<string, unknown>;
  if (typeof day !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(day) || !Number.isFinite(Date.parse(day)) || new Date(day).toISOString().slice(0, 10) !== day) return null;
  if (cny !== null && (typeof cny !== "number" || !Number.isFinite(cny) || cny <= 0 || cny > 10)) return null;
  return { day, cny };
}

/** The caller supplies its Shanghai ledger day. Expired trials cannot change the base budget. */
export function editorialBudgetForDay(config: { dailyBudgetCny?: number; budgetTrial?: EditorialBudgetTrial | null }, day: string): number {
  const trial = parseEditorialBudgetTrial(config.budgetTrial);
  const base = Number.isFinite(config.dailyBudgetCny) ? Math.min(10, Math.max(0, config.dailyBudgetCny!)) : 1;
  return trial?.day === day ? trial.cny ?? Infinity : base;
}
