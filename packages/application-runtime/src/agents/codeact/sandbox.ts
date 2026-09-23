import { Worker } from 'node:worker_threads'
import {
  codeActLimits,
  type CodeActError,
  type CodeActExecution,
  type CodeActLimits,
  type SandboxInput,
  type SandboxMessage,
  type SandboxReply,
} from './protocol.js'
import type { JsonValue } from '@loom-studio/shared'

export type CodeActHostControl = {
  waitForUser<T>(operation: () => Promise<T>): Promise<T>
}

export type CodeActHostMethod = (
  args: unknown[],
  signal: AbortSignal,
  control?: CodeActHostControl,
) => JsonValue | Promise<JsonValue>

export async function runCodeActSandbox(input: {
  source: string
  methods: Readonly<Record<string, CodeActHostMethod>>
  signal: AbortSignal
  limits?: CodeActLimits
}): Promise<CodeActExecution> {
  const limits = input.limits ?? codeActLimits
  if (!input.source.trim() || input.source.length > limits.sourceChars) {
    return { status: 'failed', output: '', error: {
      code: 'codeact.invalid_source', message: `Provide nonempty JavaScript within ${limits.sourceChars} characters.`,
    } }
  }
  if (input.signal.aborted) return aborted()
  const controller = new AbortController()
  const output: string[] = []
  let outputChars = 0
  let calls = 0
  let stopped = false
  const pending = new Set<Promise<void>>()
  let deadline = Date.now() + limits.timeoutMs
  let approvalWaiters = 0
  let approvalStarted = 0
  // Node >=22.18 runs erasable TS in the source checkout; built deployments load the emitted JS.
  const extension = import.meta.url.endsWith('.ts') ? 'ts' : 'js'
  const worker = new Worker(new URL(`./sandbox-worker.${extension}`, import.meta.url), {
    workerData: {
      source: input.source,
      methods: Object.keys(input.methods),
      limits,
      deadline,
    } satisfies SandboxInput,
    execArgv: [],
    resourceLimits: { maxOldGenerationSizeMb: 64, maxYoungGenerationSizeMb: 16, stackSizeMb: 2 },
  })
  let settle!: (result: CodeActExecution) => void
  const completion = new Promise<CodeActExecution>(resolve => { settle = resolve })
  const finish = (result: Omit<CodeActExecution, 'output'>) => {
    if (stopped) return
    stopped = true
    controller.abort()
    settle({ ...result, output: output.join('\n') })
  }
  const abort = () => finish({ status: 'aborted', error: {
    code: 'codeact.aborted', message: 'CodeAct was interrupted; no further ctx operations will start.',
  } })
  const expire = () => finish({ status: 'aborted', error: {
    code: 'codeact.timeout', message: 'CodeAct exceeded its execution deadline. Reduce the work per invocation.',
  } })
  let timer = setTimeout(expire, limits.timeoutMs)
  const control: CodeActHostControl = {
    async waitForUser(operation) {
      controller.signal.throwIfAborted()
      if (approvalWaiters++ === 0) {
        approvalStarted = Date.now()
        clearTimeout(timer)
      }
      try {
        return await operation()
      } finally {
        if (--approvalWaiters === 0) {
          deadline += Date.now() - approvalStarted
          if (!stopped) timer = setTimeout(expire, Math.max(0, deadline - Date.now()))
        }
      }
    },
  }
  input.signal.addEventListener('abort', abort, { once: true })
  if (input.signal.aborted) abort()

  worker.on('message', (message: SandboxMessage) => {
    if (stopped) return
    if (message.type === 'done') {
      finish({
        status: message.error?.code === 'codeact.timeout' ? 'aborted' : message.error ? 'failed' : 'completed',
        ...(message.error ? { error: message.error } : {}),
      })
      return
    }
    if (message.type === 'print') {
      outputChars += message.text.length + 1
      if (outputChars > limits.outputChars) {
        finish({ status: 'failed', error: { code: 'codeact.output_limit', message: 'Print a smaller selection.' } })
      } else {
        output.push(message.text)
      }
      return
    }
    if (message.type !== 'call' || !Object.hasOwn(input.methods, message.method)
      || !Number.isSafeInteger(message.id) || message.id !== ++calls
      || calls > limits.maxCalls || pending.size >= limits.maxPendingCalls
      || typeof message.argumentsJson !== 'string' || message.argumentsJson.length > limits.bridgeChars) {
      finish({ status: 'failed', error: { code: 'codeact.invalid_call', message: 'Invalid or excessive ctx request.' } })
      return
    }
    const operation = dispatch(message)
    pending.add(operation)
    void operation.finally(() => pending.delete(operation))
  })
  worker.on('error', () => finish({ status: 'failed', error: {
    code: 'codeact.sandbox_failed', message: 'The isolated JavaScript runtime failed. Reduce memory or work per invocation.',
  } }))
  worker.on('exit', code => {
    if (!stopped) finish({ status: 'failed', error: {
      code: 'codeact.sandbox_exited', message: `The isolated runtime exited without a result (${code}).`,
    } })
  })

  try {
    return await completion
  } finally {
    clearTimeout(timer)
    input.signal.removeEventListener('abort', abort)
    controller.abort()
    await worker.terminate()
    // Already accepted host work outlives the guest; never report cleanup before its actual outcome.
    await Promise.allSettled(pending)
  }

  async function dispatch(message: Extract<SandboxMessage, { type: 'call' }>) {
    let reply: SandboxReply
    try {
      const args: unknown = JSON.parse(message.argumentsJson)
      if (!Array.isArray(args)) throw new Error('ctx arguments must be an array.')
      const value = await input.methods[message.method]!(args, controller.signal, control)
      const valueJson = JSON.stringify(value)
      if (valueJson.length > limits.bridgeChars) throw new Error('Result too large. Request a smaller range.')
      reply = { id: message.id, valueJson }
    } catch (error) {
      const code = typeof error === 'object' && error !== null && 'code' in error && typeof error.code === 'string'
        ? error.code : 'codeact.operation_failed'
      reply = { id: message.id, error: {
        code,
        message: (error instanceof Error ? error.message : 'ctx operation failed.').slice(0, 1500),
      } satisfies CodeActError }
    }
    if (!stopped) worker.postMessage({ ...reply, deadline })
  }
}

function aborted(): CodeActExecution {
  return { status: 'aborted', output: '', error: { code: 'codeact.aborted', message: 'CodeAct was cancelled before execution.' } }
}
