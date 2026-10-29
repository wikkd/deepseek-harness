/** The onboarding artwork travels as files the Web shell serves, not as bundled bytes. */
import { expect, it } from 'vitest'
import { rechargeArt, welcomeArt } from '../src/client/onboarding-art.ts'

it('addresses the step artwork as shell-served files, so the client bundle carries no image bytes', () => {
  expect(welcomeArt.light).toBe('/onboarding/welcome.png')
  expect(welcomeArt.dark).toBe('/onboarding/welcome-dark.png')
  expect(welcomeArt.zhLight).toBe('/onboarding/welcome-zh.png')
  expect(welcomeArt.zhDark).toBe('/onboarding/welcome-zh-dark.png')
  expect(rechargeArt.light).toBe('/onboarding/recharge.png')
  expect(rechargeArt.dark).toBe('/onboarding/recharge-dark.png')
  expect(rechargeArt.zhLight).toBe('/onboarding/recharge-zh.png')
  expect(rechargeArt.zhDark).toBe('/onboarding/recharge-zh-dark.png')
})

it('keeps every artwork address a path, never an inlined data URI', () => {
  for (const url of [...Object.values(welcomeArt), ...Object.values(rechargeArt)]) {
    expect(url.startsWith('/onboarding/')).toBe(true)
    expect(url.startsWith('data:')).toBe(false)
  }
})
