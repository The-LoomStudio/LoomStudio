import * as React from 'react'

export type SliderProps = {
  /** 轨道内显示的文本标签 */
  label?: string
  /** 左侧图标插槽（扩展能力） */
  icon?: React.ReactNode
  /** 受控数值 */
  value?: number
  /** 默认非受控数值 */
  defaultValue?: number
  /** 数值变动回调 */
  onValueChange?: (value: number) => void
  /** 最小值，默认 0 */
  min?: number
  /** 最大值，默认 1 */
  max?: number
  /** 步长，默认 0.01 */
  step?: number
  /** 自定义数值展示格式化函数，例如 (v) => `${v}%` */
  formatValue?: (value: number) => string
  /** 是否禁用 */
  disabled?: boolean
  /** 自定义容器类名 */
  className?: string
  /** 无障碍标签 */
  'aria-label'?: string
}

// 物理与手感常量，精确对齐原版 Elastic Slider 体验
const CLICK_THRESHOLD = 3
const DEAD_ZONE = 32
const MAX_CURSOR_RANGE = 200
const MAX_STRETCH = 8

const HANDLE_BUFFER = 8
const LABEL_OFFSET = 14 + 4
const VALUE_OFFSET = 14 - 8

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v))
}

function decimalsForStep(step: number): number {
  const s = step.toString()
  const dot = s.indexOf('.')
  return dot === -1 ? 0 : s.length - dot - 1
}

function roundValue(val: number, step: number): number {
  const raw = Math.round(val / step) * step
  return parseFloat(raw.toFixed(decimalsForStep(step)))
}

// 磁吸对齐：连续滑块在接近 10% 刻度（±3.125% 范围内）时吸附至最近的十分位点
function snapToDecile(rawValue: number, min: number, max: number): number {
  const range = max - min
  if (range <= 0) return rawValue
  const normalized = (rawValue - min) / range
  const nearest = Math.round(normalized * 10) / 10
  if (Math.abs(normalized - nearest) <= 0.03125) {
    return min + nearest * range
  }
  return rawValue
}

interface SpringOptions {
  stiffness?: number
  damping?: number
  mass?: number
  velocity?: number
  threshold?: number
}

// 零依赖高性能 RAF 弹簧积分器（用于点击滑行与橡皮筋回弹）
function runSpring(
  from: number,
  to: number,
  onUpdate: (value: number) => void,
  onComplete?: () => void,
  options: SpringOptions = {}
): () => void {
  if (typeof window === 'undefined' || typeof requestAnimationFrame === 'undefined') {
    onUpdate(to)
    onComplete?.()
    return () => {}
  }

  const stiffness = options.stiffness ?? 300
  const damping = options.damping ?? 25
  const mass = options.mass ?? 0.8
  const threshold = options.threshold ?? 0.05

  let current = from
  let velocity = options.velocity ?? 0
  let lastTime = performance.now()
  let stopped = false
  let rafId: number | null = null

  const step = (now: number) => {
    if (stopped) return

    const dt = Math.min((now - lastTime) / 1000, 0.064)
    lastTime = now

    // 4 阶半隐式欧拉子步，确保高刚度时数值绝对稳定、无超调震荡
    const substeps = 4
    const subDt = dt / substeps

    for (let i = 0; i < substeps; i++) {
      const springForce = -stiffness * (current - to)
      const dampingForce = -damping * velocity
      const accel = (springForce + dampingForce) / mass
      velocity += accel * subDt
      current += velocity * subDt
    }

    if (Math.abs(current - to) < threshold && Math.abs(velocity) < threshold) {
      stopped = true
      onUpdate(to)
      onComplete?.()
      return
    }

    onUpdate(current)
    rafId = requestAnimationFrame(step)
  }

  rafId = requestAnimationFrame(step)

  return () => {
    stopped = true
    if (rafId !== null) {
      cancelAnimationFrame(rafId)
      rafId = null
    }
  }
}

export const Slider = React.forwardRef<HTMLDivElement, SliderProps>((props, forwardedRef) => {
  const {
    label,
    icon,
    value: valueProp,
    defaultValue,
    onValueChange,
    min = 0,
    max = 1,
    step = 0.01,
    formatValue,
    disabled = false,
    className,
    'aria-label': ariaLabel,
  } = props

  const isControlled = valueProp !== undefined
  const [uncontrolledValue, setUncontrolledValue] = React.useState<number>(defaultValue ?? min)
  const currentValue = isControlled ? valueProp : uncontrolledValue

  const range = max - min || 1
  const percentage = clamp(((currentValue - min) / range) * 100, 0, 100)

  const wrapperRef = React.useRef<HTMLDivElement | null>(null)
  const trackRef = React.useRef<HTMLDivElement | null>(null)
  const fillRef = React.useRef<HTMLDivElement | null>(null)
  const handleRef = React.useRef<HTMLDivElement | null>(null)
  const labelRef = React.useRef<HTMLSpanElement | null>(null)
  const valueRef = React.useRef<HTMLSpanElement | null>(null)

  const [isInteracting, setIsInteracting] = React.useState(false)
  const [isDragging, setIsDragging] = React.useState(false)
  const [isHovered, setIsHovered] = React.useState(false)
  const [keyboardFocusRing, setKeyboardFocusRing] = React.useState(false)

  // 坐标测量与交互会话状态（Mutable，不触发额外 re-render）
  const pointerDownPos = React.useRef<{ x: number; y: number } | null>(null)
  const pendingPointerFocusRef = React.useRef(false)
  const isClickRef = React.useRef(true)
  const wrapperRectRef = React.useRef<DOMRect | null>(null)
  const scaleRef = React.useRef(1)
  const animRef = React.useRef<(() => void) | null>(null)
  const rubberAnimRef = React.useRef<(() => void) | null>(null)

  const visualPercentRef = React.useRef<number>(percentage)
  const currentRubberStretchRef = React.useRef<number>(0)

  const isActive = (isInteracting || isHovered) && !disabled

  const displayValue = formatValue
    ? formatValue(currentValue)
    : currentValue.toFixed(decimalsForStep(step))

  // 游标避让文字区域计算
  const [dodge, setDodge] = React.useState({ left: 38, right: 72 })

  React.useLayoutEffect(() => {
    const wrapper = wrapperRef.current
    if (!wrapper) return

    const measure = () => {
      const trackWidth = wrapper.offsetWidth
      if (trackWidth <= 0) return

      const labelEl = labelRef.current
      const valueEl = valueRef.current

      const left = labelEl
        ? ((LABEL_OFFSET + labelEl.offsetWidth + HANDLE_BUFFER) / trackWidth) * 100
        : 38

      const right = valueEl
        ? ((trackWidth - VALUE_OFFSET - valueEl.offsetWidth - HANDLE_BUFFER) / trackWidth) * 100
        : 72

      setDodge(prev => (prev.left === left && prev.right === right ? prev : { left, right }))
    }

    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(wrapper)
    if (labelRef.current) observer.observe(labelRef.current)
    if (valueRef.current) observer.observe(valueRef.current)

    return () => observer.disconnect()
  }, [label, icon, displayValue])

  const shouldReduceMotion = React.useMemo(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return false
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches
  }, [])

  const updateVisualDOM = React.useCallback(
    (pct: number) => {
      visualPercentRef.current = pct
      if (fillRef.current) {
        fillRef.current.style.width = `${pct}%`
      }
      if (handleRef.current) {
        handleRef.current.style.left = `max(6px, min(calc(100% - 10px), calc(${pct}% - 2px)))`
        const isDodging = pct < dodge.left || pct > dodge.right
        handleRef.current.setAttribute('data-dodge', isDodging ? 'true' : 'false')
      }
    },
    [dodge.left, dodge.right]
  )

  const updateRubberDOM = React.useCallback((stretch: number) => {
    if (!trackRef.current) return
    if (stretch === 0) {
      trackRef.current.style.width = '100%'
      trackRef.current.style.transform = 'none'
    } else {
      trackRef.current.style.width = `calc(100% + ${Math.abs(stretch)}px)`
      trackRef.current.style.transform = `translateX(${stretch < 0 ? stretch : 0}px)`
    }
  }, [])

  const updateValue = React.useCallback(
    (nextRaw: number) => {
      const clamped = clamp(nextRaw, min, max)
      const rounded = roundValue(clamped, step)
      if (!isControlled) {
        setUncontrolledValue(rounded)
      }
      onValueChange?.(rounded)
    },
    [isControlled, max, min, onValueChange, step]
  )

  const percentFromValue = React.useCallback(
    (v: number) => ((v - min) / range) * 100,
    [min, range]
  )

  const positionToValue = React.useCallback(
    (clientX: number) => {
      const rect = wrapperRectRef.current
      if (!rect || rect.width <= 0) return min

      const sceneX = (clientX - rect.left) / scaleRef.current
      const nativeWidth = wrapperRef.current?.offsetWidth || rect.width || 1
      const pct = clamp(sceneX / nativeWidth, 0, 1)

      return clamp(min + pct * range, min, max)
    },
    [min, max, range]
  )

  const computeRubberStretch = React.useCallback((clientX: number, sign: number) => {
    const rect = wrapperRectRef.current
    if (!rect) return 0

    const distancePast = sign < 0 ? rect.left - clientX : clientX - rect.right
    const overflow = Math.max(0, distancePast - DEAD_ZONE)

    return sign * MAX_STRETCH * Math.sqrt(Math.min(overflow / MAX_CURSOR_RANGE, 1))
  }, [])

  const animateFillTo = React.useCallback(
    (targetPercent: number) => {
      animRef.current?.()
      animRef.current = null

      if (shouldReduceMotion) {
        visualPercentRef.current = targetPercent
        updateVisualDOM(targetPercent)
        return
      }

      const startPercent = visualPercentRef.current
      animRef.current = runSpring(
        startPercent,
        targetPercent,
        currentPercent => {
          visualPercentRef.current = currentPercent
          updateVisualDOM(currentPercent)
        },
        () => {
          animRef.current = null
        },
        { stiffness: 300, damping: 25, mass: 0.8 }
      )
    },
    [shouldReduceMotion, updateVisualDOM]
  )

  // 当处于非交互状态且无动画在途时，同步外部受控数值
  React.useEffect(() => {
    if (!isInteracting && !animRef.current) {
      visualPercentRef.current = percentage
      updateVisualDOM(percentage)
    }
  }, [percentage, isInteracting, updateVisualDOM])

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (disabled || e.button !== 0) return
    e.preventDefault()
    if (typeof e.currentTarget.setPointerCapture === 'function') {
      try {
        (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
      } catch {
        // Ignore test environments
      }
    }

    pointerDownPos.current = { x: e.clientX, y: e.clientY }
    isClickRef.current = true
    setIsInteracting(true)
    pendingPointerFocusRef.current = true
    setKeyboardFocusRing(false)

    trackRef.current?.focus({ preventScroll: true })
    requestAnimationFrame(() => {
      pendingPointerFocusRef.current = false
    })

    // 快照外层矩形与 UI 缩放比，彻底免受拖拽中轨道形变与 CSS zoom 污染
    const wrapper = wrapperRef.current
    if (wrapper) {
      const rect = wrapper.getBoundingClientRect()
      wrapperRectRef.current = rect
      scaleRef.current = wrapper.offsetWidth > 0 ? rect.width / wrapper.offsetWidth : 1
    }
  }

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!pointerDownPos.current) return

    const dx = e.clientX - pointerDownPos.current.x
    const dy = e.clientY - pointerDownPos.current.y

    // 移动超过 3px 才切入拖拽状态，否则保持点击候选
    if (isClickRef.current && Math.hypot(dx, dy) > CLICK_THRESHOLD) {
      isClickRef.current = false
      setIsDragging(true)
    }

    if (isClickRef.current) return

    // 拖拽超出边界时，计算 32px 死区平滑阻尼橡皮筋
    const rect = wrapperRectRef.current
    if (rect && !shouldReduceMotion) {
      if (e.clientX < rect.left) {
        const stretch = computeRubberStretch(e.clientX, -1)
        rubberAnimRef.current?.()
        rubberAnimRef.current = null
        currentRubberStretchRef.current = stretch
        updateRubberDOM(stretch)
      } else if (e.clientX > rect.right) {
        const stretch = computeRubberStretch(e.clientX, 1)
        rubberAnimRef.current?.()
        rubberAnimRef.current = null
        currentRubberStretchRef.current = stretch
        updateRubberDOM(stretch)
      } else {
        currentRubberStretchRef.current = 0
        updateRubberDOM(0)
      }
    }

    const newValue = positionToValue(e.clientX)
    animRef.current?.()
    animRef.current = null

    const newPercent = percentFromValue(newValue)
    updateVisualDOM(newPercent)
    updateValue(newValue)
  }

  const handlePointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!pointerDownPos.current) return

    // 如果判定为点击：带 spring 弹簧动画滑向目标点（磁吸至最近 10% 或粗粒度步长）
    if (isClickRef.current) {
      const rawValue = positionToValue(e.clientX)
      const discreteSteps = range / step
      const snapped =
        discreteSteps <= 10
          ? clamp(min + Math.round((rawValue - min) / step) * step, min, max)
          : snapToDecile(rawValue, min, max)

      const targetPercent = percentFromValue(snapped)
      animateFillTo(targetPercent)
      updateValue(snapped)
    }

    // 橡皮筋带弹性弹回 0
    if (!shouldReduceMotion && currentRubberStretchRef.current !== 0) {
      rubberAnimRef.current?.()
      rubberAnimRef.current = runSpring(
        currentRubberStretchRef.current,
        0,
        val => {
          currentRubberStretchRef.current = val
          updateRubberDOM(val)
        },
        () => {
          rubberAnimRef.current = null
          currentRubberStretchRef.current = 0
          updateRubberDOM(0)
        },
        { stiffness: 350, damping: 22, mass: 0.8 }
      )
    }

    setIsInteracting(false)
    setIsDragging(false)
    pointerDownPos.current = null
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (disabled) return
    const arrowStep = e.shiftKey ? step * 10 : step
    let next: number

    switch (e.key) {
      case 'ArrowRight':
      case 'ArrowUp':
        next = currentValue + arrowStep
        break
      case 'ArrowLeft':
      case 'ArrowDown':
        next = currentValue - arrowStep
        break
      case 'Home':
        next = min
        break
      case 'End':
        next = max
        break
      default:
        return
    }

    e.preventDefault()
    setKeyboardFocusRing(true)

    const snapped = roundValue(clamp(next, min, max), step)
    const targetPercent = percentFromValue(snapped)
    animateFillTo(targetPercent)
    updateValue(snapped)
  }

  const discreteSteps = range / step
  const hashCount = discreteSteps <= 10 ? Math.max(0, discreteSteps - 1) : 9
  const hashStepPct = (index: number) => {
    return discreteSteps <= 10
      ? (((index + 1) * step) / range) * 100
      : (index + 1) * 10
  }

  return (
    <div
      ref={forwardedRef}
      className={['loom-ui-slider-wrapper', className].filter(Boolean).join(' ')}
      data-disabled={disabled || undefined}
    >
      <div ref={wrapperRef} className="loom-ui-slider-inner-wrapper">
        <div
          ref={trackRef}
          role="slider"
          tabIndex={disabled ? -1 : 0}
          aria-label={ariaLabel ?? label}
          aria-orientation="horizontal"
          aria-valuemin={min}
          aria-valuemax={max}
          aria-valuenow={currentValue}
          aria-valuetext={displayValue}
          aria-disabled={disabled || undefined}
          className="loom-ui-slider-track"
          data-active={isActive ? 'true' : 'false'}
          data-dragging={isDragging ? 'true' : 'false'}
          data-focus-visible={keyboardFocusRing ? 'true' : 'false'}
          style={{
            width:
              currentRubberStretchRef.current !== 0
                ? `calc(100% + ${Math.abs(currentRubberStretchRef.current)}px)`
                : '100%',
            transform:
              currentRubberStretchRef.current !== 0
                ? `translateX(${currentRubberStretchRef.current < 0 ? currentRubberStretchRef.current : 0}px)`
                : 'none',
          }}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerUp}
          onMouseEnter={() => setIsHovered(true)}
          onMouseLeave={() => setIsHovered(false)}
          onKeyDown={handleKeyDown}
          onFocus={() => {
            if (!pendingPointerFocusRef.current) {
              setKeyboardFocusRing(true)
            }
          }}
          onBlur={() => setKeyboardFocusRing(false)}
        >
          {/* 刻度点 */}
          <div className="loom-ui-slider-hash-layer" aria-hidden="true">
            {Array.from({ length: hashCount }, (_, i) => (
              <span
                key={i}
                className="loom-ui-slider-hash"
                style={{ left: `${hashStepPct(i)}%` }}
              />
            ))}
          </div>

          {/* 填充进度条 */}
          <div
            ref={fillRef}
            className="loom-ui-slider-fill"
            style={{ width: `${visualPercentRef.current}%` }}
            aria-hidden="true"
          />

          {/* 游标 Handle */}
          <div
            ref={handleRef}
            className="loom-ui-slider-handle"
            data-dodge={
              visualPercentRef.current < dodge.left || visualPercentRef.current > dodge.right
                ? 'true'
                : 'false'
            }
            style={{
              left: `max(6px, min(calc(100% - 10px), calc(${visualPercentRef.current}% - 2px)))`,
            }}
            aria-hidden="true"
          />

          {/* 左侧内嵌 Label 与可选 Icon */}
          <span ref={labelRef} className="loom-ui-slider-label-block" aria-hidden="true">
            {icon ? <span className="loom-ui-slider-icon">{icon}</span> : null}
            {label ? <span className="loom-ui-slider-label">{label}</span> : null}
          </span>

          {/* 右侧数值 DisplayValue */}
          <span ref={valueRef} className="loom-ui-slider-value" aria-hidden="true">
            {displayValue}
          </span>
        </div>
      </div>
    </div>
  )
})

Slider.displayName = 'Slider'

export const ElasticSlider = Slider
