import { useSyncExternalStore } from 'react'
import { Button } from '@loom-studio/ui'
import type { ClientRendererHost } from '../../shared/extension-renderer-runtime/client-renderer-host.js'
import { rendererContributionKey } from '../../shared/extension-renderer-runtime/renderer-registry.js'
import { RendererSurfaceHost } from '../../features/extension-renderers/ui/renderer-surface-host.js'
import { GitBranch } from 'lucide-react'
import { useQuery } from '@tanstack/react-query'
import type { StudioApi } from '../../shared/api/studio-api.js'
import { PanelTabs } from '../../shared/ui/panel-tabs/index.js'
import { WorkspaceBrowser } from './workspace-browser.js'
import styles from './memory-panel.module.scss'

type Props = {
  rendererHost: ClientRendererHost
  onOpenStoryExtensions(): void
  endpoint: string
  api: StudioApi
  timelineId?: string
  defaultTimelineId?: string
  branchId?: string
  view: 'plot' | 'workspace'
  onNavigate(target: { timelineId?: string; branchId?: string; view: 'plot' | 'workspace' }): void
}

export function MemoryPanel(props: Props) {
  useSyncExternalStore(props.rendererHost.subscribe, props.rendererHost.renderRevision, props.rendererHost.renderRevision)
  const timelineId = props.timelineId ?? props.defaultTimelineId
  const timelineQuery = useQuery({
    queryKey: ['memory-timeline-owner', props.endpoint, timelineId],
    queryFn: () => props.api.narratives.get(timelineId!), enabled: Boolean(timelineId), retry: false,
  })
  const timeline = timelineQuery.data?.timeline
  const branchId = props.branchId ?? timeline?.activeBranchId
  const currentScope = props.rendererHost.scopeSnapshot()
  const scope = { kind: 'timeline' as const, key: timelineId ?? '' }
  const currentTarget = timelineId === currentScope.timelineId && branchId === currentScope.branchId
  const hasMemoryRenderer = currentTarget && props.rendererHost.list('memory.panel').some(renderer =>
    renderer.definition.instanceScope === 'timeline' && props.rendererHost.canUse(rendererContributionKey(renderer), scope))
  return <section data-loom-mobile-tab-scope="" className={styles.panel} aria-label="记忆">
    <header className={styles.header}>
      <PanelTabs activeId={props.view} ariaLabel="记忆类型" items={[
        { id: 'plot', label: '剧情记忆' }, { id: 'workspace', label: '共享工作区' },
      ]} onChange={view => props.onNavigate({ timelineId, branchId, view })} />
      <span className={styles.owner}><GitBranch size={13} /><span>{timeline?.title || '未选择 Timeline'}</span></span>
    </header>
    {props.view === 'plot' ? timelineQuery.error
      ? <div className={styles.empty} role="alert"><p>{timelineQuery.error.message}</p><button onClick={() => void timelineQuery.refetch()}>重试</button></div>
      : timelineId && timelineQuery.isPending ? <p className={styles.empty} role="status">正在加载剧情记忆…</p>
      : !timelineId || !branchId ? <p className={styles.empty}>进入一个 Timeline 后可以查看剧情记忆。</p>
      : !currentTarget ? <p className={styles.empty}>切换到此 Timeline 及分支后，可以查看剧情记忆。</p>
      : hasMemoryRenderer ? <RendererSurfaceHost key={`${timelineId}:${branchId}`} host={props.rendererHost} surface="memory.panel" scope={scope} />
      : <div className={styles.empty}><p>当前 Timeline 没有可用的剧情记忆面板。</p><p>在「故事扩展」中为当前故事选择使用记忆扩展后，它的面板才会显示。</p><Button onClick={props.onOpenStoryExtensions}>打开故事扩展</Button></div>
      : timelineQuery.error ? <div className={styles.empty} role="alert"><p>{timelineQuery.error.message}</p><button onClick={() => void timelineQuery.refetch()}>重试</button></div>
      : timelineId && timelineQuery.isPending ? <p className={styles.empty} role="status">正在加载工作区…</p>
      : timelineId && branchId ? <WorkspaceBrowser key={`${timelineId}:${branchId}`} api={props.api} timelineId={timelineId} branchId={branchId} />
      : <p className={styles.empty}>进入一个 Timeline 后可以管理共享工作区。</p>}
  </section>
}
