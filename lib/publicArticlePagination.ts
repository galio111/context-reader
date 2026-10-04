/** Keep each REST response below the backend row ceiling; never silently truncate inventory. */
export async function readAllArticleRows<T>(
  path: string, read: (path: string) => Promise<T[]>, pageSize = 200,
): Promise<T[]> {
  const rows: T[] = [];
  for (let offset = 0; ; offset += pageSize) {
    const page = await read(`${path}&limit=${pageSize}&offset=${offset}`);
    rows.push(...page);
    if (page.length < pageSize) return rows;
  }
}
