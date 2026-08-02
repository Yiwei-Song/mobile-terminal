import type { TextStyle } from "react-native";
import { Easing } from "react-native";

/**
 * Proposed theme — benchmark tokens (weaintplastic.com) with four decided overrides:
 *
 *   1. Spacing stays a 4pt grid (NOT the report's 5pt). 4/8/12/16/20/24.
 *   2. Radius: cards/inputs 4, chips 2, primary buttons pill. Not 0, not 14.
 *   3. Title tracking -0.3px on 26px display; the benchmark's case-based rule
 *      everywhere else (uppercase 0.15em, sentence case <=20px 0.025em).
 *   4. Two font weights only — regular + bold. No medium.
 *
 * Drop-in replacement for `app/src/theme.ts`: every existing export keeps its
 * name and shape. New `type` variants are additive.
 */

export const color = {
  // --- surfaces: the benchmark's own #1D1D1F, ramped at hue 240 / 4-5% sat ---
  bg: "#1D1D1F", // the site's --black: its intro panel and full-height left rail
  surface: "#28282C", // cards
  surfaceHi: "#323237", // raised / selected / pressed / user message
  border: "#2E2E33", // 1.25:1 hairline — a border should be felt, not seen
  borderHi: "#55555E", // 2.28:1 — outlined button, focus ring, grab handle

  // --- ink: two tiers, not three ---
  text: "#ECECEF", // 14.27:1 on bg. Capped below #FFF; keeps the 240 cool cast
  textMut: "#9B9BA3", // the site's --grey-light. 6.10 / 5.32 / 4.62

  // --- the one accent, spent sparingly ---
  accent: "#87C6BD", // --celeste. 8.69:1 on bg. Running, primary CTA, FAB
  accentText: "#101014", // ink on any filled chip: 9.80 on accent, 7.47 on danger

  // --- status: derived from the celeste's own recipe hsl(H, 35-60%, 65-70%) ---
  warn: "#D5B47B", // waiting_on_user      8.53 / 7.44 / 6.46
  danger: "#E08C85", // dead / destructive   6.62 / 5.78 / 5.01
  info: "#90B0D5", // links, unread          7.50 / 6.54 / 5.68
  idle: "#9B9BA3", // nothing is happening   6.10 / 5.32 / 4.62
} as const;

/** [override 1] 4pt grid. 4/8/12/16/20/24 — every gap defensible on it. */
export const space = (n: number) => n * 4;

/**
 * [override 2] 0 reads unfinished on a dense phone screen; 14 reads bubbly.
 * `pill` is for primary buttons, the FAB and genuinely circular controls.
 */
export const radius = { card: 4, chip: 2, input: 4, pill: 999 } as const;

/**
 * [override 4] Two weights. `uiMed` is retained only so existing call sites
 * compile — it resolves to Bold on purpose. Do not add a medium.
 */
export const font = {
  ui: "Inter",
  uiMed: "Inter-Bold", // deprecated alias; there is no medium in this system
  uiBold: "Inter-Bold",
  mono: "JetBrainsMono",
} as const;

/**
 * [override 3] Tracking is size/case specific, never one value:
 *   display 26px -> -0.3px (Apple optical sizing)
 *   sentence case <=20px -> 0.025em
 *   uppercase, any size  -> 0.15em
 * Line-height runs the other way: 1.08 at display -> 1.5 at body prose.
 * Hierarchy is weight + size + leading as a SET, never size alone.
 */
export const type = {
  title: { fontFamily: font.uiBold, fontSize: 26, lineHeight: 28, letterSpacing: -0.3 },
  h2: { fontFamily: font.uiBold, fontSize: 20, lineHeight: 24, letterSpacing: 0.5 },
  /** Bold 16 on tight leading — list/row/sheet titles. */
  strong: { fontFamily: font.uiBold, fontSize: 16, lineHeight: 21, letterSpacing: 0.4 },
  body: { fontFamily: font.ui, fontSize: 16, lineHeight: 24, letterSpacing: 0.4 },
  sub: { fontFamily: font.ui, fontSize: 14, lineHeight: 20, letterSpacing: 0.35 },
  /** Timestamps and inline meta — pairs on the baseline with `mono`. */
  meta: { fontFamily: font.ui, fontSize: 13, lineHeight: 19, letterSpacing: 0.33 },
  /** Section headers (NEEDS YOU). 12px/0.15em bold does most of the maturity work. */
  label: {
    fontFamily: font.uiBold,
    fontSize: 12,
    lineHeight: 16,
    letterSpacing: 1.8,
    textTransform: "uppercase" as const,
  },
  /** Chips, tab labels, status words — the same device one step down. */
  micro: {
    fontFamily: font.uiBold,
    fontSize: 11,
    lineHeight: 12,
    letterSpacing: 1.65,
    textTransform: "uppercase" as const,
  },
  mono: { fontFamily: font.mono, fontSize: 13, lineHeight: 19, letterSpacing: 0 },
} as const;

export const touch = { min: 48 } as const;

export type ColorRole = keyof typeof color;
export type TypeVariant = keyof typeof type;

/**
 * Durations keep the 150-250ms cap (journey principle 5). `stagger` is 40ms —
 * list first paint only, decorative, never blocking input.
 */
export const motion = { fast: 150, base: 200, slow: 250, stagger: 40 } as const;

/**
 * Three curves, and only three:
 *   out    cubic-bezier(0.23, 1, 0.32, 1)     entering / press / micro-state
 *   inOut  cubic-bezier(0.77, 0, 0.175, 1)    content reveals, cross-fades
 *   drawer cubic-bezier(0.32, 0.72, 0, 1)     the iOS sheet curve, switcher only
 */
export const easing = {
  out: Easing.bezier(0.23, 1, 0.32, 1),
  inOut: Easing.bezier(0.77, 0, 0.175, 1),
  drawer: Easing.bezier(0.32, 0.72, 0, 1),
} as const;

export const opacity = { pressed: 0.6, disabled: 0.45, full: 1 } as const;

/** 1px hairlines; 2px for the outlined button and the approval card's left edge. */
export const stroke = { hairline: 1, emphasis: 2, icon: 1.5 } as const;

/** Icon sizes on the 4pt grid. Stroke stays 1.5px at every size, optically. */
export const icon = { sm: 16, md: 20, lg: 24, xl: 40 } as const;

/** 0.15em at 12px — the benchmark's signature. `type.label` already carries it. */
export const tracking = { label: 1.8, micro: 1.65 } as const;

/**
 * No shadow token, on purpose. Depth is one step on the neutral ramp
 * (bg -> surface -> surfaceHi), never elevation. The FAB and the switcher
 * sheet are the only exceptions and they carry a single soft scrim, not a glow.
 */

/**
 * Machine text is quoted, not typeset. JetBrains Mono draws `==` as an
 * identity glyph, `!=` as a slashed equals and `=>` as an arrow by default,
 * which is charming in an editor and wrong here: this app's whole job is
 * showing you source and commands you did not type, and a glyph that is not in
 * the file is a lie you cannot see through on a phone.
 */
export const noLigatures: Pick<TextStyle, "fontVariant"> = {
  fontVariant: ["no-common-ligatures", "no-contextual"],
};

/** Diff line backgrounds — derived from the tokens so they can't drift. `24` is ~14%. */
export const tint = { add: `${color.accent}24`, del: `${color.danger}24` } as const;

/**
 * The canvas behind someone else's web page (the preview frame). Deliberately
 * outside `color`: a dev page assumes a browser's white default.
 */
export const canvas = "#FFFFFF";
