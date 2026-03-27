/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './src/pages/**/*.{js,ts,jsx,tsx,mdx}',
    './src/components/**/*.{js,ts,jsx,tsx,mdx}',
    './src/app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Cairo', 'Plus Jakarta Sans', 'sans-serif'],
        display: ['Cairo', 'sans-serif'],
        mono: ['Plus Jakarta Sans', 'monospace'],
      },
      colors: {
        primary: {
          DEFAULT: 'hsl(211, 67%, 28%)',
          50: 'hsl(211, 67%, 96%)',
          100: 'hsl(211, 67%, 90%)',
          200: 'hsl(211, 67%, 78%)',
          500: 'hsl(211, 67%, 45%)',
          600: 'hsl(211, 67%, 35%)',
          700: 'hsl(211, 67%, 28%)',
          800: 'hsl(211, 67%, 20%)',
          900: 'hsl(211, 67%, 14%)',
        },
        accent: {
          DEFAULT: 'hsl(28, 80%, 52%)',
          50: 'hsl(28, 80%, 96%)',
          100: 'hsl(28, 80%, 90%)',
          500: 'hsl(28, 80%, 52%)',
          600: 'hsl(28, 80%, 44%)',
        },
      },
      borderRadius: {
        xl: '0.75rem',
        '2xl': '1rem',
        '3xl': '1.5rem',
      },
      boxShadow: {
        card: '0 1px 3px 0 rgba(0,0,0,0.06), 0 1px 2px -1px rgba(0,0,0,0.04)',
        'card-hover': '0 4px 12px 0 rgba(0,0,0,0.08), 0 2px 4px -1px rgba(0,0,0,0.04)',
        modal: '0 20px 60px -10px rgba(0,0,0,0.15)',
      },
      animation: {
        'fade-in': 'fadeIn 0.2s ease-in-out',
        'slide-up': 'slideUp 0.3s ease-out',
        'pulse-subtle': 'pulseSubtle 2s ease-in-out infinite',
      },
      keyframes: {
        fadeIn: {
          '0%': { opacity: '0', transform: 'translateY(4px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        slideUp: {
          '0%': { opacity: '0', transform: 'translateY(20px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        pulseSubtle: {
          '0%, 100%': { opacity: '1' },
          '50%': { opacity: '0.7' },
        },
      },
    },
  },
  plugins: [
    require('@tailwindcss/typography'),
  ],
};