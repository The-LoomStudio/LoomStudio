import { execFileSync } from 'node:child_process'

export function resolveSystemProxyUrl(input: {
  environment?: NodeJS.ProcessEnv
  platform?: NodeJS.Platform
  readMacProxy?: () => string
} = {}): string | undefined {
  const environment = input.environment ?? process.env
  const environmentProxy = environment.HTTPS_PROXY
    ?? environment.https_proxy
    ?? environment.HTTP_PROXY
    ?? environment.http_proxy
    ?? environment.ALL_PROXY
    ?? environment.all_proxy
  if (isHttpProxyUrl(environmentProxy)) return environmentProxy

  if ((input.platform ?? process.platform) !== 'darwin') return undefined
  try {
    return parseMacSystemProxy((input.readMacProxy ?? readMacSystemProxy)())
  } catch {
    return undefined
  }
}

export function parseMacSystemProxy(output: string): string | undefined {
  const enabled = readScutilValue(output, 'HTTPSEnable') ?? readScutilValue(output, 'HTTPEnable')
  const host = readScutilValue(output, 'HTTPSProxy') ?? readScutilValue(output, 'HTTPProxy')
  const port = readScutilValue(output, 'HTTPSPort') ?? readScutilValue(output, 'HTTPPort')
  if (enabled !== '1' || !host || !port || !/^\d+$/.test(port)) return undefined
  return `http://${host}:${port}`
}

function readMacSystemProxy(): string {
  return execFileSync('/usr/sbin/scutil', ['--proxy'], {
    encoding: 'utf8',
    timeout: 1_000,
  })
}

function readScutilValue(output: string, key: string): string | undefined {
  return output.match(new RegExp(`^\\s*${key}\\s*:\\s*(.+)$`, 'm'))?.[1]?.trim()
}

function isHttpProxyUrl(value: string | undefined): value is string {
  if (!value) return false
  try {
    const protocol = new URL(value).protocol
    return protocol === 'http:' || protocol === 'https:'
  } catch {
    return false
  }
}
