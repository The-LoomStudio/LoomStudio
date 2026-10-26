import type { DashboardPeriod, DashboardSnapshot, DashboardTone, StorageGroup } from '../widgets/dashboard/dashboard-view.js'

export type DashboardScene = 'normal' | 'empty' | 'many'
const mib = 1024 * 1024
const tones: DashboardTone[] = ['accent', 'info', 'success', 'warning', 'pink', 'cyan']
const characters = [
  ['雾港来信', '港口、旧书店，与一封未寄出的信'],
  ['秋日列车', '沿着海岸线，去下一座城市'],
  ['长夜档案', '调查员的第十三份记录'],
  ['星海旅人', '偏离航线之后的日常'],
  ['庭院里的魔女', '一些植物，一点魔法'],
  ['群星坠落之夜：在永不落幕的边境城市寻找最后一位守灯人', '长篇群像 · 多分支故事'],
]

export function createDashboardSample(scene: DashboardScene, period: DashboardPeriod): DashboardSnapshot {
  const dayCount = period === '7' ? 7 : period === '30' ? 30 : 60
  const days = Array.from({ length: dayCount }, (_, index) => {
    const date = new Date(Date.UTC(2026, 9, 25 - dayCount + index + 1)).toISOString().slice(0, 10)
    const dateIndex = Math.floor(Date.parse(date) / 86400000)
    const weight = [5, 8, 4, 0, 9, 13, 7, 11, 6, 16][dateIndex % 10]!
    return { date, input: weight * 42000, output: weight * 3400, requests: weight * 3 }
  })
  const input = days.reduce((sum, day) => sum + day.input, 0)
  const output = days.reduce((sum, day) => sum + day.output, 0)
  const requests = days.reduce((sum, day) => sum + day.requests, 0)
  const providers = [
    { provider: 'Anthropic · 主力', model: 'Claude Sonnet', share: .5, tone: 'accent' as const },
    { provider: 'OpenAI · 个人', model: 'GPT', share: .3, tone: 'info' as const },
    { provider: 'OpenRouter · 备用', model: 'Gemini Pro', share: .2, tone: 'success' as const },
  ]
  const play = Array.from({ length: scene === 'many' ? 24 : 5 }, (_, index) => {
    const character = characters[index % characters.length]!
    const sends = Math.round(dayCount * (12 / (index + 1)))
    return {
      id: `card-${index}`, name: `${character[0]}${index >= characters.length ? ` · 第 ${Math.floor(index / characters.length) + 1} 部` : ''}`,
      subtitle: character[1]!, tone: tones[index % tones.length]!, sends,
      activeDays: Math.min(dayCount, Math.max(1, Math.round(dayCount / (index + 1)))),
      stories: [
        { id: `story-${index}-a`, name: '主线 · 未完的旅程', sends: Math.ceil(sends * .7), updated: '10 月 25 日' },
        { id: `story-${index}-b`, name: '另一种可能', sends: sends - Math.ceil(sends * .7), updated: '10 月 20 日' },
      ],
    }
  })
  return {
    rangeLabel: `${days[0]!.date.replaceAll('-', '.')} — 2026.10.25`,
    days: scene === 'empty' ? [] : days,
    usage: scene === 'empty' ? [] : providers.map((provider, index) => ({
      ...provider, id: `provider-${index}`, input: Math.round(input * provider.share), output: Math.round(output * provider.share),
      requests: index === 2 ? requests - Math.round(requests * .5) - Math.round(requests * .3) : Math.round(requests * provider.share),
      unreported: index === 2 ? Math.ceil(dayCount / 4) : 0,
    })),
    play: scene === 'empty' ? [] : play,
    storage: scene === 'empty' ? [] : storageSamples(),
    resources: scene === 'empty' ? [] : [{ id: 'character', label: '角色', count: 32, unit: '个' }, { id: 'resource', label: 'Lore', count: 18, unit: '本', detail: '246 条目' }, { id: 'preset', label: '预设', count: 8, unit: '个' }, { id: 'extensions', label: '扩展 Package', count: 6, unit: '个', detail: '12 个安装目标' }],
    storageUpdatedAt: '2026.10.25 14:32', diskFreeBytes: 128.6 * 1024 * mib,
  }
}

function storageSamples(): StorageGroup[] {
  const groups: Array<Omit<StorageGroup, 'bytes'>> = [
    { id: 'database', name: '数据库', tone: 'accent', description: '结构化数据、历史修订与索引；含 WAL。', action: '查看数据管理入口', items: [
      { name: '故事与会话', description: '正文、分支、消息及调用记录', bytes: 146 * mib, count: 28416 },
      { name: '状态与工作区历史', description: '变量状态与文件树的历史版本', bytes: 92 * mib, count: 8204 },
      { name: '角色与提示词资源', description: '角色定义、世界书、预设及修订', bytes: 38 * mib, count: 1260 },
      { name: '索引、元数据与空闲页', description: '数据库内部空间', bytes: 24 * mib },
      { name: 'WAL', description: '数据库写入日志', bytes: 12 * mib },
    ] },
    { id: 'blobs', name: '素材与原始包', tone: 'info', description: '按内容去重的文件；同一素材可能被多个资源引用。', action: '管理素材', items: [
      { name: '图片与封面', description: 'PNG、WebP、GIF 等原始图片', bytes: 580 * mib, count: 428 },
      { name: '音频与视频', description: '故事附件与背景媒体', bytes: 370 * mib, count: 16 },
      { name: '导入原始包', description: '保留的原始角色包与来源文件', bytes: 240 * mib, count: 32 },
    ] },
    { id: 'cards', name: '角色目录', tone: 'success', description: '文件化角色目录中的正文、结构文件与素材副本。', action: '管理角色', items: [
      { name: '角色包文件', description: '32 个角色目录', bytes: 184 * mib, count: 32 },
    ] },
    { id: 'extensions', name: '扩展数据', tone: 'warning', description: '扩展持久保存的文件数据。', action: '管理扩展', items: [
      { name: '故事记忆', description: '扩展文件数据', bytes: 42 * mib },
      { name: '其他扩展', description: '全局与角色范围的数据', bytes: 26 * mib },
    ] },
    { id: 'backups', name: '备份', tone: 'pink', description: '保留的数据库快照。', action: '查看备份', items: [
      { name: '升级前快照', description: '2026.10.18', bytes: 244 * mib },
      { name: '手动快照', description: '2026.10.24', bytes: 268 * mib },
    ] },
    { id: 'cache', name: '缓存', tone: 'cyan', description: '扩展运行时临时文件。', action: '查看缓存管理入口', items: [
      { name: '运行时缓存', description: '扩展实例暂存的文件', bytes: 48 * mib },
    ] },
    { id: 'logs', name: '日志', tone: 'muted', description: '用于排查问题的运行日志。', action: '打开日志', items: [
      { name: '运行日志', description: '最近 14 天 · JSONL', bytes: 18 * mib, count: 14 },
    ] },
  ]
  return groups.map(group => ({ ...group, bytes: group.items.reduce((sum, item) => sum + item.bytes, 0) }))
}
