/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      // ── Paleta Oceano Azul ────────────────────────────────────────────────
      colors: {
        // Primary — Sky/Ocean Blue
        'primary':                    '#0284c7',
        'primary-container':          '#0ea5e9',
        'primary-fixed':              '#e0f2fe',
        'primary-fixed-dim':          '#bae6fd',
        'on-primary':                 '#ffffff',
        'on-primary-container':       '#f0f9ff',
        'on-primary-fixed':           '#0c4a6e',
        'on-primary-fixed-variant':   '#0369a1',
        'inverse-primary':            '#7dd3fc',
        // Secondary — Slate neutro
        'secondary':                  '#64748B',
        'secondary-container':        '#E2E8F0',
        'secondary-fixed':            '#E2E8F0',
        'secondary-fixed-dim':        '#CBD5E1',
        'on-secondary':               '#ffffff',
        'on-secondary-container':     '#475569',
        'on-secondary-fixed':         '#0c1e2e',
        'on-secondary-fixed-variant': '#1e3a5f',
        // Tertiary — neutro frio
        'tertiary':                   '#52525B',
        'tertiary-container':         '#71717A',
        'tertiary-fixed':             '#E4E4E7',
        'tertiary-fixed-dim':         '#D1D5DB',
        'on-tertiary':                '#ffffff',
        'on-tertiary-container':      '#F4F4F5',
        'on-tertiary-fixed':          '#18181B',
        'on-tertiary-fixed-variant':  '#444449',
        // Surface — toque azul suave
        'surface':                    '#f0f9ff',
        'surface-dim':                '#bae6fd',
        'surface-bright':             '#f8fbff',
        'surface-variant':            '#e0f2fe',
        'surface-tint':               '#0284c7',
        'surface-container-lowest':   '#ffffff',
        'surface-container-low':      '#e8f5fe',
        'surface-container':          '#e0f2fe',
        'surface-container-high':     '#bae6fd',
        'surface-container-highest':  '#93c5fd',
        'on-surface':                 '#0c1a2e',
        'on-surface-variant':         '#334155',
        // Background
        'background':                 '#f0f9ff',
        'on-background':              '#0c1a2e',
        // Outline
        'outline':                    '#64748b',
        'outline-variant':            '#bae6fd',
        // Inverse
        'inverse-surface':            '#0c4a6e',
        'inverse-on-surface':         '#e0f2fe',
        // Error (mantém)
        'error':                      '#ba1a1a',
        'error-container':            '#ffdad6',
        'on-error':                   '#ffffff',
        'on-error-container':         '#93000a',
        // Legacy brand scale → sky/ocean
        brand: {
          50:  '#f0f9ff', 100: '#e0f2fe', 200: '#bae6fd', 300: '#7dd3fc',
          400: '#38bdf8', 500: '#0ea5e9', 600: '#0284c7', 700: '#0369a1',
          800: '#075985', 900: '#0c4a6e',
        },
        // Border util
        'border-subtle': '#bae6fd',
      },
      // ── Fonts ─────────────────────────────────────────────────────────────
      fontFamily: {
        sans:    ['Inter', 'ui-sans-serif', 'system-ui'],
        display: ['"Plus Jakarta Sans"', 'ui-sans-serif'],
      },
      // ── Type scale ────────────────────────────────────────────────────────
      fontSize: {
        'display-lg':  ['36px', { lineHeight: '44px',  letterSpacing: '-0.02em', fontWeight: '700' }],
        'headline-md': ['24px', { lineHeight: '32px',  letterSpacing: '-0.01em', fontWeight: '600' }],
        'headline-sm': ['18px', { lineHeight: '26px',  fontWeight: '600' }],
        'body-lg':     ['16px', { lineHeight: '24px',  fontWeight: '400' }],
        'body-md':     ['14px', { lineHeight: '20px',  fontWeight: '400' }],
        'body-sm':     ['12px', { lineHeight: '18px',  fontWeight: '400' }],
        'label-md':    ['13px', { lineHeight: '16px',  letterSpacing: '0.02em', fontWeight: '500' }],
        'label-sm':    ['11px', { lineHeight: '14px',  letterSpacing: '0.05em', fontWeight: '600' }],
      },
      // ── Spacing ───────────────────────────────────────────────────────────
      spacing: {
        'sidebar': '260px',
        'topbar':  '80px',
      },
      screens: { xs: '375px' },
    },
  },
  plugins: [],
}
