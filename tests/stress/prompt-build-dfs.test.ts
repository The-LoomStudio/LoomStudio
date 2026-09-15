import { describe, expect, it } from 'vitest'
import { compilePromptDataModel } from '../../packages/application-runtime/src/prompt/prompt-build-pipeline.js'
import type { PromptContribution, SourceNode } from '../../packages/application-runtime/src/prompt/prompt-builder.js'

describe('PromptBuild 1,000-node DFS compiler stress and SLA gate', () => {
  it('compiles a deeply nested 1,000-node prompt ordered tree with strict P95 SLA', () => {
    const nodeCount = 1000
    const sourceNodes: SourceNode[] = []
    const contributions: PromptContribution[] = []

    // 1. 构造一个包含根容器与深层分支的 1,000 节点结构树
    sourceNodes.push({
      id: 'root',
      parentId: null,
      orderIndex: 0,
      kind: 'module',
      label: 'Root Module',
    })

    for (let i = 1; i <= nodeCount; i++) {
      const parentId = i <= 10 ? 'root' : `folder-${Math.floor(i / 10)}`
      const isContainer = i % 10 === 0 && i < nodeCount - 50

      if (isContainer) {
        sourceNodes.push({
          id: `folder-${Math.floor(i / 10)}`,
          parentId,
          orderIndex: i,
          kind: 'folder',
          label: `Folder ${i}`,
        })
      } else {
        const nodeId = `entry-${i}`
        sourceNodes.push({
          id: nodeId,
          parentId,
          orderIndex: i,
          kind: 'entry',
          label: `Setting Entry ${i}`,
          body: `Knowledge body for item ${i}. Contains lore keywords and conditions.`,
        })

        contributions.push({
          id: `contrib-${i}`,
          sourceNodeId: nodeId,
          orderIndex: i,
          capabilities: {
            activation: i % 3 === 0
              ? { kind: 'keyword', keywords: [`keyword-${i % 20}`] }
              : undefined,
          },
          fragment: {
            id: `frag-${i}`,
            role: 'system',
            content: `Rendered prompt line ${i}`,
            order: i,
          },
        })
      }
    }

    // 2. 执行预热编译
    compilePromptDataModel({
      contributions,
      sourceNodes,
      currentInput: 'keyword-5 inquiry about lore and settings',
    })

    // 3. 执行 100 次高频压力测试并采样编译耗时
    const iterations = 100
    const samples: number[] = []

    for (let run = 0; run < iterations; run++) {
      const start = performance.now()
      const result = compilePromptDataModel({
        contributions,
        sourceNodes,
        currentInput: `keyword-${run % 20} query`,
      })
      const elapsed = performance.now() - start
      samples.push(elapsed)
      expect(result.messages.length).toBeGreaterThan(0)
    }

    samples.sort((a, b) => a - b)
    const avgMs = samples.reduce((acc, v) => acc + v, 0) / iterations
    const p95Ms = samples[Math.floor(iterations * 0.95)]!
    const maxMs = samples.at(-1)!

    console.info(
      `[perf] PromptBuild 1,000-node DFS: runs=${iterations} avg=${avgMs.toFixed(2)}ms p95=${p95Ms.toFixed(2)}ms max=${maxMs.toFixed(2)}ms`,
    )

    // 4. 硬性性能门线断言：
    // 千节点树 DFS 编译在纯 Node.js 环境下平均耗时必须 < 10ms，P95 必须 < 15ms
    expect(avgMs).toBeLessThan(10)
    expect(p95Ms).toBeLessThan(15)
  })
})
