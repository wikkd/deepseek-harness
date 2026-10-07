/** Lip-sync driver: inert outside the browser; settings-row dictionaries share one key set. */
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
})

describe('settings row dictionaries', () => {
  it('share one key set across locales', () => {
    expect(Object.keys(en).sort()).toEqual(Object.keys(zh).sort())
  })
})
