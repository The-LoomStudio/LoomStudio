export type RegexLabRequest =
  | { action: 'state' }
  | { action: 'preview'; source: string; text: string; phase: 'display' | 'prompt' | 'classify'; streaming?: boolean }
  | { action: 'install'; caseId: string; sources: string[] }
  | { action: 'project'; text: string; streaming: boolean }
  | { action: 'commit'; text: string }
export type RegexLabState = {
  caseId: string
  sessionId: string
  rules: Array<{ id: string; source: string; enabled: boolean; order: number }>
  history: Array<{ id: string; kind: string; text: string }>
  storedDisplay?: string
  storedPrompt?: string
}
export type RegexLabProjection = { text: string; matches: number; rules: string[]; diagnostics: string[] }
