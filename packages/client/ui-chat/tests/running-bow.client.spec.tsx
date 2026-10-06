// @vitest-environment jsdom

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { RunningBow } from '../src/client/chat/RunningBow.tsx'

afterEach(cleanup)

describe('RunningBow', () => {
  it('renders a decorative mask seat and static SVG without inline styles', () => {
    const view = render(<RunningBow />)
    const icon = view.container.firstElementChild!
    expect(icon.tagName).toBe('SPAN')
    expect(icon.getAttribute('aria-hidden')).toBe('true')
    expect(icon.children).toHaveLength(2)
    expect(icon.firstElementChild?.tagName).toBe('SPAN')
    expect(icon.firstElementChild?.childElementCount).toBe(0)
    const svg = icon.querySelector('svg')!
    expect(icon.lastElementChild).toBe(svg)
    expect(svg.getAttribute('viewBox')).toBe('0 0 16 16')
    expect(svg.querySelectorAll('path')).toHaveLength(1)
    expect(svg.querySelector('path')?.getAttribute('d')).toMatch(/^M/)
    expect(svg.querySelector('path')?.getAttribute('stroke')).toBe('currentColor')
    expect(view.container.querySelector('animate')).toBeNull()
    expect(view.container.querySelector('[style]')).toBeNull()
  })

  it('ships a static white-on-black bow mask that the CSS animates by luminance', () => {
    const png = readFileSync(resolve(import.meta.dirname, '../src/client/chat/running-bow.png'))
    expect([...png.subarray(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10])
    const chunks: { type: string; data: Buffer }[] = []
    for (let offset = 8; offset < png.length;) {
      const length = png.readUInt32BE(offset)
      const end = offset + 12 + length
      expect(end).toBeLessThanOrEqual(png.length)
      chunks.push({ type: png.toString('ascii', offset + 4, offset + 8), data: png.subarray(offset + 8, end - 4) })
      offset = end
    }
    expect(chunks.at(-1)?.type).toBe('IEND')
    // A static mask: the breathing motion lives in CSS, so no APNG frames.
    expect(chunks.filter(chunk => chunk.type === 'acTL')).toHaveLength(0)
    const header = chunks.find(chunk => chunk.type === 'IHDR')!.data
    expect([header.readUInt32BE(0), header.readUInt32BE(4)]).toEqual([512, 512])
  })
})
