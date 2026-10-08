/**
 * Rule-based emotion classification over assistant reply text. Lexicon and
 * punctuation cues vote for one of five emotion keys; ties and empty votes
 * resolve to `neutral`. The classifier is a pure function with no
 * dependencies, so both the client half and the tests import it directly.
 * @module @deepseek-ai/dsh-client-ui-emotion-express/classifier
 */

/** The emotion keys every consumer (expression mapping) must cover. */
export type EmotionKey = 'happy' | 'angry' | 'sad' | 'surprised' | 'neutral'

/**
 * Weighted Chinese/English lexicon fragments per non-neutral emotion.
 * Fragments are matched with `String.includes` on the raw text — entries are
 * deliberately multi-character where a single character would over-match
 * (e.g. 「哭」 instead of 「哭」's components).
 */
export const EMOTION_LEXICON: Readonly<Record<Exclude<EmotionKey, 'neutral'>, readonly string[]>> = {
  happy: [
    '哈哈', '嘿嘿', '嘻嘻', '开心', '高兴', '快乐', '愉快', '欢喜', '喜欢',
    '太好了', '好耶', '太棒', '不错', '成功', '搞定', '完成', '恭喜', '庆祝', '欢呼',
    '幸福', '满意', '惊喜', '没问题', '当然可以', '很高兴',
    'happy', 'great', 'nice', 'awesome', 'yay', 'smile', 'glad', 'wonderful',
  ],
  angry: [
    '生气', '愤怒', '气死', '可恶', '讨厌', '烦人', '岂有此理', '混蛋', '可恨',
    '住手', '不许', '禁止', '过分', '火大', '恼火', '恼怒',
    'angry', 'furious', 'annoying', 'hate', 'stop it',
  ],
  sad: [
    '呜呜', '哭泣', '眼泪', '伤心', '难过', '悲伤', '悲哀', '委屈',
    '可惜', '遗憾', '抱歉', '对不起', '失败', '心碎', '沮丧', '失落',
    '孤单', '寂寞', '唉',
    'sad', 'sorry', 'unfortunately', 'cry', 'tears', 'lonely',
  ],
  surprised: [
    '诶？', '欸？', '咦', '哇', '天哪', '天啊', '我的天', '竟然', '居然', '没想到',
    '难以置信', '不会吧', '真的吗', '是吗', '什么？！', '震惊', '目瞪口呆',
    'wow', 'what', 'really', 'unbelievable', 'omg', 'surprised',
  ],
}

/** Punctuation/semiotic cue weights; matched against the raw text. */
const HAPPY_MARKS = ['～', '♪', '☆', '(＾▽＾)', '(*^▽^*)', '^_^', '😊', '😄', '🎉', '✨'] as const
/** Exclamation and question patterns vote per occurrence, capped. */
const MARK_CAP = 3

/**
 * Count occurrences of one fragment in the text.
 * @param text - text to scan.
 * @param fragment - literal fragment.
 * @returns occurrence count.
 */
function countOccurrences(text: string, fragment: string): number {
  let count = 0
  let index = text.indexOf(fragment)
  while (index !== -1) {
    count += 1
    index = text.indexOf(fragment, index + fragment.length)
  }
  return count
}

/**
 * Classify one assistant reply's visible text into an emotion key.
 * @param text - visible assistant prose (markdown included; markers are text cues too).
 * @returns the winning emotion; `neutral` when the text is empty or the vote ties.
 */
export function classifyEmotion(text: string): EmotionKey {
  if (text.trim() === '') return 'neutral'
  const scores: Record<EmotionKey, number> = {
    happy: 0, angry: 0, sad: 0, surprised: 0, neutral: 0,
  }
  for (const [emotion, fragments] of Object.entries(EMOTION_LEXICON) as
    readonly [Exclude<EmotionKey, 'neutral'>, readonly string[]][]) {
    for (const fragment of fragments) {
      scores[emotion] += countOccurrences(text.toLowerCase(), fragment.toLowerCase())
    }
  }
  for (const mark of HAPPY_MARKS) scores.happy += countOccurrences(text, mark)
  scores.happy += Math.min(countOccurrences(text, '！'), MARK_CAP)
  scores.happy += Math.min(countOccurrences(text, '!'), MARK_CAP)
  scores.surprised += Math.min(countOccurrences(text, '？！'), MARK_CAP)
  scores.surprised += Math.min(countOccurrences(text, '?!'), MARK_CAP)
  scores.surprised += Math.min(countOccurrences(text, '？'), MARK_CAP)
  scores.sad += Math.min(countOccurrences(text, '……'), MARK_CAP)
  scores.sad += Math.min(countOccurrences(text, '...'), MARK_CAP)
  let best: EmotionKey = 'neutral'
  let bestScore = 0
  let tie = false
  for (const emotion of ['happy', 'angry', 'sad', 'surprised'] as const) {
    if (scores[emotion] > bestScore) {
      best = emotion
      bestScore = scores[emotion]
      tie = false
    } else if (scores[emotion] === bestScore && scores[emotion] > 0) {
      tie = true
    }
  }
  return tie ? 'neutral' : best
}

/**
 * Extract the visible text blocks of one assistant message payload, skipping
 * reasoning and non-text blocks the user never sees.
 * @param content - the message's content blocks.
 * @returns concatenated visible text (possibly empty).
 */
export function visibleAssistantText(content: readonly { readonly type: string; readonly text?: string }[]): string {
  return content
    .filter(block => block.type === 'text' && typeof block.text === 'string')
    .map(block => block.text ?? '')
    .join('\n')
}
