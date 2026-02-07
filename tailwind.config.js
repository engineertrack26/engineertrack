/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './App.tsx',
    './app/**/*.{js,jsx,ts,tsx}',
    './src/**/*.{js,jsx,ts,tsx}',
  ],
  presets: [require('nativewind/preset')],
  theme: {
    extend: {
      colors: {
        primary: {
          DEFAULT: '#1a73e8',
          light: '#4a90d9',
          dark: '#1557b0',
        },
        secondary: {
          DEFAULT: '#34a853',
          light: '#5bb974',
          dark: '#1e8e3e',
        },
        background: '#f8f9fa',
        surface: '#ffffff',
        gamification: {
          gold: '#ffc107',
          silver: '#9e9e9e',
          bronze: '#cd7f32',
          streak: '#ff6d00',
          xp: '#7c4dff',
          levelUp: '#00c853',
          badge: '#ffd600',
        },
        status: {
          draft: '#9aa0a6',
          submitted: '#4285f4',
          underReview: '#f9ab00',
          approved: '#34a853',
          needsRevision: '#ea4335',
          revised: '#fb8c00',
          validated: '#1b5e20',
        },
      },
    },
  },
  plugins: [],
};
