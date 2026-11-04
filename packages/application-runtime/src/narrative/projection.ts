import type { NarrativeNode } from '@loom-studio/application-data'
import {
  defaultHistoryProjectionBudget,
  type HistoryProjectionBudget,
  type TextTransformPhase,
  type TextTransformRuleEntry,
} from '../transforms/history-text.js'
import { projectHistoryEntriesIsolated } from '../transforms/history-text-isolation.js'
import type { NarrativeSampleRequest, NarrativeSampleResult } from './sampling.js'

export async function projectNarrativeNodes(
  input: { timelineId: string; branchId: string; nodes: NarrativeNode[] },
  options: { phase: TextTransformPhase; rules: TextTransformRuleEntry[]; budget?: Partial<HistoryProjectionBudget> },
) {
  const source = { kind: 'narrative' as const, timelineId: input.timelineId, branchId: input.branchId }
  return projectHistoryEntriesIsolated({
    source,
    phase: options.phase,
    entries: input.nodes.map(node => ({
      id: node.id, source, text: node.body.raw, sequence: node.floor, createdAt: node.createdAt,
    })),
    rules: options.rules,
    preserveRuleOrder: true,
    budget: options.budget,
  })
}

export async function projectNarrativeSample(
  sample: NarrativeSampleResult,
  options: Pick<NarrativeSampleRequest, 'maxNodes' | 'maxCharacters'> & {
    phase: TextTransformPhase; rules: TextTransformRuleEntry[]
  },
): Promise<NarrativeSampleResult> {
  const maxCharacters = options.maxCharacters ?? defaultHistoryProjectionBudget.maxOutputCharacters
  const snapshot = await projectNarrativeNodes(sample, {
    phase: options.phase, rules: options.rules,
    budget: {
      maxEntries: options.maxNodes ?? defaultHistoryProjectionBudget.maxEntries,
      maxInputCharacters: maxCharacters, maxOutputCharacters: maxCharacters,
    },
  })
  const nodes = sample.nodes.map((node, index) => ({ ...node, text: snapshot.entries[index]!.text }))
  const text = nodes.map(node => node.text).join('\n\n')
  if (text.length > maxCharacters) {
    throw new Error(`Narrative projection output budget exceeded: ${text.length}`)
  }
  return {
    ...sample, nodes, text,
    processing: {
      phase: snapshot.phase,
      rules: options.rules.filter(rule => snapshot.ruleIds.includes(rule.id)).map(({ id, version }) => ({ id, version })),
      diagnostics: snapshot.diagnostics,
    },
  }
}
