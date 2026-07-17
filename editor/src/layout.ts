import type { ButtonRenderStyle } from './types'

export const LAYOUT_EXTENSION = '.yuraive-layout.html'

export const DEFAULT_LAYOUT_SOURCE = `<style>
.stage {
  position: absolute;
  inset: 0;
  display: grid;
  grid-template-rows: 1fr auto;
  padding: clamp(16px, 4cqw, 32px);
  pointer-events: none;
}

slot[name="actions"] {
  display: grid;
  grid-row: 2;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: clamp(8px, 2cqw, 16px);
  pointer-events: auto;
}

slot:not([name]) {
  position: absolute;
  inset: 0;
  pointer-events: none;
}

.yuraive-button {
  display: grid;
  place-items: center;
  min-height: 52px;
  padding: 12px 20px;
  border: 0;
  border-radius: 18px;
  background: #574de5;
  color: #ffffff;
  font: 600 16px/1.3 system-ui, sans-serif;
  text-align: center;
  box-shadow: 0 4px 14px #00000066;
  pointer-events: auto;
}

.yuraive-button:active {
  filter: brightness(.86);
  transform: translateY(1px);
}

@container yuraive-canvas (max-width: 420px) {
  slot[name="actions"] {
    grid-template-columns: 1fr;
  }
}
</style>

<div class="stage">
  <slot name="actions"></slot>
  <slot></slot>
</div>
`

export const LAYOUT_ELEMENTS = ['div', 'slot'] as const
export const LAYOUT_VARIABLES = [
  '--yuraive-canvas-width',
  '--yuraive-canvas-height',
  '--yuraive-safe-top',
  '--yuraive-safe-right',
  '--yuraive-safe-bottom',
  '--yuraive-safe-left',
  '--yuraive-density',
  '--yuraive-font-scale',
] as const
export const LAYOUT_CSS_PROPERTIES = [
  'display',
  'grid-template',
  'grid-template-columns',
  'grid-template-rows',
  'grid-template-areas',
  'grid-area',
  'grid-column',
  'grid-row',
  'gap',
  'row-gap',
  'column-gap',
  'place-items',
  'place-content',
  'place-self',
  'justify-items',
  'justify-content',
  'justify-self',
  'align-items',
  'align-content',
  'align-self',
  'order',
  'position',
  'inset',
  'top',
  'right',
  'bottom',
  'left',
  'z-index',
  'width',
  'height',
  'min-width',
  'min-height',
  'max-width',
  'max-height',
  'padding',
  'margin',
  'overflow',
  'box-sizing',
  'background',
  'background-color',
  'background-image',
  'background-size',
  'background-position',
  'color',
  'opacity',
  'border',
  'border-color',
  'border-width',
  'border-radius',
  'box-shadow',
  'font',
  'font-family',
  'font-size',
  'font-weight',
  'line-height',
  'letter-spacing',
  'text-align',
  'white-space',
  'text-overflow',
  'transform',
  'filter',
  'pointer-events',
  'container',
  'container-type',
  'container-name',
] as const

const allowedElements = new Set(['STYLE', ...LAYOUT_ELEMENTS.map((name) => name.toUpperCase())])
const allowedAttributes = new Set(['class', 'id', 'name', 'style', 'role', 'aria-label'])

export type LayoutSourceIssue = { severity: 'error' | 'warning'; message: string }

const sanitizedLayoutParts = (source: string) => {
  const parsed = new DOMParser().parseFromString(source, 'text/html')
  const styles = [...parsed.querySelectorAll('style')].map((style) =>
    sanitizeLayoutCss(style.textContent ?? ''),
  )
  for (const element of [...parsed.body.querySelectorAll('*')]) {
    if (!allowedElements.has(element.tagName)) {
      element.replaceWith(...element.childNodes)
      continue
    }
    for (const attribute of [...element.attributes]) {
      if (!allowedAttributes.has(attribute.name)) element.removeAttribute(attribute.name)
    }
  }
  parsed.body.querySelectorAll('style').forEach((style) => style.remove())
  return { body: parsed.body.innerHTML, styles }
}

const sanitizeLayoutCss = (source: string) =>
  source
    .replace(/@import\s+(?:url\([^)]*\)|[^;]+);?/gi, '')
    .replace(/url\(\s*(['"]?)(.*?)\1\s*\)/gi, (value, _quote: string, url: string) =>
      /^(?:data:|blob:|content:)/i.test(url.trim()) ? value : 'none',
    )

export const layoutSlotNames = (source: string): string[] => {
  const parsed = new DOMParser().parseFromString(source, 'text/html')
  return [...parsed.querySelectorAll('slot')].map((slot) =>
    (slot.getAttribute('name') || slot.id).trim(),
  )
}

export const validateLayoutSource = (source: string): LayoutSourceIssue[] => {
  const issues: LayoutSourceIssue[] = []
  const parsed = new DOMParser().parseFromString(source, 'text/html')
  const slots = [...parsed.querySelectorAll('slot')]
  if (!slots.some((slot) => !(slot.getAttribute('name') || slot.id).trim()))
    issues.push({ severity: 'error', message: 'name/idのないデフォルトslotが必要です' })
  const names = slots.map((slot) => (slot.getAttribute('name') || slot.id).trim())
  const duplicates = [...new Set(names.filter((name, index) => names.indexOf(name) !== index))]
  if (duplicates.length)
    issues.push({
      severity: 'error',
      message: `slot名が重複しています: ${duplicates.map((name) => name || '(default)').join(', ')}`,
    })
  for (const element of [...parsed.body.querySelectorAll('*')]) {
    if (!allowedElements.has(element.tagName))
      issues.push({
        severity: 'warning',
        message: `<${element.tagName.toLowerCase()}>は除去されます。divとslotのみ使用できます`,
      })
    for (const attribute of [...element.attributes]) {
      if (!allowedAttributes.has(attribute.name))
        issues.push({
          severity: 'warning',
          message: `${element.tagName.toLowerCase()}の${attribute.name}属性は除去されます`,
        })
    }
  }
  if (!parsed.querySelector('style'))
    issues.push({
      severity: 'warning',
      message: 'style要素がありません。ボタンには暗黙の外観が適用されません',
    })
  return issues
}

export const buildLayoutFragment = (source: string) => {
  const { body, styles } = sanitizedLayoutParts(source)
  const authorCss = styles.join('\n')
  return `<style>
:host, #yuraive-layout-root { width: 100%; height: 100%; margin: 0; overflow: hidden; background: transparent; }
:host { display: block; position: relative; container: yuraive-canvas / size; contain: layout paint style; isolation: isolate; }
*, *::before, *::after { box-sizing: border-box; }
.yuraive-button { all: unset; box-sizing: border-box; -webkit-tap-highlight-color: transparent; }
</style><style>${authorCss}</style><div id="yuraive-layout-root">${body}</div>`
}

export type LayoutButton = {
  id: string
  visible: boolean
  targetSlot?: string
  order?: number
  zIndex?: number
  text: string
  style?: ButtonRenderStyle
  backgroundImageUrl?: string
}

const applyButtonStyle = (
  element: HTMLButtonElement,
  style: ButtonRenderStyle | undefined,
  backgroundImageUrl?: string,
) => {
  if (!style) return
  if (style.backgroundColor !== undefined) element.style.backgroundColor = style.backgroundColor
  if (backgroundImageUrl) {
    element.style.backgroundImage = `url(${JSON.stringify(backgroundImageUrl).slice(1, -1)})`
    element.style.backgroundSize = 'cover'
    element.style.backgroundPosition = 'center'
  }
  if (style.textColor !== undefined) element.style.color = style.textColor
  if (style.opacity !== undefined) element.style.opacity = String(style.opacity)
  if (style.borderColor !== undefined) element.style.borderColor = style.borderColor
  if (style.borderWidth !== undefined) {
    element.style.borderWidth = `${style.borderWidth}px`
    element.style.borderStyle = 'solid'
  }
  if (style.borderRadius !== undefined) element.style.borderRadius = `${style.borderRadius}px`
  if (style.fontSize !== undefined) element.style.fontSize = `${style.fontSize}px`
  if (style.fontWeight !== undefined) element.style.fontWeight = String(style.fontWeight)
  if (style.paddingHorizontal !== undefined) {
    element.style.paddingLeft = `${style.paddingHorizontal}px`
    element.style.paddingRight = `${style.paddingHorizontal}px`
  }
  if (style.paddingVertical !== undefined) {
    element.style.paddingTop = `${style.paddingVertical}px`
    element.style.paddingBottom = `${style.paddingVertical}px`
  }
}

export const syncLayoutRoot = (
  root: ShadowRoot,
  buttons: LayoutButton[],
  onPress?: (id: string) => void,
) => {
  root
    .querySelectorAll('.yuraive-button[data-yuraive-injected]')
    .forEach((button) => button.remove())
  const slots = [...root.querySelectorAll('slot')]
  const slotId = (slot: Element) =>
    (slot.getAttribute('name') || slot.getAttribute('id') || '').trim()
  const defaultSlot = slots.find((slot) => !slotId(slot))
  buttons
    .filter((button) => button.visible)
    .sort((left, right) => (left.order ?? 0) - (right.order ?? 0))
    .forEach((button) => {
      const requested = button.targetSlot?.trim()
      const target =
        (requested ? slots.find((slot) => slotId(slot) === requested) : defaultSlot) ?? defaultSlot
      if (!target) return
      const element = document.createElement('button')
      element.type = 'button'
      element.className = 'yuraive-button'
      element.dataset.yuraiveInjected = 'true'
      element.dataset.buttonId = button.id
      element.style.order = String(button.order ?? 0)
      element.style.zIndex = String(button.zIndex ?? 0)
      element.textContent = button.text
      applyButtonStyle(element, button.style, button.backgroundImageUrl)
      if (onPress) element.addEventListener('click', () => onPress(button.id))
      target.append(element)
    })
}

export const updateLayoutVariables = (host: HTMLElement) => {
  const width = host.clientWidth
  const height = host.clientHeight
  host.style.setProperty('--yuraive-canvas-width', `${width}px`)
  host.style.setProperty('--yuraive-canvas-height', `${height}px`)
  host.style.setProperty('--yuraive-safe-top', '0px')
  host.style.setProperty('--yuraive-safe-right', '0px')
  host.style.setProperty('--yuraive-safe-bottom', '0px')
  host.style.setProperty('--yuraive-safe-left', '0px')
  host.style.setProperty('--yuraive-density', String(window.devicePixelRatio || 1))
  host.style.setProperty('--yuraive-font-scale', '1')
}
