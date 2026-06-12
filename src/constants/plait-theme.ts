/**
 * plAIt v2 "paper" design tokens (Sushi 2.1, June 2026 spec — locked).
 *
 * Color is semantic, never decorative:
 *   green = matched / safe / primary actions (the brand color)
 *   amber = verify-with-staff contexts ONLY
 *   plum  = stretch picks ONLY, always paired with dashed borders
 */
export const Plait = {
  color: {
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
    danger: '#A8402F', // errors only — verify contexts use amber
  },
  font: {
    // Exact static weights; loaded in app/_layout.
    display: 'Fraunces_600SemiBold', // dish names, headers
    displayMedium: 'Fraunces_500Medium',
    body: 'PublicSans_400Regular',
    bodySemiBold: 'PublicSans_600SemiBold',
    bodyBold: 'PublicSans_700Bold',
    mono: 'SplineSansMono_400Regular', // prices, scores, eyebrow labels
    monoSemiBold: 'SplineSansMono_600SemiBold',
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
