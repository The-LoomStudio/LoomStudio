import { parentPort, workerData } from 'node:worker_threads'
import { newQuickJSWASMModuleFromVariant, type QuickJSDeferredPromise, type QuickJSHandle } from 'quickjs-emscripten-core'
import type { CodeActError, SandboxInput, SandboxMessage, SandboxReply } from './protocol.js'

const port = parentPort!
const input = workerData as SandboxInput
const { limits } = input
let deadline = input.deadline
const pending = new Map<number, QuickJSDeferredPromise>()
const QuickJS = await newQuickJSWASMModuleFromVariant(import('@jitl/quickjs-wasmfile-release-sync'))
const runtime = QuickJS.newRuntime()
runtime.setMemoryLimit(limits.memoryBytes)
runtime.setMaxStackSize(limits.stackBytes)
runtime.setInterruptHandler(() => Date.now() >= deadline)
const vm = runtime.newContext()
let nextCallId = 0
let outputChars = 0
let stopped = false
let root: QuickJSHandle | undefined
let job: ReturnType<typeof setImmediate> | undefined
const { promise: done, resolve: resolveDone } = Promise.withResolvers<void>()

function send(message: SandboxMessage) {
  port.postMessage(message)
}

function finish(error?: CodeActError) {
  if (stopped) return
  stopped = true
  if (job) clearImmediate(job)
  send({ type: 'done', ...(error ? { error } : {}) })
  resolveDone()
}

function guestError(handle: QuickJSHandle): CodeActError {
  const value = vm.dump(handle) as { message?: unknown; code?: unknown } | null
  const message = typeof value?.message === 'string' ? value.message : 'JavaScript execution failed.'
  return {
    code: Date.now() >= deadline ? 'codeact.timeout'
      : typeof value?.code === 'string' ? value.code : 'codeact.javascript_error',
    message: message.slice(0, 1500),
  }
}

function pump() {
  job = undefined
  if (stopped) return
  const result = runtime.executePendingJobs(64)
  if (result.error) {
    const error = guestError(result.error)
    result.error.dispose()
    finish(error)
  } else if (runtime.hasPendingJob()) {
    job = setImmediate(pump)
  }
}

function schedulePump() {
  if (!stopped && !job) job = setImmediate(pump)
}

function errorValue(error: CodeActError) {
  const handle = vm.newError(error.message)
  const code = vm.newString(error.code)
  vm.setProp(handle, 'code', code)
  code.dispose()
  return handle
}

const call = vm.newFunction('__codeact_call', (methodValue, argsValue) => {
  if (vm.typeof(methodValue) !== 'string' || vm.typeof(argsValue) !== 'string')
    return { error: errorValue({ code: 'codeact.invalid_call', message: 'ctx arguments must be serializable.' }) }
  const method = vm.getString(methodValue)
  const argumentsJson = vm.getString(argsValue)
  if (!input.methods.includes(method) || argumentsJson.length > limits.bridgeChars)
    return { error: errorValue({ code: 'codeact.invalid_call', message: 'Unknown ctx method or oversized arguments.' }) }
  if (pending.size >= limits.maxPendingCalls)
    return { error: errorValue({ code: 'codeact.invalid_call', message: 'ctx bridge concurrency exceeded.' }) }
  const id = ++nextCallId
  const deferred = vm.newPromise()
  pending.set(id, deferred)
  send({ type: 'call', id, method, argumentsJson })
  return deferred.handle.dup()
})
const print = vm.newFunction('__codeact_print', value => {
  if (vm.typeof(value) !== 'string') return { error: vm.newError('print requires serializable values.') }
  const text = vm.getString(value)
  outputChars += text.length + 1
  if (outputChars > limits.outputChars) {
    const error = { code: 'codeact.output_limit', message: 'Output limit reached. Print a smaller selection.' }
    finish(error)
    return { error: errorValue(error) }
  }
  send({ type: 'print', text })
  return vm.undefined
})
vm.setProp(vm.global, '__codeact_call', call)
vm.setProp(vm.global, '__codeact_print', print)
call.dispose()
print.dispose()

port.on('message', (reply: SandboxReply) => {
  if (stopped) return
  if (reply.deadline !== undefined) deadline = reply.deadline
  const deferred = pending.get(reply.id)
  if (!deferred) return
  pending.delete(reply.id)
  const value = 'error' in reply ? errorValue(reply.error) : vm.newString(reply.valueJson)
  if ('error' in reply) deferred.reject(value)
  else deferred.resolve(value)
  value.dispose()
  deferred.dispose()
  schedulePump()
})

try {
  // Only trusted bootstrap source captures the host bridges; generated source stays entirely in QuickJS.
  const bootstrap = vm.evalCode(`(() => {
    const call = globalThis.__codeact_call;
    const output = globalThis.__codeact_print;
    const stringify = JSON.stringify;
    const parse = JSON.parse;
    const ctx = Object.create(null);
    const queue = [];
    let active = 0;
    function drain() {
      while (active < ${limits.maxPendingCalls} && queue.length) {
        const request = queue.shift();
        active++;
        call(request.method, request.args).then(parse).then(request.resolve, request.reject).finally(() => {
          active--;
          drain();
        });
      }
    }
    for (const method of ${JSON.stringify(input.methods)}) {
      ctx[method] = (...args) => new Promise((resolve, reject) => {
        queue.push({ method, args: stringify(args), resolve, reject });
        drain();
      });
    }
    Object.defineProperty(globalThis, "ctx", { value: Object.freeze(ctx) });
    Object.defineProperty(globalThis, "print", {
      value: (...values) => output(values.map(value =>
        typeof value === "string" ? value : stringify(value) ?? String(value)
      ).join(" "))
    });
    delete globalThis.__codeact_call;
    delete globalThis.__codeact_print;
  })()`, 'codeact-bootstrap.js')
  if (bootstrap.error) {
    const error = guestError(bootstrap.error)
    bootstrap.error.dispose()
    finish(error)
  } else {
    bootstrap.value.dispose()
    const evaluated = vm.evalCode(`(async () => {\n${input.source}\n})()`, 'codeact.js')
    if (evaluated.error) {
      const error = guestError(evaluated.error)
      evaluated.error.dispose()
      finish(error)
    } else {
      root = evaluated.value
      void vm.resolvePromise(root).then(result => {
        if (stopped) {
          result.dispose()
          return
        }
        if (result.error) {
          const error = guestError(result.error)
          result.error.dispose()
          finish(error)
        } else {
          result.value.dispose()
          finish(pending.size ? {
            code: 'codeact.unawaited_calls',
            message: 'Execution ended with pending ctx calls. Await every operation; do not launch background work.',
          } : undefined)
        }
      })
      schedulePump()
    }
  }
  await done
} finally {
  stopped = true
  if (job) clearImmediate(job)
  port.removeAllListeners('message')
  for (const deferred of pending.values()) deferred.dispose()
  pending.clear()
  root?.dispose()
  vm.dispose()
  runtime.dispose()
  port.close()
}
