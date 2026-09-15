import { describe, expect, it } from 'vitest'
import { createSqliteDataEngine } from '../../packages/data-engine/src/sqlite.js'

describe('SQLite concurrent transaction stress and SLA gate', () => {
  it('handles 50 concurrent transactions through FIFO queue with zero data loss within SLA', async () => {
    let sequence = 0
    const createId = (prefix: string) => `${prefix}-${++sequence}`
    const now = () => new Date().toISOString()

    const engine = createSqliteDataEngine({
      filename: ':memory:',
      createId,
      now,
    })

    // 运行初始迁移，创建压测表
    engine.migrate({
      namespace: 'test.stress',
      migrations: [
        {
          version: 1,
          migrate: db => {
            db.exec(`
              CREATE TABLE stress_records (
                id TEXT PRIMARY KEY,
                worker_id INTEGER NOT NULL,
                counter INTEGER NOT NULL,
                payload TEXT NOT NULL
              );
            `)
          },
        },
      ],
    })

    const concurrency = 50
    const startTime = performance.now()

    // 50 个并发异步事务同时发起
    const tasks = Array.from({ length: concurrency }, async (_, workerId) => {
      return engine.transact(
        {
          actor: { kind: 'system' },
          reason: `stress worker ${workerId}`,
        },
        async tx => {
          const id = `stress-${workerId}`
          tx.database
            .prepare(
              'INSERT INTO stress_records (id, worker_id, counter, payload) VALUES (?, ?, ?, ?)',
            )
            .run(id, workerId, workerId * 10, `payload-from-worker-${workerId}`)

          tx.recordOperations([
            {
              type: 'document.create',
              entityId: id,
              payload: { workerId },
            },
          ])

          return { workerId, success: true }
        },
      )
    })

    // 等待所有并发事务全部完成
    const results = await Promise.all(tasks)
    const elapsedMs = performance.now() - startTime

    // 1. 50 个并发事务全部成功且产生合法的 commit fact
    expect(results).toHaveLength(concurrency)
    for (const res of results) {
      expect(res.value.success).toBe(true)
      expect(res.commit.changesetId).toBeDefined()
    }

    // 2. 验证数据行完全持久化，零丢失
    const countRow = engine.database
      .prepare('SELECT COUNT(*) as total FROM stress_records')
      .get() as { total: number }
    expect(countRow.total).toBe(concurrency)

    // 3. 验证事务操作记录的完整性
    const changesetRows = engine.database
      .prepare('SELECT COUNT(*) as total FROM changesets')
      .get() as { total: number }
    expect(changesetRows.total).toBe(concurrency)

    // 4. 硬性性能门线：50 个内存事务串行排队处理总时间必须小于 500ms（平均单事务 < 10ms）
    expect(elapsedMs).toBeLessThan(500)

    engine.close()
  })
})
