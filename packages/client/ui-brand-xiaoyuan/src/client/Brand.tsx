/** The 小圆 product brand artwork, locale-driven so the client copy stays locale-owned. */
import type { HeroBrandMarkOwnerProps } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { SidebarBrandMarkOwnerProps } from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import brandMark from './assets/brand-mark.png'

/** Shared circular presentation: the avatar artwork is square and reads as a badge. */
const markStyle = { borderRadius: '50%', display: 'block', objectFit: 'cover' } as const

/**
 * Render the product avatar at the sidebar's requested square edge.
 * @param props - Host-supplied mark presentation.
 * @returns the circular product avatar.
 */
export function BrandMark({ size }: SidebarBrandMarkOwnerProps) {
  return <img src={brandMark} width={size} height={size} style={markStyle} alt="" />
}

/**
 * Render the product avatar in the blank-session hero, keeping the host
 * geometry class so the hover sway still plays over the mark.
 * @param props - Host-supplied mark presentation.
 * @returns the circular product avatar.
 */
export function HeroBrandMark({ size, className }: HeroBrandMarkOwnerProps) {
  return <img src={brandMark} width={size} height={size} className={className} style={markStyle} alt="" />
}

/**
 * Render the product name without the local-build version badge.
 * @param props - sidebar locale seat bound by the renderer.
 * @returns the plain product wordmark.
 */
export function BrandName({ t }: PropsLocale<'sidebar'>) {
  return <span style={{ fontSize: 17, letterSpacing: 0, whiteSpace: 'nowrap' }}>{t('brand.product')}</span>
}
