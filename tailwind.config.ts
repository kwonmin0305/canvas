import type { Config } from 'tailwindcss'

const config: Config = {
  content: [
    './app/**/*.{js,ts,jsx,tsx,mdx}',
    './components/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        'primary': 'var(--green-primary)',
        'primary-dark': 'var(--green-dark)',
        'primary-light': 'var(--green-light)',
        'primary-bg': 'var(--green-bg)',

        'red-primary': 'var(--red-primary)',
        'red-dark': 'var(--red-dark)',
        'red-bg': 'var(--red-bg)',
        'red-border': 'var(--red-border)',

        'orange-primary': 'var(--orange-primary)',
        'orange-dark': 'var(--orange-dark)',
        'orange-bg': 'var(--orange-bg)',

        'blue-primary': 'var(--blue-primary)',
        'blue-light': 'var(--blue-light)',
        'blue-bg': 'var(--blue-bg)',
        'blue-bg-light': 'var(--blue-bg-light)',

        'brown-primary': 'var(--brown-primary)',
        'brown-bg': 'var(--brown-bg)',

        'gray-primary': 'var(--gray-primary)',
        'gray-bg': 'var(--gray-bg)',
        'gray-border': 'var(--gray-border)',

        'bg-primary': 'var(--bg-primary)',
        'bg-secondary': 'var(--bg-secondary)',
        'bg-tertiary': 'var(--bg-tertiary)',

        'text-primary': 'var(--text-primary)',
        'text-secondary': 'var(--text-secondary)',
        'text-tertiary': 'var(--text-tertiary)',
        'text-muted': 'var(--text-muted)',

        'border-color': 'var(--border-color)',
        'border-light': 'var(--border-light)',
        'border-lighter': 'var(--border-lighter)',

        'hover-bg': 'var(--hover-bg)',
      },
      boxShadow: {
        'sm': 'var(--shadow-sm)',
        'md': 'var(--shadow-md)',
        'lg': 'var(--shadow-lg)',
      },
    },
  },
  plugins: [],
}

export default config
