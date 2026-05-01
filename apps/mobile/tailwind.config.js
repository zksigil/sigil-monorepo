/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './App.tsx',
    './index.js',
    './src/**/*.{js,jsx,ts,tsx}',
  ],
  presets: [require('nativewind/preset')],
  theme: {
    extend: {
      colors: {
        brand: {
          primary: '#bd93f9',
          secondary: '#8be9fd',
          success: '#50fa7b',
          warning: '#ffb86c',
          danger: '#ff5555',
          surface: '#44475a',
          background: '#282a36',
        },
        dracula: {
          bg: '#282a36',
          surface: '#44475a',
          fg: '#f8f8f2',
          comment: '#6272a4',
          cyan: '#8be9fd',
          green: '#50fa7b',
          orange: '#ffb86c',
          pink: '#ff79c6',
          purple: '#bd93f9',
          red: '#ff5555',
          yellow: '#f1fa8c',
        },

        canvas: '#282a36',
        surface: '#373947',
        elevated: '#44475a',

        text: {
          primary: '#f8f8f2',
          secondary: '#c8cad6',
          muted: '#8a92b2',
        },
        border: {
          subtle: 'rgba(98,114,164,0.25)',
        },
        accent: {
          primary: '#bd93f9',
          success: '#50fa7b',
          danger: '#ff5555',
          warning: '#ffb86c',
        },
      },
      fontSize: {
        display: ['34px', { lineHeight: '40px', letterSpacing: '-0.5px' }],
        title: ['22px', { lineHeight: '28px', letterSpacing: '-0.2px' }],
        body: ['15px', { lineHeight: '22px' }],
        caption: ['13px', { lineHeight: '18px' }],
        micro: ['11px', { lineHeight: '14px', letterSpacing: '0.4px' }],
      },
    },
  },
  plugins: [],
};
