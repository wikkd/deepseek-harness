/** Locale bundles for the long-term memory settings page. */

/** Locale keys the page renders. */
export type MemorySettingsKey =
  | 'nav' | 'title' | 'description'
  | 'loading' | 'retry'
  | 'consentTitle' | 'consentBody' | 'consentAction'
  | 'enabledLabel' | 'enabledHint' | 'disabledHint'
  | 'addPlaceholder' | 'kindLabel' | 'kindUser' | 'kindPreference' | 'kindFact' | 'add'
  | 'empty' | 'edit' | 'editText' | 'save' | 'cancel' | 'delete'
  | 'clear' | 'clearConfirm' | 'clearConfirmHint'

/** English copy. */
export const en: Record<MemorySettingsKey, string> = {
  nav: 'Memory',
  title: 'Long-term memory',
  description: 'Little Yua can remember things you explicitly ask her to keep. Memories stay on this computer and are never sent anywhere for storage.',
  loading: 'Reading memories…',
  retry: 'Try again',
  consentTitle: 'Remember things across conversations',
  consentBody: 'When this is on, you can ask Little Yua to remember a preference or detail. She can then use it in later conversations. You can view, edit, or delete every memory here, and turn the feature off at any time.',
  consentAction: 'Agree and turn on memory',
  enabledLabel: 'Long-term memory',
  enabledHint: 'On. Little Yua may save things you ask her to remember.',
  disabledHint: 'Off. Saved memories stay here but are not given to Little Yua.',
  addPlaceholder: 'Something you want Little Yua to remember',
  kindLabel: 'Memory kind',
  kindUser: 'About you',
  kindPreference: 'Preference',
  kindFact: 'Other fact',
  add: 'Save',
  empty: 'No memories saved yet.',
  edit: 'Edit',
  editText: 'Memory text',
  save: 'Save',
  cancel: 'Cancel',
  delete: 'Delete',
  clear: 'Clear all',
  clearConfirm: 'Clear everything',
  clearConfirmHint: 'This cannot be undone.',
}

/** Chinese copy. */
export const zh: Record<MemorySettingsKey, string> = {
  nav: '记忆',
  title: '长期记忆',
  description: '小圆可以记住你明确让她记住的事情。记忆只保存在这台电脑上，不会上传到任何地方。',
  loading: '正在读取记忆…',
  retry: '再试一次',
  consentTitle: '让小圆记住跨对话的事',
  consentBody: '开启后，你可以让小圆记住某个偏好或细节，她会在之后的对话里用上。所有记忆都可以在这里查看、修改或删除，也可以随时关闭这个功能。',
  consentAction: '同意并开启记忆',
  enabledLabel: '长期记忆',
  enabledHint: '已开启。小圆可以保存你让她记住的事情。',
  disabledHint: '已关闭。已保存的记忆还在，但不会提供给小圆。',
  addPlaceholder: '想让小圆记住的事',
  kindLabel: '记忆类型',
  kindUser: '关于你',
  kindPreference: '偏好',
  kindFact: '其他事实',
  add: '保存',
  empty: '还没有保存的记忆。',
  edit: '修改',
  editText: '记忆内容',
  save: '保存',
  cancel: '取消',
  delete: '删除',
  clear: '清空全部',
  clearConfirm: '确认清空',
  clearConfirmHint: '清空后无法恢复。',
}
