// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { expect, it } from 'vitest'

/**
 * The dialog card keeps its own content readable: a theme may tint its
 * floating layers translucently, and the page behind a dialog must never show
 * through it. The contract lives in the stylesheet, so it is read there.
 */
it('paints the dialog card with the opaque surface, not a tintable layer', () => {
  const sheet = readFileSync(resolve(import.meta.dirname, '../src/Modal.module.css'), 'utf8')
  const rule = sheet.match(/\.dialog\s*\{[^}]*\}/)?.[0] ?? ''
  expect(rule).toContain('var(--dsw-alias-bg-opaque)')
  expect(rule).not.toContain('var(--dsw-alias-bg-layer-')
})
