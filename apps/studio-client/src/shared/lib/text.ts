export function normalizeSearchText(value: string): string {
  return value.trim().toLocaleLowerCase()
}

export function sanitizeFileName(value: string): string {
  return value.trim().replace(/[\\/:*?"<>|]/g, '-')
}
