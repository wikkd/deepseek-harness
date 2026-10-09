/**
 * Browser stand-in for the Node `url` builtin. `@pixi/utils` requires the
 * builtin for its deprecated helpers, and `Cubism4ModelSettings.resolveURL`
 * calls `url.resolve(base, path)` to build model texture URLs, so `resolve`
 * must work for path-only bases; the remaining names stay no-ops.
 */

/**
 * Resolve `relative` against `base` the way the Node builtin does.
 * @param base - base URL or path.
 * @param relative - relative path to append, absolute path, or full URL.
 * @returns the joined URL string.
 */
export function resolve(base: string, relative: string): string {
  if (relative === '') return base
  if (/^[a-z][a-z0-9+.-]*:/i.test(relative) || relative.startsWith('/')) return relative
  const dir = base.slice(0, base.lastIndexOf('/') + 1)
  const segments = `${dir}${relative}`.split('/')
  const resolved: string[] = []
  for (const segment of segments) {
    if (segment === '' || segment === '.') continue
    if (segment === '..') resolved.pop()
    else resolved.push(segment)
  }
  return `/${resolved.join('/')}`
}

/**
 * No-op parse; pixi's deprecated `utils.url.parse` is dead code for the pet.
 * @returns undefined — the stub never parses paths.
 */
export function parse(): undefined {
  return undefined
}

/**
 * No-op format; see {@link parse}.
 * @returns an empty string — the stub never formats paths.
 */
export function format(): string {
  return ''
}

/**
 * No-op inverse of {@link resolve}; see {@link parse}.
 * @returns undefined — the stub never resolves paths.
 */
export function resolveObject(): undefined {
  return undefined
}


/** No-op Url constructor stand-in. */
export class Url {
  /** Matches the Node builtin's shape loosely; never exercised by the pet. */
  protocol = ''
  /** Matches the Node builtin's shape loosely; never exercised by the pet. */
  host = ''
  /** Matches the Node builtin's shape loosely; never exercised by the pet. */
  pathname = ''
}
