/**
 * plAIt v2 "paper" design tokens (Sushi 2.1, June 2026 spec — locked).
 *
 * Color is semantic, never decorative:
 *   green = matched / safe / primary actions (the brand color)
 *   amber = verify-with-staff contexts ONLY
 *   plum  = stretch picks ONLY, always paired with dashed borders
 *
 * Legacy v1 keys (background / coral / teal / text / …) are kept as aliases
 * mapped into the new system so every v1 screen compiles and inherits the
 * paper look without a per-screen rewrite. New code should use the v2 names.
 */
export const Plait = {
  color: {
    // ── v2 paper system
    paper: '#FBFAF7',
    card: '#FFFFFF',
    ink: '#1B1E1B',
    inkSoft: '#5C615C',
    inkFaint: '#9AA09A',
    line: '#E7E5DE',
    green: '#1F5C40',
    greenSoft: '#EAF2ED',
    amber: '#B26A00',
    amberSoft: '#FBF1E0',
    plum: '#6E3B8E',
    plumSoft: '#F3ECF8',

    // ── legacy aliases (v1 screens)
    background: '#FBFAF7', // → paper
    cardElevated: '#EFEDE6',
    coral: '#1F5C40', // primary accent → green
    teal: '#1F5C40', // secondary accent → green (amber/plum are reserved)
    text: '#1B1E1B', // → ink
    textDim: '#5C615C', // → inkSoft
    border: '#E7E5DE', // → line
    danger: '#A8402F', // errors only — verify contexts use amber
    warn: '#B26A00', // → amber
  },
  font: {
    // ── v2 type ramp (exact static weights; loaded in app/_layout)
    display: 'Fraunces_600SemiBold', // dish names, headers
    displayMedium: 'Fraunces_500Medium',
    body: 'PublicSans_400Regular',
    bodySemiBold: 'PublicSans_600SemiBold',
    bodyBold: 'PublicSans_700Bold',
    mono: 'SplineSansMono_400Regular', // prices, scores, eyebrow labels
    monoSemiBold: 'SplineSansMono_600SemiBold',

    // ── legacy aliases (v1 screens; their fontWeight overrides are ignored
    //    on iOS for loaded fonts — hierarchy there leans on size/color)
    serif: 'Fraunces_600SemiBold',
    sans: 'PublicSans_400Regular',
  },
  space: {
    xs: 6,
    sm: 12,
    md: 18,
    lg: 28,
    xl: 40,
  },
  radius: {
    sm: 10,
    md: 16,
    lg: 20,
    pill: 999,
  },
} as const;
