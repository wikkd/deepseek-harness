/**
 * Lip-sync tap for the desktop pet. The TTS plugin (`dsh-tts`) plays every
 * spoken reply through `new Audio(blobUrl)` elements it never mounts in the
 * DOM and exposes no playback events, so the only plugin-level observation
 * point is the `Audio` constructor itself. This module wraps the constructor
 * and hands each playing element plus a shared `AnalyserNode` to the caller,
 * which feeds them into the Live2D motion manager's own lip-sync path
 * (`currentAudio`/`currentAnalyzer`).
 * @module @deepseek-ai/dsh-client-ui-live2d-avatar/client/lip-sync
 */

/** Analyser resolution; 1024 samples is roughly 21ms of audio per reading. */
const FFT_SIZE = 1024

/** Callbacks mirroring the tap lifecycle into the Live2D motion manager. */
export interface LipSyncHooks {
  /**
   * An observed element is now playing and tapped for analysis.
   * @param element - the playing audio element.
   * @param analyser - the analyser attached to it.
   */
  tap(element: HTMLAudioElement, analyser: AnalyserNode): void
  /** The tapped element stopped; lip sync should close the mouth. */
  untap(): void
}

/** Audio observation plus its teardown. */
export interface LipSyncDriver {
  /** Restore the previous `Audio` constructor and stop observing. */
  dispose(): void
}

/**
 * Wrap `window.Audio` and report playing elements with their analyser.
 * Installing the wrapper never changes playback: elements keep sounding even
 * before the tap attaches, and an element that already carries a media source
 * from another tapper stays untapped.
 * @param hooks - tap lifecycle receiver.
 * @returns the driver. Disposing restores the previous constructor value; the
 *   shared AudioContext is deliberately left open because an element already
 *   routed through it would fall silent if it closed.
 */
export function installLipSync(hooks: LipSyncHooks): LipSyncDriver {
  if (typeof window === 'undefined' || typeof window.Audio === 'undefined') {
    return { dispose: () => {} }
  }
  const native = window.Audio
  const graphs = new WeakMap<HTMLAudioElement, AnalyserNode>()
  let tapped: HTMLAudioElement | undefined
  let context: AudioContext | undefined
  let disposed = false

  const attach = (element: HTMLAudioElement): void => {
    if (context === undefined || context.state !== 'running' || disposed) return
    let analyser = graphs.get(element)
    if (analyser === undefined) {
      try {
        const source = context.createMediaElementSource(element)
        analyser = context.createAnalyser()
        analyser.fftSize = FFT_SIZE
        source.connect(analyser)
        analyser.connect(context.destination)
        graphs.set(element, analyser)
      } catch (error) {
        // An element accepts only one media source; if another tapper won the
        // race, playback continues and the pet simply keeps a closed mouth.
        const message = error instanceof Error ? error.message : String(error)
        console.warn(`ui-live2d-avatar: lip-sync tap unavailable (${message})`)
        return
      }
    }
    // A resumed element already carries its graph; the tap must re-engage so
    // the caller's currentAudio/currentAnalyzer pair tracks this playback.
    tapped = element
    hooks.tap(element, analyser)
  }

  const onPlay = (event: Event): void => {
    const element = event.currentTarget
    if (!(element instanceof HTMLAudioElement) || disposed) return
    context ??= new AudioContext()
    // A media source permanently reroutes its element, so attach only once
    // the context actually runs — attaching against a suspended context
    // would mute the element instead of just skipping the tap.
    void context.resume().then(() => {
      if (!disposed && !element.paused) attach(element)
    })
  }

  const onStop = (event: Event): void => {
    const element = event.currentTarget
    if (!(element instanceof HTMLAudioElement)) return
    if (tapped === element) {
      tapped = undefined
      hooks.untap()
    }
  }

  const tracked = new Proxy(native, {
    construct(target, args, newTarget) {
      const element: HTMLAudioElement = Reflect.construct(target, args, newTarget)
      element.addEventListener('play', onPlay)
      element.addEventListener('pause', onStop)
      element.addEventListener('ended', onStop)
      return element
    },
  })
  window.Audio = tracked

  return {
    dispose: () => {
      disposed = true
      if (tapped !== undefined) {
        tapped = undefined
        hooks.untap()
      }
      if (window.Audio === tracked) window.Audio = native
    },
  }
}
