/**
 * 小圆 Live2D desktop pet, browser half. A draggable Madoka Kaname mascot floats
 * at the client's lower-right corner: idle motions and expressions cycle on a
 * timer, clicking the character plays another one, and dragging repositions the
 * pet (persisted in localStorage). The Cubism core loads from the web app's
 * static directory before the Live2D runtime evaluates, and the model files
 * are served from the same directory.
 *
 * The build keeps the whole pixi stack in one artifact (`codeSplitting: false`
 * in this package's tsdown config — the plugin bundle route cannot serve
 * rolldown's default pixi chunks), so both npm imports below compile into
 * in-place module initializations and the entry chunk stays self-contained.
 * The Live2D import stays inside the boot promise: its module body reads
 * `window.Live2DCubismCore` at evaluation time, which the core script
 * populates first.
 * @module @deepseek-ai/dsh-client-ui-live2d-avatar/client
 */
import type { Context as ClientContext } from '@deepseek-ai/cordis'

/** Services required by the browser half. */
export const inject: string[] = []

/** Where the pet anchors and persists its position. */
const PET_ID = 'dsh-live2d-avatar'
/** Cubism runtime and model assets served by the web app's static directory. */
const CORE_URL = '/live2d/live2dcubismcore.js'
const MODEL_URL = '/live2d/madoka_200100/model.model3.json'
/** Displayed pet height in pixels; the mascot hugs the viewport bottom edge. */
const PET_HEIGHT = 300
/** Milliseconds between ambient motion changes while the pet idles. */
const AMBIENT_INTERVAL_MS = 9000
/** Pointer travel below this distance counts as a click, not a drag. */
const CLICK_SLOP_PX = 6
/** The model's single motion group; indexes 0-8 address individual clips. */
const MOTION_GROUP = 'Motion'
const STORAGE_KEY = 'dsh-live2d-avatar-position'

interface StoredPosition {
  readonly x: number
  readonly y: number
}

/** Load the Cubism core script once; the Live2D runtime reads it on evaluation. */
function loadCubismCore(): Promise<void> {
  if (typeof window !== 'undefined' && 'Live2DCubismCore' in window) return Promise.resolve()
  return new Promise((resolve, reject) => {
    const script = document.createElement('script')
    script.src = CORE_URL
    script.onload = () => { resolve() }
    script.onerror = () => { reject(new Error('ui-live2d-avatar: Cubism core failed to load')) }
    document.head.appendChild(script)
  })
}

/** Restore the last dragged position, clamped into the current viewport. */
function restorePosition(host: HTMLDivElement): void {
  let stored: StoredPosition | undefined
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (raw !== null) stored = JSON.parse(raw) as StoredPosition
  } catch {
    stored = undefined
  }
  const x = stored === undefined
    ? Math.max(16, window.innerWidth - 220)
    : Math.min(Math.max(0, stored.x), Math.max(0, window.innerWidth - host.offsetWidth))
  const y = stored === undefined
    ? Math.max(0, window.innerHeight - PET_HEIGHT - 40)
    : Math.min(Math.max(0, stored.y), Math.max(0, window.innerHeight - 80))
  host.style.left = `${x}px`
  host.style.top = `${y}px`
}

/**
 * Mount the desktop pet as one disposal-scoped effect.
 * @param ctx - Client root context.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => {
    if (typeof document === 'undefined') return () => {}
    const host = document.createElement('div')
    host.id = PET_ID
    host.style.cssText = [
      'position: fixed', 'z-index: 900', 'width: 260px', `height: ${PET_HEIGHT}px`,
      'pointer-events: auto', 'cursor: grab', 'user-select: none', 'touch-action: none',
      'filter: drop-shadow(0 6px 16px rgb(0 0 0 / 18%))',
    ].join(';')
    document.body.appendChild(host)
    restorePosition(host)

    let disposed = false
    let teardown: (() => void) | undefined
    let bootError: ((message: string) => void) | undefined

    const boot = (async () => {
      await loadCubismCore()
      if (disposed) return
      const [{ Live2DModel }, PIXI] = await Promise.all([
        import('pixi-live2d-display-lipsyncpatch/cubism4'),
        import('pixi.js'),
      ])
      if (disposed) return
      const canvas = document.createElement('canvas')
      canvas.style.cssText = 'width: 100%; height: 100%; display: block;'
      const app = new PIXI.Application({
        view: canvas, backgroundAlpha: 0, autoDensity: true, resolution: 2, resizeTo: host,
      })
      host.appendChild(canvas)
      const model = await Live2DModel.from(MODEL_URL, { autoInteract: false })
      if (disposed) {
        model.destroy()
        app.destroy(true)
        return
      }
      model.scale.set(PET_HEIGHT / model.internalModel.height)
      // Hug the pet to the container's bottom edge so it "stands" on it.
      model.x = (app.screen.width - model.width) / 2
      model.y = app.screen.height - model.height
      app.stage.addChild(model)

      const random = (bound: number): number => Math.floor(Math.random() * bound)
      const play = (): void => {
        void model.motion(MOTION_GROUP, random(9))
        const expressions = model.internalModel.motionManager?.expressionManager
        if (expressions !== undefined && Math.random() < 0.6) {
          expressions.setRandomExpression()
        }
      }
      void model.motion(MOTION_GROUP, 0)
      const ambient = window.setInterval(play, AMBIENT_INTERVAL_MS)

      let dragging = false
      let moved = 0
      let offsetX = 0
      let offsetY = 0
      const onPointerDown = (event: PointerEvent): void => {
        dragging = true
        moved = 0
        offsetX = event.clientX - host.offsetLeft
        offsetY = event.clientY - host.offsetTop
        host.style.cursor = 'grabbing'
        host.setPointerCapture(event.pointerId)
      }
      const onPointerMove = (event: PointerEvent): void => {
        if (!dragging) return
        const left = event.clientX - offsetX
        const top = event.clientY - offsetY
        moved += Math.abs(event.movementX) + Math.abs(event.movementY)
        host.style.left = `${Math.max(0, left)}px`
        host.style.top = `${Math.max(0, top)}px`
      }
      const onPointerUp = (event: PointerEvent): void => {
        if (!dragging) return
        dragging = false
        host.style.cursor = 'grab'
        host.releasePointerCapture(event.pointerId)
        if (moved <= CLICK_SLOP_PX) {
          play()
          return
        }
        try {
          window.localStorage.setItem(STORAGE_KEY, JSON.stringify({
            x: host.offsetLeft, y: host.offsetTop,
          }))
        } catch {
          // A private-mode localStorage refusal only costs the persisted position.
        }
      }
      // Listeners live on the host div: the canvas fills it and pointer events
      // bubble, while the ICanvas type's own event maps are WebGL-flavored.
      host.addEventListener('pointerdown', onPointerDown)
      host.addEventListener('pointermove', onPointerMove)
      host.addEventListener('pointerup', onPointerUp)

      teardown = () => {
        window.clearInterval(ambient)
        host.removeEventListener('pointerdown', onPointerDown)
        host.removeEventListener('pointermove', onPointerMove)
        host.removeEventListener('pointerup', onPointerUp)
        model.destroy()
        app.destroy(true, { children: true, texture: true })
      }
    })()
    boot.catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error)
      console.warn(`ui-live2d-avatar: pet unavailable (${message})`)
      bootError?.(message)
    })

    return () => {
      disposed = true
      bootError = undefined
      teardown?.()
      host.remove()
    }
  }, 'ui-live2d-avatar: desktop pet')
}
