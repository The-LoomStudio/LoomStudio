import { useState } from 'react'
import { Button } from '@loom-studio/ui'
import { ArrowLeft, ChartNoAxesCombined, Feather, RotateCcw } from 'lucide-react'
import { StartupReady } from '../app/startup-curtain.js'
import { DashboardDialog } from '../widgets/dashboard/dashboard-panel.js'
import type { DashboardAction, DashboardPeriod } from '../widgets/dashboard/dashboard-view.js'
import { createDashboardSample, type DashboardScene } from './dashboard-fixtures.js'
import styles from './dashboard-preview.module.scss'

export function DashboardPreview() {
  const [open, setOpen] = useState(true)
  const [scene, setScene] = useState<DashboardScene>(() => {
    const query = new URLSearchParams(window.location.search).get('scene')
    return query === 'empty' || query === 'many' ? query : 'normal'
  })
  const [period, setPeriod] = useState<DashboardPeriod>('30')
  const [revision, setRevision] = useState(0)
  const [destination, setDestination] = useState<DashboardAction>()
  const data = createDashboardSample(scene, period)

  function reset() { setRevision(value => value + 1); setDestination(undefined); setPeriod('30') }

  return <main className={styles.host}>
    <StartupReady />
    <header className={styles.toolbar}><span><Feather size={18} />LoomStudio <small>Dashboard · DEV PREVIEW</small></span><Button onClick={() => setOpen(true)}><ChartNoAxesCombined size={16} />数据总览</Button></header>
    <div className={styles.workspace}>
      {destination ? <section className={styles.destination} aria-live="polite"><Button size="small" onClick={() => setDestination(undefined)}><ArrowLeft size={14} />返回故事</Button><span className={styles.kicker}>快捷管理 · 模拟落点</span><h1>{destination.label}</h1><p>Dashboard 已关闭，这里代表对应的工作区入口。草稿不读取或修改真实资源。</p><Button onClick={() => setOpen(true)}><ChartNoAxesCombined size={15} />重新打开数据总览</Button></section> : <section className={styles.story}><span className={styles.kicker}>工作区背景 · 模拟故事</span><h1>雾港来信</h1><p className={styles.subtitle}>主线 · 未完的旅程</p><div className={styles.prose}><p>雨停的时候，港口的灯刚刚亮起。</p><p>你在旧书店门前停下。窗后的那个人抬起头，像是已经等了很久。柜台上放着一封信，信封没有署名，只有一枚褪色的邮戳。</p><p>“今天还要继续读下去吗？”</p></div><div className={styles.help}><ChartNoAxesCombined size={18} /><p>数据总览作为临时浮层打开。<br />关闭后，仍然回到这段故事。</p><Button onClick={() => setOpen(true)}>打开数据总览</Button></div></section>}
    </div>
    <DashboardDialog key={`${scene}-${revision}`} open={open} onClose={() => setOpen(false)} data={data} period={period} onPeriodChange={setPeriod}
      onAction={action => { setDestination(action); setOpen(false) }}
      headerActions={<div className={styles.previewControls}><span>模拟数据</span><select aria-label="预览数据场景" value={scene} onChange={event => { setScene(event.target.value as DashboardScene); setDestination(undefined) }}><option value="normal">正常</option><option value="empty">空数据</option><option value="many">较多角色</option></select><Button size="small" variant="ghost" onClick={reset} aria-label="重置 Dashboard 样例" title="重置样例"><RotateCcw size={14} /></Button></div>} />
  </main>
}
