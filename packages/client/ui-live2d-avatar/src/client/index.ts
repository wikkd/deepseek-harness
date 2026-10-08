/**
 * 小圆 Live2D desktop pet, browser half. A draggable Madoka Kaname mascot
 * floats at the client's lower corner: idle motions and expressions cycle on a
 * timer, clicking the character plays another one, dragging repositions the
 * pet (persisted in localStorage), and a General-settings row owns the whole
 * appearance — visibility, size, opacity, and dock corner — through the
 * plugin's own settings namespace. While the TTS plugin plays a spoken reply,
 * the playing element is tapped into the motion manager's lip-sync path, which
 * drives the model's mouth.
 *
 * The Cubism core loads from the web app's static directory before the Live2D
 * runtime evaluates, and the model files are served from the same directory.
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
import type { ObservableSnapshot } from '@deepseek-ai/dsh-client-store'
// Type-only: the ctx.configForms Context merge. Cross-plugin collaboration
// goes through the service, never a value import (client bundle purity gate).
import type { ConfigForm } from '@deepseek-ai/dsh-client-ui-settings/client'
// Type-only: pulls the locale plugin's Context merge (ctx.locale).
import type {} from '@deepseek-ai/dsh-client-locale/client'
// Type-only: pulls the SlotRegistry service merge (ctx.slots).
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type { Cubism4InternalModel } from 'pixi-live2d-display-lipsyncpatch/cubism4'
import { installLipSync } from './lip-sync.ts'
import { en, zh, type PetSettingsKey } from './locales.ts'
import { PetRow, type PetRowInjected } from './PetRow.tsx'
import {
  PET_SETTINGS_DEFAULTS, PET_SETTINGS_NAMESPACE,
} from '../pet-settings.ts'

/** Services required by the browser half (settings transport + row surfaces). */
export const inject: string[] = ['slots', 'locale', 'remote', 'configForms']

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** The desktop-pet settings row's copy. */
    'settings.live2dAvatar': PetSettingsKey
  }
}

/** Where the pet anchors and persists its position. */
const PET_ID = 'dsh-live2d-avatar'
/** Cubism runtime and model assets served by the web app's static directory. */
const CORE_URL = '/live2d/live2dcubismcore.js'
const MODEL_URL = '/live2d/madoka_200100/model.model3.json'
/** Host width per unit of pet height; the two scale together. */
const HOST_ASPECT = 260 / 300
/** Milliseconds between ambient motion changes while the pet idles. */
const AMBIENT_INTERVAL_MS = 9000
/** Pointer travel below this distance counts as a click, not a drag. */
const CLICK_SLOP_PX = 6
/** The model's single motion group; indexes 0-8 address individual clips. */
const MOTION_GROUP = 'Motion'
/** Settings-row copy namespace owned by this plugin. */
const SETTINGS_NS = 'settings.live2dAvatar'
const STORAGE_KEY = 'dsh-live2d-avatar-position'

/** The pet-facing face of the model this plugin drives. */
interface PetModel {
  scale: { set(value: number): void }
  x: number
  y: number
  width: number
  internalModel: { height: number }
}

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

/** Dock coordinates for one anchor: hugged to the corner, 16px inset. */
function placeAtAnchor(host: HTMLDivElement, settings: PetSettings): void {
  const width = Math.round(settings.height * HOST_ASPECT)
  host.style.left = `${settings.anchor === 'left' ? 16 : Math.max(16, window.innerWidth - width - 16)}px`
  host.style.top = `${Math.max(0, window.innerHeight - settings.height - 40)}px`
}

/** Restore the last dragged position, clamped into the current viewport. */
function restorePosition(host: HTMLDivElement, settings: PetSettings): void {
  let stored: StoredPosition | undefined
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (raw !== null) stored = JSON.parse(raw) as StoredPosition
  } catch {
    stored = undefined
  }
  if (stored === undefined) {
    placeAtAnchor(host, settings)
    return
  }
  host.style.left = `${Math.min(Math.max(0, stored.x), Math.max(0, window.innerWidth - host.offsetWidth))}px`
  host.style.top = `${Math.min(Math.max(0, stored.y), Math.max(0, window.innerHeight - 80))}px`
}

/**
 * Mount the desktop pet, its settings row, and its appearance preferences.
 * @param ctx - Client root context.
 */
export function apply(ctx: ClientContext): void {
  const form: ConfigForm<PetSettings> = ctx.configForms.get<PetSettings>(PET_SETTINGS_NAMESPACE)

  ctx.effect(() => ctx.locale.register(SETTINGS_NS, { zh, en }), 'ui-live2d-avatar: settings row dictionaries')

  // The appearance preferences: adopted from the settings form, mirrored to
  // the settings row through this snapshot, and applied to the mounted host.
  let settings: PetSettings = PET_SETTINGS_DEFAULTS
  const rowListeners = new Set<() => void>()
  const settingsSnapshot: ObservableSnapshot<PetSettings> = {
    getSnapshot: () => settings,
    subscribe: (listener) => {
      rowListeners.add(listener)
      return () => { rowListeners.delete(listener) }
    },
  }
  // Filled in by the mount effect once the host exists; preference flips that
  // arrive before (or after) the pet is mounted are absorbed there.
  let applyVisibility: (() => void) | undefined
  let applyAppearance: ((next: PetSettings, previous: PetSettings) => void) | undefined

  ctx.effect(() => form.subscribe(() => {
    const next = form.getSnapshot().value
    if (next === undefined) return
    const previous = settings
    settings = next
    applyVisibility?.()
    applyAppearance?.(next, previous)
    for (const listener of rowListeners) listener()
  }), 'ui-live2d-avatar: preference adoption')

  ctx.slots.inject('settings.general.item', () => ctx.slots.register({
    name: 'settings.general.item',
    id: 'live2d-avatar',
    order: 30,
    locale: SETTINGS_NS,
    inject: (): PetRowInjected => ({
      hooks: { settings: settingsSnapshot },
      setField: (field, value) => { void form.set(field, value) },
    }),
  }, PetRow))

  ctx.effect(() => {
    if (typeof document === 'undefined') return () => {}
    const host = document.createElement('div')
    host.id = PET_ID
    host.style.cssText = [
      'position: fixed', 'z-index: 900', 'pointer-events: auto', 'cursor: grab',
      'user-select: none', 'touch-action: none',
      'filter: drop-shadow(0 6px 16px rgb(0 0 0 / 18%))',
    ].join(';')
    document.body.appendChild(host)
    restorePosition(host, settings)

    let disposed = false
    let teardown: (() => void) | undefined
    let app: { ticker: { start(): void; stop(): void }; screen: { width: number; height: number } } | undefined
    let model: PetModel | undefined

    const applyPetVisibility = (): void => {
      host.style.display = settings.visible ? '' : 'none'
      if (app === undefined) return
      if (settings.visible) app.ticker.start()
      else app.ticker.stop()
    }
    applyVisibility = applyPetVisibility
    applyPetVisibility()

    // Size, opacity, and dock side react live: the host resizes (the canvas
    // follows through resizeTo), the model rescales and re-hugs the bottom,
    // and an anchor flip re-docks the pet to its corner. Dragged positions
    // keep applying afterwards — a flip just moves the pet once.
    const resizeHost = (value: PetSettings): void => {
      host.style.width = `${Math.round(value.height * HOST_ASPECT)}px`
      host.style.height = `${value.height}px`
      host.style.opacity = `${value.opacity}`
    }
    const rescaleModel = (value: PetSettings): void => {
      if (model === undefined || app === undefined) return
      model.scale.set(value.height / model.internalModel.height)
      model.x = (app.screen.width - model.width) / 2
      model.y = app.screen.height - model.height
    }
    applyAppearance = (next: PetSettings, previous: PetSettings): void => {
      resizeHost(next)
      if (next.anchor !== previous.anchor) placeAtAnchor(host, next)
      rescaleModel(next)
    }
    resizeHost(settings)

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
      const petApp = new PIXI.Application({
        view: canvas, backgroundAlpha: 0, autoDensity: true,
        resolution: Math.min(window.devicePixelRatio || 1, 2), resizeTo: host,
      })
      host.appendChild(canvas)
      try {
        // The automator falls back to a global `window.PIXI` when no ticker is
        // given; this bundle inlines pixi and never exposes that global, so the
        // explicit ticker is what keeps autoUpdate alive — without it the model
        // freezes on its initial frame (every arm variant visible, no motions).
        // The application's own ticker (not Ticker.shared) keeps model updates
        // under the same visibility gate as rendering.
        const pet = await Live2DModel.from(MODEL_URL, {
          autoHitTest: false, autoFocus: false, ticker: petApp.ticker,
        })
        if (disposed) {
          pet.destroy()
          petApp.destroy(true)
          return
        }
        app = petApp
        model = pet as unknown as PetModel
        applyPetVisibility()
        model.scale.set(settings.height / model.internalModel.height)
        // Hug the pet to the container's bottom edge so it "stands" on it.
        model.x = (petApp.screen.width - model.width) / 2
        model.y = petApp.screen.height - model.height
        petApp.stage.addChild(pet)

        // Feed the playing audio into the model's own lip-sync path: while
        // `currentAudio` is set, the motion manager reads `currentAnalyzer`
        // every update and writes the mouth parameter over the idle motions
        // (`internalModel.lipSync` defaults to true). The downcast to the
        // Cubism4 face is safe here — every cubism4 model builds one — and is
        // what exposes the typed `currentAudio`/`currentAnalyzer` pair.
        const internalModel = pet.internalModel as Cubism4InternalModel
        let speaking = false
        const speech = installLipSync({
          tap: (element, analyser) => {
            speaking = true
            internalModel.motionManager.currentAudio = element
            internalModel.motionManager.currentAnalyzer = analyser
          },
          untap: () => {
            speaking = false
            delete internalModel.motionManager.currentAudio
            delete internalModel.motionManager.currentAnalyzer
          },
        })

        const random = (bound: number): number => Math.floor(Math.random() * bound)
        const play = (): void => {
          // Hidden pets run no ticker; skip the blind motion/expression churn.
          if (!settings.visible || speaking) return
          void pet.motion(MOTION_GROUP, random(9))
          const expressions = pet.internalModel.motionManager?.expressionManager
          if (expressions !== undefined && Math.random() < 0.6) {
            expressions.setRandomExpression()
          }
        }
        void pet.motion(MOTION_GROUP, 0)
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
          // Same clamps as restorePosition: the pet never leaves the viewport.
          host.style.left = `${Math.min(Math.max(0, left), Math.max(0, window.innerWidth - host.offsetWidth))}px`
          host.style.top = `${Math.min(Math.max(0, top), Math.max(0, window.innerHeight - 80))}px`
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
          speech.dispose()
          host.removeEventListener('pointerdown', onPointerDown)
          host.removeEventListener('pointermove', onPointerMove)
          host.removeEventListener('pointerup', onPointerUp)
          pet.destroy()
          petApp.destroy(true, { children: true, texture: true })
        }
      } catch (error) {
        // A mid-boot failure (model 404, network) must not leave the app
        // rendering a detached canvas: destroy it, then surface the cause.
        petApp.destroy(true, { children: true, texture: true })
        throw error
      }
    })()
    boot.catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error)
      console.warn(`ui-live2d-avatar: pet unavailable (${message})`)
    })

    return () => {
      disposed = true
      applyVisibility = undefined
      applyAppearance = undefined
      teardown?.()
      host.remove()
    }
  }, 'ui-live2d-avatar: desktop pet')
}
