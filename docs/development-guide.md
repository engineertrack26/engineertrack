# EngineerTrack - Development Guide

## Getting Started

### Prerequisites
- Node.js v22+
- npm 10+
- Expo CLI (`npx expo`)
- Git
- Expo Go app (on physical device) or Android/iOS emulator

### Setup
```bash
git clone https://github.com/engineertrack26/engineertrack.git
cd engineertrack
cp .env.example .env
# Fill in Supabase credentials in .env
npm install
npx expo start
```

## Project Structure

```
app/                    # Expo Router file-based routes
├── _layout.tsx         # Root layout (providers, global CSS)
├── index.tsx           # Entry redirect (role-based)
├── (auth)/             # Auth screens (login, register, etc.)
├── (student)/          # Student tab screens
├── (mentor)/           # Mentor tab screens
└── (advisor)/          # Advisor tab screens

src/                    # Application source code
├── components/         # Reusable UI components
├── services/           # API & Supabase services
├── store/              # Zustand state stores
├── hooks/              # Custom React hooks
├── utils/              # Constants, helpers, validators
├── i18n/               # Internationalization (6 languages)
├── theme/              # Design tokens (colors, spacing, typography)
├── types/              # TypeScript type definitions
└── assets/             # Images, icons, fonts

docs/                   # Project documentation
```

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Framework | Expo SDK 54, React Native 0.81 |
| Routing | Expo Router (file-based) |
| Styling | NativeWind (Tailwind CSS) + theme tokens |
| State | Zustand (domain-separated stores) |
| Backend | Supabase (Auth, Database, Storage) |
| i18n | i18next + react-i18next |
| Language | TypeScript (strict mode) |

## Conventions

### File Naming
- Components: `PascalCase.tsx` (e.g., `LogCard.tsx`)
- Screens: `kebab-case.tsx` in `app/` directory (expo-router convention)
- Stores: `camelCaseStore.ts` (e.g., `authStore.ts`)
- Utils: `camelCase.ts` (e.g., `dateUtils.ts`)

### Imports
- Always use path aliases: `@/`, `@components/`, `@store/`, etc.
- Never use relative paths from outside `src/`

### Styling
- Prefer NativeWind/Tailwind classes for layout and spacing
- Use theme tokens from `@theme` for brand colors
- Use `StyleSheet.create()` only for complex/dynamic styles

### State Management
- One Zustand store per domain: `authStore`, `logStore`, `gamificationStore`, `uiStore`
- Keep stores flat, avoid deep nesting

### i18n
- All user-facing strings must use i18n keys
- Key format: `section.key` (e.g., `common.save`, `student.dashboard`)
- English (`en.json`) is the source of truth

## Development Phases

1. **Setup & Foundation** - Project structure, configs, types
2. **Auth & Navigation** - Supabase auth, role-based routing
3. **Student Features** - Log CRUD, dashboard, attachments, internship info form
4. **Mentor & Advisor** - Review, feedback, validation, reports
5. **Gamification & i18n** - XP, badges, streaks, translations
6. **Polish & Deployment** - Testing, optimization, EAS build
