# EngineerTrack Mobile Application
## Development Roadmap

---

## Project Overview

**Project Name:** EngineerTrack - Gamified Internship Tracking Platform  
**Project Type:** Mobile Application (iOS & Android)  
**Target Users:** Engineering Students, Academic Advisors, Industry Supervisors  
**Supported Languages:** 6 languages (English, Turkish, Greek, Spanish, Italian, German)

---

## Technology Stack

| Layer | Technology | Status |
|-------|------------|--------|
| **Mobile Framework** | React Native 0.81 + Expo SDK 54 | ✅ Configured |
| **Routing** | Expo Router (file-based) | ✅ Configured |
| **Styling** | NativeWind v4 (Tailwind CSS) | ✅ Configured |
| **Backend & Database** | Supabase (PostgreSQL) | ✅ Configured |
| **Authentication** | Supabase Auth + expo-secure-store | ✅ Configured |
| **File Storage** | Supabase Storage (3 buckets) | ✅ Configured |
| **State Management** | Zustand (domain-separated stores) | ✅ Configured |
| **Internationalization** | i18next + react-i18next (6 languages) | ✅ Configured |
| **Type System** | TypeScript (strict mode) | ✅ Configured |
| **Deployment** | Expo Application Services (EAS) | ✅ Configured |

---

## Development Phases

### Phase 1: Foundation & Setup
**Duration:** 2 Weeks
**Status:** 🟡 In Progress

| Task | Description | Status |
|------|-------------|--------|
| Project Initialization | Expo SDK 54 + TypeScript + path aliases (@/ prefix) | ✅ Done |
| Expo Router Setup | File-based routing with (auth), (student), (mentor), (advisor) groups | ✅ Done |
| NativeWind/Tailwind | Styling framework with custom theme tokens | ✅ Done |
| Backend Configuration | Supabase: 13 tables, 25+ RLS policies, 3 storage buckets, triggers | ✅ Done |
| Service Layer | auth.ts, logs.ts, gamification.ts + Supabase client | ✅ Done |
| State Management | Zustand stores: authStore, logStore, gamificationStore, uiStore | ✅ Done |
| Theme System | colors.ts, spacing.ts, typography.ts | ✅ Done |
| Type Definitions | user.ts, log.ts, gamification.ts, navigation.ts | ✅ Done |
| i18n Setup | i18next with 6 language files (en complete, others placeholder) | ✅ Done |
| Authentication Screens | Login, Register, Forgot Password, Language Select UI | 🔲 Pending |
| UI Component Library | Reusable components (Button, Input, Card, Modal, etc.) | 🔲 Pending |

**Deliverables:**
- ~~Working authentication flow~~ → In progress
- ✅ Basic app structure with navigation
- ✅ Database schema deployed

---

### Phase 2: Student Features
**Duration:** 3 Weeks

| Task | Description |
|------|-------------|
| Student Dashboard | Main screen with progress overview and quick actions |
| Daily Log Creation | Form for documenting daily internship activities |
| Photo Upload | Camera and gallery integration for activity photos |
| Log History | View and manage past daily logs |
| Competency Tracking | Select and track practiced competencies |

**Deliverables:**
- Fully functional student panel
- Daily logging system with photo support
- Progress visualization

---

### Phase 3: Gamification System
**Duration:** 2 Weeks

| Task | Description |
|------|-------------|
| Points System | Award points for activities (logging, photos, polls) |
| Level Progression | 8-level system based on accumulated points |
| Badge System | Achievement badges for milestones and streaks |
| Streak Tracking | Daily activity streak counter |
| Leaderboard | Ranking system to compare with peers |

**Gamification Elements:**
- Points for each activity
- Progress bars and level indicators
- Achievement badges (6 initial badges)
- Daily streak counter with visual feedback
- Social leaderboard

**Deliverables:**
- Complete gamification engine
- Badge and level definitions
- Animated UI components

---

### Phase 4: Advisor & Industry Panels
**Duration:** 2 Weeks

| Task | Description |
|------|-------------|
| Advisor Dashboard | Overview of assigned students and pending reviews |
| Student Monitoring | View student logs, progress, and competency development |
| Feedback System | Submit ratings and comments on student performance |
| Industry Dashboard | Similar features for industry supervisors |
| Competency Evaluation | Rate students on specific competencies |

**Deliverables:**
- Advisor panel with student management
- Industry supervisor panel
- Feedback and evaluation system

---

### Phase 5: Advanced Features
**Duration:** 2 Weeks

| Task | Description |
|------|-------------|
| Poll/Quiz System | Interactive polls related to internship topics |
| Push Notifications | Reminders and feedback alerts |
| Multi-language Support | Implementation of 6 languages |
| Reports & Analytics | Progress reports and statistics |
| Settings & Profile | User preferences and profile management |

**Deliverables:**
- Poll system with point rewards
- Notification system
- Complete translation for all 6 languages
- Reporting module

---

### Phase 6: Testing & Deployment
**Duration:** 3 Weeks

| Task | Description |
|------|-------------|
| Internal Testing | Bug fixes and performance optimization |
| Pilot Testing | Test with 20 students per partner country |
| Feedback Collection | Gather and implement user feedback |
| Store Preparation | Prepare assets for app stores |
| Deployment | Release to Google Play and App Store |

**Deliverables:**
- Bug-free application
- Pilot test reports
- Published application on both stores

---

## Timeline Summary

| Phase | Duration | Cumulative |
|-------|----------|------------|
| Phase 1: Foundation | 2 weeks | Week 2 |
| Phase 2: Student Features | 3 weeks | Week 5 |
| Phase 3: Gamification | 2 weeks | Week 7 |
| Phase 4: Advisor & Industry | 2 weeks | Week 9 |
| Phase 5: Advanced Features | 2 weeks | Week 11 |
| Phase 6: Testing & Deployment | 3 weeks | Week 14 |

**Total Development Time: 14 Weeks**

---

## Application Features Overview

### Student Features
- ✅ Personal dashboard with progress overview
- ✅ Daily log creation with photo upload
- ✅ Blog-style activity documentation
- ✅ Competency selection and tracking
- ✅ Points, levels, and badges
- ✅ Streak tracking
- ✅ Leaderboard view
- ✅ Poll/quiz participation
- ✅ Feedback notifications
- ✅ Profile management

### Advisor Features
- ✅ Student list and monitoring
- ✅ Daily log review
- ✅ Competency progress visualization
- ✅ Feedback submission
- ✅ Rating system
- ✅ Report generation

### Industry Supervisor Features
- ✅ Intern monitoring dashboard
- ✅ Performance evaluation
- ✅ Feedback and rating system
- ✅ Competency assessment
- ✅ Analytics overview

### System Features
- ✅ Role-based access control (Student, Advisor, Industry)
- ✅ 6 language support
- ✅ Push notifications
- ✅ Offline capability for log drafts
- ✅ Secure file storage
- ✅ Real-time data synchronization

---

## Gamification Details

### Points System
| Action | Points |
|--------|--------|
| Daily log submission | 10 pts |
| Photo upload (each) | 5 pts |
| Competency tag (each) | 5 pts |
| Poll completion | 10 pts |
| Receiving feedback | 15 pts |

### Levels (Implemented in src/types/gamification.ts)
| Level | Name | Required Points |
|-------|------|-----------------|
| 1 | Beginner | 0 |
| 2 | Novice | 100 |
| 3 | Apprentice | 300 |
| 4 | Journeyman | 600 |
| 5 | Expert | 1,000 |
| 6 | Master | 1,500 |
| 7 | Grandmaster | 2,100 |
| 8 | Legend | 2,800 |
| 9 | Mythic | 3,600 |
| 10 | Transcendent | 4,500 |

### Badges
| Badge | Requirement |
|-------|-------------|
| First Step | Submit first daily log |
| Week Warrior | 7-day streak |
| Photo Enthusiast | Upload 10 photos |
| Quiz Master | Complete 20 polls |
| Feedback Champion | Receive 10 feedbacks |
| Month Master | 30-day streak |

---

## Infrastructure & Costs

### Development Phase
| Service | Cost |
|---------|------|
| Supabase (Free tier) | $0/month |
| Expo (Free tier) | $0/month |
| Development tools | $0 |

### Production Phase
| Service | Cost |
|---------|------|
| Supabase Pro | $25/month |
| Expo Production | $99/month |
| Google Play (one-time) | $25 |
| Apple Developer (annual) | $99/year |

---

## Pilot Testing Plan

### Test Group
- 20 students per partner country
- 6 countries = 120 total student testers
- Academic advisors and industry supervisors from each partner

### Testing Duration
- 4 weeks (1 month)

### Success Metrics
- 80% user satisfaction rate
- App stability (crash-free rate > 99%)
- Feature completion feedback
- Usability assessment

### Feedback Collection
- In-app feedback forms
- User surveys
- Bug reporting system
- Focus group sessions

---

## Deliverables Summary

1. **Mobile Application** - iOS and Android compatible
2. **Admin Backend** - Supabase dashboard for data management
3. **Video Guides** - How-to videos in 6 languages
4. **User Documentation** - Guides for all user types
5. **Source Code** - Full codebase with documentation
6. **Deployment Package** - Store-ready application builds

---

## Contact & Support

For questions regarding this development roadmap, please contact the technical team.

---

*Document Version: 2.0*
*Last Updated: February 2026*
*GitHub: https://github.com/engineertrack26/engineertrack*
