/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      // ── Paleta Violeta Premium ─────────────────────────────────────────────
      colors: {
        // Primary — Violet
        'primary':                    '#6D28D9',
        'primary-container':          '#8B5CF6',
        'primary-fixed':              '#EDE9FE',
        'primary-fixed-dim':          '#DDD6FE',
        'on-primary':                 '#ffffff',
        'on-primary-container':       '#F5F3FF',
        'on-primary-fixed':           '#2E1065',
        'on-primary-fixed-variant':   '#5B21B6',
        'inverse-primary':            '#C4B5FD',
        // Secondary — Slate neutro
        'secondary':                  '#64748B',
        'secondary-container':        '#E2E8F0',
        'secondary-fixed':            '#E2E8F0',
        'secondary-fixed-dim':        '#CBD5E1',
        'on-secondary':               '#ffffff',
        'on-secondary-container':     '#475569',
        'on-secondary-fixed':         '#1E1B2E',
        'on-secondary-fixed-variant': '#3F3B52',
        // Tertiary — neutro frio
        'tertiary':                   '#52525B',
        'tertiary-container':         '#71717A',
        'tertiary-fixed':             '#E4E4E7',
        'tertiary-fixed-dim':         '#D1D5DB',
        'on-tertiary':                '#ffffff',
        'on-tertiary-container':      '#F4F4F5',
        'on-tertiary-fixed':          '#18181B',
        'on-tertiary-fixed-variant':  '#444449',
        // Surface — toque violeta suave
        'surface':                    '#FAF8FF',
        'surface-dim':                '#DDD6FE',
        'surface-bright':             '#FDFCFF',
        'surface-variant':            '#EDE9FE',
        'surface-tint':               '#6D28D9',
        'surface-container-lowest':   '#ffffff',
        'surface-container-low':      '#F5F3FF',
        'surface-container':          '#EDE9FE',
        'surface-container-high':     '#E4DAFF',
        'surface-container-highest':  '#DDD6FE',
        'on-surface':                 '#1C1427',
        'on-surface-variant':         '#4B4558',
        // Background
        'background':                 '#FAF8FF',
        'on-background':              '#1C1427',
        // Outline
        'outline':                    '#6E6780',
        'outline-variant':            '#D0C9E0',
        // Inverse
        'inverse-surface':            '#2E1A47',
        'inverse-on-surface':         '#F5F3FF',
        // Error (mantém)
        'error':                      '#ba1a1a',
        'error-container':            '#ffdad6',
        'on-error':                   '#ffffff',
        'on-error-container':         '#93000a',
        // Legacy brand scale → violet
        brand: {
          50:  '#F5F3FF', 100: '#EDE9FE', 200: '#DDD6FE', 300: '#C4B5FD',
          400: '#A78BFA', 500: '#8B5CF6', 600: '#7C3AED', 700: '#6D28D9',
          800: '#5B21B6', 900: '#4C1D95',
        },
        // Border util usado em mobile cards
        'border-subtle': '#E0D9F0',
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
