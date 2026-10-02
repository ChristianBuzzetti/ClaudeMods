# boberto

Boberto is a small bat-winged mascot. He keeps you company in Claude Code: he types while tools run, searches, thinks, celebrates a finished answer, gets dizzy on errors, naps when idle and plays a short gesture now and then.

![Boberto in his pane](assets/pane.svg) ![Boberto playing the guitar](assets/gesture-guitarra.svg) ![Boberto reacting to an answer](assets/reaction-celebrate.svg)

He is not a sprite sheet. His own vector engine draws him at run time on a Canvas 2D context, and the mod records those calls as SVG. The previews above come from the mod's own drawing code: the pane in the default outfit, the `guitarra` gesture in another outfit, and the small reaction shown under a reply.

## Where he appears

- **His pane** (desktop app): Boberto at full size, with a word on what he is doing. A folding **Customize** section holds his wardrobe: accessory, body color, eye color and glow. When he is idle he plays a random gesture from time to time. On the terminal the pane holds a single line of text saying what he is doing.
- **Under each reply** (desktop app): the assistant row that ends a turn gets a small looping Boberto. A finished answer gets one of his gestures; an error or refusal makes him dizzy; an interrupted turn shows him calm.
- **The turn row** (terminal): the line with the turn's duration gets a text face and a word for how the turn ended.

The outfit is saved and comes back in later sessions.

## Commands

| Command | Effect |
| --- | --- |
| `/boberto` | Opens or closes his pane. |
| `/boberto help` | Lists every option. |
| `/boberto <gesture>` | Plays one gesture now: `guitarra`, `skate`, `mate`, `rubik`, `selfie`, `yoyo`, `malabares`, `pesca`, `pintor`, `cafe`, `avion`, `baila`, `levita`, `burbuja`. |
| `/boberto shuffle` | Puts on a random outfit. |
| `/boberto reset` | Goes back to the default bat wings. |
| `/boberto next` or `/boberto <state>` | Pins a preview of a live state (`idle`, `working`, `searching`, `thinking`, `celebrate`, `dizzy`, `sleep`, `calm`). |
| `/boberto auto` | Stops the preview, so he follows the session again. |

## Install

From a clone of this repository:

```bash
claude --plugin-dir ./ClaudeMods/mods/boberto
```

To load it in every session, see [Install a mod](../../README.md#install-a-mod).

## How it works

- `hooks/engine.generated.mjs` is Boberto's original browser engine, wrapped in a function, `bootEngine({ window, document, … })`. Its parameters stand for the browser globals the engine reads. The engine is plain source: nothing is evaluated from a string.
- `hooks/engine-host.ts` boots the engine inside the hooks environment. It stubs just enough of a browser for it, runs its timers on a virtual clock and hands it a recording canvas.
- `hooks/svg-context.mjs` is that canvas: a Canvas 2D context that turns paths, gradients, transforms, shadows and clips into SVG.
- A gesture is the engine's own choreography played to the end on the virtual clock, in a few milliseconds. The frames it drew become a **flipbook**: one SVG whose frames take turns with SMIL `visibility` animation (`hooks/assemble.ts`, `hooks/choreo.ts`).
- `hooks/art.ts` keeps each SVG under the size cap of the `Svg` element, and `hooks/register.tsx` wires up the pane, the reactions and the `/boberto` command.

## Rebuilding the engine module

`hooks/engine.generated.mjs` is committed, so the mod runs as it is. Rebuilding it needs two private inputs that are **not** in this repository:

- the original engine source, `boberto.js`;
- a private deny-list file: one case-insensitive regular expression per line.

```bash
node build/build.mjs <path/to/boberto.js> <path/to/deny-list.txt> [--preview out.html]
# or
BOBERTO_JS=<path/to/boberto.js> BOBERTO_DENY_LIST=<path/to/deny-list.txt> node build/build.mjs
```

`build/make-engine.mjs` does the following:

- drops every comment;
- removes the engine's third-party character catalog, along with every declaration only that catalog used;
- removes the original host apps' storage migration and gives a few strings neutral names;
- wraps the result.

The build fails in three cases: the result does not parse, it matches the deny-list, or it embeds a local path. It then draws every live state and the top gestures, and reports their sizes. `--preview` writes an HTML page of everything the mod shows.

Tests: `claude plugin test mods/boberto`.

## Limits

- **Drawing is desktop-only.** The terminal gets text: a status line in the pane and a face on the turn row.
- **No engine particles.** The engine's particles are DOM elements and are not recorded. The live states carry a few hand-drawn ones instead (thinking dots, stars, sleep Z's).
- **Size.** The engine module is about 395 KB of source. Each drawing is one SVG, kept under 120,000 characters (the largest gesture is about 116,000).
- **Reactions are matched by text.** On desktop an assistant row carries no turn id, so the reaction goes to the row whose text ends like the turn's final answer.
