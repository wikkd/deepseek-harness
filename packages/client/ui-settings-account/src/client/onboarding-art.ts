/**
 * Onboarding illustration URLs.
 *
 * The 3× Figma artwork is megabytes of PNG that only the Desktop onboarding
 * shows, so the Web shell serves it as static files and the browser fetches the
 * variant the current locale and theme need when the step renders. Inlining it
 * as base64 instead would ship every variant inside the client bundle, which
 * every browser parses on the first paint of every session.
 */

/** Static artwork directory served by the Web shell. */
const ART_BASE = '/onboarding'

/** Welcome step artwork, in both locales and themes. */
export const welcomeArt = {
  light: `${ART_BASE}/welcome.png`,
  dark: `${ART_BASE}/welcome-dark.png`,
  zhLight: `${ART_BASE}/welcome-zh.png`,
  zhDark: `${ART_BASE}/welcome-zh-dark.png`,
} as const

/** Credit step artwork, in both locales and themes. */
export const rechargeArt = {
  light: `${ART_BASE}/recharge.png`,
  dark: `${ART_BASE}/recharge-dark.png`,
  zhLight: `${ART_BASE}/recharge-zh.png`,
  zhDark: `${ART_BASE}/recharge-zh-dark.png`,
} as const
