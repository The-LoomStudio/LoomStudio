import type { ExtensionStyleContribution, StyleParameter, StyleParameterValue } from '@loom-studio/extension-sdk'
import { sharedStyleParameterDefinitions } from '@loom-studio/extension-sdk'
import type { ManagedExtensionPackage, ManagedExtensionModule } from '../../../entities/extension.js'
import { styleKey } from './style-registry.js'

export type ThemeEntry = {
  key: string
  kind: 'theme' | 'enhancement'
  packageId: string
  packageLabel: string
  version: string
  available: boolean
  definition: ExtensionStyleContribution
  url: string
  module?: ManagedExtensionModule
}

export function readThemeCatalog(packages: readonly ManagedExtensionPackage[]): ThemeEntry[] {
  return packages.filter(pkg => pkg.target?.kind !== 'card' && pkg.participation !== 'timeline').flatMap(pkg => {
    const entry = (definition: ExtensionStyleContribution, kind: ThemeEntry['kind']): ThemeEntry => ({
      key: styleKey(pkg.packageId, definition.id), kind, packageId: pkg.packageId,
      packageLabel: pkg.displayName, version: pkg.fileRevision ?? pkg.version, available: pkg.available,
      definition,
      url: `/extensions/${encodeURIComponent(pkg.packageId)}/${encodeURIComponent(pkg.fileRevision ?? pkg.version)}/files/${definition.css.split('/').map(encodeURIComponent).join('/')}`,
      module: pkg.modules.find(module => module.moduleId === definition.moduleId),
    })
    return [...(pkg.resources?.themes ?? []).map(value => entry(value, 'theme')),
      ...(pkg.resources?.styles ?? []).map(value => entry(value, 'enhancement'))]
  })
}

export function parameterCss(parameter: StyleParameter, value: StyleParameterValue): string {
  switch (parameter.type) {
    case 'number': {
      const range = sharedStyleParameterDefinitions[parameter.variable] ?? parameter
      if (typeof value !== 'number' || !Number.isFinite(value) || value < range.min || value > range.max) throw new Error(`Invalid parameter: ${parameter.label}`)
      return `${value}${parameter.unit ?? ''}`
    }
    case 'boolean':
      if (typeof value !== 'boolean') throw new Error(`Invalid parameter: ${parameter.label}`)
      return value ? parameter.trueValue : parameter.falseValue
    case 'select':
      if (typeof value !== 'string' || !parameter.options.some(option => option.value === value)) throw new Error(`Invalid parameter: ${parameter.label}`)
      return value
    case 'color':
      if (typeof value !== 'string' || /[;{}]/.test(value) || !CSS.supports('color', value)) throw new Error(`Invalid color: ${parameter.label}`)
      return value
  }
}
