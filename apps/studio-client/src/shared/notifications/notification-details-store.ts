import { create } from 'zustand'

export const useNotificationDetails = create<{
  detail?: { title: string; text: string }
  open(title: string, text: string): void
  close(): void
}>(set => ({ open: (title, text) => set({ detail: { title, text } }), close: () => set({ detail: undefined }) }))
