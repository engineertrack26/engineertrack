# EngineerTrack - Claude Code Context

## Project Overview
Gamification-powered internship tracking mobile app for engineering students.
Built with Expo SDK 54, React Native, TypeScript, Supabase, Zustand.

## Key Commands
```bash
npx expo start          # Start dev server
npx expo start --clear  # Start with cache clear
npm install             # Install dependencies
npx expo install <pkg>  # Install SDK-compatible package
```

## Architecture
- **Routing**: Expo Router (file-based) - `app/` directory with route groups
- **Styling**: NativeWind (Tailwind CSS) + theme tokens
- **State**: Zustand with domain-separated stores (auth, log, gamification, ui)
- **Backend**: Supabase (auth, database, storage)
- **i18n**: i18next + react-i18next (6 languages: en, tr, el, es, it, de)
- **Auth tokens**: expo-secure-store

## Route Groups
- `app/(auth)/` - Login, Register, Forgot Password, Language Select
- `app/(student)/` - Dashboard, Create Log, Log History, Achievements, Leaderboard
- `app/(mentor)/` - Dashboard, Student List, Review Log, Feedback
- `app/(advisor)/` - Dashboard, Student Monitor, Validation, Reports

## Path Aliases
- `@/*` → `src/*`
- `@components/*`, `@screens/*`, `@services/*`, `@store/*`
- `@hooks/*`, `@utils/*`, `@i18n/*`, `@theme/*`, `@types/*`, `@assets/*`

## Conventions
- **Env vars**: Use `EXPO_PUBLIC_` prefix for client-side variables
- **Imports**: Always use path aliases, never relative paths from outside src/
- **Components**: Functional components with TypeScript interfaces for props
- **Stores**: One Zustand store per domain (authStore, logStore, etc.)
- **Types**: Centralized in `src/types/`, exported via barrel files
- **i18n keys**: Dot notation (e.g., `common.save`, `student.dashboard`)

## User Roles
1. **Student** - Creates daily logs, earns XP/badges, tracks progress
2. **Mentor** (Company supervisor) - Reviews logs, gives feedback, rates competencies
3. **Advisor** (University professor) - Validates logs, monitors compliance, generates reports

## Important Files to Read First
1. `PROGRESS.md` - Current development status
2. `src/types/` - All TypeScript interfaces
3. `src/theme/` - Design system (colors, spacing, typography)
4. `src/utils/constants.ts` - App constants and limits
5. `EngineerTrack-Development-Roadmap.md` - Full development plan
6. `EngineerTrack-Complete-Workflow.md` - User flow documentation
