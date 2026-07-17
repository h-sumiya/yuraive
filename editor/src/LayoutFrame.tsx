import { useEffect, useMemo, useRef } from 'react'
import {
  buildLayoutFragment,
  syncLayoutRoot,
  updateLayoutVariables,
  type LayoutButton,
} from './layout'

export function LayoutFrame({
  source,
  buttons,
  onPress,
  className,
}: {
  source: string
  buttons: LayoutButton[]
  onPress?: (id: string) => void
  className?: string
}) {
  const host = useRef<HTMLDivElement>(null)
  const fragment = useMemo(() => buildLayoutFragment(source), [source])
  const latest = useRef({ buttons, onPress })
  latest.current = { buttons, onPress }

  const sync = () => {
    const current = host.current
    if (!current?.shadowRoot) return
    updateLayoutVariables(current)
    syncLayoutRoot(current.shadowRoot, latest.current.buttons, latest.current.onPress)
  }

  useEffect(() => {
    const current = host.current
    if (!current) return
    const root = current.shadowRoot ?? current.attachShadow({ mode: 'open' })
    root.innerHTML = fragment
    sync()
  }, [fragment])
  useEffect(() => {
    sync()
  }, [buttons, onPress])
  useEffect(() => {
    const current = host.current
    if (!current) return
    const observer = new ResizeObserver(sync)
    observer.observe(current)
    return () => observer.disconnect()
  }, [fragment])

  return <div ref={host} className={className} title="ボタンレイアウト" />
}
