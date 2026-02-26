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
          primary: '#635BFF',
          secondary: '#0052FF',
          success: '#22C55E',
          warning: '#F59E0B',
          danger: '#EF4444',
          surface: '#1C1C1E',
          background: '#000000',
        },
      },
    },
  },
  plugins: [],
};
