/** Locale-owned copy for the generate_image tool card. */
import type {} from '@deepseek-ai/dsh-client-ui-slots'

/** Dictionary namespace for the image-generation tool card. */
export const NS = 'image-gen'

/** Chinese dictionary and key source. */
export const zh = {
  pending: '正在生成图像…',
  failed: '图像生成失败',
  imageAlt: '生成的图像',
}

/** English dictionary. */
export const en = {
  pending: 'Generating image…',
  failed: 'Image generation failed',
  imageAlt: 'Generated image',
}

/** Keys of the image-generation tool-card dictionary. */
export type ImageGenKey = keyof typeof zh

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Picture card of the generate_image tool. */
    'image-gen': ImageGenKey
  }
}
