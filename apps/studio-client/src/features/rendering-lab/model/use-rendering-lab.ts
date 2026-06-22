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

  return {
    renderingMode,
    setRenderingMode,
    rawHtmlAllowed,
    setRawHtmlAllowed,
    renderingEvents: messages.renderingEvents,
    setRenderingEvents: messages.setRenderingEvents,
    renderingSample: buildRenderingLabSample(renderingMode, input.t),
  }
}
