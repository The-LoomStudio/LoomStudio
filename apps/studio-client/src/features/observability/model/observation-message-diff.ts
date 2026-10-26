/** Align unchanged messages before comparing gaps, so an insertion does not mark the tail edited. */
export function compareMessages<T extends { role: string; tool_call_id?: string; name?: string }>(before: T[], after: T[]) {
  const beforeKeys = before.map(message => JSON.stringify(message))
  const afterKeys = after.map(message => JSON.stringify(message))
  let prefix = 0
  while (prefix < before.length && prefix < after.length && beforeKeys[prefix] === afterKeys[prefix]) prefix++
  let beforeEnd = before.length, afterEnd = after.length
  while (beforeEnd > prefix && afterEnd > prefix && beforeKeys[beforeEnd - 1] === afterKeys[afterEnd - 1]) { beforeEnd--; afterEnd-- }
  const positions = new Map<string, number[]>()
  beforeKeys.forEach((key, index) => {
    if (index < prefix || index >= beforeEnd) return
    const list = positions.get(key) ?? []
    list.push(index)
    positions.set(key, list)
  })
  const occurrences = new Map<string, number>()
  const matches: Array<{ before: number; after: number; previous: number }> = []
  const tails: number[] = []
  afterKeys.forEach((key, index) => {
    if (index < prefix || index >= afterEnd) return
    const occurrence = occurrences.get(key) ?? 0
    occurrences.set(key, occurrence + 1)
    const position = positions.get(key)?.[occurrence]
    if (position === undefined) return
    let low = 0, high = tails.length
    while (low < high) {
      const mid = (low + high) >>> 1
      if (matches[tails[mid]].before < position) low = mid + 1
      else high = mid
    }
    matches.push({ before: position, after: index, previous: low ? tails[low - 1] : -1 })
    tails[low] = matches.length - 1
  })
  const anchors: Array<{ before: number; after: number }> = [{ before: beforeEnd, after: afterEnd }]
  for (let index = tails.at(-1) ?? -1; index >= 0; index = matches[index].previous) anchors.push(matches[index])
  anchors.reverse()
  const changes = new Map<number, 'added' | 'changed'>()
  const removed: number[] = []
  let left = prefix, right = prefix
  for (const anchor of anchors) {
    while (right < anchor.after) {
      const current = after[right]
      const prior = before[left]
      if (left < anchor.before && current.role === prior.role && current.tool_call_id === prior.tool_call_id && current.name === prior.name) {
        changes.set(right++, 'changed')
        left++
      } else changes.set(right++, 'added')
    }
    while (left < anchor.before) removed.push(left++)
    left = anchor.before + 1
    right = anchor.after + 1
  }
  return { changes, removed }
}
