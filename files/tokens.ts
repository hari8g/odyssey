/**
 * tokens.ts
 * Single source of truth for all design values.
 * Imported by tailwind.config.ts and by any component that needs raw values.
 */

// ── Verb palette ──────────────────────────────────────────────────────────────
export const VERB_COLOR = {
  LISTEN: { full: '#E24B4A', soft: '#E24B4A1F', text: '#FF8E8D' },
  DECIDE: { full: '#D4537E', soft: '#D4537E1F', text: '#F09BBB' },
  DEFINE: { full: '#639922', soft: '#6399221F', text: '#9DD95C' },
  BUILD:  { full: '#7F77DD', soft: '#7F77DD1F', text: '#C0BBFF' },
  SHIP:   { full: '#378ADD', soft: '#378ADD1F', text: '#8EC4F5' },
  LEARN:  { full: '#1D9E75', soft: '#1D9E751F', text: '#5DCAA5' },
} as const

export type VerbKey = keyof typeof VERB_COLOR

// ── Status palette ────────────────────────────────────────────────────────────
export const STATUS_COLOR = {
  ok:     { bg: '#07291F', border: '#17654C', text: '#3ECF8E', icon: '✓' },
  warn:   { bg: '#2B2008', border: '#7A5A14', text: '#E8A13C', icon: '⚠' },
  danger: { bg: '#331111', border: '#7A2E2E', text: '#E25C5C', icon: '✕' },
  info:   { bg: '#0D2540', border: '#1E4878', text: '#4C9AE8', icon: 'ℹ' },
  neutral:{ bg: '#1B1D21', border: '#2A2D33', text: '#A9ADB6', icon: '○' },
} as const

export type StatusKey = keyof typeof STATUS_COLOR

// ── Motion ────────────────────────────────────────────────────────────────────
export const DURATION = { fast: 150, base: 200, slow: 250 } as const
export const EASING   = { standard: 'cubic-bezier(0.4,0,0.2,1)', decel: 'cubic-bezier(0,0,0.2,1)' } as const

// ── Tailwind theme extension ──────────────────────────────────────────────────
export const journeyTheme = {
  colors: {
    canvas:  { DEFAULT: '#0B0C0E', light: '#F7F7F8' },
    surface: {
      1: '#131417', 2: '#1B1D21', 3: '#24262B',
      l1: '#FFFFFF', l2: '#F1F1F3', l3: '#E7E7EA',
    },
    line: { DEFAULT: '#2A2D33', strong: '#3D4149', l: '#E3E4E8', lstrong: '#CFD1D7' },
    ink: {
      1: '#F2F3F5', 2: '#A9ADB6', 3: '#6F747E',
      l1: '#17181B', l2: '#4E535D', l3: '#8A8F99',
    },
    accent:  { DEFAULT: '#6E5BFF', hover: '#5A47EB', soft: '#6E5BFF1F' },
    ok:      { DEFAULT: '#2FBF8F', soft: '#2FBF8F1A', dark: '#07291F' },
    warn:    { DEFAULT: '#E8A13C', soft: '#E8A13C1A', dark: '#2B2008' },
    danger:  { DEFAULT: '#E25C5C', soft: '#E25C5C1A', dark: '#331111' },
    info:    { DEFAULT: '#4C9AE8', soft: '#4C9AE81A', dark: '#0D2540' },
    listen:  '#E24B4A', decide: '#D4537E', define: '#639922',
    build:   '#7F77DD', ship:   '#378ADD', learn:  '#1D9E75',
  },
  fontFamily: {
    sans: ['Inter', 'system-ui', 'sans-serif'],
    mono: ['"JetBrains Mono"', 'ui-monospace', 'monospace'],
  },
  fontSize: {
    display: ['22px', { lineHeight: '28px', fontWeight: '600' }],
    title:   ['15px', { lineHeight: '22px', fontWeight: '600' }],
    body:    ['13px', { lineHeight: '20px', fontWeight: '400' }],
    micro:   ['11px', { lineHeight: '16px', fontWeight: '500' }],
  },
  borderRadius: { card: '12px', control: '8px', pill: '999px' },
  boxShadow: {
    raise: '0 1px 2px rgba(0,0,0,.25), 0 4px 16px rgba(0,0,0,.20)',
    pop:   '0 8px 32px rgba(0,0,0,.35)',
    gate:  '0 0 0 3px #E8A13C44',
  },
  transitionDuration: { fast: '150ms', base: '200ms', slow: '250ms' },
} as const
