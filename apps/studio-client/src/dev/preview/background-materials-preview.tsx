import { useState } from 'react'
import { Check, Image as ImageIcon, Info, SlidersHorizontal, Sparkles, Volume2 } from 'lucide-react'
import styles from './background-materials-preview.module.scss'

type BackgroundItem = {
  id: string
  name: string
  description: string
  source: string
  image: string
  status: 'active' | 'available' | 'missing'
}

const backgrounds: BackgroundItem[] = [
  { id: 'harbor', name: '黄昏港口', description: '适合海港、码头与临海城市场景', source: '角色卡 · 四方世界', image: '/images/default-card.png', status: 'active' },
  { id: 'forest', name: '雾中森林', description: '低对比度的林地背景', source: '官方背景', image: '/images/default-card.png', status: 'available' },
  { id: 'missing', name: '旧城夜景', description: '来源扩展已卸载', source: 'Extension · old-town', image: '', status: 'missing' },
]

export function BackgroundMaterialsPreview() {
  const [tab, setTab] = useState<'background' | 'material'>('background')
  const [selected, setSelected] = useState('harbor')
  const [followState, setFollowState] = useState(true)
  const [mode, setMode] = useState<'solid' | 'glass'>('glass')
  const [blur, setBlur] = useState(18)
  const current = backgrounds.find(item => item.id === selected) ?? backgrounds[0]

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <div><small>设置 · 外观</small><h1>背景与材质</h1><p>背景决定显示什么，材质决定前景如何呈现。</p></div>
        <div className={styles.tabs} role="tablist" aria-label="外观设置">
          <button aria-selected={tab === 'background'} role="tab" type="button" onClick={() => setTab('background')}><ImageIcon size={15} />背景</button>
          <button aria-selected={tab === 'material'} role="tab" type="button" onClick={() => setTab('material')}><SlidersHorizontal size={15} />材质</button>
        </div>
      </header>
      {tab === 'background' ? (
        <section className={styles.body}>
          <div className={styles.controls}>
            <div className={styles.controlHeader}><div><h2>背景库</h2><p>横图预览 · 3 个已注册背景</p></div><label className={styles.switch}><input checked={followState} type="checkbox" onChange={event => setFollowState(event.target.checked)} /><span /><b>跟随 AI 场景切换</b></label></div>
            <div className={styles.info}><Info size={15} />开启后将读取当前世界 State 的活动背景；关闭后保留当前场景状态，但界面不再自动切换。</div>
            <div className={styles.grid}>{backgrounds.map(item => <button aria-pressed={selected === item.id} className={styles.card} key={item.id} type="button" onClick={() => item.status !== 'missing' && setSelected(item.id)}>
              <div className={styles.thumbnail}>{item.image ? <img alt="" src={item.image} /> : <span>资源不可用</span>}{selected === item.id && item.status !== 'missing' ? <i><Check size={14} /></i> : null}</div>
              <div className={styles.cardText}><strong>{item.name}</strong><span>{item.description}</span><small>{item.source}</small></div>
              {item.status === 'missing' ? <em>已失效</em> : null}
            </button>)}</div>
          </div>
          <aside className={styles.preview}>
            <div className={styles.previewImage}>{current.image ? <img alt="" src={current.image} /> : <span>没有可预览的背景</span>}<div><small>当前背景</small><strong>{current.name}</strong></div></div>
            <div className={styles.summary}><span>材质</span><strong>{mode === 'glass' ? `毛玻璃 · ${blur}px` : '实色'}</strong><button type="button" onClick={() => setTab('material')}>调整材质</button></div>
            <div className={styles.summary}><span>自动切换</span><strong>{followState ? '已开启' : '已关闭'}</strong></div>
          </aside>
        </section>
      ) : (
        <section className={styles.materialBody}>
          <div className={styles.materialMain}>
            <div className={styles.sectionTitle}><div><h2>前景材质</h2><p>仅影响明确标记为宿主材质层的区域。</p></div><Sparkles size={18} /></div>
            <div className={styles.choiceRow}><button aria-pressed={mode === 'solid'} className={mode === 'solid' ? styles.choiceActive : ''} type="button" onClick={() => setMode('solid')}><span className={styles.solidSample} />实色</button><button aria-pressed={mode === 'glass'} className={mode === 'glass' ? styles.choiceActive : ''} type="button" onClick={() => setMode('glass')}><span className={styles.glassSample} />毛玻璃</button></div>
            <label className={styles.range}><span><b>模糊强度</b><output>{blur}px</output></span><input disabled={mode === 'solid'} max="32" min="0" type="range" value={blur} onChange={event => setBlur(Number(event.target.value))} /></label>
            <label className={styles.range}><span><b>表面透明度</b><output>62%</output></span><input disabled={mode === 'solid'} max="100" min="20" type="range" defaultValue="62" /></label>
            <div className={styles.info}><Info size={15} />没有可见背景时，毛玻璃通常不会产生明显效果。关闭背景不会清除材质偏好。</div>
          </div>
          <aside className={styles.materialPreview}>
            <div className={`${styles.mockStage} ${mode === 'glass' ? styles.mockGlass : styles.mockSolid}`}><div className={styles.mockTop}><span><ImageIcon size={14} />背景预览</span><Volume2 size={14} /></div><div className={styles.mockContent}><small>CONTENT SURFACE</small><strong>文字与交互保持清晰</strong><p>材质只改变表面，不改变内容颜色和焦点。</p></div></div>
            <div className={styles.legend}><span /><span /><span /><small>chrome · content · floating</small></div>
          </aside>
        </section>
      )}
    </main>
  )
}
