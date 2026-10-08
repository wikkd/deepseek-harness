/** Lip-sync driver: inert outside the browser, browser-path via stubs; locale key parity. */
import { describe, expect, it, vi } from 'vitest'
import { installLipSync } from '../src/client/lip-sync.ts'
import { en, zh } from '../src/client/locales.ts'

describe('installLipSync', () => {
  it('returns an inert driver outside the browser', () => {
    // This lane has no window, so the wrapper cannot install; the driver must
    // still be safe to dispose and must never call the hooks.
    const tap = vi.fn()
    const untap = vi.fn()
    const driver = installLipSync({ tap, untap })
    expect(() => driver.dispose()).not.toThrow()
    expect(tap).not.toHaveBeenCalled()
    expect(untap).not.toHaveBeenCalled()
  })

  describe('browser path (stubbed window)', () => {
    /** Flush the driver's resume().then continuation. */
    const flush = (): Promise<void> => new Promise(resolve => { setTimeout(resolve, 0) })

    /** A fake audio element: an EventTarget the instanceof check accepts. */
    class FakeAudioElement extends EventTarget {
      paused = true
    }

    /**
     * A fake AudioContext. `running` controls whether resume() reaches the
     * running state; `throwOnSource` simulates losing the media-source race.
     */
    class FakeAudioContext {
      static running = true
      static throwOnSource = false
      state = 'suspended'
      destination = {}
      resume = async (): Promise<void> => {
        if (FakeAudioContext.running) this.state = 'running'
      }
      createMediaElementSource = (): { connect(): void } => {
        if (FakeAudioContext.throwOnSource) {
          throw new Error('HTMLMediaElement already connected previously')
        }
        return { connect: () => {} }
      }
      createAnalyser = (): { fftSize: number; connect(): void } => ({ fftSize: 0, connect: () => {} })
    }

    /** Fake browser globals; restored after each case. */
    const stubBrowser = (): void => {
      vi.stubGlobal('HTMLAudioElement', FakeAudioElement)
      vi.stubGlobal('AudioContext', FakeAudioContext)
      vi.stubGlobal('window', { Audio: FakeAudioElement })
    }

    /** A playing element observed through the wrapped constructor. */
    const playAnElement = (): FakeAudioElement => {
      const element = new (window.Audio as unknown as typeof FakeAudioElement)()
      element.paused = false
      element.dispatchEvent(new Event('play'))
      return element
    }

    it('reports onUnavailable and untap when the context never runs', async () => {
      stubBrowser()
      FakeAudioContext.running = false
      const tap = vi.fn()
      const untap = vi.fn()
      const onUnavailable = vi.fn()
      const driver = installLipSync({ tap, untap, onUnavailable })
      const element = playAnElement()
      await flush()
      expect(onUnavailable).toHaveBeenCalledTimes(1)
      expect(tap).not.toHaveBeenCalled()
      // The untapped playback still ends: pause fires untap for the fallback cue.
      element.paused = true
      element.dispatchEvent(new Event('pause'))
      expect(untap).toHaveBeenCalledTimes(1)
      driver.dispose()
      expect(untap).toHaveBeenCalledTimes(1)
      vi.unstubAllGlobals()
    })

    it('reports onUnavailable and untap when the media source race is lost', async () => {
      stubBrowser()
      FakeAudioContext.running = true
      FakeAudioContext.throwOnSource = true
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
      const tap = vi.fn()
      const untap = vi.fn()
      const onUnavailable = vi.fn()
      const driver = installLipSync({ tap, untap, onUnavailable })
      const element = playAnElement()
      await flush()
      expect(onUnavailable).toHaveBeenCalledTimes(1)
      expect(tap).not.toHaveBeenCalled()
      element.paused = true
      element.dispatchEvent(new Event('pause'))
      expect(untap).toHaveBeenCalledTimes(1)
      driver.dispose()
      warn.mockRestore()
      vi.unstubAllGlobals()
    })

    it('taps a playing element and untaps when it stops', async () => {
      stubBrowser()
      FakeAudioContext.running = true
      FakeAudioContext.throwOnSource = false
      const tap = vi.fn()
      const untap = vi.fn()
      const driver = installLipSync({ tap, untap })
      const element = playAnElement()
      await flush()
      expect(tap).toHaveBeenCalledWith(element, expect.objectContaining({ fftSize: 1024 }))
      element.paused = true
      element.dispatchEvent(new Event('ended'))
      expect(untap).toHaveBeenCalledTimes(1)
      driver.dispose()
      vi.unstubAllGlobals()
    })

    it('untaps on dispose while a playback is observed', () => {
      stubBrowser()
      FakeAudioContext.running = true
      const untap = vi.fn()
      const driver = installLipSync({ tap: vi.fn(), untap })
      playAnElement()
      driver.dispose()
      expect(untap).toHaveBeenCalledTimes(1)
      vi.unstubAllGlobals()
    })
  })
})

describe('settings row dictionaries', () => {
  it('share one key set across locales', () => {
    expect(Object.keys(en).sort()).toEqual(Object.keys(zh).sort())
  })
})
