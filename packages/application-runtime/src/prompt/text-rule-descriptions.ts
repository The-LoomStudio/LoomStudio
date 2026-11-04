import type { TextTransformRuleEntry } from '../transforms/history-text.js'
import type { PromptContribution, SourceNode } from './prompt-builder.js'

/** Consume already resolved rules; do not resolve adoption or execute regexes during PromptBuild. */
export function createTextRuleDescriptionInputs(input: {
  session: readonly TextTransformRuleEntry[]
  narrative: readonly TextTransformRuleEntry[]
}) {
  const sourceNodes: SourceNode[] = []
  const contributions: PromptContribution[] = []
  const seen = new Set<string>()
  for (const [target, rules] of [['agent-session', input.session], ['narrative', input.narrative]] as const) {
    for (const rule of rules) {
      if (!rule.enabled || !rule.targets.includes(target) || !rule.description?.trim() || seen.has(rule.id)) continue
      seen.add(rule.id)
      const id = `runtime.text-rule-description:${rule.id}`
      const sourceId = rule.scriptDocumentId ?? rule.id
      sourceNodes.push({ id, sourceId, parentId: null, displayName: rule.name,
        orderIndex: sourceNodes.length, kind: 'entry',
        evidence: { resourceId: sourceId, version: rule.version, original: rule.description },
        metadata: { ruleId: rule.id, ...(rule.loreRefs ? { loreRefs: rule.loreRefs } : {}), ...(rule.contributionId ? { contributionId: rule.contributionId } : {}) },
      })
      contributions.push({ id, sourceRef: { kind: 'runtime', sourceId, sourceNodeId: id },
        content: rule.description, capabilities: { targetAnchorId: rule.descriptionAnchor ?? '@chat.tools' },
      })
    }
  }
  return { sourceNodes, contributions }
}
