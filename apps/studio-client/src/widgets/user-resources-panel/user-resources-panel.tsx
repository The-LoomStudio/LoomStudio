import { InfoDialog } from '../../shared/ui/info-dialog/info-dialog.js'
import type { UserBackgroundLibrary } from '../../features/backgrounds/model/use-user-backgrounds.js'
import { useMemo, useState } from 'react'
import { Button } from '@loom-studio/ui'
import { useQuery } from '@tanstack/react-query'
import { BookOpen, Bot, FileText, Folder, Image, Regex } from 'lucide-react'
import type { ListPromptResourcesResult, PromptResource } from '../../entities/index.js'
import type { StudioApi } from '../../shared/api/studio-api.js'
import type { Translator } from '../../shared/i18n/index.js'
import { FileTree, type FileTreeNode } from '../../shared/ui/file-tree/file-tree.js'
import styles from './user-resources-panel.module.scss'

export type UserResourceRuleItem = { id: string; name: string; owner: { kind: string } }

export function buildUserResourceTree(
  resources: readonly PromptResource[],
  rules: readonly UserResourceRuleItem[],
  t: Translator,
  backgrounds: readonly { id: string; name: string }[] = [],
): { nodes: FileTreeNode[]; resourcesByNode: Map<string, PromptResource> } {
  const own = resources.filter(isUserPromptResource)
  const groups = [
    { id: 'presets', title: t('rail.agent'), items: own.filter(resource => resource.resourceKind === 'preset') },
    { id: 'lore', title: t('context.authoring.lore'), items: own.filter(resource => resource.resourceKind === 'lore') },
    { id: 'other', title: t('rail.resource'), items: own.filter(resource => resource.resourceKind !== 'preset' && resource.resourceKind !== 'lore') },
  ]
  const ownRules = rules.filter(rule => rule.owner.kind === 'workspace')
  const resourcesByNode = new Map<string, PromptResource>()
  const nodes: FileTreeNode[] = groups.map(group => ({
    id: `user:${group.id}`, label: group.title, kind: 'folder', meta: String(group.items.length),
    children: group.items.map(resource => {
      const visit = (node: PromptResource['rootNode']): FileTreeNode => {
        resourcesByNode.set(node.id, resource)
        return {
          id: node.id, label: node.label, kind: node.children?.length ? 'folder' : 'entry',
          ...(node.children?.length ? { children: node.children.map(visit) } : {}),
        }
      }
      return visit(resource.rootNode)
    }),
  }))
  nodes.push({
    id: 'user:rules', label: t('rail.textTransform'), kind: 'folder', meta: String(ownRules.length),
    children: ownRules.map(rule => ({ id: `user:rule:${rule.id}`, label: rule.name, kind: 'entry' })),
  })
  nodes.push({
    id: 'user:backgrounds', label: t('appearance.background'), kind: 'folder', meta: String(backgrounds.length),
    children: backgrounds.map(background => ({ id: `user:background:${background.id}`, label: background.name, kind: 'entry' })),
  })
  return { nodes, resourcesByNode }
}

export function UserResourcesPanel(props: {
  backgroundLibrary?: Pick<UserBackgroundLibrary, 'backgrounds' | 'error' | 'refresh' | 'loading'>
  onOpenBackground?(id: string): void
  api: StudioApi['textTransforms']
  endpoint: string
  resources: PromptResource[]
  invalidResources?: ListPromptResourcesResult['invalidResources']
  onRefresh?(): Promise<unknown>
  t: Translator
  onOpenResource(resource: PromptResource, nodeId: string): void
  onOpenRule(ruleId: string): void
}) {
  const rules = useQuery({
    queryKey: ['user-resources', props.endpoint, 'rules'],
    queryFn: () => props.api.listRules(),
  })
  const [expandedIds, setExpandedIds] = useState(['user:presets', 'user:settings', 'user:other', 'user:rules', 'user:backgrounds'])
  const { nodes, resourcesByNode } = useMemo(
    () => buildUserResourceTree(props.resources, rules.data?.rules ?? [], props.t, props.backgroundLibrary?.backgrounds),
    [props.resources, rules.data?.rules, props.t, props.backgroundLibrary?.backgrounds],
  )

  return <section aria-label={props.t('rail.user')} className={styles.panel}>
    {props.backgroundLibrary?.loading ? <p role="status">{props.t('appearance.backgroundLoading')}</p> : null}
    {props.backgroundLibrary?.error ? <p role="alert">{props.backgroundLibrary.error}<Button onClick={props.backgroundLibrary.refresh}>{props.t('appError.reload')}</Button></p> : null}
    {rules.isError ? <p role="alert">{rules.error.message}</p> : null}
    {props.invalidResources?.length ? <div role="alert">
      <p>{props.t('promptResource.invalidResources')}</p>
      {props.invalidResources.map(resource => <div key={resource.id}><span>{resource.label} · {resource.resourceKind}</span><InfoDialog title={resource.label}>
        <dl><dt>ID</dt><dd>{resource.id}</dd><dt>版本</dt><dd>{resource.version}</dd></dl><p>{resource.error}</p>
      </InfoDialog></div>)}
      <p>{props.t('promptResource.invalidResourcesHelp')}</p>
      <Button onClick={() => { void props.onRefresh?.().catch(() => undefined) }}>{props.t('appError.reload')}</Button>
    </div> : null}
    <FileTree
      ariaLabel={props.t('rail.user')}
      expandedIds={expandedIds}
      getDisclosureLabel={(node, expanded) => `${expanded ? '收起' : '展开'}${node.label}`}
      getDragLabel={node => node.label}
      moreActionsLabel={props.t('context.actionMore')}
      nodes={nodes}
      onExpandedIdsChange={setExpandedIds}
      onSelect={node => {
        const resource = resourcesByNode.get(node.id)
        if (resource) props.onOpenResource(resource, node.id)
        else if (node.id.startsWith('user:background:')) props.onOpenBackground?.(node.id.slice('user:background:'.length))
        else if (node.id.startsWith('user:rule:')) props.onOpenRule(node.id.slice('user:rule:'.length))
      }}
      renderIcon={node => node.id.startsWith('user:background') ? <Image size={16} aria-hidden="true" /> : node.id.startsWith('user:rule:') ? <Regex size={16} aria-hidden="true" />
        : node.id === 'user:presets' ? <Bot size={16} aria-hidden="true" />
          : node.id === 'user:settings' ? <BookOpen size={16} aria-hidden="true" />
            : node.kind === 'folder' ? <Folder size={16} aria-hidden="true" /> : <FileText size={16} aria-hidden="true" />}
    />
  </section>
}

export function isUserPromptResource(resource: Pick<PromptResource, 'origin' | 'sourceArtifactRef'>): boolean {
  return !resource.origin && !resource.sourceArtifactRef
}
