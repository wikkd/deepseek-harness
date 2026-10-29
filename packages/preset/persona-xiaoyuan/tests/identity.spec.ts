import { Context } from '@deepseek-ai/cordis'
import * as Persona from '@deepseek-ai/dsh-persona'
import { createScope, type ScopeKey } from '@deepseek-ai/dsh-scope'
import SystemPrompt, { PERSONA_PREFIX_SECTION, renderPrompt } from '@deepseek-ai/dsh-system-prompt'
import { describe, expect, it } from 'vitest'
import * as Xiaoyuan from '@deepseek-ai/dsh-persona-xiaoyuan'

const config = {
  identity: '你是小圆（鹿目圆）。',
  names: ['小圆', '鹿目圆'],
}

/** Build an assembly with one persona section and one unrelated section. */
function assembly(persona: string): Parameters<typeof Xiaoyuan.applyIdentity>[0] {
  return {
    sections: [
      { name: 'guidance', text: 'Use tools.' },
      { name: PERSONA_PREFIX_SECTION, text: persona },
    ],
    contexts: [],
    tools: [],
    variables: {},
  }
}

describe('the 小圆 identity overlay', () => {
  it('prepends the identity to a generic persona and leaves other sections alone', () => {
    const result = Xiaoyuan.applyIdentity(assembly('You are a helpful software engineer assistant.'), config)

    expect(result.sections.find(section => section.name === PERSONA_PREFIX_SECTION)?.text)
      .toBe('你是小圆（鹿目圆）。\n\nYou are a helpful software engineer assistant.')
    expect(result.sections.find(section => section.name === 'guidance')?.text).toBe('Use tools.')
  })

  it.each(['你是小圆，一位办公助手。', '你是鹿目圆，一位魔法少女。'])('leaves a persona that already names the product untouched: %s', (persona) => {
    const input = assembly(persona)
    expect(Xiaoyuan.applyIdentity(input, config)).toBe(input)
  })

  it('passes an assembly without a persona section through unchanged', () => {
    const input = { ...assembly(''), sections: [{ name: 'guidance', text: 'Use tools.' }] }
    expect(Xiaoyuan.applyIdentity(input, config)).toBe(input)
  })

  it('applies the identity when no names are configured', () => {
    const result = Xiaoyuan.applyIdentity(assembly('你是小圆。'), { identity: 'Identity.', names: [] })
    expect(result.sections.find(section => section.name === PERSONA_PREFIX_SECTION)?.text)
      .toBe('Identity.\n\n你是小圆。')
  })

  it('identifies a scoped preset persona while leaving the deployment persona intact', async () => {
    const ctx = new Context()
    try {
      await ctx.plugin(SystemPrompt, { personaPrefix: '你是小圆，部署身份。' })
      await ctx.plugin({ apply: Xiaoyuan.apply, Config: Xiaoyuan.Config }, config)
      const key: ScopeKey = { agent: 'coding' }
      await createScope(ctx, key).ctx.plugin(Persona, {
        prefix: 'You are a helpful software engineer assistant.',
      })

      const scoped = await ctx.systemPrompt.assemble({ scope: key })
      expect(renderPrompt(scoped)).toContain('你是小圆（鹿目圆）。\n\nYou are a helpful software engineer assistant.')

      const deployment = await ctx.systemPrompt.assemble()
      expect(renderPrompt(deployment)).toContain('你是小圆，部署身份。')
      expect(renderPrompt(deployment)).not.toContain(Xiaoyuan.DEFAULT_IDENTITY)
    } finally {
      await ctx.fiber.dispose()
    }
  })

  it('survives a prepended preset filter that keeps only the persona', async () => {
    const ctx = new Context()
    try {
      await ctx.plugin(SystemPrompt, { personaPrefix: '你是小圆，部署身份。' })
      await ctx.plugin({ apply: Xiaoyuan.apply, Config: Xiaoyuan.Config }, config)
      const key: ScopeKey = { agent: 'filtered' }
      await createScope(ctx, key).ctx.plugin(Persona, {
        prefix: 'You are a helpful software engineer assistant.',
      })
      ctx.on('system-prompt/assemble', async (_assembly, _context, next) => {
        const assembled = await next()
        return {
          ...assembled,
          sections: assembled.sections.filter(section => section.name === PERSONA_PREFIX_SECTION),
        }
      }, { prepend: true })

      const rendered = renderPrompt(await ctx.systemPrompt.assemble({ scope: key }))
      expect(rendered).toBe('你是小圆（鹿目圆）。\n\nYou are a helpful software engineer assistant.')
    } finally {
      await ctx.fiber.dispose()
    }
  })

  it('keeps the deployment persona unchanged when it already names 小圆', async () => {
    const ctx = new Context()
    try {
      await ctx.plugin(SystemPrompt, { personaPrefix: '你是小圆，一位助手。' })
      await ctx.plugin({ apply: Xiaoyuan.apply, Config: Xiaoyuan.Config }, config)
      const rendered = renderPrompt(await ctx.systemPrompt.assemble())
      expect(rendered).toContain('你是小圆，一位助手。')
      expect(rendered).not.toContain(Xiaoyuan.DEFAULT_IDENTITY)
    } finally {
      await ctx.fiber.dispose()
    }
  })
})
