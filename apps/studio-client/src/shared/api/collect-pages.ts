export async function collectPages<T>(
  read: (cursor?: string) => Promise<{ items: T[]; nextCursor?: string }>,
): Promise<T[]> {
  const items: T[] = []
  let cursor: string | undefined
  do {
    const page = await read(cursor)
    items.push(...page.items)
    cursor = page.nextCursor
  } while (cursor !== undefined)
  return items
}
