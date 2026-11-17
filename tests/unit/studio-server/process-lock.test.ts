import { acquireProcessLock, ProcessLockError } from '@loom-studio/kernel/platform'
import { spawn } from 'node:child_process'
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

async function collectDeadPid(): Promise<number> {
  const child = spawn(process.execPath, ['-e', ''], { stdio: 'ignore' })
  await new Promise<void>((resolve, reject) => {
    child.once('error', reject)
    child.once('exit', () => resolve())
  })
  if (typeof child.pid !== 'number') throw new Error('Expected spawned child PID')
  return child.pid
}

describe('acquireProcessLock', () => {
  it('writes lock metadata exclusively and cleans up idempotently on release', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'loom-lock-'))
    const lockFile = join(dir, 'nested', 'loom.lock')
    try {
      const handle = await acquireProcessLock({
        lockFile,
        port: 4100,
        now: () => '2026-11-17T00:00:00.000Z',
      })
      const payload = JSON.parse(await readFile(lockFile, 'utf8')) as {
        pid: number
        port?: number
        startedAt: string
        token: string
      }
      expect(payload).toMatchObject({
        pid: process.pid,
        port: 4100,
        startedAt: '2026-11-17T00:00:00.000Z',
        token: expect.any(String),
      })

      await handle.release()
      await handle.release()
      await expect(stat(lockFile)).rejects.toMatchObject({ code: 'ENOENT' })
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('rejects with ProcessLockError when an existing lock belongs to a live PID', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'loom-lock-'))
    const lockFile = join(dir, 'loom.lock')
    try {
      const first = await acquireProcessLock({
        lockFile,
        port: 4200,
        now: () => '2026-11-17T00:00:01.000Z',
      })
      try {
        await expect(acquireProcessLock({
          lockFile,
          port: 4201,
          now: () => '2026-11-17T00:00:02.000Z',
        })).rejects.toMatchObject({
          name: 'ProcessLockError',
          code: 'server.data_root_locked',
          details: {
            lockFile,
            pid: process.pid,
            port: 4200,
            startedAt: '2026-11-17T00:00:01.000Z',
          },
        } satisfies Partial<ProcessLockError>)
      } finally {
        await first.release()
      }
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('replaces a stale lock whose recorded PID is no longer alive', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'loom-lock-'))
    const lockFile = join(dir, 'loom.lock')
    try {
      const deadPid = await collectDeadPid()
      await writeFile(lockFile, JSON.stringify({
        pid: deadPid,
        port: 4000,
        startedAt: '2026-11-16T00:00:00.000Z',
        token: 'stale-token',
      }), 'utf8')

      const acquired = await acquireProcessLock({
        lockFile,
        port: 4001,
        now: () => '2026-11-17T00:00:03.000Z',
      })
      try {
        const current = JSON.parse(await readFile(lockFile, 'utf8')) as { pid: number; port?: number; token: string }
        expect(current.pid).toBe(process.pid)
        expect(current.port).toBe(4001)
        expect(current.token).not.toBe('stale-token')
      } finally {
        await acquired.release()
      }
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('rejects malformed lock files and avoids unlinking locks superseded by another token', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'loom-lock-'))
    const lockFile = join(dir, 'loom.lock')
    try {
      await writeFile(lockFile, 'not-json', 'utf8')
      await expect(acquireProcessLock({
        lockFile,
        now: () => '2026-11-17T00:00:04.000Z',
      })).rejects.toBeInstanceOf(ProcessLockError)
      await rm(lockFile)

      const owned = await acquireProcessLock({
        lockFile,
        now: () => '2026-11-17T00:00:05.000Z',
      })
      await writeFile(lockFile, JSON.stringify({
        pid: process.pid,
        startedAt: '2026-11-17T00:00:06.000Z',
        token: 'replacement-owner',
      }), 'utf8')

      await owned.release()
      const surviving = JSON.parse(await readFile(lockFile, 'utf8')) as { token: string }
      expect(surviving.token).toBe('replacement-owner')
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})
