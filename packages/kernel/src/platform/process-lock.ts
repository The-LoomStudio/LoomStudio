import { randomUUID } from 'node:crypto'
import { mkdir, open, readFile, unlink } from 'node:fs/promises'
import { dirname } from 'node:path'

export class ProcessLockError extends Error {
  readonly code = 'server.data_root_locked'

  constructor(
    message: string,
    readonly details?: {
      lockFile: string
      pid?: number
      port?: number
      startedAt?: string
    },
  ) {
    super(message)
    this.name = 'ProcessLockError'
  }
}

type LockPayload = {
  pid: number
  startedAt: string
  port?: number
  token: string
}

export async function acquireProcessLock(options: {
  lockFile: string
  port?: number
  now(): string
}): Promise<{ release(): Promise<void> }> {
  await mkdir(dirname(options.lockFile), { recursive: true })
  const token = randomUUID()
  const payload: LockPayload = {
    pid: process.pid,
    startedAt: options.now(),
    ...(options.port !== undefined ? { port: options.port } : {}),
    token,
  }

  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const handle = await open(options.lockFile, 'wx')
      try {
        await handle.writeFile(JSON.stringify(payload, null, 2), 'utf8')
      } finally {
        await handle.close()
      }

      let released = false
      return {
        release: async () => {
          if (released) return
          released = true
          let raw: string
          try {
            raw = await readFile(options.lockFile, 'utf8')
          } catch (error) {
            if (isNodeError(error, 'ENOENT')) return
            throw error
          }
          const current = parseLockPayload(raw)
          if (current?.pid === process.pid && current.token === token) {
            try {
              await unlink(options.lockFile)
            } catch (error) {
              if (!isNodeError(error, 'ENOENT')) throw error
            }
          }
        },
      }
    } catch (error) {
      if (!isNodeError(error, 'EEXIST')) throw error

      let raw: string
      try {
        raw = await readFile(options.lockFile, 'utf8')
      } catch (readError) {
        if (isNodeError(readError, 'ENOENT')) continue
        throw readError
      }

      const existing = parseLockPayload(raw)
      if (existing && typeof existing.pid === 'number' && Number.isInteger(existing.pid) && existing.pid > 0) {
        if (!isProcessAlive(existing.pid)) {
          try {
            await unlink(options.lockFile)
          } catch (unlinkError) {
            if (!isNodeError(unlinkError, 'ENOENT')) throw unlinkError
          }
          continue
        }
        throw new ProcessLockError(
          formatLockedMessage(options.lockFile, existing.pid, existing.port),
          {
            lockFile: options.lockFile,
            pid: existing.pid,
            port: existing.port,
            startedAt: existing.startedAt,
          },
        )
      }

      throw new ProcessLockError(
        `Loom Studio data directory is locked (${options.lockFile}). Remove the stale lock file if no other instance is running.`,
        { lockFile: options.lockFile },
      )
    }
  }

  throw new ProcessLockError(
    `Loom Studio data directory is locked (${options.lockFile}).`,
    { lockFile: options.lockFile },
  )
}

function parseLockPayload(raw: string): Partial<LockPayload> | undefined {
  try {
    const parsed = JSON.parse(raw) as unknown
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return undefined
    const record = parsed as Record<string, unknown>
    return {
      pid: typeof record.pid === 'number' ? record.pid : undefined,
      startedAt: typeof record.startedAt === 'string' ? record.startedAt : undefined,
      port: typeof record.port === 'number' ? record.port : undefined,
      token: typeof record.token === 'string' ? record.token : undefined,
    }
  } catch {
    return undefined
  }
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    if (isNodeError(error, 'ESRCH')) return false
    return true
  }
}

function formatLockedMessage(lockFile: string, pid: number, port?: number): string {
  const portInfo = port !== undefined ? `, port ${port}` : ''
  return `Loom Studio data directory is already locked by another running instance (PID ${pid}${portInfo}, lock file: ${lockFile}). Stop the existing Loom Studio process before starting a new one.`
}

function isNodeError(error: unknown, code: string): boolean {
  return error instanceof Error && 'code' in error && error.code === code
}
