import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { BookOpen, Bot, FileText, Folder, Regex } from 'lucide-react'
import type { PromptResource } from '../../entities/index.js'
import type { StudioApi } from '../../shared/api/studio-api.js'
import type { Translator } from '../../shared/i18n/index.js'
import { FileTree, type FileTreeNode } from '../../shared/ui/file-tree/file-tree.js'
import styles from './user-resources-panel.module.scss'

export function UserResourcesPanel(props: {
  api: StudioApi['textTransforms']
  endpoint: string
  resources: PromptResource[]
  t: Translator
  onOpenResource(resource: PromptResource, nodeId: string): void
  onOpenRule(ruleId: string): void
}) {
  const rules = useQuery({
    queryKey: ['user-resources', props.endpoint, 'rules'],
    queryFn: () => props.api.listRules(),
  })
  const [expandedIds, setExpandedIds] = useState(['user:presets', 'user:settings', 'user:other', 'user:rules'])
  const own = props.resources.filter(isUserPromptResource)
  const groups = [
    { id: 'presets', title: props.t('rail.agent'), items: own.filter(resource => resource.resourceKind === 'preset') },
    { id: 'settings', title: props.t('context.authoring.settings'), items: own.filter(resource => resource.resourceKind === 'setting') },
    { id: 'other', title: props.t('rail.resource'), items: own.filter(resource => resource.resourceKind !== 'preset' && resource.resourceKind !== 'setting') },
  ]
  const ownRules = (rules.data?.rules ?? []).filter(rule => rule.owner.kind === 'workspace')
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
    id: 'user:rules', label: props.t('rail.textTransform'), kind: 'folder', meta: String(ownRules.length),
    children: ownRules.map(rule => ({ id: `user:rule:${rule.id}`, label: rule.name, kind: 'entry' })),
  })

  return <section aria-label={props.t('rail.user')} className={styles.panel}>
    <header><h2>{props.t('rail.user')}</h2></header>
    {rules.isError ? <p role="alert">{rules.error.message}</p> : null}
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
        else if (node.id.startsWith('user:rule:')) props.onOpenRule(node.id.slice('user:rule:'.length))
      }}
      renderIcon={node => node.id.startsWith('user:rule:') ? <Regex size={16} aria-hidden="true" />
        : node.id === 'user:presets' ? <Bot size={16} aria-hidden="true" />
          : node.id === 'user:settings' ? <BookOpen size={16} aria-hidden="true" />
            : node.kind === 'folder' ? <Folder size={16} aria-hidden="true" /> : <FileText size={16} aria-hidden="true" />}
    />
  </section>
}

export function isUserPromptResource(resource: Pick<PromptResource, 'origin' | 'sourceArtifactRef'>): boolean {
  return !resource.origin && !resource.sourceArtifactRef
}
