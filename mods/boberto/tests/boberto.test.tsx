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

  test('custom RGB colors: typed in the editor, set by command, cleared by Reset', { timeoutMs: 30000 }, async ($, on) => {
    bottoms(on)
    await start($)
    type Ui = {
      press: (t: { key: string }) => Promise<unknown>
      select: (t: { key: string; value: string }) => Promise<unknown>
      input: (t: { key: string; text: string }) => Promise<unknown>
      find: (q: { type: string; text?: RegExp }) => Promise<unknown>
    }
    const mounted = await $.ui.mount({ plugin: 'boberto', surface: 'desktop', ...PANE } as never)
    const ui = mounted as never as Ui
    const [first = ''] = await svgs(mounted as never)
    await ui.press({ key: 'wardrobe' })

    // Custom on the body Select opens its editor; a hex typed there recolors him
    // with the shades the engine derives from it (derivePal / pintorDe).
    await ui.press({ key: 'tab-skin' })
    await ui.select({ key: 'skin', value: 'custom' })
    await ui.input({ key: 'hex', text: '#ff3366' })
    const [body = ''] = await svgs(mounted as never)
    expect(body === first).toBe(false)
    expect(body).toContain('#ff0f4b')
    expect(body.length).toBeLessThan(120001)

    // The accessory's tab: Custom opens its card even over a preset-matching color, and a bare
    // rrggbb typed there gives the bat wings the engine's accessory tint.
    await ui.press({ key: 'tab-hat' })
    await ui.select({ key: 'hatColor', value: 'custom' })
    await ui.input({ key: 'hex', text: '22d3ee' })
    const [tinted = ''] = await svgs(mounted as never)
    expect(tinted === body).toBe(false)
    expect(tinted).toContain('#3ad8f0')
    expect(tinted).toContain('#ff0f4b')

    // Invalid input changes nothing and says so.
    await ui.input({ key: 'hex', text: 'not-a-color' })
    await ui.input({ key: 'r', text: '300' })
    const [same = ''] = await svgs(mounted as never)
    expect(same === tinted).toBe(true)
    expect(await ui.find({ type: 'Text', text: /channel is a whole number/ })).toBeDefined()

    // The command, for the iris: its glint is the engine's mix of the tint with white.
    const ran = await $.command.run({ command: 'boberto', args: 'color eyes #00ff88' } as never)
    expect(String((ran as { text?: string }).text)).toContain('#00ff88')
    const [eyed = ''] = await svgs(mounted as never)
    expect(eyed === tinted).toBe(false)
    expect(eyed).toContain('#8cffc9')
    const help = await $.command.run({ command: 'boberto', args: 'help' } as never)
    expect(String((help as { text?: string }).text)).toContain('/boberto color')

    // Reset clears every custom color: he is drawn exactly as at the start.
    await ui.press({ key: 'reset' })
    const [reset = ''] = await svgs(mounted as never)
    expect(reset === first).toBe(true)
  })

  test('tabs show only their own controls; the RGB card appears for a custom color', { timeoutMs: 30000 }, async ($, on) => {
    bottoms(on)
    await start($)
    type Ui = {
      press: (t: { key: string }) => Promise<unknown>
      select: (t: { key: string; value: string }) => Promise<unknown>
      input: (t: { key: string; text: string }) => Promise<unknown>
      findAll: (q: { type: string }) => Promise<{ props: Record<string, unknown> }[]>
    }
    const wide = { ...PANE, props: { ...PANE.props, bodyColumns: 60 } }
    const mounted = await $.ui.mount({ plugin: 'boberto', surface: 'desktop', ...wide } as never)
    const ui = mounted as never as Ui
    const keysOf = async (type: string) => (await ui.findAll({ type })).map(found => String(found.props['key'] ?? ''))
    await ui.press({ key: 'wardrobe' })

    // Accessory is the first tab: its two Selects, no card while its color is natural.
    expect(await keysOf('Select')).toEqual(['hat', 'hatColor'])
    expect(await keysOf('Input')).toEqual([])
    for (const [tab, select] of [['tab-skin', 'skin'], ['tab-eye', 'eye'], ['tab-glow', 'glow']] as const) {
      await ui.press({ key: tab })
      expect(await keysOf('Select')).toEqual([select])
      expect(await keysOf('Input')).toEqual([])
    }

    // A custom glow opens its card: hex field, three channels, a swatch and a bar per channel.
    await ui.select({ key: 'glow', value: 'custom' })
    expect(await keysOf('Input')).toEqual(['hex', 'r', 'g', 'b'])
    const sources = await svgs(mounted as never)
    expect(sources.filter(source => source.includes('id="ramp"')).length).toBe(3)
    expect(sources.some(source => source.includes('#8b7cf6') && source.includes('GLOW'))).toBe(true)
    // A +16 step on the open tab's red channel moves the glow, nothing else.
    await ui.press({ key: 'r-plus' })
    expect(sources.some(source => source.includes('#9b7cf6'))).toBe(false)
    expect((await svgs(mounted as never)).some(source => source.includes('#9b7cf6'))).toBe(true)

    // The tab persists across a fold, and a preset closes the card again.
    await ui.press({ key: 'wardrobe' })
    expect((await ui.findAll({ type: 'Select' })).length).toBe(0)
    await ui.press({ key: 'wardrobe' })
    expect(await keysOf('Select')).toEqual(['glow'])
    await ui.select({ key: 'glow', value: 'none' })
    expect(await keysOf('Input')).toEqual([])

    // A narrow pane keeps the channel rows but drops their bars.
    await ui.press({ key: 'tab-eye' })
    await ui.select({ key: 'eye', value: 'custom' })
    await (mounted as never as { unmount: () => Promise<unknown> }).unmount()
    const narrow = await $.ui.mount({ plugin: 'boberto', surface: 'desktop', ...PANE, props: { ...PANE.props, bodyColumns: 34 } } as never)
    const narrowSources = await svgs(narrow as never)
    expect(narrowSources.filter(source => source.includes('id="ramp"')).length).toBe(0)
    expect((await (narrow as never as Ui).findAll({ type: 'Input' })).length).toBe(4)
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
