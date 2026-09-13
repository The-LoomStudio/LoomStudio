import { createInMemoryDiagnosticsRegistry } from '@loom-studio/diagnostics'
import { createDocumentDataCommitSource, createInMemoryDocumentStore } from '@loom-studio/document-store'
import { createKernel } from '@loom-studio/kernel'
import { createInMemoryTraceAuditStore } from '@loom-studio/trace-audit'
import type { ExtensionHost } from '@loom-studio/extension-host'
import type { LoomRunner } from '@loom-studio/loom-runner'
import vm from 'node:vm'

console.log('✨ [Playground] 正在初始化 Loom Studio 沙盒...');

// 1. 初始化平台依赖组件
const diagnostics = createInMemoryDiagnosticsRegistry()
const documents = createInMemoryDocumentStore()
const traceAudit = createInMemoryTraceAuditStore()

const extensionHost = {
  list: () => [],
  diagnostics: () => [],
} as unknown as ExtensionHost

const loomRunner = {
  run: async (input: { fragments?: unknown[] }) => ({ fragments: input.fragments ?? [] }),
} as unknown as LoomRunner

// 2. 实例化 Kernel 并启动
const kernel = createKernel({
  documents,
  dataCommits: createDocumentDataCommitSource(documents),
  diagnostics,
  traceAudit,
  extensionHost,
  loomRunner,
})

await kernel.start()
console.log('🚀 [Playground] Kernel 已成功启动！');

// 3. 演示通过 Kernel RPC 写入 Document
console.log('\n📝 正在尝试写入测试数据...');
const writeResult = await kernel.callRpc<{ changesetId: string; documents: unknown[] }>('docs.write', {
  id: 'playground.test:1',
  type: 'playground.test',
  content: {
    message: 'Hello from Loom Studio Playground!',
    timestamp: new Date().toISOString(),
  },
  expectedVersion: 'new',
})

console.log(`✅ 写入成功！变更集 ID: ${writeResult.changesetId}`);
console.log('写入的文档内容:', writeResult.documents[0]);

// 4. 演示通过 Kernel RPC 查询刚才写入的数据
console.log('\n🔍 正在读取测试数据...');
const readResult = await kernel.callRpc<unknown>('docs.get', {
  id: 'playground.test:1',
})
console.log('读取到的文档内容:', readResult);

// 5. 演示 system.introspect 返回的能力发现
console.log('\n📊 正在获取系统自省（Introspection）数据...');
const introspectResult = await kernel.callRpc<{ methods: Array<{ name: string }>; events: string[] }>('system.introspect', {})
console.log('支持的 RPC 方法数量:', introspectResult.methods.length);
console.log('前 5 个 RPC 方法:', introspectResult.methods.slice(0, 5).map(m => m.name));
console.log('已注册的事件:', introspectResult.events);

console.log('\n🎉 [Playground] 测试运行全部通过！你可以修改此脚本来验证你的想法了。');

console.log('\n🧪 [CodeAct] 开始验证连续 JavaScript 执行与 Loom API...')

type PromptEntry = { id: string; label: string; body: string }
const promptResource = {
  id: 'playground.prompt.character',
  label: '角色状态',
  version: 3,
  entries: [
    { id: 'status', label: '状态规则', body: 'HP: 100\nMood: calm' },
    { id: 'style', label: '写作风格', body: '简洁、具体、保持角色口吻' },
  ] satisfies PromptEntry[],
}

type CodeActAction = {
  method: string
  input: unknown
  result: unknown
  diff?: { modifiedEntries: number; changedLines?: number }
}
const actions: CodeActAction[] = []

const countChangedLines = (before: string, after: string) => {
  const oldLines = before.split('\n')
  const newLines = after.split('\n')
  return Array.from({ length: Math.max(oldLines.length, newLines.length) }, (_, index) => oldLines[index] !== newLines[index]).filter(Boolean).length
}

const record = async <T>(method: string, input: unknown, run: () => T | Promise<T>, diff?: CodeActAction['diff']) => {
  const result = await run()
  actions.push({ method, input, result, ...(diff ? { diff } : {}) })
  return result
}

const loom = Object.freeze({
  promptResources: Object.freeze({
    search: async (input: { query: string }) => record(
      'promptResources.search',
      input,
      () => promptResource.entries.filter(entry => `${entry.label}\n${entry.body}`.includes(input.query)),
    ),
    read: async (input: { resourceId: string }) => record(
      'promptResources.read',
      input,
      () => input.resourceId === promptResource.id ? structuredClone(promptResource) : null,
    ),
    update: async (input: { resourceId: string; expectedVersion: number; entries: PromptEntry[] }) => {
      const previous = structuredClone(promptResource)
      const modifiedEntries = input.entries.filter((entry, index) => {
        const oldEntry = previous.entries[index]
        return oldEntry?.label !== entry.label || oldEntry?.body !== entry.body
      }).length
      const changedLines = input.entries.reduce((total, entry, index) => total + countChangedLines(previous.entries[index]?.body ?? '', entry.body), 0)
      promptResource.entries = structuredClone(input.entries)
      promptResource.version += 1
      return record(
        'promptResources.update',
        { resourceId: input.resourceId, expectedVersion: input.expectedVersion },
        () => ({ resourceId: promptResource.id, version: promptResource.version }),
        { modifiedEntries, ...(changedLines > 0 ? { changedLines } : {}) },
      )
    },
  }),
})

const context = vm.createContext({ loom, console })
const runCodeAct = async (source: string) => {
  const script = new vm.Script(`(async () => {\n${source}\n})()`)
  return script.runInContext(context, { timeout: 1000 })
}

await runCodeAct(`
  const matches = await loom.promptResources.search({ query: '状态' })
  const resource = await loom.promptResources.read({ resourceId: matches[0] ? 'playground.prompt.character' : 'missing' })
  globalThis.statusResource = resource
  console.log('[CodeAct step 1]', { matches: matches.length, version: resource?.version })
`)

await runCodeAct(`
  const nextEntries = statusResource.entries.map(entry =>
    entry.id === 'status'
      ? { ...entry, body: entry.body.replace('Mood: calm', 'Mood: focused') }
      : entry
  )
  const result = await loom.promptResources.update({
    resourceId: statusResource.id,
    expectedVersion: statusResource.version,
    entries: nextEntries,
  })
  console.log('[CodeAct step 2]', result)
`)

console.log('[CodeAct] 持久化上下文变量 statusResource:', Boolean((context as { statusResource?: unknown }).statusResource))
console.log('[CodeAct] 调用记录（默认折叠时只显示摘要）:', actions.map(action => ({ method: action.method, diff: action.diff ?? null })))
console.log('[CodeAct] 最终 Diff:', actions.at(-1)?.diff)

const processType = await runCodeAct('return typeof process')
if (processType !== 'undefined') throw new Error('Sandbox unexpectedly exposed process')
console.log('[CodeAct] 宿主访问已拒绝: process is', processType)
