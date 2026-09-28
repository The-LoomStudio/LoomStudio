import { describe, expect, it } from 'vitest'
import { runCodeActSandbox } from '../../../packages/application-runtime/src/agents/codeact/sandbox.js'
import { codeActLimits } from '../../../packages/application-runtime/src/agents/codeact/protocol.js'

const run = (source: string, timeoutMs = 3000) => runCodeActSandbox({
  source,
  methods: { read: async args => `read:${args[0]}` },
  signal: new AbortController().signal,
  limits: { ...codeActLimits, timeoutMs },
})

describe('CodeAct isolated executor', () => {
  it('supports await, loops and bounded parallel reads in a fresh guest', async () => {
    const result = await run(`
      const values = await Promise.all(["a", "b"].map(path => ctx.read(path)));
      for (const value of values) print(value);
      globalThis.fromPreviousCall = true;
    `)
    expect(result).toEqual({ status: 'completed', output: 'read:a\nread:b' })
    expect((await run('print(typeof fromPreviousCall);')).output).toBe('undefined')
  })

  it('does not expose Node, host bridges or module imports', async () => {
    expect((await run(`
      print(typeof process, typeof require, typeof fetch, typeof __codeact_call);
      print(ctx.read.constructor("return typeof process")());
    `)).output).toBe('undefined undefined undefined undefined\nundefined')
    expect((await run('await import("node:fs");')).status).toBe('failed')
  })

  it.each(['while (true) {}', 'await new Promise(() => {});', 'while (true) await Promise.resolve();'])(
    'terminates noncompleting code: %s', async source => {
      const result = await run(source, 1000)
      expect(result.status).toBe('aborted')
      expect(result.error?.code).toBe('codeact.timeout')
    },
  )

  it('limits memory and output without poisoning the next invocation', async () => {
    expect((await run('const a = []; while (true) a.push(new Array(10000).fill("x"));')).status).not.toBe('completed')
    const output = await run('print("x".repeat(100000));')
    expect(output.error?.code).toBe('codeact.output_limit')
    expect(output.output.length).toBeLessThanOrEqual(codeActLimits.outputChars)
    expect((await run('print(42);')).output).toBe('42')
  })

  it('propagates actionable host errors and rejects unknown methods', async () => {
    const result = await runCodeActSandbox({
      source: 'try { await ctx.read("missing"); } catch (e) { print(e.code, e.message); }',
      methods: { read: () => { throw Object.assign(new Error('List the directory first.'), { code: 'vfs.not_found' }) } },
      signal: new AbortController().signal,
    })
    expect(result.output).toBe('vfs.not_found List the directory first.')
    expect((await run('await ctx.write("x", "y");')).status).toBe('failed')
  })

  it('stops new host calls on abort but settles already accepted work', async () => {
    const controller = new AbortController()
    let accepted = 0
    let settled = 0
    const result = await runCodeActSandbox({
      source: 'await ctx.read("first"); await ctx.read("second");',
      signal: controller.signal,
      methods: {
        read: async () => {
          accepted++
          controller.abort()
          await new Promise(resolve => setTimeout(resolve, 10))
          settled++
          return 'done'
        },
      },
    })
    expect(result.status).toBe('aborted')
    expect({ accepted, settled }).toEqual({ accepted: 1, settled: 1 })
  })

  it('pauses the wall-clock budget while a host approval waits', async () => {
    const timeoutMs = 2000
    let approvals = 0
    const result = await runCodeActSandbox({
      source: 'await ctx.write("resource", "next"); print("after approval");',
      methods: {
        write: async (_args, _signal, control) => control!.waitForUser(async () => {
          approvals++
          // Allow cold worker startup, but make approval alone exceed the entire execution budget.
          await new Promise(resolve => setTimeout(resolve, timeoutMs + 100))
          return 'approved'
        }),
      },
      signal: new AbortController().signal,
      limits: { ...codeActLimits, timeoutMs },
    })
    expect(approvals).toBe(1)
    expect(result).toEqual({ status: 'completed', output: 'after approval' })
  })
})
