export const color = {
  bg: "#0B1220",          // app background (near-black blue, OLED-friendly)
  surface: "#121B2E",     // cards
  surfaceHi: "#1B2843",   // raised/selected
  border: "#26334F",
  text: "#F1F5F9",
  textMut: "#93A1B7",     // ≥4.5:1 on surface
  accent: "#22C55E",      // running / primary CTA
  accentText: "#052E13",  // text on accent
  warn: "#F5A623",        // waiting_on_user
  danger: "#EF4444",      // dead / destructive
  info: "#38BDF8",        // links, info
  idle: "#64748B",
} as const;
export const space = (n: number) => n * 4;           // 4pt grid
export const radius = { card: 14, chip: 8, pill: 24, input: 10 } as const;
export const font = { ui: "Inter", uiMed: "Inter-Medium", uiBold: "Inter-Bold", mono: "JetBrainsMono" } as const;
export const type = {
  title: { fontFamily: font.uiBold, fontSize: 26, lineHeight: 32 },
  h2:    { fontFamily: font.uiMed,  fontSize: 20, lineHeight: 26 },
  body:  { fontFamily: font.ui,     fontSize: 16, lineHeight: 24 },
  sub:   { fontFamily: font.ui,     fontSize: 14, lineHeight: 20 },
  mono:  { fontFamily: font.mono,   fontSize: 13, lineHeight: 19 },
} as const;
export const touch = { min: 48 } as const;

// --- Additions beyond the plan's block (still the single token source) ---

/** Named color roles usable as a `color` prop on Text. */
export type ColorRole = keyof typeof color;

/** Type-scale variants usable as a `variant` prop on Text. */
export type TypeVariant = keyof typeof type;

/** Motion: journey principle 5 — 150-250ms only. */
export const motion = { fast: 150, base: 200, slow: 250 } as const;

/** Opacity steps (pressed / disabled feedback). */
export const opacity = { pressed: 0.6, disabled: 0.45, full: 1 } as const;

/** Stroke widths: borders, plus the lighter weight lucide icons draw with. */
export const stroke = { hairline: 1, emphasis: 3, icon: 1.5 } as const;

/** Icon sizes on the 4pt grid. */
export const icon = { sm: 16, md: 20, lg: 24, xl: 40 } as const;

/** Letter spacing for all-caps section labels. */
export const tracking = { label: 1 } as const;
