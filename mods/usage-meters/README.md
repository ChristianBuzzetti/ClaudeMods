# usage-meters

Shows how much of the session you are spending, right above the prompt: context window, cache hits and running subagents in one animated strip, with a **Details** pane for the full picture.

![usage-meters strip](assets/strip.svg)

![usage-meters panel](assets/panel.svg)

The previews are rendered by this mod's own drawing code with sample figures.

## What it shows

**The strip** stays above the prompt at all times:

- **Context**: how full the context window is.
- **Cache hits**: the share of input tokens served from the prompt cache this session.
- **Agents**: how many subagents are running now, with a pulsing dot while any are.
- **Details**: a button that opens the pane, and closes it again as **Hide details**.

**The Details pane** holds the dashboard:

- **Gauges** for context, the 5-hour cap, the weekly cap and cache hits, each with its figure and detail (`190k / 1.0M`, `resets in 2h 13m`).
- **Token flow**: one stacked bar of where the session's tokens went: input, cache write, cache read and output.
- **By agent**: the conversation and each subagent type, with how many times it ran, how many are live, its latest task, its share of the session's tokens and its own cache hit rate.
- A header with the model, turn count, average turn length and the session's cost.

Bars use a dithered dot fill with a sweeping shimmer and a glowing knob; a neon trail circles the strip's and the pane's border. Gauges turn amber from 80 % and red from 95 %; the cache gauge reads the other way, green from 70 %.

## Commands

| Command | Effect |
| --- | --- |
| `/meters` | Hides or shows the strip. |

The pane closes with **Hide details**, Escape, or its own close mark.

## Install

See [the collection README](../../README.md#install-a-mod). In short, add this folder to `CLAUDE_CODE_PLUGIN_DIRS` in `~/.claude/settings.json` and start a new session.

## How it works

The mod is one hooks module, [`hooks/register.tsx`](hooks/register.tsx):

| Hook | Role |
| --- | --- |
| `session.start` | Registers `/meters`, reads `$.session.usage()` for the first figures, and starts a one-minute clock for the reset countdowns. |
| `session.measure` | Takes the context fill, rate-limit windows and cost each time the engine measures the session. |
| `turn.complete` | Adds each turn's token counts to the session totals; a turn carrying an `agentId` is also credited to that subagent. |
| `agent.spawn` | Records each subagent's type, task and id as it starts, so its later turns can be attributed. |
| `ui.render` for `AbovePrompt` | Draws the strip. |
| `ui.render` for `Pane` | Draws the Details pane. |
| `ui.close` | Keeps the button's label in step with however the pane was closed. |

On the desktop app the strip and the pane are SVG images built in the module, which is what allows the gradients, glow and animation. In the terminal they fall back to text bars with the same figures.

All values live in `$.state`, declared in [`types/index.d.ts`](types/index.d.ts), so they survive a hot reload of the module.

## Limits

- **Session totals start when the mod loads.** Token counts come from `turn.complete`, so turns before the mod was loaded are not counted, and the cache figures can differ from `/usage` in a session the mod joined midway. In a session that starts with the mod loaded, they track from the first turn.
- **The 5-hour and weekly caps need a subscription.** They come from the rate-limit windows the API reports, so they appear after the first response, and not at all on API-key billing.
- **The context gauge reads 0 % until the first response**, which is when the engine first reports the window's fill.
- **Subagents that started before the mod loaded** show as `subagent`, since their type was announced before the mod could record it.
- **The pane's placement belongs to Claude Code**: docked beside the transcript where the surface supports it, otherwise above the prompt. A mod cannot open a floating window.
- **No tooltips.** The SVGs are drawn as images, which keeps them sized to the available width but takes no pointer input.

## License

[MIT](../../LICENSE).
