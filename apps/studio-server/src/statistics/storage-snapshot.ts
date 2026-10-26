import { lstat, readdir, statfs } from 'node:fs/promises'
import { join, resolve, sep } from 'node:path'
import type { LoomStudioLocalPaths } from '../platform/local-paths.js'

const categories = [
  ['database', '数据库文件'], ['blobs', '素材与原始包'], ['cards', '角色目录'], ['extensions', '扩展数据'],
  ['backups', '备份'], ['cache', '缓存'], ['logs', '日志'], ['other', '配置与其他'],
] as const
export function createStorageSnapshot(paths: LoomStudioLocalPaths, databaseFile: string) {
  const dbFiles = databaseFile === ':memory:' ? [] : [databaseFile, `${databaseFile}-wal`, `${databaseFile}-shm`].map(resolvePath)
  const roots = [...new Set([paths.dataRoot, paths.cacheRoot, paths.logRoot].map(resolvePath))]
  const assignments = [
    [paths.blobRoot, 'blobs'], [join(paths.dataRoot, 'characters'), 'cards'], [paths.extensionRoot, 'extensions'],
    [paths.backupRoot, 'backups'], [paths.cacheRoot, 'cache'], [paths.logRoot, 'logs'],
  ].map(([path, id]) => ({ path: resolve(path!), id: id! })).sort((a, b) => b.path.length - a.path.length)
  type Snapshot = Awaited<ReturnType<typeof scan>>
  let cached: { at: number; value: Snapshot } | undefined
  let running: Promise<Snapshot> | undefined
  async function scan() {
    const started = Date.now()
    const groups = categories.map(([id, name]) => ({ id, name, bytes: 0, files: 0 }))
    const errors: string[] = []
    const seen = new Set<string>()
    const queue = [...roots, ...dbFiles]
    while (queue.length) {
      if (seen.size >= 100000 || Date.now() - started > 5000) { errors.push('扫描达到预算，结果不完整；可稍后刷新。'); break }
      const path = queue.pop()!
      if (seen.has(path)) continue
      seen.add(path)
      try {
        const info = await lstat(path)
        if (info.isSymbolicLink()) { errors.push('已跳过符号链接，链接目标不计入。'); continue }
        if (info.isDirectory()) { for (const name of await readdir(path)) queue.push(join(path, name)); continue }
        if (!info.isFile()) continue
        const id = dbFiles.includes(path) ? 'database' : assignments.find(item => path === item.path || path.startsWith(item.path + sep))?.id ?? 'other'
        const group = groups.find(item => item.id === id)!
        group.bytes += info.size
        group.files += 1
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT' || !roots.includes(path) && !dbFiles.slice(1).includes(path)) errors.push('部分文件不可读或扫描期间发生变化。')
      }
    }
    const volumes: Array<{ label: string; isDataVolume: boolean; freeBytes: number }> = []
    const devices = new Set<number>()
    for (const [index, root] of roots.entries()) {
      try {
        const info = await lstat(root)
        if (devices.has(info.dev)) continue
        const disk = await statfs(root)
        devices.add(info.dev)
        volumes.push({ isDataVolume: index === 0, label: index === 0 ? '数据目录所在磁盘' : '缓存 / 日志所在磁盘', freeBytes: disk.bavail * disk.bsize })
      } catch (error) {
        // Optional cache/log directories may not have been created yet.
        if (index > 0 && (error as NodeJS.ErrnoException).code === 'ENOENT') continue
        errors.push(`无法读取${index === 0 ? '数据' : root === resolve(paths.cacheRoot) ? '缓存' : '日志'}目录所在磁盘的剩余容量；文件占用统计单独显示。`)
      }
    }
    return { groups, volumes, startedAt: new Date(started).toISOString(), asOf: new Date().toISOString(), errors: [...new Set(errors)], complete: !errors.length }
  }
  return async (refresh = false) => {
    if (running) return running
    if (!refresh && cached && Date.now() - cached.at < 60000) return cached.value
    running = scan().then(value => { cached = { at: Date.now(), value }; return value }).finally(() => { running = undefined })
    return running
  }
}
function resolvePath(path: string) { return resolve(path) }
