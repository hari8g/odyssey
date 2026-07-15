import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))

/** @type {import('tailwindcss').Config} */
export default {
  content: [
    resolve(__dirname, 'index.html'),
    resolve(__dirname, 'src/**/*.{ts,tsx,js,jsx}'),
  ],
  theme: {
    extend: {
      colors: {
        canvas: { DEFAULT: '#0B0C0E', light: '#F7F7F8' },
        surface: {
          DEFAULT: '#131417',
          1: '#131417',
          2: '#1B1D21',
          3: '#24262B',
          l1: '#FFFFFF',
          l2: '#F1F1F3',
          l3: '#E7E7EA',
        },
        'surface-2': '#1B1D21',
        'surface-3': '#24262B',
        line: { DEFAULT: '#2A2D33', strong: '#3D4149', l: '#E3E4E8', lstrong: '#CFD1D7' },
        border: '#2A2D33',
        ink: {
          1: '#F2F3F5',
          2: '#A9ADB6',
          3: '#6F747E',
          l1: '#17181B',
          l2: '#4E535D',
          l3: '#8A8F99',
        },
        accent: { DEFAULT: '#6E5BFF', hover: '#5A47EB', soft: '#6E5BFF1F' },
        'accent-2': '#2FBF8F',
        ok: { DEFAULT: '#2FBF8F', soft: '#2FBF8F1A', dark: '#07291F' },
        warn: { DEFAULT: '#E8A13C', soft: '#E8A13C1A', dark: '#2B2008' },
        danger: { DEFAULT: '#E25C5C', soft: '#E25C5C1A', dark: '#331111' },
        info: { DEFAULT: '#4C9AE8', soft: '#4C9AE81A', dark: '#0D2540' },
        listen: '#E24B4A',
        decide: '#D4537E',
        define: '#639922',
        build: '#7F77DD',
        ship: '#378ADD',
        learn: '#1D9E75',
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'ui-monospace', 'monospace'],
      },
      fontSize: {
        display: ['22px', { lineHeight: '28px', fontWeight: '600' }],
        title: ['15px', { lineHeight: '22px', fontWeight: '600' }],
        body: ['13px', { lineHeight: '20px', fontWeight: '400' }],
        micro: ['11px', { lineHeight: '16px', fontWeight: '500' }],
      },
      borderRadius: { card: '12px', control: '8px', pill: '999px' },
      boxShadow: {
        raise: '0 1px 2px rgba(0,0,0,.25), 0 4px 16px rgba(0,0,0,.20)',
        pop: '0 8px 32px rgba(0,0,0,.35)',
        gate: '0 0 0 3px #E8A13C44',
      },
      transitionDuration: { fast: '150ms', base: '200ms', slow: '250ms' },
      animation: {
        'spin-slow': 'spin 3s linear infinite',
      },
    },
  },
  plugins: [
    function reducedMotion({ addVariant }) {
      addVariant('motion-safe', '@media (prefers-reduced-motion: no-preference)')
      addVariant('motion-reduce', '@media (prefers-reduced-motion: reduce)')
    },
  ],
}
