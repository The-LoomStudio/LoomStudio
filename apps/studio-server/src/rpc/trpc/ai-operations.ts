import type { ProfiledAiGateway } from '@loom-studio/ai-gateway'

type GatewayRun = ReturnType<ProfiledAiGateway['createRun']>
const runStores = new WeakMap<ProfiledAiGateway, Map<string, GatewayRun>>()
const maxRetainedRuns = 128

export function retainAiGatewayRun(gateway: ProfiledAiGateway, run: GatewayRun): void {
  const runs = getRunStore(gateway)
  runs.set(run.id, run)
  void run.result.catch(() => undefined).finally(() => pruneCompletedRuns(runs))
}

export function requireAiGatewayRun(gateway: ProfiledAiGateway, runId: string): GatewayRun {
  const run = getRunStore(gateway).get(runId)
  if (!run) throw new Error(`Gateway run not found: ${runId}`)
  return run
}

function pruneCompletedRuns(runs: Map<string, GatewayRun>): void {
  if (runs.size <= maxRetainedRuns) return
  for (const [runId, run] of runs) {
    if (runs.size <= maxRetainedRuns) return
    if (run.getState() === 'running') continue
    runs.delete(runId)
  }
}

function getRunStore(gateway: ProfiledAiGateway): Map<string, GatewayRun> {
  const existing = runStores.get(gateway)
  if (existing) return existing
  const created = new Map<string, GatewayRun>()
  runStores.set(gateway, created)
  return created
}
