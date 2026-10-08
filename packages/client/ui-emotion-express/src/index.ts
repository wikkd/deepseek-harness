/**
 * 小圆 emotion expressions, node half. The feature lives entirely in the
 * browser (session events are already observable client-side, and the pet
 * renders there); the node half exists only so the profile entry mounts a
 * valid plugin with no host-side behavior.
 * @module @deepseek-ai/dsh-client-ui-emotion-express
 */

/**
 * Install the node half: nothing to do — the browser half owns the feature.
 * @returns void; kept for the Service Definition convention.
 */
export function apply(): void {}
