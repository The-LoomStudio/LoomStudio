export type CodeActError = { code: string; message: string }

export type CodeActLimits = {
  timeoutMs: number
  memoryBytes: number
  stackBytes: number
  sourceChars: number
  outputChars: number
  bridgeChars: number
  maxCalls: number
  maxPendingCalls: number
}

// ponytail: Fixed first-release budgets; expose policy settings only when a real caller needs overrides.
export const codeActLimits: Readonly<CodeActLimits> = {
  timeoutMs: 10_000,
  memoryBytes: 16 * 1024 * 1024,
  stackBytes: 512 * 1024,
  sourceChars: 40 * 1024,
  outputChars: 32 * 1024,
  bridgeChars: 64 * 1024,
  maxCalls: 128,
  maxPendingCalls: 8,
}

export type SandboxInput = {
  source: string
  methods: string[]
  limits: CodeActLimits
  deadline: number
}

export type SandboxMessage =
  | { type: 'call'; id: number; method: string; argumentsJson: string }
  | { type: 'print'; text: string }
  | { type: 'done'; error?: CodeActError }

export type SandboxReply =
  | { id: number; valueJson: string; deadline?: number }
  | { id: number; error: CodeActError; deadline?: number }

export type CodeActExecution = {
  status: 'completed' | 'failed' | 'aborted'
  output: string
  error?: CodeActError
}
