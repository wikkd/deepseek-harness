/** Bow mask and static SVG fallback for the running Chat status. */
import css from './ChatView.module.css'

/** Static bow outline for reduced-motion and no-mask-support fallbacks. */
const REST_PATH = 'M8 8C5.6 4.6 1.6 4.9 2 7.9 2.4 10.9 6.2 10.6 8 8M8 8C10.4 4.6 14.4 4.9 14 7.9 13.6 10.9 9.8 10.6 8 8M6.7 8A1.3 1.3 0 1 0 9.3 8A1.3 1.3 0 1 0 6.7 8'

/**
 * Render the decorative running icon; the bow mask breathes through CSS in
 * motion-capable browsers and falls back to the static outline otherwise.
 * @returns mask and static SVG selected by browser capabilities and accessibility preferences.
 */
export function RunningBow() {
  return (
    <span className={css.runningIcon} aria-hidden="true">
      <span className={css.runningBowAnimated} />
      <svg className={css.runningBowStill} width="100%" height="100%" viewBox="0 0 16 16" fill="none">
        <path d={REST_PATH} stroke="currentColor" strokeWidth={1} />
      </svg>
    </span>
  )
}
