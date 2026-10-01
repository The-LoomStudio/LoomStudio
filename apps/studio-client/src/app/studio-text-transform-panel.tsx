import { useState, type ReactNode } from 'react'
import { TextTransformPanel, type OwnerScope, type TextTransformProps } from '../features/text-transforms/ui/text-transform-panel.js'
import type { TextRuleOwner } from '../entities/index.js'
import type { Translator } from '../shared/i18n/index.js'
import { PanelTabs } from '../shared/ui/panel-tabs/index.js'
import styles from './studio-state-panel.module.scss'

export type TextTransformView = 'authoring' | 'runtime'

type StudioTextTransformPanelProps = {
  initialRuleId?: string
  initialExtractorId?: string
  temporaryTarget?: boolean
  api: TextTransformProps['api']
  loomScriptsApi: TextTransformProps['loomScriptsApi']
  onRuntimeChanged: TextTransformProps['onRuntimeChanged']
  rendererHost: TextTransformProps['rendererHost']
  runtimeScriptContext: TextTransformProps['runtimeScriptContext']
  runtimeContexts: TextTransformProps['runtimeContexts']
  t: Translator
  cardId?: string
  getOwnerName?: (owner: TextRuleOwner | OwnerScope) => string | undefined
}

export function StudioTextTransformPanel(props: StudioTextTransformPanelProps): ReactNode {
  const [view, setView] = useState<TextTransformView>('authoring')
  const [scope, setScope] = useState<'current' | 'global'>(props.initialRuleId || props.initialExtractorId ? 'global' : 'current')
  
  const hasCard = Boolean(props.cardId)
  const owner = scope === 'current' && hasCard ? { kind: 'card' as const, cardId: props.cardId! } : { kind: 'catalog' as const }

  return (
    <div className={styles.panel}>
      <header className={styles.header}>
        <PanelTabs<TextTransformView>
          activeId={view}
          ariaLabel={props.t('textTransform.title')}
          items={[
            { id: 'authoring', label: props.t('textTransform.title') },
            { id: 'runtime', label: props.t('textTransform.inspectorTitle') },
          ]}
          onChange={setView}
        />
      </header>
      <div className={styles.content}>
        {view === 'authoring' ? (
          <TextTransformPanel
            initialRuleId={props.initialRuleId}
            initialExtractorId={props.initialExtractorId}
            temporaryTarget={props.temporaryTarget}
            api={props.api}
            loomScriptsApi={props.loomScriptsApi}
            onRuntimeChanged={props.onRuntimeChanged}
            owner={owner}
            ownerOptions={[
              ...(hasCard ? [{ owner: { kind: 'card' as const, cardId: props.cardId! }, label: '当前生效', id: 'current' }] : []),
              { owner: { kind: 'catalog' as const }, label: '全局默认', id: 'global' }
            ]}
            onOwnerChange={newOwner => setScope(newOwner.kind === 'catalog' ? 'global' : 'current')}
            getOwnerName={props.getOwnerName}
            t={props.t}
          />
        ) : (
          <TextTransformPanel
            api={props.api}
            loomScriptsApi={props.loomScriptsApi}
            onRuntimeChanged={props.onRuntimeChanged}
            rendererHost={props.rendererHost}
            runtimeScriptContext={props.runtimeScriptContext}
            owner={{ kind: 'runtime' }}
            getOwnerName={props.getOwnerName}
            t={props.t}
            runtimeContexts={props.runtimeContexts}
          />
        )}
      </div>
    </div>
  )
}
