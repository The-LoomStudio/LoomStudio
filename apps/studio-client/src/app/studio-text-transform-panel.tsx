import { type ReactNode } from 'react'
import { TextTransformPanel, type OwnerScope, type TextTransformProps } from '../widgets/text-transform-workbench/text-transform-panel.js'
import type { TextRuleOwner } from '../entities/index.js'
import type { StudioApi } from '../shared/api/studio-api.js'
import type { Translator } from '../shared/i18n/index.js'

type StudioTextTransformPanelProps = {
  api: TextTransformProps['api']
  loomScriptsApi: StudioApi['loomScripts']
  onRuntimeChanged: TextTransformProps['onRuntimeChanged']
  rendererHost: TextTransformProps['rendererHost']
  runtimeScriptContext: TextTransformProps['runtimeScriptContext']
  runtimeContexts: TextTransformProps['runtimeContexts']
  t: Translator
  getOwnerName?: (owner: TextRuleOwner | OwnerScope) => string | undefined
}

export function StudioTextTransformPanel(props: StudioTextTransformPanelProps): ReactNode {
  return <TextTransformPanel api={props.api} loomScriptsApi={props.loomScriptsApi}
    onRuntimeChanged={props.onRuntimeChanged} rendererHost={props.rendererHost}
    runtimeScriptContext={props.runtimeScriptContext} runtimeContexts={props.runtimeContexts}
    owner={{ kind: 'runtime' }} getOwnerName={props.getOwnerName} t={props.t} hideHeader />
}
