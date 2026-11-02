import { useEffect, useId, useRef, useState } from 'react'
import { Button, IconButton, DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@loom-studio/ui'
import { ArrowUpRight, Check, ChevronDown, GitGraph, Pencil, Plus, Trash2, UserRound, UserRoundX } from 'lucide-react'
import styles from './timeline-quick-actions.module.scss'

export type TimelineQuickActionsProps = {
  character: { name: string; avatarUrl?: string }
  timeline?: { title: string; branchId?: string; branches: readonly { id: string; title: string }[] }
  timelines?: readonly { id: string; title: string; description?: string; preview?: string }[]
  selectedTimelineId?: string
  onSelectTimeline?(id: string): void
  busy?: boolean
  canFork?: boolean
  labels: {
    expand: string; collapse: string; openCharacter: string; opening: string; story: string; selectStory: string
    branch: string; rename: string; newStory: string; fork: string; deleteStory: string; deleteCharacter: string
  }
  onOpenWorkspace?(): void
  onOpenCharacter(): void
  onNewStory(): void
  onRenameStory(): void
  onFork(): void
  onSelectBranch(id: string): void
  onDeleteStory(): void
  onDeleteCharacter(): void
}

export function TimelineQuickActions(props: TimelineQuickActionsProps) {
  const [expanded, setExpanded] = useState(false)
  const toggleRef = useRef<HTMLButtonElement>(null)
  const characterRef = useRef<HTMLButtonElement>(null)
  const pressTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const pressOrigin = useRef<{ x: number; y: number } | undefined>(undefined)
  const suppressClick = useRef(false)
  function cancelPress() {
    clearTimeout(pressTimer.current)
    pressTimer.current = undefined
    pressOrigin.current = undefined
  }
  useEffect(() => cancelPress, [])
  const contentId = useId()
  const currentBranch = props.timeline?.branches.find(branch => branch.id === props.timeline?.branchId)
  return <section className={styles.island} data-expanded={expanded} aria-label={props.character.name}
    onKeyDown={event => {
      if (event.key === 'Escape' && !event.defaultPrevented) {
        setExpanded(false)
        const focusTarget = window.matchMedia('(max-width: 768px)').matches ? characterRef : toggleRef
        focusTarget.current?.focus()
      }
    }}>
    <div className={styles.header}>
      <button type="button" ref={characterRef} className={styles.character} aria-label={props.labels.openCharacter}
        onPointerDown={event => {
          if (event.button !== 0 || !event.isPrimary || !window.matchMedia('(max-width: 768px)').matches) return
          cancelPress()
          suppressClick.current = false
          pressOrigin.current = { x: event.clientX, y: event.clientY }
          pressTimer.current = setTimeout(() => {
            suppressClick.current = true
            setExpanded(value => !value)
            cancelPress()
          }, 500)
        }}
        onPointerMove={event => {
          if (pressOrigin.current && Math.hypot(event.clientX - pressOrigin.current.x, event.clientY - pressOrigin.current.y) > 8) {
            suppressClick.current = true
            cancelPress()
          }
        }}
        onPointerUp={cancelPress} onPointerCancel={cancelPress} onPointerLeave={cancelPress}
        onContextMenu={event => { if (window.matchMedia('(max-width: 768px)').matches) event.preventDefault() }}
        onKeyDown={event => {
          if (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) {
            event.preventDefault()
            setExpanded(value => !value)
          }
        }}
        onClick={event => {
          if (suppressClick.current && event.detail !== 0) { suppressClick.current = false; return }
          props.onOpenCharacter()
        }}>
        {props.character.avatarUrl
          ? <img className={styles.avatar} src={props.character.avatarUrl} alt="" />
          : <UserRound className={styles.avatar} aria-hidden="true" />}
        <span>{props.character.name}</span>
      </button>
      <button type="button" className={styles.expand} ref={toggleRef} aria-expanded={expanded} aria-controls={contentId}
        aria-label={expanded ? props.labels.collapse : props.labels.expand} onClick={() => setExpanded(value => !value)}>
        <ChevronDown size={16} aria-hidden="true" />
      </button>
    </div>
    <div className={styles.reveal} inert={!expanded} aria-hidden={!expanded}>
      <div className={styles.clip}>
        <div id={contentId} className={styles.body}>
          <div className={styles.storyHeading}>
            <span className={styles.eyebrow}>{props.labels.story}</span>
            {props.timeline ? <IconButton size="small" disabled={props.busy} aria-label={props.labels.rename} title={props.labels.rename} onClick={props.onRenameStory}><Pencil size={15} aria-hidden="true" /></IconButton> : null}
          </div>
          <div className={styles.story}>
            <div className={styles.storyTitle}>{props.timelines ? <DropdownMenu>
              <DropdownMenuTrigger asChild><Button className={styles.storyPicker} disabled={props.busy || props.timelines.length === 0} aria-label={props.labels.selectStory}>
                <strong>{props.timeline?.title ?? props.labels.opening}</strong><ChevronDown size={14} aria-hidden="true" />
              </Button></DropdownMenuTrigger>
              <DropdownMenuContent align="start">
                {props.timelines.map(item => <DropdownMenuItem key={item.id} onSelect={() => props.onSelectTimeline?.(item.id)}>
                  <span className={styles.choice}>
                    <span className={styles.choiceText}>
                      <span title={item.title}>{item.title}</span>
                      {item.description ? <small>{item.description}</small> : null}
                      {item.preview ? <small title={item.preview}>{item.preview}</small> : null}
                    </span>
                    {item.id === props.selectedTimelineId ? <Check size={14} aria-hidden="true" /> : null}
                  </span>
                </DropdownMenuItem>)}
              </DropdownMenuContent>
            </DropdownMenu> : <strong>{props.timeline?.title ?? props.labels.opening}</strong>}</div>
          {props.timeline ? <><span className={styles.separator} aria-hidden="true">/</span><DropdownMenu>
            <DropdownMenuTrigger asChild><Button disabled={props.busy} className={styles.branch} aria-label={props.labels.branch}>
              <GitGraph size={16} aria-hidden="true" /><span>{currentBranch?.title}</span><ChevronDown size={14} aria-hidden="true" />
            </Button></DropdownMenuTrigger>
            <DropdownMenuContent align="start">
              {props.timeline.branches.map(branch => <DropdownMenuItem key={branch.id} onSelect={() => props.onSelectBranch(branch.id)}>
                <span className={styles.choice}><span>{branch.title}</span>{branch.id === props.timeline?.branchId ? <Check size={14} aria-hidden="true" /> : null}</span>
              </DropdownMenuItem>)}
            </DropdownMenuContent>
          </DropdownMenu></> : null}
          </div>
          <div className={styles.actions}>
            {props.timeline && props.onOpenWorkspace ? <Button className={styles.workspaceLink} onClick={props.onOpenWorkspace}>打开工作区<ArrowUpRight size={15} aria-hidden="true" /></Button> : null}
            <div className={styles.storyActions}>
            <Button disabled={props.busy} onClick={props.onNewStory}><Plus size={16} aria-hidden="true" />{props.labels.newStory}</Button>
            {props.timeline ? <Button disabled={props.busy || props.canFork === false} onClick={props.onFork}><GitGraph size={16} aria-hidden="true" />{props.labels.fork}</Button> : null}
            </div>
          </div>
          <div className={styles.danger}>
            <Button disabled={props.busy || !props.timeline} variant="danger" onClick={props.onDeleteStory}><Trash2 size={16} aria-hidden="true" />{props.labels.deleteStory}</Button>
            <IconButton size="small" className={styles.deleteCharacter} disabled={props.busy} aria-label={props.labels.deleteCharacter} title={props.labels.deleteCharacter} onClick={props.onDeleteCharacter}><UserRoundX size={16} aria-hidden="true" /></IconButton>
          </div>
        </div>
      </div>
    </div>
  </section>
}
