import { useState } from 'react'
import type { Translator } from '../../../shared/i18n/index.js'
import { buildRenderingLabSample, type RenderingLabMode } from './rendering-lab-sample.js'
import { useRenderingLabMessages } from './use-rendering-lab-messages.js'

type UseRenderingLabInput = {
  initialMode: RenderingLabMode
  t: Translator
}

export function useRenderingLab(input: UseRenderingLabInput) {
  const [renderingMode, setRenderingMode] = useState<RenderingLabMode>(input.initialMode)
  const [rawHtmlAllowed, setRawHtmlAllowed] = useState(false)
  const messages = useRenderingLabMessages()

  function selectRenderingChoice(choice: string) {
    messages.setRenderingEvents(current => [`${new Date().toLocaleTimeString()} choice: ${choice}`, ...current].slice(0, 5))
  }

  return {
    renderingMode,
    setRenderingMode,
    rawHtmlAllowed,
    setRawHtmlAllowed,
    renderingEvents: messages.renderingEvents,
    setRenderingEvents: messages.setRenderingEvents,
    selectRenderingChoice,
    renderingSample: buildRenderingLabSample(renderingMode, input.t),
  }
}
