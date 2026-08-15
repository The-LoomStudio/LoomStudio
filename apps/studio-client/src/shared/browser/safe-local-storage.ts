export const safeLocalStorage = {
  getItem(name: string): string | null {
    try {
      return globalThis.localStorage?.getItem(name) ?? null
    } catch {
      return null
    }
  },
  removeItem(name: string): void {
    try {
      globalThis.localStorage?.removeItem(name)
    } catch {
      // Browser storage is optional.
    }
  },
  setItem(name: string, value: string): void {
    try {
      globalThis.localStorage?.setItem(name, value)
    } catch {
      // Browser storage is optional.
    }
  },
}
