export const FAST_IMAGE_LOCALIZATION_BUDGET_MS = 1_800;

export type FastImageLocalizationResult<T> =
  | { mode: "fast"; value: T }
  | { mode: "background"; pending: Promise<T> };

export async function waitForFastImageLocalization<T>(
  pending: Promise<T>,
  budgetMs = FAST_IMAGE_LOCALIZATION_BUDGET_MS,
): Promise<FastImageLocalizationResult<T>> {
  let timeoutId: ReturnType<typeof setTimeout> | null = null;
  const timeout = new Promise<FastImageLocalizationResult<T>>((resolve) => {
    timeoutId = setTimeout(() => resolve({ mode: "background", pending }), budgetMs);
  });
  const completed = pending.then((value): FastImageLocalizationResult<T> => ({ mode: "fast", value }));
  const result = await Promise.race([completed, timeout]);
  if (timeoutId !== null) clearTimeout(timeoutId);
  return result;
}
