import { InfoDialog } from '../../shared/ui/info-dialog/info-dialog.js'
import type { UserBackgroundLibrary } from '../../features/backgrounds/model/use-user-backgrounds.js'
import { useMemo, useState } from 'react'
import { Button, SearchField } from '@loom-studio/ui'
import { useQuery } from '@tanstack/react-query'
import { BookOpen, Bot, FileText, Image, Regex, ChevronRight } from 'lucide-react'
import type { ListPromptResourcesResult, PromptResource } from '../../entities/index.js'
import type { StudioApi } from '../../shared/api/studio-api.js'
import type { Translator } from '../../shared/i18n/index.js'
import type { FileTreeNode } from '../../shared/ui/file-tree/file-tree.js'
import { ResourceListRow } from '../../shared/ui/resource-list/resource-list-row.js'
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
      const node = resource.rootNode
      resourcesByNode.set(node.id, resource)
      return { id: node.id, label: node.label, kind: 'entry' }
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
  active?: boolean
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
  const active = props.active ?? true
  const rules = useQuery({
    queryKey: ['user-resources', props.endpoint, 'rules'],
    queryFn: () => props.api.listRuleSummaries({ kind: 'workspace' }),
    enabled: active,
  })
  const [query, setQuery] = useState('')
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({})
  const { nodes, resourcesByNode } = useMemo(
    () => active ? buildUserResourceTree(props.resources, rules.data?.rules ?? [], props.t, props.backgroundLibrary?.backgrounds) : { nodes: [], resourcesByNode: new Map<string, PromptResource>() },
    [active, props.resources, rules.data?.rules, props.t, props.backgroundLibrary?.backgrounds],
  )

  if (!active) return null

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
    <div className={styles.search}><SearchField aria-label="搜索我的资源" placeholder="搜索我的资源" clearLabel="清除搜索" value={query} onChange={event => setQuery(event.target.value)} onClear={() => setQuery('')} /></div>
    {nodes.map(group => {
      const items = (group.children ?? []).filter(item => `${group.label} ${item.label}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()))
      if (query.trim() && !items.length) return null
      const Icon = group.id === 'user:presets' ? Bot : group.id === 'user:lore' ? BookOpen : group.id === 'user:rules' ? Regex : group.id === 'user:backgrounds' ? Image : FileText
      const groupKey = `${group.id}-${!!query.trim()}-${!!group.children?.length}`
      return <details className={styles.group} key={groupKey} open={openGroups[groupKey] ?? items.length > 0} onToggle={event => {
        const open = event.currentTarget.open
        setOpenGroups(previous => previous[groupKey] === open ? previous : { ...previous, [groupKey]: open })
      }}>
        <summary><Icon size={18} aria-hidden="true" /><strong>{group.label}</strong><span>{items.length}</span><ChevronRight size={16} className={styles.disclosure} aria-hidden="true" /></summary>
        <div className={styles.items}>
          {items.map(item => {
            const resource = resourcesByNode.get(item.id)
            const background = props.backgroundLibrary?.backgrounds.find(value => item.id === `user:background:${value.id}`)
            return <ResourceListRow key={item.id} name={item.label}
              icon={background ? <img src={background.image} alt="" loading="lazy" /> : <Icon size={24} />}
              metadata={<span>{group.label}</span>}
              onOpen={() => {
                if (resource) props.onOpenResource(resource, item.id)
                else if (background) props.onOpenBackground?.(background.id)
                else if (item.id.startsWith('user:rule:')) props.onOpenRule(item.id.slice('user:rule:'.length))
              }}
            />
          })}
          {!items.length && <p className={styles.empty}>暂无{group.label}</p>}
        </div>
      </details>
    })}
    {query.trim() && !nodes.some(group => group.children?.some(item => `${group.label} ${item.label}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()))) && <p className={styles.empty}>没有匹配的资源</p>}

  </section>
}

export function isUserPromptResource(resource: Pick<PromptResource, 'origin' | 'sourceArtifactRef'>): boolean {
  return !resource.origin && !resource.sourceArtifactRef
}
