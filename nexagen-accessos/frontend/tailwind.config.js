export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      fontFamily: {
        display: ['"Space Grotesk"', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        sans: ['Inter', 'ui-sans-serif', 'system-ui', 'sans-serif'],
      },
      colors: {
        // "ink" — the near-black navy used for chrome (header, sidebar,
        // the Login split panel) instead of plain slate-900. Slightly
        // blue-shifted so it reads as "security console" rather than
        // generic dark-mode gray.
        ink: {
          950: '#0A0F1E',
          900: '#0F172A',
          800: '#1B2537',
          700: '#2A3650',
        },
        // "signal" — the one brand accent, used deliberately and
        // sparingly (primary buttons, focus rings, active nav state,
        // the Login signature graphic). Teal rather than the default
        // indigo/violet every SaaS dashboard reaches for — reads as
        // "verified / scanned" rather than "generic corporate."
        signal: {
          50: '#EFFDFB',
          100: '#CCFBF3',
          400: '#2DD4C6',
          500: '#0FB8A9',
          600: '#0D9488',
          700: '#0B7A70',
        },
      },
      boxShadow: {
        card: '0 1px 2px 0 rgb(15 23 42 / 0.04), 0 1px 3px 0 rgb(15 23 42 / 0.06)',
        'card-hover': '0 4px 12px -2px rgb(15 23 42 / 0.08), 0 2px 4px -2px rgb(15 23 42 / 0.06)',
        panel: '0 25px 50px -12px rgb(10 15 30 / 0.35)',
      },
    },
  },
  plugins: [],
};