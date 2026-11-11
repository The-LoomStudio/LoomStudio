import type { SqliteDataEngine, SqliteDataTransaction } from '@loom-studio/data-engine'
import type { TokenUsage } from '@loom-studio/tokenizer/contracts'

export type StatisticsRange = { from?: string; to: string; timeZone: string }
export type UsageIdentity = {
  id: string; providerProfileId: string; providerId: string; providerName: string; modelId?: string
  capabilityId?: string; purpose: string; simulated: boolean; sessionId?: string; timelineId?: string; cardId?: string
}
const fields = ['inputTokens', 'outputTokens', 'totalTokens', 'cacheReadTokens', 'cacheWriteTokens', 'reasoningTokens'] as const
export type UsageTotals = { requests: number; reported: number; unreported: number; unknown: number; input: number; output: number; total: number; inputReported: number; outputReported: number; totalReported: number; cacheRead: number; cacheWrite: number; reasoning: number }
const actor = { kind: 'kernel' as const, id: 'application.statistics' }
const totalsSql = `COUNT(*) AS requests, COUNT(usage_json) AS reported, COALESCE(SUM(usage_json IS NULL), 0) AS unreported,
  COALESCE(SUM(status = 'unknown'), 0) AS unknown,
  COALESCE(SUM(json_extract(usage_json, '$.inputTokens')), 0) AS input,
  COALESCE(SUM(json_extract(usage_json, '$.outputTokens')), 0) AS output,
  COALESCE(SUM(COALESCE(json_extract(usage_json, '$.totalTokens'), json_extract(usage_json, '$.inputTokens') + json_extract(usage_json, '$.outputTokens'))), 0) AS total,
  COUNT(json_extract(usage_json, '$.inputTokens')) AS inputReported, COUNT(json_extract(usage_json, '$.outputTokens')) AS outputReported,
  COUNT(COALESCE(json_extract(usage_json, '$.totalTokens'), json_extract(usage_json, '$.inputTokens') + json_extract(usage_json, '$.outputTokens'))) AS totalReported,
  COALESCE(SUM(json_extract(usage_json, '$.cacheReadTokens')), 0) AS cacheRead,
  COALESCE(SUM(json_extract(usage_json, '$.cacheWriteTokens')), 0) AS cacheWrite,
  COALESCE(SUM(json_extract(usage_json, '$.reasoningTokens')), 0) AS reasoning`

export function createStatisticsStore(engine: SqliteDataEngine, now: () => string, onError?: (error: unknown) => void) {
  engine.initializeSchema({ namespace: 'application.statistics', version: 1, initialize(db) {
    db.exec(`CREATE TABLE statistics_metadata (id INTEGER PRIMARY KEY CHECK(id = 1), started_at TEXT NOT NULL);
      CREATE TABLE usage_requests (id TEXT PRIMARY KEY, started_at TEXT NOT NULL, ended_at TEXT,
        provider_profile_id TEXT NOT NULL, provider_id TEXT NOT NULL, provider_name TEXT NOT NULL, model_id TEXT, capability_id TEXT,
        purpose TEXT NOT NULL, simulated INTEGER NOT NULL, session_id TEXT, timeline_id TEXT, card_id TEXT,
        status TEXT NOT NULL, usage_json TEXT, provider_call_id TEXT);
      CREATE INDEX usage_requests_time ON usage_requests(started_at, id);
      CREATE TABLE play_interactions (id TEXT PRIMARY KEY, created_at TEXT NOT NULL, session_id TEXT, timeline_id TEXT, card_id TEXT, kind TEXT NOT NULL);
      CREATE INDEX play_interactions_time ON play_interactions(created_at, id);`)
    db.prepare('INSERT INTO statistics_metadata VALUES (1, ?)').run(now())
  } })
  const formatters = new Map<string, Intl.DateTimeFormat>()
  engine.database.function('statistics_date', (date, zone) => {
    const timeZone = String(zone)
    let formatter = formatters.get(timeZone)
    if (!formatter) {
      formatter = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' })
      if (formatters.size >= 16) formatters.clear()
      formatters.set(timeZone, formatter)
    }
    return formatter.format(new Date(String(date)))
  })
  // A previous process cannot still finish these calls. Never retry the remote request.
  const recovery = engine.read(db => Number(db.prepare("SELECT COUNT(*) AS n FROM usage_requests WHERE status = 'running'").get()!.n))
    .then(async count => { if (count) await engine.transact({ actor, reason: 'statistics.recover' }, async tx => {
      tx.database.prepare("UPDATE usage_requests SET status = 'unknown' WHERE status = 'running'").run()
      tx.recordOperations([{ store: 'statistics', kind: 'update', entityId: 'usage-recovery', entityType: 'statistics.usage' }])
    }) })
  // Attach a rejection handler immediately; query/capture callers still receive the failure.
  void recovery.catch(() => {})
  let collectionErrors = 0
  async function capture(work: () => Promise<unknown>) {
    try { await recovery; await work(); return true } catch (error) { collectionErrors += 1;
      try { onError?.(error) } catch { /* Diagnostics cannot interrupt the model call. */ }
      return false }
  }
  const write = (id: string, reason: string, work: (tx: SqliteDataTransaction) => void) => engine.transact({ actor, reason }, async tx => {
    work(tx)
    tx.recordOperations([{ store: 'statistics', kind: 'update', entityId: id, entityType: 'statistics.usage' }])
  })
  async function track<T>(identity: UsageIdentity, operation: (report: (usage: TokenUsage, providerCallId?: string) => void) => Promise<T>, signal?: AbortSignal): Promise<T> {
    let usage: TokenUsage | undefined
    let providerCallId: string | undefined
    const report = (value: TokenUsage, callId?: string) => {
      const next: TokenUsage = { ...usage }
      for (const key of fields) {
        const count = value[key]
        if (count !== undefined) {
          if (!Number.isSafeInteger(count) || count < 0) { collectionErrors += 1; continue }
          next[key] = count
        }
      }
      if (Object.keys(next).length) usage = next
      if (callId) providerCallId = callId
    }
    const began = await capture(() => write(identity.id, 'statistics.usage.begin', tx => {
      const session = identity.sessionId ? tx.database.prepare(`SELECT s.id, s.timeline_id, t.created_from_card_id
        FROM agent_sessions s LEFT JOIN narrative_timelines t ON t.id = s.timeline_id WHERE s.id = ?`).get(identity.sessionId) : undefined
      identity = { ...identity, sessionId: identity.sessionId,
        timelineId: identity.timelineId ?? (session?.timeline_id ? String(session.timeline_id) : undefined),
        cardId: identity.cardId ?? (session?.created_from_card_id ? String(session.created_from_card_id) : undefined) }

      tx.database.prepare(`INSERT INTO usage_requests (id, started_at, provider_profile_id, provider_id, provider_name,
        model_id, capability_id, purpose, simulated, session_id, timeline_id, card_id, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'running')`)
        .run(identity.id, now(), identity.providerProfileId, identity.providerId, identity.providerName, identity.modelId ?? null,
          identity.capabilityId ?? null, identity.purpose, Number(identity.simulated), identity.sessionId ?? null, identity.timelineId ?? null, identity.cardId ?? null)
    }))
    let status = 'completed'
    try { return await operation(report) } catch (error) {
      status = signal?.aborted || (error instanceof Error && error.name === 'AbortError') ? 'cancelled' : 'failed'
      throw error
    } finally {
      if (status === 'completed' && signal?.aborted) status = 'cancelled'
      if (began) await capture(() => write(identity.id, 'statistics.usage.finish', tx => {
        tx.database.prepare('UPDATE usage_requests SET status = ?, ended_at = ?, usage_json = ?, provider_call_id = ? WHERE id = ?')
          .run(status, now(), usage ? JSON.stringify(usage) : null, providerCallId ?? null, identity.id)
      }))
    }
  }
  return {
    track,
    async usageRequests(input: StatisticsRange & { providerProfileId: string; limit: number; cursor?: { startedAt: string; id: string } }) {
      await recovery
      return engine.read(db => {
        const startedAt = String(db.prepare('SELECT started_at FROM statistics_metadata WHERE id = 1').get()!.started_at)
        const rows = db.prepare(`SELECT id, started_at AS startedAt, ended_at AS endedAt, model_id AS modelId,
          capability_id AS capabilityId, purpose, status, usage_json AS usageJson FROM usage_requests
          WHERE started_at >= ? AND started_at < ? AND provider_profile_id = ? AND simulated = 0
          AND (? IS NULL OR started_at < ? OR (started_at = ? AND id < ?))
          ORDER BY started_at DESC, id DESC LIMIT ?`).all(input.from ?? startedAt, input.to, input.providerProfileId,
            input.cursor?.startedAt ?? null, input.cursor?.startedAt ?? null, input.cursor?.startedAt ?? null,
            input.cursor?.id ?? null, input.limit + 1) as unknown as Array<{ id: string; startedAt: string; endedAt: string | null; modelId: string | null; capabilityId: string | null; purpose: string; status: string; usageJson: string | null }>
        const hasMore = rows.length > input.limit
        const items = rows.slice(0, input.limit).map(({ usageJson, ...row }) => ({ ...row, usage: usageJson ? JSON.parse(usageJson) as TokenUsage : null }))
        const last = items.at(-1)
        return { items, nextCursor: hasMore && last ? { startedAt: last.startedAt, id: last.id } : undefined }
      })
    },
    async usage(input: StatisticsRange & { includeSimulated?: boolean }) {
      await recovery
      return engine.read(db => {
        const startedAt = String(db.prepare('SELECT started_at FROM statistics_metadata WHERE id = 1').get()!.started_at)
        const from = input.from ?? startedAt
        const conditions = 'started_at >= ? AND started_at < ? AND (? = 1 OR simulated = 0)'
        const values = [from, input.to, Number(input.includeSimulated ?? false)]
        const bucket = Date.parse(input.to) - Date.parse(from) > 366 * 86400000 ? "substr(statistics_date(started_at, ?), 1, 7)" : 'statistics_date(started_at, ?)'
        return {
          collectionStartedAt: startedAt, collectionErrors, asOf: now(),
          totals: db.prepare(`SELECT ${totalsSql} FROM usage_requests WHERE ${conditions}`).get(...values) as unknown as UsageTotals,
          providers: db.prepare(`SELECT provider_profile_id AS id, provider_name AS name, provider_id AS providerId, model_id AS modelId, capability_id AS capabilityId, ${totalsSql} FROM usage_requests WHERE ${conditions} GROUP BY provider_profile_id, model_id, capability_id ORDER BY total DESC`).all(...values) as unknown as Array<UsageTotals & { id: string; name: string; providerId: string; modelId: string | null; capabilityId: string | null }>,
          days: db.prepare(`SELECT ${bucket} AS date, ${totalsSql} FROM usage_requests WHERE ${conditions} GROUP BY date ORDER BY date`).all(input.timeZone, ...values) as unknown as Array<UsageTotals & { date: string }>,
          breakdown: db.prepare(`SELECT ${bucket} AS date, provider_profile_id AS providerId, provider_name AS providerName, model_id AS modelId, ${totalsSql} FROM usage_requests WHERE ${conditions} GROUP BY date, provider_profile_id, model_id ORDER BY date`).all(input.timeZone, ...values) as unknown as Array<UsageTotals & { date: string; providerId: string; providerName: string; modelId: string | null }>,
        }
      })
    },
    async resources() {
      return engine.read(db => {
        const count = (sql: string) => Number(db.prepare(sql).get()!.n)
        const documents = db.prepare('SELECT type, COUNT(*) AS n FROM documents WHERE tombstoned = 0 GROUP BY type').all() as Array<{ type: string; n: number }>
        const byType = new Map(documents.map(row => [row.type, row.n]))
        const resource = (kind: string) => Number(db.prepare('SELECT COUNT(*) AS n FROM prompt_resources WHERE tombstoned = 0 AND resource_kind = ?').get(kind)!.n)
        return { asOf: now(), items: [
          { id: 'character', label: '角色', count: byType.get('airp.cardSource') ?? 0, unit: '个' },
          { id: 'resource', label: 'Lore', count: resource('lore'), unit: '本', detail: `${count("SELECT COUNT(*) AS n FROM prompt_resource_nodes n JOIN prompt_resources r ON r.id = n.resource_id WHERE r.tombstoned = 0 AND r.resource_kind = 'lore' AND n.kind = 'entry'")} 条目` },
          { id: 'preset', label: '预设', count: resource('preset'), unit: '个' },
          { id: 'extensions', label: '扩展 Package', count: count("SELECT COUNT(DISTINCT json_extract(content_json, '$.packageId')) AS n FROM documents WHERE tombstoned = 0 AND type = 'airp.extensionInstallation'"), unit: '个', detail: `${byType.get('airp.extensionInstallation') ?? 0} 个安装目标` },
          { id: 'scripts', label: 'Loom Script', count: byType.get('airp.loomScript') ?? 0, unit: '份' },
          { id: 'text-transform', label: '正则规则', count: byType.get('airp.textTransformRule') ?? 0, unit: '条' },
          { id: 'extractors', label: '提取器', count: byType.get('airp.textExtractor') ?? 0, unit: '个' },
          { id: 'media', label: '媒体素材', count: count('SELECT COUNT(*) AS n FROM media_assets'), unit: '份' },
          { id: 'timelines', label: '故事', count: count('SELECT COUNT(*) AS n FROM narrative_timelines WHERE tombstoned = 0'), unit: '个' },
          { id: 'sessions', label: '独立会话', count: count("SELECT COUNT(*) AS n FROM agent_sessions WHERE tombstoned = 0 AND kind = 'agent'"), unit: '个' },
        ] }
      })
    },
    async play(input: StatisticsRange) {
      return engine.read(db => {
        const startedAt = String(db.prepare('SELECT started_at FROM statistics_metadata WHERE id = 1').get()!.started_at)
        const rows = db.prepare(`SELECT p.card_id AS id, COUNT(*) AS sends, COUNT(DISTINCT statistics_date(p.created_at, ?)) AS days,
          MAX(p.created_at) AS lastSent, COALESCE(json_extract(d.content_json, '$.name'), '已删除角色 / 未关联角色') AS name, d.id IS NOT NULL AS available
          FROM play_interactions p LEFT JOIN documents d ON d.id = p.card_id AND d.tombstoned = 0
          WHERE p.created_at >= ? AND p.created_at < ? GROUP BY p.card_id ORDER BY sends DESC`).all(input.timeZone, input.from ?? startedAt, input.to) as unknown as Array<{ id: string | null; sends: number; days: number; lastSent: string; name: string; available: number }>
        const stories = db.prepare(`SELECT t.id, t.title AS name, t.created_from_card_id AS cardId, t.updated_at AS updated,
          COUNT(p.id) AS sends FROM narrative_timelines t LEFT JOIN play_interactions p ON p.timeline_id = t.id AND p.created_at >= ? AND p.created_at < ?
          WHERE t.tombstoned = 0 GROUP BY t.id ORDER BY t.updated_at DESC`).all(input.from ?? startedAt, input.to) as unknown as Array<{ id: string; name: string | null; cardId: string | null; updated: string; sends: number }>
        return { collectionStartedAt: startedAt, asOf: now(), rows: rows.map(row => ({ ...row, stories: stories.filter(story => story.cardId === row.id) })) }
      })
    },
  }
}

/** Called only from the accepted user-input transaction, never from generic message writes. */
export function recordUserInteraction(tx: SqliteDataTransaction, input: { id: string; timelineId?: string; sessionId?: string; kind: string }) {
  // Other hosts and historical migrations need not opt into statistics.
  if (!tx.database.prepare("SELECT 1 FROM sqlite_schema WHERE name = 'play_interactions'").get()) return
  const timelineId = input.timelineId ?? (input.sessionId ? tx.database.prepare('SELECT timeline_id FROM agent_sessions WHERE id = ?').get(input.sessionId)?.timeline_id as string | null : undefined)
  const cardId = timelineId ? tx.database.prepare('SELECT created_from_card_id FROM narrative_timelines WHERE id = ?').get(timelineId)?.created_from_card_id : null
  const result = tx.database.prepare('INSERT OR IGNORE INTO play_interactions (id, created_at, session_id, timeline_id, card_id, kind) VALUES (?, ?, ?, ?, ?, ?)')
    .run(input.id, tx.createdAt, input.sessionId ?? null, timelineId ?? null, cardId == null ? null : String(cardId), input.kind)
  if (result.changes) tx.recordOperations([{ store: 'statistics', kind: 'create', entityId: input.id, entityType: 'statistics.interaction' }])
}
export type StatisticsStore = ReturnType<typeof createStatisticsStore>
