// What Boberto plays: the live states (step tables transcribed from the
// engine's g_* choreographies, with body motion after its `plt-*` keyframes
// and hand-drawn particles, since the engine's particles are DOM), the
// curated idle gestures (recorded from the engine itself), and the end-of-turn
// reactions. Pure: no `$`, shared with the build's preview.

import type { BobertoMotion } from './assemble'
import { SCALE } from './engine-host'

/** The live states, driven by the session's events. */
export const LIVE = ['idle', 'working', 'searching', 'thinking', 'celebrate', 'dizzy', 'sleep', 'calm'] as const
export type LiveName = (typeof LIVE)[number]

/** The gestures the pane plays at random while the session is idle (GESTOS ids). */
export const TOP_GESTURES = [
  'guitarra', 'skate', 'mate', 'rubik', 'selfie', 'yoyo', 'malabares',
  'pesca', 'pintor', 'cafe', 'avion', 'baila', 'levita', 'burbuja',
] as const

// In drawing units, 1 CSS px of the engine's topbar canvas (2 px per unit) is
// SCALE / 2, and 1% of the canvas height is 0.21 * SCALE.
const PX = SCALE / 2
const PCT = 0.21 * SCALE
const MID = (20 * SCALE) / 2

const particle = {
  // g_think: three dots rising up-left from (15 - n*4.5, 9 - n*3) px.
  thinkDots: [0, 1, 2]
    .map(n => {
      const x = (15 - n * 4.5) * PX
      const y = (9 - n * 3) * PX
      const r = (0.8 + n * 0.25) * 0.6 * SCALE
      return (
        `<circle cx="${x}" cy="${y}" r="${r}" fill="#e9e3ff" opacity="0">` +
        `<animate attributeName="opacity" values="0;.9;.9;0" keyTimes="0;.15;.7;1" dur="1.52s" begin="${n * 0.24}s" repeatCount="indefinite"/>` +
        `<animateTransform attributeName="transform" type="translate" values="0 0;-5 -15" dur="1.52s" begin="${n * 0.24}s" repeatCount="indefinite"/>` +
        '</circle>'
      )
    })
    .join(''),
  // g_sleep: a "z" per snore, climbing up-right from (26 + n*3, 11 - n*3.5) px.
  sleepZ: [0, 1, 2]
    .map(n => {
      const x = (26 + n * 3) * PX
      const y = (11 - n * 3.5) * PX
      const s = (0.7 + n * 0.3) * 0.9 * SCALE
      return (
        `<path d="M${x} ${y}h${s}l${-s} ${s}h${s}" fill="none" stroke="#c4b5fd" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" opacity="0">` +
        `<animate attributeName="opacity" values="0;1;1;0" keyTimes="0;.2;.7;1" dur="3.6s" begin="${n * 1.2}s" repeatCount="indefinite"/>` +
        `<animateTransform attributeName="transform" type="translate" values="0 0;10 -25" dur="3.6s" begin="${n * 1.2}s" repeatCount="indefinite"/>` +
        '</path>'
      )
    })
    .join(''),
  // g_celebrate: stars raining from above the head.
  stars: [-1, 1, -1, 1, -1, 1]
    .map((side, i) => {
      const x = MID + side * (12 + i * 9) * (SCALE / 10)
      const y = (10 + (i % 3) * 8) * (SCALE / 10)
      const star = 'M0 -6L1.8 -1.8L6 0L1.8 1.8L0 6L-1.8 1.8L-6 0L-1.8 -1.8Z'
      const color = ['#fde047', '#f9a8d4', '#a5f3fc'][i % 3]
      return (
        `<g transform="translate(${x} ${y})"><path d="${star}" fill="${color}" opacity="0">` +
        `<animate attributeName="opacity" values="0;1;1;0" keyTimes="0;.1;.6;1" dur="1.6s" begin="${(i * 0.27).toFixed(2)}s" repeatCount="indefinite"/>` +
        `<animateTransform attributeName="transform" type="translate" values="0 0;${side * 18} 70" dur="1.6s" begin="${(i * 0.27).toFixed(2)}s" repeatCount="indefinite"/>` +
        '</path></g>'
      )
    })
    .join(''),
  // g_dizzy: stars circling the head.
  orbit: [0, 1, 2]
    .map(i => {
      const star = 'M0 -5L1.5 -1.5L5 0L1.5 1.5L0 5L-1.5 1.5L-5 0L-1.5 -1.5Z'
      return (
        `<g transform="translate(${MID} ${3.4 * SCALE}) scale(1 .35)"><g><path d="${star}" transform="translate(${5.2 * SCALE} 0) scale(1 2.8)" fill="#fde047"/>` +
        `<animateTransform attributeName="transform" type="rotate" from="${i * 120}" to="${i * 120 + 360}" dur="1.4s" repeatCount="indefinite"/></g></g>`
      )
    })
    .join(''),
}

export type LiveSpec = { steps: [string, number][]; motion: BobertoMotion; extras: string }

/** Steps name engine poses (`@up`/`@down` flap the bat wings) and how long each shows. */
export const LIVE_SPECS: Record<LiveName, LiveSpec> = {
  idle: {
    // Breathing (plt-breathe, 3.2 s) with blinks and a wing flap between them.
    steps: [
      ['base', 1400], ['blink', 80], ['base', 900],
      ['base@up', 120], ['base@down', 120], ['base@up', 120], ['base@down', 120],
      ['base', 1100], ['blink', 70], ['base', 180], ['blink', 70], ['base', 1300],
    ],
    motion: { durMs: 3200, keyTimes: [0, 0.5, 1], translate: [[0, 0], [0, -1 * PX], [0, 0]], scale: [[1, 1], [0.985, 1.035], [1, 1]] },
    extras: '',
  },
  working: {
    // g_laptop's typing bursts with a pause to read; plt-tipea (0.3 s).
    steps: [
      ['laptopType1', 130], ['laptopType2', 120], ['laptopTipea3', 140], ['laptopTipea4', 120],
      ['laptopType1', 130], ['laptopType2', 150], ['laptopTipea3', 110], ['laptopTipea4', 140],
      ['laptopLee', 560],
      ['laptopType1', 120], ['laptopType2', 140], ['laptopTipea3', 130], ['laptopTipea4', 120],
      ['laptopType1', 150], ['laptopType2', 130],
    ],
    motion: { durMs: 300, keyTimes: [0, 0.5, 1], translate: [[0, 0], [0, 0.4 * PCT], [0, 0]], rotate: [0, 0.8, 0] },
    extras: '',
  },
  searching: {
    // g_magnify's sweep from one eye to the other; plt-lupa (1.3 s).
    steps: [
      ['magnify', 380], ['lupaParpadea', 90], ['magnify', 260],
      ['magnifyL', 340], ['magnify', 320], ['magnifyR', 360], ['magnify', 300], ['magnifyL', 340],
    ],
    motion: {
      durMs: 1300,
      keyTimes: [0, 0.25, 0.75, 1],
      translate: [[0, 0], [-0.8 * 2, 0], [0.8 * 2, 0], [0, 0]],
      rotate: [0, -2.5, 2.5, 0],
    },
    extras: '',
  },
  thinking: {
    // g_think; plt-piensa (1.4 s).
    steps: [['think', 260], ['piensaMira', 240], ['piensaMira2', 240], ['think', 260], ['piensaMira2', 200], ['think', 320]],
    motion: { durMs: 1400, keyTimes: [0, 0.5, 1], translate: [[0, 0], [0, -0.4 * PCT], [0, 0]], rotate: [0, -2, 0] },
    extras: particle.thinkDots,
  },
  celebrate: {
    // g_celebrate: crouch, jump, land, two fist pumps, the finale; plt-festejo (0.34 s).
    steps: [
      ['festejaAgacha', 170], ['festejaSalto', 290], ['festejaCae', 160],
      ['festejaPuno', 150], ['festejaPuno2', 140], ['festejaPuno', 150], ['festejaPuno2', 140],
      ['festejaRemate', 720],
    ],
    motion: { durMs: 340, keyTimes: [0, 0.5, 1], translate: [[0, 0], [0, -2.5 * PCT], [0, 0]], scale: [[1, 1], [1, 1.02], [1, 1]] },
    extras: particle.stars,
  },
  dizzy: {
    // g_dizzy's spinning eyes; plt-mareo (1 s).
    steps: [
      ['mareoEntra', 280],
      ['dizzy', 170], ['mareo2', 170], ['mareo3', 170], ['mareo4', 170],
      ['dizzy', 170], ['mareo2', 170], ['mareo3', 170], ['mareo4', 170],
    ],
    motion: {
      durMs: 1000,
      keyTimes: [0, 0.25, 0.5, 0.75, 1],
      translate: [[0, 0], [-1.5 * 2, 0], [0, 0], [1.5 * 2, 0], [0, 0]],
      rotate: [0, -6, 1, 5, 0],
    },
    extras: particle.orbit,
  },
  sleep: {
    // g_sleep's snoring loop; plt-siesta (1.2 s).
    steps: [['sleep', 600], ['siestaRonca', 600]],
    motion: {
      durMs: 1200,
      keyTimes: [0, 0.5, 1],
      translate: [[0, 0], [0, -0.6 * PCT], [0, 0]],
      rotate: [4, 5, 4],
      scale: [[1, 1], [0.98, 1.035], [1, 1]],
    },
    extras: particle.sleepZ,
  },
  calm: {
    // An interrupted turn: a look aside, a slow blink, back to rest (g_lookL, g_happy).
    steps: [['lookL', 520], ['blink', 90], ['base', 380], ['happyBlink', 90], ['happy', 900]],
    motion: { durMs: 2000, keyTimes: [0, 0.5, 1], translate: [[0, 0], [0, -0.5 * PX], [0, 0]] },
    extras: '',
  },
}

/** A gesture's body motion: the idle breathing (plt-breathe), under the choreography's frames. */
export const GESTURE_MOTION: BobertoMotion = {
  durMs: 3200,
  keyTimes: [0, 0.5, 1],
  translate: [[0, 0], [0, -0.6 * PX], [0, 0]],
  scale: [[1, 1], [0.99, 1.02], [1, 1]],
}
