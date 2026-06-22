import type { ClientJsonValue } from '@loom-studio/client-bridge'
import yaml from 'yaml'
import type { ModelProfile } from '../../../entities/index.js'

export type ModelConfigForm = {
  additionalParameters: string
  excludeParameters: string
  customHeaders: string
}

export function readModelConfig(profile: ModelProfile, form: ModelConfigForm): Record<string, ClientJsonValue> {
  const config = { ...profile.config }

  if (form.additionalParameters) config.additionalParameters = yaml.parse(form.additionalParameters)
  else delete config.additionalParameters

  if (form.excludeParameters) config.excludeParameters = yaml.parse(form.excludeParameters)
  else delete config.excludeParameters

  if (form.customHeaders) config.customHeaders = yaml.parse(form.customHeaders)
  else delete config.customHeaders

  return config as Record<string, ClientJsonValue>
}

export function readModelConfigForm(profile: ModelProfile): ModelConfigForm {
  return {
    additionalParameters: profile.config.additionalParameters ? yaml.stringify(profile.config.additionalParameters) : '',
    excludeParameters: profile.config.excludeParameters ? yaml.stringify(profile.config.excludeParameters) : '',
    customHeaders: profile.config.customHeaders ? yaml.stringify(profile.config.customHeaders) : '',
  }
}
