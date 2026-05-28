/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      // ── Material Design 3 color tokens (from Stitch) ──────────────────────
      colors: {
        // Primary
        'primary':                    '#004ac6',
        'primary-container':          '#2563eb',
        'primary-fixed':              '#dbe1ff',
        'primary-fixed-dim':          '#b4c5ff',
        'on-primary':                 '#ffffff',
        'on-primary-container':       '#eeefff',
        'on-primary-fixed':           '#00174b',
        'on-primary-fixed-variant':   '#003ea8',
        'inverse-primary':            '#b4c5ff',
        // Secondary
        'secondary':                  '#565e74',
        'secondary-container':        '#dae2fd',
        'secondary-fixed':            '#dae2fd',
        'secondary-fixed-dim':        '#bec6e0',
        'on-secondary':               '#ffffff',
        'on-secondary-container':     '#5c647a',
        'on-secondary-fixed':         '#131b2e',
        'on-secondary-fixed-variant': '#3f465c',
        // Tertiary
        'tertiary':                   '#525657',
        'tertiary-container':         '#6b6e70',
        'tertiary-fixed':             '#e0e3e5',
        'tertiary-fixed-dim':         '#c4c7c9',
        'on-tertiary':                '#ffffff',
        'on-tertiary-container':      '#eff1f3',
        'on-tertiary-fixed':          '#191c1e',
        'on-tertiary-fixed-variant':  '#444749',
        // Surface
        'surface':                    '#f8f9ff',
        'surface-dim':                '#cbdbf5',
        'surface-bright':             '#f8f9ff',
        'surface-variant':            '#d3e4fe',
        'surface-tint':               '#0053db',
        'surface-container-lowest':   '#ffffff',
        'surface-container-low':      '#eff4ff',
        'surface-container':          '#e5eeff',
        'surface-container-high':     '#dce9ff',
        'surface-container-highest':  '#d3e4fe',
        'on-surface':                 '#0b1c30',
        'on-surface-variant':         '#434655',
        // Background
        'background':                 '#f8f9ff',
        'on-background':              '#0b1c30',
        // Outline
        'outline':                    '#737686',
        'outline-variant':            '#c3c6d7',
        // Inverse
        'inverse-surface':            '#213145',
        'inverse-on-surface':         '#eaf1ff',
        // Error
        'error':                      '#ba1a1a',
        'error-container':            '#ffdad6',
        'on-error':                   '#ffffff',
        'on-error-container':         '#93000a',
        // Legacy brand scale (backward compat)
        brand: {
          50: '#eff6ff', 100: '#dbeafe', 200: '#bfdbfe', 300: '#93c5fd',
          400: '#60a5fa', 500: '#3b82f6', 600: '#2563eb', 700: '#1d4ed8',
          800: '#1e40af', 900: '#1e3a8a',
        },
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
        'topbar':  '64px',
      },
      screens: { xs: '375px' },
    },
  },
  plugins: [],
}
