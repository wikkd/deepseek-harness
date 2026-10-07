/** File identity, inline image preview, Sidebar preview, and contributed native actions for one delivery. */
import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { fileMediaUrl, resolveWorkspacePath } from '@deepseek-ai/dsh-util-workspace-path'
import { FileTypeIcon, fileExtension } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { PresentedHost } from '../presented.ts'
import { PRESENTED_SUCCESS_HOLD_MS, PRESENTED_SUCCESS_FADE_MS, type PresentedOpenPhase } from './present-open.ts'
import { basename, type PresentedPath } from './turn-deliverables.ts'
import type { NS } from './locales.ts'
import css from './Deliverables.module.css'

/** The media extensions the authenticated file route can show as an inline thumbnail. */
const IMAGE_EXTENSIONS: ReadonlySet<string> = new Set(['png', 'jpg', 'jpeg', 'webp', 'gif', 'svg'])

function cardDescription(description: string | undefined, fallback: string): string {
  const trimmed = description?.replace(/\s*(?:\([^()]*\)|（[^（）]*）)\s*$/u, '').trim()
  return trimmed === undefined || trimmed === '' ? fallback : trimmed
}

/**
 * The inline preview URL for an image file: the session-authorized media route
 * over the absolute workspace path. Undefined for non-images and for paths the
 * route cannot address (no workspace root yet, or an unresolvable relative
 * path), which falls back to the type icon.
 * @param cwd - session workspace root, when known.
 * @param path - delivered file path, relative or absolute.
 * @returns the media URL, or undefined when no thumbnail applies.
 */
function previewUrl(cwd: string | undefined, path: string): string | undefined {
  const extension = fileExtension(basename(path)).toLowerCase()
  if (!IMAGE_EXTENSIONS.has(extension)) return undefined
  return fileMediaUrl(document.baseURI, resolveWorkspacePath(cwd, path))
}

/**
 * The icon block's content: the picture once decoded, otherwise the type icon.
 * A decode failure (deleted file, unsupported media) is permanent for that URL
 * and falls back; a changed URL (a rewritten file) retries the load.
 * @param props - resolved media URL, file path for the icon, icon size, and locale seat.
 * @returns the thumbnail image or the type icon.
 */
function FileThumbnail({ url, path, size, t }: {
  url: string | undefined
  path: string
  size: number
  t: (key: 'presented.imageAlt', values: { name: string }) => string
}) {
  const [failed, setFailed] = useState(false)
  useEffect(() => { setFailed(false) }, [url])
  if (url === undefined || failed) return <FileTypeIcon path={path} size={size} />
  return <img className={css.fileThumbnail} src={url}
    alt={t('presented.imageAlt', { name: basename(path) })}
    onError={() => { setFailed(true) }} draggable={false} />
}

/**
 * Render independent file actions without nesting buttons inside a clickable card.
 * @param props - durable file metadata, Sidebar preview, Host capabilities, gesture status, and localized copy.
 * @returns the file card and its anchored action menu.
 */
export function PresentedFileCard({ file, cwd, phase, host, onPreview, actions, t }: {
  file: PresentedPath
  cwd: string | undefined
  phase: PresentedOpenPhase | undefined
  host: PresentedHost | null
  onPreview: () => void
  actions: ReactNode
} & PropsLocale<typeof NS>) {
  const succeeded = phase === 'opened' || phase === 'revealed'
  const reveal = host?.fileManager ?? 'directory'
  const name = basename(file.path)
  const metadata = fileExtension(name).toUpperCase() || t('presented.file')
  const thumbnail = previewUrl(cwd, file.path)
  const status = phase === undefined
    ? cardDescription(file.description, metadata)
    : t(reveal === 'directory' && phase === 'revealed' ? 'presented.directoryOpened'
      : reveal === 'directory' && phase === 'revealing' ? 'presented.directoryOpening'
        : reveal === 'directory' && phase === 'revealError' ? 'presented.directoryError' : `presented.${phase}`)
  return <div className={css.file} data-presented-file>
    <button type="button" className={css.cardPreview} title={resolveWorkspacePath(cwd, file.path)}
      aria-label={t('presented.previewCard', { name: file.path })} onClick={onPreview} />
    <span className={css.fileIcon}><FileThumbnail url={thumbnail} path={file.path} size={20} t={t} /></span>
    <div className={css.fileBody}>
      <div className={css.details}>
        <span className={css.fileName}>{name}</span>
        <span className={css.description} data-presented-description role={phase === undefined ? undefined : 'status'}
          data-error={phase === 'error' || phase === 'revealError' || phase === 'nativeUnavailable' ? true : undefined}>
          <span className={css.secondaryText} data-success={succeeded || undefined}
            style={succeeded ? { animationDelay: `${PRESENTED_SUCCESS_HOLD_MS}ms`, animationDuration: `${PRESENTED_SUCCESS_FADE_MS}ms` } : undefined}>
            {status}
          </span>
          <span className={css.previewHint}>{t('presented.preview')}</span>
        </span>
      </div>
      <div className={css.actions}>{actions}</div>
    </div>
  </div>
}
