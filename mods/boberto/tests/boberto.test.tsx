import { describe, expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'

// The bottom of each chain the plugin continues into: what the engine would draw or answer.
function bottoms(on: On) {
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('command.register', () => ({ value: {} }) as never)
  mock.clock(on, { now: Date.UTC(2026, 9, 2) })
  mock.store(on)
  on('ui.open', () => ({ value: { isPlaced: true } }) as never)
  on('ui.panes', () => ({ value: [] }) as never)
  on('turn.complete', () => ({ text: '' }))
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text key="engine">engine row</Text>
  })
}

const SCROLL = { offset: 0, bodyRows: 20 } as never
const PANE = { component: 'Pane', requestId: 'boberto', props: { title: 'Boberto', isFocused: false, bodyColumns: 40, placement: 'dock', scroll: SCROLL, view: {} } } as const

async function start($: Engine) {
  await $.session.start({ cwd: 'C:/', surface: 'desktop', isInteractive: true } as never)
}

const svgs = async (ui: { findAll: (q: { type: string }) => Promise<{ props: Record<string, unknown> }[]> }) =>
  (await ui.findAll({ type: 'Svg' })).map(found => String(found.props['source'] ?? ''))

describe('boberto', () => {
  test('the pane draws him from the engine at run time; the folded wardrobe dresses him', { timeoutMs: 20000 }, async ($, on) => {
    bottoms(on)
    await start($)
    const ui = await $.ui.mount({ plugin: 'boberto', surface: 'desktop', ...PANE } as never)
    const [first = ''] = await svgs(ui as never)
    expect(first.startsWith('<svg')).toBe(true)
    expect(first.length).toBeLessThan(120001)
    // The wardrobe starts folded: no controls until it is opened.
    expect((await (ui as never as { findAll: (q: { type: string }) => Promise<unknown[]> }).findAll({ type: 'Select' })).length).toBe(0)
    await (ui as never as { press: (t: { key: string }) => Promise<unknown> }).press({ key: 'wardrobe' })
    await (ui as never as { select: (t: { key: string; value: string }) => Promise<unknown> }).select({ key: 'hat', value: 'corona' })
    const [crowned = ''] = await svgs(ui as never)
    expect(crowned === first).toBe(false)
    expect(crowned.length).toBeLessThan(120001)
    await (ui as never as { press: (t: { key: string }) => Promise<unknown> }).press({ key: 'shuffle' })
    const [shuffled = ''] = await svgs(ui as never)
    expect(shuffled.length).toBeLessThan(120001)
  })

  test('every top gesture records under the Svg cap', { timeoutMs: 60000 }, async ($, on) => {
    bottoms(on)
    await start($)
    const ui = await $.ui.mount({ plugin: 'boberto', surface: 'desktop', ...PANE } as never)
    for (const id of ['guitarra', 'skate', 'mate', 'rubik', 'selfie', 'yoyo', 'malabares', 'pesca', 'pintor', 'cafe', 'avion', 'baila', 'levita', 'burbuja']) {
      const ran = await $.command.run({ command: 'boberto', args: id } as never)
      expect(String((ran as { text?: string }).text)).toContain(`plays ${id}`)
      const [svg = ''] = await svgs(ui as never)
      expect(svg.length).toBeLessThan(120001)
      expect(svg.length).toBeGreaterThan(10000)
    }
  })

  test('turns react on both surfaces, looping', { timeoutMs: 20000 }, async ($, on) => {
    bottoms(on)
    await start($)
    await $.turn.complete({ answer: 'All done here, the fix is in place and tested.', durationMs: 4200, isAborted: false, turnId: 't1', reason: 'answer' } as never)
    const reply = await $.ui.mount({ plugin: 'boberto', surface: 'desktop', component: 'AssistantMessage', props: { text: 'All done here, the fix is in place and tested.', isFirstOfReply: true } } as never)
    const [reaction = ''] = await svgs(reply as never)
    expect(reaction.length).toBeGreaterThan(1000)
    expect(reaction.length).toBeLessThan(120001)
    // The reaction keeps playing: it must never freeze on its last frame.
    expect(reaction).toContain('indefinite')
    expect(reaction).not.toContain('fill="freeze"')
    // The next answer plays a different top gesture under its own row.
    await $.turn.complete({ answer: 'Second answer, a different ending for the row.', durationMs: 3100, isAborted: false, turnId: 't2', reason: 'answer' } as never)
    const second = await $.ui.mount({ plugin: 'boberto', surface: 'desktop', component: 'AssistantMessage', props: { text: 'Second answer, a different ending for the row.', isFirstOfReply: true } } as never)
    const [other = ''] = await svgs(second as never)
    expect(other.length).toBeGreaterThan(1000)
    expect(other).toContain('indefinite')
    expect(other === reaction).toBe(false)
    const row = await $.ui.mount({ plugin: 'boberto', surface: 'terminal', component: 'TurnDuration', props: { word: 'Baked', durationMs: 4200 } } as never)
    expect(await row.find({ type: 'Text', text: /cheers/ })).toBeDefined()
  })
})
