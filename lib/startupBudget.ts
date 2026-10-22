/** Nonessential public catalogue work must not hold the whole document open. */
export async function withinStartupBudget<T>(pending: Promise<T>, milliseconds = 600): Promise<T | undefined> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      pending.catch(() => undefined),
      new Promise<undefined>(resolve => { timer = setTimeout(() => resolve(undefined), milliseconds); }),
    ]);
  } finally { clearTimeout(timer); }
}
