import { MobileTabPages } from '../shared/ui/mobile-tab-pages/mobile-tab-pages.js'
import { useWorkbenchView } from '../shared/studio-shell/use-workbench-view.js'
import { useEffect, type ComponentProps, type ReactNode } from 'react'
import { TextTransformPanel, type OwnerScope, type TextTransformProps } from '../widgets/text-transform-workbench/text-transform-panel.js'
import { ScriptManagementPanel } from '../features/loom-scripts/ui/script-management-panel.js'
import type { TextRuleOwner } from '../entities/index.js'
import type { StudioApi } from '../shared/api/studio-api.js'
import type { Translator } from '../shared/i18n/index.js'
import { PanelTabs } from '../shared/ui/panel-tabs/index.js'
import styles from './studio-state-panel.module.scss'

export type TextTransformView = 'authoring' | 'runtime'

type StudioTextTransformPanelProps = {
  initialRuleId?: string
  initialExtractorId?: string
  api: TextTransformProps['api']
  loomScriptsApi: StudioApi['loomScripts']
  scriptScopes: ComponentProps<typeof ScriptManagementPanel>['scopes']
  getScriptOwnerName: ComponentProps<typeof ScriptManagementPanel>['getOwnerName']
  onScriptsChanged(): void
  scriptsRefreshToken?: number
  onRuntimeChanged: TextTransformProps['onRuntimeChanged']
  rendererHost: TextTransformProps['rendererHost']
  runtimeScriptContext: TextTransformProps['runtimeScriptContext']
  runtimeContexts: TextTransformProps['runtimeContexts']
  t: Translator
  cardId?: string
  getOwnerName?: (owner: TextRuleOwner | OwnerScope) => string | undefined
}

export function StudioTextTransformPanel(props: StudioTextTransformPanelProps): ReactNode {
  const [view, setView] = useWorkbenchView<TextTransformView>('text-transform.tab', 'authoring', ['authoring', 'runtime'])
  useEffect(() => {
    if (props.initialRuleId || props.initialExtractorId) setView('authoring')
  }, [props.initialRuleId, props.initialExtractorId])
  const tabs = (
    <PanelTabs<TextTransformView>
      activeId={view}
      ariaLabel={props.t('textTransform.title')}
      items={[
        { id: 'authoring', label: props.t('textTransform.tabRules') },
        { id: 'runtime', label: props.t('textTransform.tabInspector') },
      ]}
      onChange={setView}
    />
  )

  return (
    <div data-loom-mobile-tab-scope="" className={styles.panel}>
      <MobileTabPages<TextTransformView> activeId={view} onChange={setView} header={tabs} pages={[{ id: 'authoring', content: props.initialExtractorId ? (
        <TextTransformPanel header={<div data-mobile-tab-inline-header="">{tabs}</div>} api={props.api} loomScriptsApi={props.loomScriptsApi}
          initialExtractorId={props.initialExtractorId} owner={{ kind: 'catalog' }}
          onRuntimeChanged={props.onRuntimeChanged} rendererHost={props.rendererHost}
          runtimeScriptContext={props.runtimeScriptContext} runtimeContexts={props.runtimeContexts}
          getOwnerName={props.getOwnerName} t={props.t} hideHeader />
      ) : (
        <ScriptManagementPanel
          header={<div data-mobile-tab-inline-header="">{tabs}</div>}
          initialFilter={props.initialRuleId || props.initialExtractorId ? 'rules' : undefined}
          initialScriptId={props.initialRuleId ?? props.initialExtractorId}
          api={props.loomScriptsApi}
          scopes={props.scriptScopes}
          getOwnerName={props.getScriptOwnerName}
          cardId={props.cardId}
          onScriptsChanged={props.onScriptsChanged}
          refreshToken={props.scriptsRefreshToken}
          t={props.t}
        />
      ) }, { id: 'runtime', content: (
        <TextTransformPanel
          header={<div data-mobile-tab-inline-header="">{tabs}</div>}
          api={props.api}
          loomScriptsApi={props.loomScriptsApi}
          onRuntimeChanged={props.onRuntimeChanged}
          rendererHost={props.rendererHost}
          runtimeScriptContext={props.runtimeScriptContext}
          owner={{ kind: 'runtime' }}
          getOwnerName={props.getOwnerName}
          t={props.t}
          runtimeContexts={props.runtimeContexts}
          hideHeader={true}
        />
      ) }]} />
    </div>
  )
}
