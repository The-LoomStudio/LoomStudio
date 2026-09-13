import { randomUUID } from 'node:crypto'
import { mkdir, rename, unlink, writeFile } from 'node:fs/promises'
import { mkdirSync, renameSync, unlinkSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'

function temporaryFilename(filename: string): string {
  return `${filename}.${process.pid}.${randomUUID()}.tmp`
}

export function writeJsonAtomicallySync(filename: string, value: unknown): void {
  mkdirSync(dirname(filename), { recursive: true })
  const temporary = temporaryFilename(filename)
  try {
    writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 })
    renameSync(temporary, filename)
  } catch (error) {
    try {
      unlinkSync(temporary)
    } catch {
      // Preserve the original write or rename error.
    }
    throw error
  }
}

export async function writeJsonAtomically(filename: string, value: unknown): Promise<void> {
  await mkdir(dirname(filename), { recursive: true })
  const temporary = temporaryFilename(filename)
  try {
    await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 })
    await rename(temporary, filename)
  } catch (error) {
    await unlink(temporary).catch(() => undefined)
    throw error
  }
}
