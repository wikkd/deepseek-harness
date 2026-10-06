// generate_image toolview row: the keyed Tool card for the image-generation
// tool. A settled result's content carries the durable image reference as its
// single source of truth; the row narrows it defensively (replayed logs arrive
// unvalidated) and renders the picture through the chat-supplied
// session-authorized loader, so this package owns no URL plumbing of its own.
//
// Claiming the `generate_image` key suppresses the generic fallback for EVERY
// generate_image result, so the row must cover every shape: a running call, a
// refusal (missing key, provider error), and a settled picture.

import { useEffect, useState } from 'react'
import type { ImageAttachmentRef, ImageMediaType } from '@deepseek-ai/dsh-attachment'
import type { ToolCallViewProps } from '@deepseek-ai/dsh-client-ui-tool/client'
import type { ToolCallBlock } from '@deepseek-ai/dsh-client-ui-chat/client'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'

/** Row props: the runtime share plus the framework-injected seat of our own namespace. */
type ImageGenRowProps = ToolCallViewProps & { t: TranslateNS<'image-gen'> }

/** The settled result node shape this row reads. */
type SettledBlock = Extract<ToolCallBlock, { readonly kind: 'tool-result' }>

/** The media types a durable image block may claim; anything else declines. */
const IMAGE_MEDIA_TYPES: ReadonlySet<string> = new Set([
  'image/png', 'image/jpeg', 'image/webp', 'image/gif',
])

/** One settled call's display material: the prompt label plus durable references. */
interface ImageGenCard {
  prompt: string
  images: readonly ImageAttachmentRef[]
  text: string
}

/** Whether a wire value is a positive integer. */
function positiveInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0
}

/**
 * Narrow the durable image references carried by the result's content blocks.
 * The content is the single source of truth; any malformed block declines the
 * whole gallery rather than rendering a partial one.
 * @param content - the settled result's content blocks.
 * @returns the references in order, or null when none is well-formed.
 */
function imageReferences(content: readonly unknown[]): ImageAttachmentRef[] | null {
  const refs: ImageAttachmentRef[] = []
  for (const part of content) {
    if (typeof part !== 'object' || part === null) continue
    const { type, attachment } = part as { type?: unknown; attachment?: unknown }
    if (type !== 'image') continue
    if (typeof attachment !== 'object' || attachment === null || Array.isArray(attachment)) return null
    const { attachmentId, mediaType, bytes, width, height, name } = attachment as Record<string, unknown>
    if (typeof attachmentId !== 'string' || attachmentId === '') return null
    if (typeof mediaType !== 'string' || !IMAGE_MEDIA_TYPES.has(mediaType)) return null
    if (!positiveInteger(bytes) || !positiveInteger(width) || !positiveInteger(height)) return null
    if (name !== undefined && typeof name !== 'string') return null
    refs.push({
      attachmentId: attachmentId as ImageAttachmentRef['attachmentId'],
      mediaType: mediaType as ImageMediaType,
      bytes,
      width,
      height,
      ...name === undefined ? {} : { name },
    })
  }
  return refs.length > 0 ? refs : null
}

/**
 * Derive the settled card from the result block and the call's own arguments.
 * @param block - the settled Tool result node.
 * @returns the card material, or null when the shape does not fit the card.
 */
function imageGenCard(block: SettledBlock): ImageGenCard | null {
  if (block.isError) return null
  const rawArgs: unknown = block.args
  const prompt = typeof rawArgs === 'object' && rawArgs !== null
    && typeof (rawArgs as Record<string, unknown>).prompt === 'string'
    && ((rawArgs as Record<string, unknown>).prompt as string).trim() !== ''
    ? ((rawArgs as Record<string, unknown>).prompt as string).trim()
    : null
  if (prompt === null) return null
  const refs = imageReferences(block.content)
  if (refs === null) return null
  const text = block.content
    .map((part) => typeof part === 'object' && part !== null && (part as { type?: unknown }).type === 'text'
      && typeof (part as { text?: unknown }).text === 'string' ? (part as { text: string }).text : '')
    .filter((text) => text !== '')
    .join('\n')
  return { prompt, images: refs, text }
}

/** One loaded picture: resolves the durable reference once, via the loader's peek cache when warm. */
function Picture({ attachment, loadImage, alt }: {
  attachment: ImageAttachmentRef
  loadImage: ImageGenRowProps['loadImage']
  alt: string
}) {
  const [src, setSrc] = useState<string | undefined>(() => loadImage.peek?.(attachment))
  useEffect(() => {
    if (src !== undefined) return
    let alive = true
    loadImage(attachment).then((url) => {
      if (alive) setSrc(url)
    }).catch(() => {})
    return () => {
      alive = false
    }
  }, [attachment, loadImage, src])
  if (src === undefined) return <div data-image-gen-placeholder="" />
  return <img src={src} alt={alt} data-image-gen-picture="" />
}

/**
 * The keyed `generate_image` Tool card.
 * @param props - the Tool view's owner currency: stage, block, loader, and locale seat.
 * @returns the card for the current call stage.
 */
export function ImageGenRow(props: ImageGenRowProps) {
  const { phase, block, loadImage, t } = props
  if (phase !== 'result') {
    return <div data-image-gen-row="">{t('pending')}</div>
  }
  const settled: SettledBlock = block
  if (settled.isError) {
    const message = settled.content
      .map((part) => typeof part === 'object' && part !== null && (part as { type?: unknown }).type === 'text'
        && typeof (part as { text?: unknown }).text === 'string' ? (part as { text: string }).text : '')
      .filter((text) => text !== '')
      .join(' ')
    return <div data-image-gen-row="">{`${t('failed')}${message === '' ? '' : ` ${message}`}`}</div>
  }
  const card = imageGenCard(block)
  if (card === null) {
    return <div data-image-gen-row="">{t('failed')}</div>
  }
  return (
    <div data-image-gen-row="">
      <div data-image-gen-prompt="">{card.prompt}</div>
      {card.images.map((attachment) => (
        <Picture key={attachment.attachmentId} attachment={attachment} loadImage={loadImage} alt={t('imageAlt')} />
      ))}
      {card.text === '' ? undefined : <div data-image-gen-note="">{card.text}</div>}
    </div>
  )
}
