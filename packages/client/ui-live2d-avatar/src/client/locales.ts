/** `settings.live2dAvatar` namespace dictionary (the desktop-pet row's copy). */

/** Simplified Chinese dictionary (the key-set source of truth). */
export const zh = {
  'pet.nav': '桌宠',
  'pet.title': '小圆桌宠',
  'pet.description': '在页面角落显示小圆；朗读回复时她的口型会跟着声音动',
  'pet.size': '大小',
  'pet.size.small': '小',
  'pet.size.standard': '标准',
  'pet.size.large': '大',
  'pet.opacity': '透明度',
  'pet.opacity.opaque': '不透明',
  'pet.opacity.translucent': '半透明',
  'pet.opacity.faint': '隐约',
  'pet.anchor': '停靠',
  'pet.anchor.left': '左下角',
  'pet.anchor.right': '右下角',
  'pet.rate': '动作频率',
  'pet.rate.calm': '安静',
  'pet.rate.normal': '标准',
  'pet.rate.lively': '活泼',
  'pet.lipSync': '口型跟随',
  'pet.lipSync.on': '开',
  'pet.lipSync.off': '关',
  'pet.resetPosition': '重置位置',
} satisfies Record<string, string>

/** The settings.live2dAvatar namespace key union. */
export type PetSettingsKey = keyof typeof zh

/** English dictionary, checked complete against the zh key set. */
export const en = {
  'pet.nav': 'Desktop pet',
  'pet.title': 'Madoka desktop pet',
  'pet.description': 'Show Madoka in a corner; her mouth follows the spoken replies',
  'pet.size': 'Size',
  'pet.size.small': 'Small',
  'pet.size.standard': 'Standard',
  'pet.size.large': 'Large',
  'pet.opacity': 'Opacity',
  'pet.opacity.opaque': 'Opaque',
  'pet.opacity.translucent': 'Translucent',
  'pet.opacity.faint': 'Faint',
  'pet.anchor': 'Dock',
  'pet.anchor.left': 'Bottom left',
  'pet.anchor.right': 'Bottom right',
  'pet.rate': 'Motion tempo',
  'pet.rate.calm': 'Calm',
  'pet.rate.normal': 'Standard',
  'pet.rate.lively': 'Lively',
  'pet.lipSync': 'Lip sync',
  'pet.lipSync.on': 'On',
  'pet.lipSync.off': 'Off',
  'pet.resetPosition': 'Reset position',
} satisfies Record<PetSettingsKey, string>
