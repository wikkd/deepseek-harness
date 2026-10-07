/** `settings.live2dAvatar` namespace dictionary (the desktop-pet row's copy). */

/** Simplified Chinese dictionary (the key-set source of truth). */
export const zh = {
  'pet.title': '小圆桌宠',
  'pet.description': '在页面右下角显示小圆；朗读回复时她的口型会跟着声音动',
} satisfies Record<string, string>

/** The settings.live2dAvatar namespace key union. */
export type PetSettingsKey = keyof typeof zh

/** English dictionary, checked complete against the zh key set. */
export const en = {
  'pet.title': 'Madoka desktop pet',
  'pet.description': 'Show Madoka in the lower-right corner; her mouth follows the spoken replies',
} satisfies Record<PetSettingsKey, string>
