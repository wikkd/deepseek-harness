/** classifyEmotion votes over the lexicon and punctuation cues; ties resolve neutral. */
import { describe, expect, it } from 'vitest'
import { classifyEmotion, visibleAssistantText } from '../src/classifier.ts'

describe('classifyEmotion', () => {
  it('returns neutral for empty and whitespace-only text', () => {
    expect(classifyEmotion('')).toBe('neutral')
    expect(classifyEmotion('   \n  ')).toBe('neutral')
  })

  it('classifies happy replies by lexicon hits', () => {
    expect(classifyEmotion('太好了，我们成功搞定啦！哈哈')).toBe('happy')
  })

  it('classifies angry replies by lexicon hits', () => {
    expect(classifyEmotion('哼，真是岂有此理，太可恶了！')).toBe('angry')
  })

  it('classifies sad replies by lexicon hits', () => {
    expect(classifyEmotion('呜呜……真的很遗憾，失败了。')).toBe('sad')
  })

  it('classifies surprised replies by lexicon hits', () => {
    expect(classifyEmotion('诶？！竟然会是这样，没想到。')).toBe('surprised')
  })

  it('counts exclamation marks toward happy within the cap', () => {
    expect(classifyEmotion('好的！')).toBe('happy')
  })

  it('counts interrobangs toward surprised over happy', () => {
    expect(classifyEmotion('什么？！')).toBe('surprised')
  })

  it('returns neutral when no cue matches', () => {
    expect(classifyEmotion('这是一段普通的说明文字，描述了函数的用法。')).toBe('neutral')
  })

  it('returns neutral on an exact tie between emotions', () => {
    // 哈哈 (happy 1) vs 呜呜 (sad 1) — no tiebreak marks.
    expect(classifyEmotion('哈哈 呜呜')).toBe('neutral')
  })

  it('is case-insensitive for latin fragments', () => {
    expect(classifyEmotion('WOW, unbelievable!')).toBe('surprised')
  })
})

describe('visibleAssistantText', () => {
  it('joins text blocks and skips reasoning and non-text blocks', () => {
    const content = [
      { type: 'reasoning', text: 'internal thought' },
      { type: 'text', text: '第一段' },
      { type: 'image' },
      { type: 'text', text: '第二段' },
    ]
    expect(visibleAssistantText(content)).toBe('第一段\n第二段')
  })

  it('returns empty for content without visible text', () => {
    expect(visibleAssistantText([{ type: 'image' }])).toBe('')
  })
})
