/** Named background palettes for the app chrome (surfaces + border). */

export type BackgroundThemeId =
  | 'default'
  | 'slate'
  | 'navy'
  | 'charcoal'
  | 'forest'
  | 'wine'

export type BackgroundPalette = {
  id: BackgroundThemeId
  label: string
  /** Swatch shown in Settings (base surface). */
  swatch: string
  surface: string
  surface2: string
  surface3: string
  border: string
}

export const BACKGROUND_THEMES: BackgroundPalette[] = [
  {
    id: 'default',
    label: 'Default',
    swatch: '#0d0d0f',
    surface: '#0d0d0f',
    surface2: '#141418',
    surface3: '#1c1c23',
    border: '#2a2a35',
  },
  {
    id: 'slate',
    label: 'Slate',
    swatch: '#0f172a',
    surface: '#0f172a',
    surface2: '#1e293b',
    surface3: '#334155',
    border: '#475569',
  },
  {
    id: 'navy',
    label: 'Navy',
    swatch: '#0a0e1a',
    surface: '#0a0e1a',
    surface2: '#12182b',
    surface3: '#1a2238',
    border: '#2a3550',
  },
  {
    id: 'charcoal',
    label: 'Charcoal',
    swatch: '#121212',
    surface: '#121212',
    surface2: '#1a1a1a',
    surface3: '#242424',
    border: '#333333',
  },
  {
    id: 'forest',
    label: 'Forest',
    swatch: '#0c1210',
    surface: '#0c1210',
    surface2: '#141c18',
    surface3: '#1c2822',
    border: '#2a3a32',
  },
  {
    id: 'wine',
    label: 'Wine',
    swatch: '#140e12',
    surface: '#140e12',
    surface2: '#1c1418',
    surface3: '#261c22',
    border: '#3a2a32',
  },
]

export const DEFAULT_BACKGROUND_THEME: BackgroundThemeId = 'default'

export function getBackgroundTheme(id: string | undefined | null): BackgroundPalette {
  return BACKGROUND_THEMES.find((t) => t.id === id) ?? BACKGROUND_THEMES[0]!
}

/** Apply palette CSS variables on :root (and body background). */
export function applyBackgroundTheme(id: string | undefined | null): void {
  const theme = getBackgroundTheme(id)
  const root = document.documentElement
  root.style.setProperty('--color-surface', theme.surface)
  root.style.setProperty('--color-surface-2', theme.surface2)
  root.style.setProperty('--color-surface-3', theme.surface3)
  root.style.setProperty('--color-border', theme.border)
  document.body.style.backgroundColor = theme.surface
}
