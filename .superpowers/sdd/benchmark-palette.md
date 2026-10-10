# Benchmark: weaintplastic.com — colour, type and geometry spec

Roland Schütz's studio site (Berlin). Loaded live with the gstack browse binary at 1440×900, computed
styles pulled from the real DOM, and the whole stylesheet (`assets/css/styles.min.css`, 151 KB)
downloaded and tallied. Every number below is measured, not remembered.

Screenshots: `benchmark-weaintplastic-hero.png`, `-gems.png`, `-letters.png`, `-contact.png`.

> **How the site was captured.** The page gates its content behind a full-screen intro
> (`.section-intro`, a solid `#1D1D1F` panel) and scrolls inside a clipped `.site-main`. Colours and
> computed styles were read from the live DOM before any intervention. The screenshots required
> injecting `display:none` on the intro and `overflow:visible` on `.site-main` — that unclips the
> layout but changes no colour, font or spacing value.

---

## 1. Exact colours

The site declares **five** named colour tokens in CSS and uses nothing else. Not a palette that
*happens* to be small — a palette that was decided.

| CSS class name | Hex | HSL | Role, and where it actually appears |
|---|---|---|---|
| `--white` | `#FFFFFF` | `hsl(0 0% 100%)` | Page background for the Gems and Letters bands; nav bar; text on the dark blocks |
| `--grey-lighter` | `#F3F3F3` | `hsl(0 0% 95.3%)` | The *other* background — Hero, Work, Profile bands. Also the 1px hairline rule colour |
| `--grey-light` | `#9B9BA3` | `hsl(240 4.2% 62.4%)` | **All body prose.** 22 of the page's paragraph nodes |
| `--black` | `#1D1D1F` | `hsl(240 3.3% 11.8%)` | Headlines, nav labels, the left edge rail, the intro panel, 2px button outlines |
| `--celeste` | `#87C6BD` | `hsl(171 35.6% 65.3%)` | The single accent. Kicker lines ("Onboarding"), the "— Read" links, nav hover/active |

Rendered-frequency counts from the live DOM (elements with a direct text node):

```
color:            #000000 ×52 (UA default, inherits to #1D1D1F visually)  #FFFFFF ×19
                  #87C6BD ×13   #1D1D1F ×9   #9B9BA3 ×4-on-22-paragraphs
background-color: #F3F3F3 ×7    #FFFFFF ×6   #1D1D1F ×3
border-color:     #FFFFFF 2px ×2   #1D1D1F 2px ×1
border-radius:    (none on any rendered rectangle)
box-shadow:       (none, anywhere)
```

Four strays exist in the stylesheet and never render: `#FF0`, `#333`, `#09F`, `#2A2E35`, `#212227` —
all inside the vendored Flickity carousel and a `:focus` ring. Ignore them.

**Light or dark:** the site is **light**, with dark *blocks* rather than a dark mode — a `#1D1D1F`
left rail down the full page, the `#1D1D1F` intro panel, and inverted `#FFF`-on-black button
variants. The first thing a visitor actually sees is a full-bleed `#1D1D1F` screen, so the near-black
is doing as much identity work as the white.

---

## 2. The colour relationships

**Body text contrast is 2.76:1, and it fails.** `#9B9BA3` on `#FFFFFF` is 2.76:1; on `#F3F3F3` it is
2.49:1. WCAG AA wants 4.5:1. This is a deliberate softness choice on a portfolio and it is the one
thing in this spec that must **not** be copied into a tool people read all day.

| pair | ratio |
|---|---|
| `#1D1D1F` on `#FFFFFF` | **16.83:1** |
| `#1D1D1F` on `#F3F3F3` | 15.17:1 |
| `#FFFFFF` on `#1D1D1F` | 16.83:1 |
| `#9B9BA3` on `#FFFFFF` (body) | **2.76:1** ✗ |
| `#9B9BA3` on `#1D1D1F` | 6.10:1 ✓ |
| `#87C6BD` on `#FFFFFF` | 1.94:1 ✗ (decorative only) |
| `#87C6BD` on `#1D1D1F` | **8.69:1** ✓ |

**The neutrals are cool, faintly.** Not warm, not truly neutral:

- `#1D1D1F` = rgb(29, 29, 31). Two points of blue over red/green. `hsl(240 3.3% 11.8%)`.
- `#9B9BA3` = rgb(155, 155, 163). Eight points of blue. `hsl(240 4.2% 62.4%)`.
- `#F3F3F3` and `#FFFFFF` are exactly achromatic — 0% saturation.

So: the two neutrals that carry *ink* are tinted 240° at 3–4% saturation; the two that carry *paper*
are dead neutral. The tint is below the threshold you can name and above the threshold you can feel.
That is the whole trick.

**Exactly one accent, used sparingly.** `#87C6BD` appears on 13 text nodes across a ~5400px page:
four "— Read" links, the small kicker sublines above project titles, and nav hover. It never fills a
region, never sits behind text, and never appears twice in the same eye-span. The only place it
becomes a fill is `.button--ghost-celeste__to__solid-celeste:hover`, which flips a 2px outline into a
solid — one interaction, one moment.

**There is no second accent, and no status colour system at all.** Nothing is red, nothing is green.

---

## 3. Typography

Three custom faces, self-hosted `.ttf` (with `.eot` fallbacks — this build predates woff2):

| `font-family` | Weight | Kind | Used for |
|---|---|---|---|
| `Oak Bold` | 700 | Geometric sans | **74 of 97** rendered text nodes: every headline, nav item, label, button, kicker |
| `Plantin Light` | 400 | Old-style serif | **23 nodes**: all running prose, the hero statement, project descriptions |
| `Oak Light` | — | Geometric sans | Declared on `body` and inherited by nothing that renders text |

**Two weights on the whole site: 400 and 700.** No 500, no 600. Hierarchy is carried by size, case
and tracking, never by a mid-weight.

### Type scale (measured `font-size` / `line-height` / `letter-spacing` / weight)

| px | ratio to 16 | line-height | tracking (px / em) | face | what it is |
|---|---|---|---|---|---|
| 48 | 3.00em | 50.4 (**1.05**) | `normal` (0) | Oak Bold | uppercase display headline |
| 26 | 1.625em | 1.2em | 2.6 / **0.1em** | Oak Bold | uppercase section headline (`h2`) |
| 24 | 1.5em | 34.27 (**1.428**) | 0.6 / **0.025em** | Oak Bold *or* Plantin Light | sentence-case headline |
| 20 | 1.25em | `normal` | 1.6 / **0.08em** | Oak Bold | project title (`.link__headline`) |
| 16 | 1em | 29.6 (**1.85**) | 0.8 / **0.05em** | Plantin Light | **body prose** |
| 16 | 1em | 22.85 (1.428) | 2.16 / **0.135em** | Oak Bold | uppercase numeral/label (`h4`) |
| 14 | 0.875em | 19.99 (1.428) | 2.1 / **0.15em** | Oak Bold | nav items, buttons, gem titles |
| 12 | 0.75em | `normal` | 1.8 / **0.15em** | Oak Bold | kicker sublines, footer links |

### The size ↔ tracking relationship

**There is no negative tracking anywhere on this site.** I grepped for it explicitly: zero matches.
The curve runs from `0.15em` at 12px down to `0` at 48px and stops there. Every tracking value in the
stylesheet is one of `.15em`, `.135em`, `.1em`, `.05em`, `.025em`.

But the real rule is sharper than "bigger = tighter" — it is **case-driven**:

- **Uppercase, any size** → `0.1em` to `0.15em`. The 26px uppercase `h2` gets `0.1em` while the 24px
  sentence-case `h3` gets `0.025em`. Case, not size, decides the band.
- **Sentence case, 16–24px** → `0.025em`–`0.05em`. Barely there.
- **Sentence case, display (48px)** → `normal`. Zero. It bottoms out rather than going negative.

Line-height moves the opposite direction and further than the tracking: **1.05 at 48px → 1.2 at 26px
→ 1.428 at 14–24px → 1.85 for 16px body prose.** The 1.85 on the serif paragraphs is the single most
generous number on the page and is why the prose reads as *editorial* rather than *interface*.

---

## 4. Spacing & geometry

**Radius: zero.** Not one rendered rectangle has a corner radius. The five `border-radius` rules in
the stylesheet are `100%`/`100px` on 40–44px *squares* (carousel arrows, the close button, the loader
dot) — i.e. circles — plus one `2000px` on a scale-transformed reveal mask. Rectangles are sharp,
circles are circles, nothing in between. No 4px, no 8px, no 12px.

**Shadows: zero.** One `box-shadow` exists in the file and it is `0 0 0 5px #09F`, a focus ring.
There is no elevation model.

**Depth is done with rotated colour planes instead.** Every section boundary is a pseudo-element:

```css
.section:before {
  content:''; height:225px; width:120%;
  position:absolute; left:50%; top:0;
  transform: rotate(-5deg) translateX(-50%);
  transform-origin: center top;
  z-index: 150;
}
```

A 225px-tall slab of the *next* section's background colour, rotated −5°, sliding over the seam. Two
flat planes and an angle. That is the whole depth system, and it costs one pseudo-element per section.

**Borders are opaque palette colours, never alpha.** Four border declarations in the entire file:

| declaration | where |
|---|---|
| `border-bottom: 1px solid #F3F3F3` | hairline rules — **1.11:1 against white**, a whisper |
| `border: 2px solid` (currentColor) | the button, `padding: 8px 18px`, `text-transform: uppercase` |
| `border: 3px solid #1D1D1F` | carousel arrow circles |
| `border: 7px solid #F3F3F3` | loader |

The 1px separator rule is the same colour as the alternate page background. It is one step of the
ramp, not "a grey". No `rgba(0,0,0,.08)` anywhere.

**Spacing rhythm is a strict 10px grid.** Utility classes exist at every 10px step from `10px` to
`300px` (16 occurrences each — a generated scale). Frequency: `10px` ×22, then `20/30/40/50/60/70/80/
90/100` at 16–18 each. `max-width: 1000px` is the content container. Nothing lands off the 10.

---

## 5. What makes it read as mature

Named, concrete, copyable:

1. **Five colours. Full stop.** No tints, no shades, no `-50/-100/-900` ramp. Every surface is one of
   two whites; every ink is one of two neutrals; there is one accent. Restraint at the palette level
   is the thing an amateur theme never does.
2. **The neutrals are tinted 240° at 3–4% saturation — the ink is, the paper isn't.** `#1D1D1F` is
   rgb(29,29,31), not rgb(30,30,30). Two points of blue. `#9B9BA3` is rgb(155,155,163). It reads as
   "considered" and you cannot name why.
3. **Two font weights, 400 and 700, and hierarchy is carried by case and tracking instead.** A 12px
   `#87C6BD` uppercase kicker at `0.15em` above a 20px `#1D1D1F` title at `0.08em` is a complete
   hierarchy with no mid-weight and no size jump worth mentioning.
4. **Tracking is a function of case, not just size** — `0.15em` for uppercase, `0.025em` for
   sentence case, `0` for display. Uppercase without added tracking is the single most common
   amateur tell, and this site never makes it.
5. **Zero radius on rectangles, circles on circles.** No 8px "friendly" corner anywhere. The
   confidence to leave a corner sharp.
6. **Zero shadows. Depth is two flat planes and a −5° rotation.** Nothing floats; things *abut*.
7. **The 1px rule is the same colour as the alternate background — 1.11:1.** Separation you can feel
   and not see, instead of a visible `#DDD` line.
8. **The accent appears 13 times on a 5400px page and never fills anything** until you hover a
   button, where a 2px outline flips to solid. One accent event per interaction.
9. **Body prose is a serif at line-height 1.85** while every piece of chrome is a geometric sans at
   1.428. Two typographic registers, cleanly separated — reading vs. operating.
10. **Motion has exactly two curves.** `cubic-bezier(.77,0,.175,1)` (easeInOutQuart) for content
    reveals, `cubic-bezier(.165,.84,.44,1)` (easeOutQuart) for hover and micro-state. Delays step in
    100ms increments (`.1s` through `1.1s`) for staggered entrances.

**Do not copy:** body text at 2.76:1. That is a portfolio's luxury and a dev tool's bug.

---

## 6. Proposed token set — dark developer tool

Same shape as `app/src/theme.ts`. Everything is flagged **[verbatim]** (taken from the benchmark
unchanged), **[inverted]** (the benchmark's relationship, applied to a dark base), or **[derived]**
(the benchmark has no equivalent and I made one in its spirit — with the reasoning stated).

### Derivation notes

- **Base is the benchmark's own `#1D1D1F`**, which is what the site shows on first paint. The surface
  ramp above it holds hue 240 and 4–5% saturation, matching the benchmark's cool cast, and steps by
  L = 11.8 → 16.5 → 20.5%.
- **Text is capped at `#ECECEF`, not `#FFFFFF`.** The benchmark *does* use pure white on its black
  blocks, but those are 3 short bands. Here white-on-dark is the dominant pairing across code, diffs
  and terminal output, where 16.8:1 halates on OLED. `#ECECEF` holds the 240° cool cast and still
  measures 14.27:1 on bg.
- **Secondary text is `#9B9BA3` verbatim** — the benchmark's own body grey. On this dark base it
  measures 6.10:1 (bg) / 5.32:1 (surface) / 4.62:1 (surfaceHi), so the one thing the benchmark got
  wrong on white gets fixed for free by inverting.
- **Status colours are derived** — the benchmark has none. Recipe: the celeste's own formula,
  `hsl(H, 35–60%, 65–70%)`. Mid-lightness, moderate saturation, no pure hues. `running` *is* the
  celeste, verbatim. Every status was verified ≥4.5:1 as text on all three surfaces, and ≥5.7:1 as
  ink on its own fill. `dead` and destructive share `danger`, matching the current theme's semantics
  and keeping hue separation ≥40° between every remaining pair.
- **Never colour alone.** The benchmark's own signalling device is the 12px uppercase `0.15em` kicker
  and the `— ` em-dash prefix. `type.label` + a lucide glyph carries every status; the colour is the
  third channel, never the first.
- **Radius goes to 0**, matching the benchmark exactly, with `pill: 999` reserved for genuinely
  circular controls (FAB, status dots) — which is the only way the benchmark uses radius either.
- **`space` moves from a 4pt to a 5pt unit** so `space(2) = 10`, landing on the benchmark's 10px
  grid at every even multiple. **This changes the meaning of every existing `space(n)` call site**
  (`space(4)` goes 16 → 20). If that migration isn't wanted, keep `n * 4` and treat this as
  aspiration; the rest of the token set is independent of it.
- **No shadow token exists, deliberately.** Depth is a step on the neutral ramp, never elevation.

```ts
import type { TextStyle } from "react-native";
import { Easing } from "react-native";

export const color = {
  // --- surfaces: benchmark's #1D1D1F base, ramp holds hue 240 @ 4-5% sat ---
  bg:        "#1D1D1F", // [verbatim] the site's --black; its intro panel and left rail
  surface:   "#28282C", // [inverted] hsl(240 4% 16.5%) — cards
  surfaceHi: "#323237", // [inverted] hsl(240 4.5% 20.5%) — raised / selected / pressed
  border:    "#2E2E33", // [inverted] 1.25:1 hairline. The site's rule is #F3F3F3 on #FFF = 1.11:1
  borderHi:  "#55555E", // [derived]  2.28:1 — the 2px outlined button and focus ring

  // --- ink: two tiers, exactly as the benchmark has (not three) ---
  text:      "#ECECEF", // [derived]  14.27:1. Capped below #FFF; keeps the 240 cool cast
  textMut:   "#9B9BA3", // [verbatim] the site's --grey-light. 6.10:1 on bg, 4.62:1 on surfaceHi

  // --- the one accent ---
  accent:     "#87C6BD", // [verbatim] --celeste. 8.69:1 on bg. Running / primary CTA
  accentText: "#101014", // [derived]  ink on an accent fill, 9.80:1 (the site uses #FFF here = 1.94:1)

  // --- status: derived. celeste's recipe hsl(H, 35-60%, 65-70%) ---
  warn:   "#D5B47B", // [derived] hsl(38 52% 66%)  waiting_on_user     8.53 / 7.44 / 6.46
  danger: "#E08C85", // [derived] hsl(5 60% 70%)   dead / destructive  6.62 / 5.78 / 5.01
  info:   "#90B0D5", // [derived] hsl(212 45% 70%) links, info         7.50 / 6.54 / 5.68
  idle:   "#9B9BA3", // [verbatim] --grey-light doubles as "nothing is happening"  6.10 / 5.32 / 4.62
} as const;

/** 5pt unit → space(2) = 10, the benchmark's grid step. Even n lands on 10/20/30/40. */
export const space = (n: number) => n * 5;

/** [verbatim] Rectangles are sharp; circles are circles. The benchmark has nothing between. */
export const radius = { card: 0, chip: 0, input: 0, pill: 999 } as const;

/**
 * [derived] Oak Bold + Plantin Light are not licensable here. Inter is the closest
 * available neo-grotesque; the benchmark's discipline transfers regardless — use
 * TWO weights only (ui + uiBold) and let case and tracking carry hierarchy.
 * `uiMed` is kept for existing call sites but should be retired.
 */
export const font = {
  ui: "Inter", uiMed: "Inter-Medium", uiBold: "Inter-Bold", mono: "JetBrainsMono",
} as const;

/**
 * Tracking follows the benchmark's rule: CASE decides the band, not size.
 * uppercase → 0.135-0.15em · sentence case ≤20px → 0.025em · display → 0.
 * Line-height runs the other way: 1.15 at display → 1.5 at body.
 */
export const type = {
  title: { fontFamily: font.uiBold, fontSize: 26, lineHeight: 30, letterSpacing: 0 },
  h2:    { fontFamily: font.uiBold, fontSize: 20, lineHeight: 26, letterSpacing: 0.5 },  // 0.025em
  body:  { fontFamily: font.ui,     fontSize: 16, lineHeight: 24, letterSpacing: 0.2 },
  sub:   { fontFamily: font.ui,     fontSize: 14, lineHeight: 20, letterSpacing: 0.35 }, // 0.025em
  label: { fontFamily: font.uiBold, fontSize: 12, lineHeight: 16, letterSpacing: 1.8,    // 0.15em
           textTransform: "uppercase" as const },
  mono:  { fontFamily: font.mono,   fontSize: 13, lineHeight: 19, letterSpacing: 0 },
} as const;

export const touch = { min: 48 } as const;

export type ColorRole = keyof typeof color;
export type TypeVariant = keyof typeof type;

/**
 * Durations keep the app's 150-250ms cap (journey principle 5). The curves are the
 * benchmark's two, and only two: easeInOutQuart for anything that enters or leaves,
 * easeOutQuart for hover/press/micro-state. `stagger` is its 100ms delay step.
 */
export const motion = { fast: 150, base: 200, slow: 250, stagger: 100 } as const;
export const easing = {
  inOut: Easing.bezier(0.77, 0, 0.175, 1),   // [verbatim] content reveals
  out:   Easing.bezier(0.165, 0.84, 0.44, 1), // [verbatim] press / micro-state
} as const;

export const opacity = { pressed: 0.6, disabled: 0.45, full: 1 } as const;

/** [verbatim] The benchmark's borders are 1px (rules) and 2px (outlined button). */
export const stroke = { hairline: 1, emphasis: 2, icon: 1.5 } as const;

export const icon = { sm: 16, md: 20, lg: 24, xl: 40 } as const;

/** 0.15em at 12px — the benchmark's signature. `type.label` already carries it. */
export const tracking = { label: 1.8 } as const;

/**
 * No shadow token, on purpose. The benchmark has zero box-shadows: depth is one step
 * on the neutral ramp (bg → surface → surfaceHi), never elevation.
 */

/** Machine text is quoted, not typeset — see the note in the current theme.ts. */
export const noLigatures: Pick<TextStyle, "fontVariant"> = {
  fontVariant: ["no-common-ligatures", "no-contextual"],
};

/** Diff line backgrounds, derived from the accent/danger tokens so they can't drift. */
export const tint = { add: `${color.accent}24`, del: `${color.danger}24` } as const;

/** [verbatim] Someone else's page assumes a browser's white default. Outside the palette. */
export const canvas = "#FFFFFF";
```

### Verified contrast of the proposed tokens

| token | on `bg` | on `surface` | on `surfaceHi` |
|---|---|---|---|
| `text` `#ECECEF` | 14.27 | 12.45 | 10.81 |
| `textMut` `#9B9BA3` | 6.10 | 5.32 | 4.62 |
| `accent` `#87C6BD` | 8.69 | 7.58 | 6.58 |
| `warn` `#D5B47B` | 8.53 | 7.44 | 6.46 |
| `danger` `#E08C85` | 6.62 | 5.78 | 5.01 |
| `info` `#90B0D5` | 7.50 | 6.54 | 5.68 |
| `idle` `#9B9BA3` | 6.10 | 5.32 | 4.62 |

Every text role clears 4.5:1 on every surface. `accentText` `#101014` on an `accent` fill is 9.80:1;
on `warn` 9.62, `danger` 7.47, `info` 8.46, `idle` 6.88 — so the same ink works on any filled chip.
