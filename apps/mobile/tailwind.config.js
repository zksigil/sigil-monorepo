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
      },
    },
  },
  plugins: [],
};
