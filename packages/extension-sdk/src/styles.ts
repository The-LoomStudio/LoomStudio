import type { ExtensionRegistrationHandle } from './index.js'

/** Host-owned numeric appearance inputs; theme ranges may narrow these bounds. */
export const sharedStyleParameterDefinitions: Readonly<Record<string, {
  readonly min: number
  readonly max: number
  readonly unit: '' | 'px' | '%'
}>> = {
  '--loom-ui-scale': { min: 0.8, max: 1.25, unit: '' },
  '--loom-canvas-width': { min: 540, max: 1120, unit: 'px' },
  '--loom-preview-blur': { min: 0, max: 32, unit: 'px' },
  '--loom-preview-opacity': { min: 0, max: 100, unit: '%' },
}

export type StyleParameterValue = string | number | boolean
export type StyleParameter = {
  id: string
  label: string
  variable: string
} & (
  | { type: 'number'; default: number; min: number; max: number; step?: number; unit?: 'px' | '%' | 'rem' | 'ms' | ''; }
  | { type: 'color'; default: string }
  | { type: 'select'; default: string; options: Array<{ label: string; value: string }> }
  | { type: 'boolean'; default: boolean; trueValue: string; falseValue: string }
)

export type ExtensionStyleContribution = {
  id: string
  label: string
  description?: string
  /** Bundled package-relative stylesheet; assets resolve relative to this file. */
  css: string
  /** Background, panel and accent preview swatches (literal hex, RGB, HSL or OKLCH/OKLab colors). */
  previewColors?: [string, string, string]
  moduleId?: string
  /** Required JS is the default when moduleId is present. */
  supportsCssOnly?: boolean
  nativeMotion?: 'retain' | 'disable'
  parameters?: StyleParameter[]
}

export type StyleAnimationSurface = 'workbench.panel'
export type StyleAnimation = { finished: Promise<unknown>; cancel(): void }
export type StyleAnimationHandler = (input: {
  element: HTMLElement
  phase: 'enter' | 'exit'
  signal: AbortSignal
}) => StyleAnimation

export type ClientStyleContext = {
  signal: AbortSignal
  parameters: Readonly<Record<string, StyleParameterValue>>
  animations: {
    register(surface: StyleAnimationSurface, handler: StyleAnimationHandler): ExtensionRegistrationHandle
  }
}
/** Side effects belong to this adoption lifetime, not the module registration lifetime. */
export type ClientStyleFactory = (context: ClientStyleContext) =>
  void | ExtensionRegistrationHandle | Promise<void | ExtensionRegistrationHandle>
