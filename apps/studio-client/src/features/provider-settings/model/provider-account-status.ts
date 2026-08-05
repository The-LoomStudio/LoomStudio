import type { ProviderAccount } from '../../../entities/index.js'

export function hasCompleteProviderAccount(accounts: ProviderAccount[]): boolean {
  return accounts.some(account => {
    if (account.providerExtensionId !== 'official.openai-compatible' && account.providerExtensionId !== 'openai-compatible') {
      return true
    }

    return typeof account.config.baseUrl === 'string'
      && account.config.baseUrl.trim().length > 0
      && typeof account.secretRefs.apiKey === 'string'
      && account.secretRefs.apiKey.trim().length > 0
  })
}
