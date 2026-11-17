import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createId } from '@loom-studio/shared'
import { createConsoleLogSink, createMemoryLogSink, createRootLogger, readLogFailure, type LogRecord } from '@loom-studio/logging'
import { createJsonlFileSink, createJsonlLogReader } from '@loom-studio/logging/node'
import { resolveLoomStudioLocalPaths } from '@loom-studio/kernel/platform'
import { createStudioServer } from './server.js'

const defaultPort = 18010
const defaultClientOrigin = process.env.STUDIO_CLIENT_URL ?? 'http://127.0.0.1:18011'
const installationRoot = fileURLToPath(new URL('../../../', import.meta.url))

export async function main(): Promise<void> {
  const development = process.env.NODE_ENV === 'development'
    || (!process.env.NODE_ENV && import.meta.url.endsWith('.ts'))
  const clientDirectory = join(installationRoot, 'apps/studio-client/dist')
  if (!development && !existsSync(join(clientDirectory, 'index.html'))) {
    throw new Error('Client build is missing. Run pnpm build:app before starting Loom Studio.')
  }
  const localPaths = resolveLoomStudioLocalPaths()
  const instanceId = createId('server')
  const memoryLogs = createMemoryLogSink({ capacity: 5_000 })
  const rootLogger = createRootLogger({
    service: 'studio-server',
    instanceId,
    sinks: [
      memoryLogs,
      createJsonlFileSink({ directory: localPaths.logRoot }),
      createConsoleLogSink({
        filter: shouldWriteServerConsoleLog,
        colorize: process.env.FORCE_COLOR !== undefined
          ? process.env.FORCE_COLOR !== '0'
          : process.env.NO_COLOR === undefined && Boolean(process.stdout.isTTY),
        verbose: process.env.LOOM_STUDIO_LOG_DETAILS === '1',
      }),
    ],
  })
  const logger = rootLogger.child('system')
  const server = createStudioServer({
    runtimeMode: development ? 'development' : 'production',
    clientDirectory: development ? undefined : clientDirectory,
    localPaths,
    logger,
    logs: memoryLogs,
    logHistory: createJsonlLogReader({ directory: localPaths.logRoot }),
    rpcLogger: rootLogger.child('transport.rpc'),
    documentLogger: rootLogger.child('document.store'),
    promptBuildLogger: rootLogger.child('prompt.build'),
    providerLogger: rootLogger.child('runtime.provider'),
    runtimeLogger: rootLogger.child('runtime'),
    extensionLogger: rootLogger.child('extension.loader'),
  })
  const port = Number(process.env.PORT ?? defaultPort)
  let shuttingDown = false
  const shutdown = async (signal: NodeJS.Signals): Promise<void> => {
    if (shuttingDown) return
    shuttingDown = true
    logger.info('Studio server shutdown requested', {
      event: 'server.shutdown.requested',
      data: { signal },
    })
    try {
      await server.close()
    } catch (error) {
      logger.error('Studio server failed to stop cleanly', {
        event: 'server.stop.failed',
        data: { ...readLogFailure(error), detail: readLogFailure(error).failureReason },
      })
      process.exitCode = 1
    } finally {
      await rootLogger.close()
    }
  }
  const handleSigint = () => void shutdown('SIGINT')
  const handleSigterm = () => void shutdown('SIGTERM')
  process.once('SIGINT', handleSigint)
  process.once('SIGTERM', handleSigterm)

  try {
    const { port: actualPort } = await server.listen(port)
    console.log(`Loom Studio: http://127.0.0.1:${actualPort}`)
    printStudioServerBanner(actualPort, development)
    console.log(`Loom Studio 数据目录: ${localPaths.dataRoot}`)
  } catch (error) {
    process.off('SIGINT', handleSigint)
    process.off('SIGTERM', handleSigterm)
    await server.close()
    await rootLogger.close()
    throw error
  }
}

function printStudioServerBanner(port: number, development: boolean): void {
  try {
    const candidatePaths = [
      fileURLToPath(new URL('./banner.txt', import.meta.url)),
      fileURLToPath(new URL('../src/banner.txt', import.meta.url)),
    ]
    const bannerPath = candidatePaths.find(p => existsSync(p))
    if (!bannerPath) return

    const raw = readFileSync(bannerPath, 'utf8')
    const lines = raw.split('\n')
    const rawTag = development ? '\x1b[?loom-raw]' : ''

    // 每次打印前先通过 ANSI 转义码软清屏，防止热重启时出现两个 Banner 重叠
    const isInteractive = typeof process !== 'undefined' && process.stdout?.isTTY
    if (isInteractive) {
      process.stdout.write(`${rawTag}\x1b[2J\x1b[3J\x1b[H`)
    }

    // 采用与 Logo 完全一致的金属冷银灰渐变插值 (从浅冷银 198,208,222 过渡到深沉岩蓝 90,104,126)
    const startRgb = [198, 208, 222]
    const endRgb = [90, 104, 126]
    const total = lines.length

    const bold = '\x1b[1m'
    const dim = '\x1b[2m'
    const reset = '\x1b[0m'
    const silver = '\x1b[38;2;175;186;202m'

    console.log(rawTag)
    for (let i = 0; i < total; i++) {
      const t = total <= 1 ? 0 : i / (total - 1)
      const r = Math.round(startRgb[0] + (endRgb[0] - startRgb[0]) * t)
      const g = Math.round(startRgb[1] + (endRgb[1] - startRgb[1]) * t)
      const b = Math.round(startRgb[2] + (endRgb[2] - startRgb[2]) * t)
      const color = `\x1b[38;2;${r};${g};${b}m`
      console.log(`${rawTag}${color}${lines[i]}${reset}`)
    }

    const time = new Date().toLocaleTimeString('zh-CN', { hour12: false })
    const nodeVer = process.version
    const serverUrl = `http://127.0.0.1:${port}`
    const clientUrl = development ? defaultClientOrigin : serverUrl

    // OSC 8 原生终端可点击超链接 (VSCode/iTerm2/Ghostty 支持直接按住点击打开)
    const serverLink = `\x1b]8;;${serverUrl}\x1b\\${serverUrl}\x1b]8;;\x1b\\`
    const clientLink = `\x1b]8;;${clientUrl}\x1b\\${clientUrl}\x1b]8;;\x1b\\`

    const ramBar = renderRamBar()

    console.log(`${rawTag}╭─ ${bold}${silver}Loom Studio${reset}  \x1b[32m● active\x1b[0m  ${dim}${nodeVer}   ${time}${reset}`)
    console.log(`${rawTag}│  ${dim}➜${reset}  ${bold}Local Server:${reset}  ${serverLink}`)
    console.log(`${rawTag}│  ${dim}➜${reset}  ${bold}Studio Client:${reset} ${clientLink}`)
    if (ramBar) {
      console.log(`${rawTag}│  ${dim}➜${reset}  ${bold}RAM Meter:${reset}     ${ramBar}`)
    }
    console.log(`${rawTag}╰─ ${dim}Weave worlds, interweave stories.${reset}\n`)
  } catch {
    // ignore banner printing errors
  }
}

function renderRamBar(): string {
  try {
    const mem = process.memoryUsage()
    const heapUsedMb = Math.round(mem.heapUsed / 1024 / 1024)
    const heapTotalMb = Math.round(mem.heapTotal / 1024 / 1024)
    const percent = heapTotalMb > 0 ? Math.min(100, Math.round((heapUsedMb / heapTotalMb) * 100)) : 0
    const totalBars = 10
    const filledBars = Math.round((percent / 100) * totalBars)
    const emptyBars = Math.max(0, totalBars - filledBars)

    const green = '\x1b[32m'
    const yellow = '\x1b[33m'
    const red = '\x1b[31m'
    const dim = '\x1b[2m'
    const reset = '\x1b[0m'

    const color = percent > 85 ? red : percent > 65 ? yellow : green
    const bar = `${color}${'█'.repeat(filledBars)}${dim}${'░'.repeat(emptyBars)}${reset}`
    return `[${bar}] ${color}${percent}%${reset} ${dim}(${heapUsedMb}MB / ${heapTotalMb}MB)${reset}`
  } catch {
    return ''
  }
}

function shouldWriteServerConsoleLog(record: LogRecord): boolean {
  return record.level === 'warn'
    || record.level === 'error'
    || record.namespace === 'system'
    || record.namespace.startsWith('runtime.')
    || record.namespace === 'prompt.build'
}

export function runStudioServerCli(): void {
  void main().catch(error => {
    if (isAddressInUseError(error)) {
      console.error(`Loom Studio server port ${error.port ?? defaultPort} is already in use. Stop the existing server or set PORT to another port.`)
    } else if (isDataRootLockedError(error)) {
      console.error(error.message)
    } else {
      console.error(error)
    }
    process.exitCode = 1
  })
}

function isAddressInUseError(error: unknown): error is NodeJS.ErrnoException & { port?: number } {
  return error instanceof Error && 'code' in error && error.code === 'EADDRINUSE'
}

function isDataRootLockedError(error: unknown): error is Error & { code: 'server.data_root_locked' } {
  return error instanceof Error && 'code' in error && error.code === 'server.data_root_locked'
}
