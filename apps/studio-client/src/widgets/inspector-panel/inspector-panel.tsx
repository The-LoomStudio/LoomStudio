import type { Translator } from '../../shared/i18n/index.js'
import { JsonBlock } from '../../shared/ui/json-block/json-block.js'
import type { PromptBuildStep } from '../../features/prompt-build/model/build-prompt-build-steps.js'
import type { RenderingLabMode, RenderingLabSample } from '../../features/rendering-lab/model/rendering-lab-sample.js'
import { PromptBuildFlow } from '../prompt-build-flow/prompt-build-flow.js'
import { RenderingLab } from '../rendering-lab/rendering-lab.js'
import styles from './inspector-panel.module.scss'

type InspectorPanelProps = {
  agentTranscript: unknown
  cardSnapshot: unknown
  events: string[]
  mode: RenderingLabMode
  onAllowRawHtml: () => void
  onCreateRendererSession: () => Promise<void>
  onOpenRenderer: () => void
  onSelectChoice: (choice: string) => void
  onSelectMode: (mode: RenderingLabMode) => void
  promptBuildSteps: PromptBuildStep[]
  promptBuildTrace: unknown
  promptMessages: unknown
  providerPayloadPreview: unknown
  rawHtmlAllowed: boolean
  rendererSessionId?: string
  runDetails: unknown
  sample: RenderingLabSample
  t: Translator
}

export function InspectorPanel(props: InspectorPanelProps) {
  return (
    <aside className={styles.inspector} data-loom-component="overlay-utility-layer">
      <section className={styles.section} data-loom-component="rendering-lab">
        <RenderingLab
          events={props.events}
          mode={props.mode}
          onAllowRawHtml={props.onAllowRawHtml}
          onCreateRendererSession={props.onCreateRendererSession}
          onOpenRenderer={props.onOpenRenderer}
          onSelectChoice={props.onSelectChoice}
          onSelectMode={props.onSelectMode}
          rawHtmlAllowed={props.rawHtmlAllowed}
          rendererSessionId={props.rendererSessionId}
          sample={props.sample}
          t={props.t}
        />
      </section>
      <section className={styles.section}>
        <h2>{props.t('inspector.cardSnapshot')}</h2>
        <JsonBlock value={props.cardSnapshot} />
      </section>
      <section className={styles.section}>
        <h2>{props.t('inspector.run')}</h2>
        <JsonBlock value={props.runDetails} />
      </section>
      <section className={styles.section}>
        <h2>{props.t('inspector.agentTranscript')}</h2>
        <JsonBlock value={props.agentTranscript} />
      </section>
      <section className={styles.section}>
        <h2>{props.t('inspector.promptBuildFlow')}</h2>
        <PromptBuildFlow steps={props.promptBuildSteps} />
      </section>
      <section className={styles.section}>
        <h2>PromptBuild Trace</h2>
        <JsonBlock value={props.promptBuildTrace} />
      </section>
      <section className={styles.section}>
        <h2>{props.t('inspector.prompt')}</h2>
        <JsonBlock value={props.promptMessages} />
      </section>
      <section className={styles.section}>
        <h2>Provider Payload</h2>
        <JsonBlock value={props.providerPayloadPreview} />
      </section>
    </aside>
  )
}
