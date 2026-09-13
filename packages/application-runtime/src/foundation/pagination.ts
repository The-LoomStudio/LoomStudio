export async function collectPages<T>(
  fetchPage: (cursor: string | undefined) => Promise<{ items: T[]; nextCursor?: string }>,
): Promise<T[]> {
  const items: T[] = []
  let cursor: string | undefined
  do {
    const page = await fetchPage(cursor)
    items.push(...page.items)
    cursor = page.nextCursor
  } while (cursor)
  return items
}
