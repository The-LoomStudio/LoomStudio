import { createInMemoryDiagnosticsRegistry } from '@loom-studio/diagnostics'
import { createDocumentDataCommitSource, createInMemoryDocumentStore } from '@loom-studio/document-store'
import { createKernel } from '@loom-studio/kernel'
import { createInMemoryTraceAuditStore } from '@loom-studio/trace-audit'
import type { ExtensionHost } from '@loom-studio/extension-host'
import type { LoomRunner } from '@loom-studio/loom-runner'

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
  environment: 'development',
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
