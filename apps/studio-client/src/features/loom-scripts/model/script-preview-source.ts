import { parseLoomScriptSource, resolveLoomScriptSettings, resolveTextExtractorContribution, resolveTextTransformContributionRule } from '@loom-studio/shared/loom-scripts'

export type ScriptPreviewSource = 'narrative' | 'agent-session'

export function defaultScriptPreviewSource(source: string, context?: ScriptPreviewSource): ScriptPreviewSource {
  try {
    const metadata = parseLoomScriptSource(source)
    const settings = resolveLoomScriptSettings(metadata.settings)
    const definitions = metadata.contributions.flatMap<{ enabled: boolean; targets: ScriptPreviewSource[] }>(contribution => contribution.kind === 'text-transform'
      ? [resolveTextTransformContributionRule(contribution, settings)]
      : contribution.kind === 'text-extractor' ? [resolveTextExtractorContribution(contribution, settings)] : [])
      .filter(definition => definition.enabled)
    if (definitions.length && definitions.every(definition => definition.targets.length === 1 && definition.targets[0] === 'agent-session')) return 'agent-session'
  } catch {
    // Editing incomplete source must leave the source selector usable; parsing errors are shown by the editor/preview.
  }
  return context ?? 'narrative'
}
