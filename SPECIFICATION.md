# YehThatRocks.com — Product Specification

**Version:** 2.1 (Ground-Up Rebuild, Open Source Ready)  
**Date:** April 2026  
**Author:** Simon James Odell  
**Tagline:** *"The World's LOUDEST Website"*

---

## 1. Vision & Purpose

YehThatRocks.com is a **community-driven rock and metal music streaming platform**. It is a place for fans of rock, metal and all their sub-genres to discover new music, watch YouTube videos, chat with other fans, curate their own collections, and explore one of the most comprehensive catalogues of rock and metal artists on the internet.

The site is not a generic streaming service. It is a **passion project with personality** — loud, boldly designed, and unapologetically aimed at people who love heavy music. It is the natural meeting point of a YouTube front-end, a fan community, and a music encyclopaedia.

The rebuild starts from scratch in terms of code but **retains the existing MySQL database**, which contains:

- ~139,583 rock/metal artist records scraped from open-source data — an exceptional starting asset
- ~266,000 YouTube video records accumulated from user activity
- 153 genre taxonomy entries
- Thousands of saved playlists and favourites from previous users

---

## 2. Core Philosophy

| Principle | Detail |
|---|---|
| **Music first** | The video player is always present and always prominent. Everything else is secondary. |
| **Community** | Real-time chat, sharing, and social interaction are first-class features, not afterthoughts. |
| **Discovery** | The primary job of the site is to surface great music the user hasn't heard yet. |
| **Catalogue depth** | The artist + genre database is a major differentiator. It must be surfaced intelligently. |
| **Typography identity** | Preserve the legacy brand typeface `Metal Mania` for hero branding and major headings to maintain continuity with the original site identity. |
| **Performance** | Pages load fast. The player never stutters. Animations are smooth. |
| **Security** | All user data is handled securely. Passwords are hashed. Queries use prepared statements. |
| **Simplicity** | The UI is clean and bold. No clutter. Every feature earns its space. |

---

## 3. Tech Stack (Recommended for Rebuild)

| Layer | Technology | Notes |
|---|---|---|
| **Monorepo** | Turborepo + pnpm | Single codebase for web + mobile + shared packages |
| **Web app** | Next.js (React, App Router) + TypeScript | SSR/SEO for artist, genre, and video pages |
| **Mobile app** | React Native + Expo + TypeScript | Android/iOS app in the same repo |
| **Backend** | Next.js Route Handlers + background workers | API and jobs in one stack |
| **Routing** | Next.js App Router | File-based routing + layouts |
| **Database** | MySQL 8+ / MariaDB 10.6+ | Retain existing `yeh` database |
| **ORM / DB** | Prisma ORM | Type-safe schema + migrations |
| **Validation** | Zod | Shared request/response validation across web and mobile |
| **Frontend** | React + TypeScript | Shared architecture across platforms |
| **UI** | Tailwind CSS + reusable component library | Consistent design and faster AI-generated implementation |
| **Icons** | Font Awesome 6 or Lucide Icons | |
| **Real-time chat** | Socket.IO (or managed Ably/Pusher) | Replace hand-rolled WebSocket server |
| **YouTube** | YouTube IFrame API + YouTube Data API v3 | Retain existing integration |
| **Auth** | Auth.js / NextAuth with secure session cookies | Replace legacy session model |
| **AI Tracks** | Suno API / Udio API or hosted audio files | New feature (see Section 9) |
| **Testing** | Vitest + Playwright | Required gates for AI-maintained code quality |
| **Hosting** | Vercel/Fly.io/Render + managed MySQL | Contributor-friendly deployment targets |

### 3.1 Repository Layout (Single Codebase)

```
apps/
	web/               # Next.js web app
	mobile/            # Expo React Native app
packages/
	ui/                # shared design tokens + reusable components
	core/              # shared business logic
	schemas/           # shared Zod schemas + TypeScript types
	api-client/        # shared typed API client for web/mobile
	config/            # eslint, tsconfig, prettier presets
```

### 3.2 Open Source Requirements

- Public GitHub repository with `README`, `CONTRIBUTING`, and `CODE_OF_CONDUCT`
- Conventional commits + PR template + issue templates
- CI required checks: typecheck, lint, unit tests, e2e smoke tests
- No direct DB access outside data-access modules
- No merge allowed unless all required checks pass

---

## 4. Database (Retained & Extended)

The existing `yeh` database is retained as-is and extended. The following tables are carried over:

### 4.1 Existing Tables (Migrated)

| Table | Records (approx.) | Purpose |
|---|---|---|
| `artists` | 139,583 | Rock/metal artist catalogue with name, origin country, up to 6 genre tags |
| `genres` | 153 | Genre taxonomy (Alternative, Black, Death, Doom, Gothic, Industrial, Nu, Power, Progressive, Thrash, etc.) |
| `videos` | 266,168 | YouTube video log — videoId, title, channelTitle, thumbnail, view count, favourite count |
| `favourites` | — | User-saved video records |
| `playlistnames` | 29 | Named playlists |
| `playlistitems` | 1,326 | Videos within playlists |
| `related` | — | Cached related-video HTML per videoId |
| `searches` | — | Cached search result HTML per query string |
| `messages` | — | Historical chat messages (global and per-video) |
| `online` | — | User presence table |
| `videosbyartist` | — | Cross-reference: artist name ↔ videoId |
| `site_videos` | — | Submission queue for contributed videos |

### 4.2 New Tables (Rebuild)

| Table | Purpose |
|---|---|
| `users` | Rebuilt: hashed passwords, email, screen name, avatar, preferences, ban fields |
| `ai_tracks` | AI-generated tracks (see Section 9) |
| `ai_track_votes` | Up/down votes on AI tracks |
| `artist_videos` | Cleaner artist ↔ video relationship (replaces `videosbyartist`) |

### 4.3 Security Fixes on Migration

- All existing plaintext passwords must be force-reset on first login (send reset email)
- Add `password_hash` column to `users`, deprecate plaintext `password` column
- Add foreign key constraints and indexes where missing
- Prepared statements everywhere — no string concatenation in SQL

---

## 5. URL Structure & Routing

| URL | Page / Feature |
|---|---|
| `/` | Homepage — player with featured/random video |
| `/?v=<videoId>` | Play a specific YouTube video |
| `/search/?q=<query>` | Search results (AJAX endpoint) |
| `/categories/` | Genre browser |
| `/categories/<genre-slug>/` | Videos in a specific genre |
| `/artist/<artist-slug>/` | Artist page — bio, genre tags, videos |
| `/artists/` | Artist directory (A–Z or by genre) |
| `/top100/` | Most-favourited videos |
| `/new/` | Recently added or trending |
| `/favourites/` | Logged-in user's saved videos |
| `/playlists/` | User's playlists |
| `/playlists/<id>/` | Play a specific playlist |
| `/account/` | User account settings |
| `/register/` | Registration |
| `/login/` | Login |
| `/logout/` | Logout |
| `/ai/` | AI-generated tracks section |
| `/ai/<track-id>/` | Individual AI track page |
| `/admin/` | Admin control panel |
| `/sitemap.xml` | XML sitemap for SEO |

---

## 6. Core Features

### 6.1 Video Player

The YouTube IFrame player is the heart of the site. It must:

- Be large, prominent, and always visible on all screen sizes  
- Load immediately on page open with a default or URL-specified video  
- Support loading a new video **without a full page reload** (update URL via `history.pushState`)  
- Display the **video title** attractively — animated transition on change  
- Show the YouTube **channel name**  
- Update the page background to use the video's **thumbnail** (blurred/darkened) as an ambient backdrop  
- Generate correct `<meta og:*>` tags server-side for social sharing  
- Support **fullscreen** (both the player and the whole page)  
- Handle player events: play, pause, end, buffering  
- On video end: trigger **Autoplay** logic (see 6.2)

### 6.2 Autoplay & Next Track

- A toggleable **Autoplay mode**: when a video ends, the next one loads automatically  
- When Autoplay is ON: picks a random video from the **Top Favourited** pool or the user's own favourites (if logged in)  
- When Autoplay is OFF: shows the **Watch Next** panel  
- **Next Track button**: manually moves to the next video at any time  
- **Previous Track button**: returns to the previously played video (JS history stack, last 20 videos)  
- Avoid replaying the same video within a session window (maintain a "recently played" exclusion list)

### 6.3 Related Videos Panel

- Slides in from the right edge on hover or swipe  
- Populated from the YouTube Data API (`relatedToVideoId`)  
- Results cached in the `related` DB table (cache TTL: 7 days)  
- Fallback: pull from the site's own `videos` table when API is unavailable  
- Clicking a result loads it in the player

### 6.4 Search

- **Search bar** accessible from the header at all times  
- Live (debounced) results as the user types  
- Results sourced from the YouTube Data API (up to 20 results)  
- Results cached in the `searches` DB table (cache TTL: 24 hours)  
- Click any result to load it in the player  
- Also searches the **local `artists` table** to surface artist pages alongside video results

### 6.5 Categories / Genre Browser

- A visual genre browser displaying all major rock/metal sub-genres from the `genres` table  
- Clicking a genre loads a panel of YouTube search results for e.g. `"progressive metal"` or `"black metal"`  
- All category pages are cached (TTL: 24 hours)  
- Supported genres include (from existing taxonomy): Alternative, Acoustic, Black, Death, Deathcore, Doom, Gothic, Groove, Grindcore, Industrial, Metalcore, Nu, Power, Progressive, Rap, Thrash, + ~140 more  
- Each genre links to the artist directory filtered by that genre

### 6.6 Artist Directory & Artist Pages

The 139,583-entry `artists` table is a defining feature of the site.

**Artist Directory `/artists/`:**
- Browse A–Z or filter by genre  
- Paginated list with artist name, country of origin, and primary genre  
- Fast full-text search within the directory  

**Artist Page `/artist/<slug>/`:**
- Artist name, country, genre tags (up to 6)  
- YouTube search results for `"<artist name> official"` loaded via API  
- Links to the artist's full discography on YouTube  
- Related artists (same genres from the DB)  
- User-contributed notes or corrections (future phase)

### 6.7 Top 100

- Leaderboard of the 100 most-favourited videos on the site  
- Ordered by `videos.favourited` descending  
- Displayed as a clickable grid of video thumbnails with title and favourite count  
- Refreshed every 24 hours (cached)

### 6.8 Favourites

- Logged-in users can **Add to Favourites** at any time (button always prominent)  
- Adding plays a brief sound effect  
- The **Favourites panel** lists all saved videos with thumbnail, title, and a remove button  
- Removing a favourite animates the item out  
- Backend: `INSERT INTO favourites` + increments `videos.favourited` counter  
- Favourites can be used as the source pool for Autoplay next-video selection

### 6.9 Playlists

- Logged-in users can create **named playlists**  
- Add any video to one or more playlists  
- View and play playlists sequentially  
- Delete playlists or remove individual items  
- Playlist pages are shareable by URL (public by default, optionally private)

---

## 7. Community & Social Features

### 7.1 Real-Time Chat

There are two simultaneous chat channels visible at all times:

1. **Global Chat** — site-wide, all users regardless of which video is playing. Perfect for general banter.  
2. **Video Chat** — scoped to the current `videoId`. Focused discussion about the track being played. Auto-switches when the user loads a new video.

Chat features:
- Messages display user **avatar** + **screen name** + timestamp  
- New message **notification sound** (user-configurable: guitar, bell, etc., with volume control)  
- Sound can be muted  
- Messages stored in the `messages` table (persistent history, last N messages shown on join)  
- Profanity filter (configurable by admin)  
- Admin/mod ability to ban users or delete messages

Implementation: Socket.IO gateway (or equivalent), reconnect-on-disconnect handling in client code.

### 7.2 Who's Online

- A count (and optionally a list) of currently online users, updating in real time via WebSocket  
- Users are considered "online" if a heartbeat was received within the last 5 minutes (`online` table `lastSeen`)

### 7.3 Sharing

- **Share URL** input auto-populates with `?v=<videoId>` for the current video — click to select  
- **Share to Global Chat**: posts a rich video card (thumbnail + title + link) into the global chat room. Rate-limited to once per 60 seconds per user.  
- Open Graph meta tags (`og:title`, `og:image`, `og:description`) generated server-side for link preview cards on social media

---

## 8. User Accounts

### 8.1 Registration

- Email address (required — used for account recovery)  
- Optionally set a **screen name** at registration (auto-assigned as `MetalFan<id>` if blank)  
- Password (minimum 8 characters, must contain at least one number or symbol)  
- Confirm password  
- CAPTCHA or honeypot to prevent bot registrations  

### 8.2 Login / Logout

- Session-based authentication with secure HTTP-only cookies  
- Login with email + password  
- "Remember me" option (persistent cookie with secure token)  
- Brute-force protection: rate-limit failed login attempts per IP  
- Logout clears session and cookie  

### 8.3 Account Settings (`/account/`)

- Update **email address**  
- Update **screen name**  
- Change **password** (requires current password)  
- Upload / change **avatar** image (cropped to square, max 200×200px)  
- Configure **chat notification sound** (select from preset list)  
- Configure **chat sound volume** (slider 0–100%)  
- Toggle chat sounds on/off  
- Delete account (with confirmation)  

### 8.4 Password Security

- Passwords stored with bcrypt/argon2 using framework defaults and periodic cost upgrades  
- Existing accounts: force a password reset on first login after migration  
- Password reset via email link (time-limited token stored in DB)

---

## 9. AI-Generated Tracks (New Feature)

This section covers the new AI music feature — a first-class section of the site distinct from YouTube videos.

### 9.1 Purpose

AI music generation tools (e.g. Suno, Udio) can produce surprisingly good rock and metal tracks. This section of YehThatRocks curates **AI-generated rock and metal tracks** as a **separate, clearly labelled** experience. It provides a space to discover, rate, and discuss AI music within the rock/metal fan community — with full transparency that listeners know they are hearing AI output.

### 9.2 The AI Tracks Section (`/ai/`)

- **Landing page** shows a grid of AI-generated tracks  
- Each track card shows: generated artwork / thumbnail, title, genre tag, generation tool used (e.g. "Suno"), upload date, play count, vote score  
- Filter by genre  
- Sort by: Newest, Most Played, Top Rated  

### 9.3 Individual AI Track Page (`/ai/<id>/`)

- Audio player (HTML5 `<audio>` element)  
- Track artwork (full size)  
- Track title, description/prompt used to generate it  
- Genre tags  
- **AI tool attribution** (Suno / Udio / Other — clearly labelled)  
- Prompt text that was used to generate the track (transparency)  
- Up/down vote buttons (logged-in users only)  
- Comment section (real-time or standard threaded comments)  
- Share URL + social share buttons  

### 9.4 Database: `ai_tracks` Table

```
id             INT AUTO_INCREMENT PRIMARY KEY
title          VARCHAR(255)
description    TEXT                    -- human-written description
prompt         TEXT                    -- prompt used in generation
genre_id       INT (FK → genres.id)
tool           VARCHAR(100)            -- 'Suno', 'Udio', 'Other'
audio_url      VARCHAR(500)            -- hosted audio file URL or CDN path
artwork_url    VARCHAR(500)
play_count     INT DEFAULT 0
uploaded_by    INT (FK → users.id)     -- NULL if admin-uploaded
status         ENUM('pending','published','rejected') DEFAULT 'pending'
created_at     DATETIME
updated_at     DATETIME
```

### 9.5 Database: `ai_track_votes` Table

```
id             INT AUTO_INCREMENT PRIMARY KEY
track_id       INT (FK → ai_tracks.id)
user_id        INT (FK → users.id)
vote           TINYINT                 -- 1 = upvote, -1 = downvote
created_at     DATETIME
UNIQUE KEY (track_id, user_id)
```

### 9.6 Submission Flow

- Admin curates the initial library of AI tracks via the admin panel  
- **Phase 2**: Allow registered users to submit AI-generated tracks for review  
- All submissions go through admin approval before appearing publicly  
- Audio files stored on the server or a CDN (not YouTube)  
- Maximum file size: 20MB per track; accepted formats: MP3, WAV, OGG

### 9.7 Player Integration

- AI tracks use a separate **HTML5 audio player** (not the YouTube IFrame player)  
- The site-wide player area adapts: when viewing an AI track, it shows the HTML5 player + artwork; when on a YouTube video it shows the YouTube embed  
- The two modes (YouTube / AI) are clearly distinct visually  
- Autoplay, next track, and favourites all work for AI tracks too

---

## 10. Admin Panel (`/admin/`)

Accessible only to admin users (separate session flag).

### Features:
- **Dashboard**: site stats (total users, videos, plays today, active chat users)  
- **User management**: view all users, ban/unban, force password reset, delete account  
- **Video management**: view most-played, remove flagged videos from the catalogue  
- **AI track management**: upload new AI tracks, approve submissions, edit metadata, publish/reject/delete  
- **Chat moderation**: view recent messages, delete messages, ban users from chat  
- **Cache management**: clear search/related/category caches  
- **Genre management**: add/edit/delete genres  
- **Site settings**: default video, autoplay defaults, site-wide announcement banner  

---

## 11. SEO & Discoverability

- Server-side rendered pages for all artist pages, genre pages, and top 100  
- Clean semantic HTML with proper `<h1>`, `<h2>` structure  
- `<title>` tags and `<meta description>` populated per page  
- Open Graph + Twitter Card meta tags on all shareable pages  
- XML sitemaps: one per entity type (artists, genres, videos, ai_tracks)  
- `robots.txt` correctly configured  
- Canonical URLs to avoid duplicate content  
- The 139,583 artist records are a significant long-tail SEO asset — each artist page should be indexable

---

## 12. Performance & Caching

| Cache type | TTL | Storage |
|---|---|---|
| Search results | 24 hours | `searches` DB table |
| Related videos | 7 days | `related` DB table |
| Category pages | 24 hours | DB or file cache |
| Artist page data | 7 days | DB or APCu |
| Top 100 list | 24 hours | DB or file cache |
| Open Graph metadata | Per video, 7 days | `videos` table |

Additional performance requirements:
- Gzip/Brotli compression for all text assets (CSS, JS, HTML)  
- Browser cache headers for static assets (images, JS, CSS) — at least 1 year  
- Lazy-load thumbnail images in lists and panels  
- JS and CSS bundled and minified  
- No blocking scripts in `<head>`  
- Core Web Vitals targets: LCP < 2.5s, CLS < 0.1, FID < 100ms

---

## 13. Security Requirements

All of the following must be implemented from day one:

| Requirement | Implementation |
|---|---|
| Password hashing | bcrypt/argon2 via auth framework defaults |
| SQL injection prevention | Prisma queries only; raw SQL restricted to reviewed migration scripts |
| XSS prevention | React output escaping + Content Security Policy header |
| CSRF protection | CSRF tokens on all state-changing forms and AJAX POSTs |
| Brute-force protection | Rate limiting on `/login` (5 attempts per 15 min per IP) |
| Session security | Secure, HTTP-only, SameSite cookies; token rotation on login/logout |
| File upload security | Validate MIME type server-side; strip EXIF; enforce max size; store outside web root |
| API key protection | YouTube API key server-side only (never exposed in client JS) |
| Input validation | Zod schemas at every API boundary (request + response) |
| HTTPS | TLS enforced; redirect all HTTP to HTTPS; HSTS header |

---

## 14. Responsive Design & Accessibility

- Typography system must preserve `Metal Mania` as the primary display font for hero/headings, with `Impact` and `Century Gothic` available as secondary accent fonts and a readable sans-serif for body text/forms  
- **Mobile-first responsive layout** — usable on phones from 360px width upward  
- **Tablet** friendly — comfortable on 768px+ screens  
- **Ultra-wide monitor** support — the layout should look intentional at 21:9 and wider  
- Keyboard navigable (player controls, menus, chat input)  
- ARIA labels on all interactive UI elements  
- Colour contrast meets WCAG 2.1 AA minimum  
- Touch-swipe support on mobile for panels (favourites, related, chat)

---

## 15. Assets to Carry Over Into the New Project

The following assets from the current codebase are worth preserving:

| Asset | Location | Notes |
|---|---|---|
| Logo + brand images | `images/` | Keep existing brand assets |
| Favicon set | `favicons/` | `browserconfig.xml`, `manifest.json`, all favicon sizes |
| Sound effects | `sounds/` | Chat notification sounds (guitar.mp3, etc.) |
| The `yeh` MySQL database | (server) | Core data asset — artists, genres, videos, favourites, playlists |
| Colour scheme concepts | `css/colour_schemes/` | May inform the new design system |

---

## 16. Out of Scope for Initial Rebuild

The following features from the old codebase should **not** be carried into the rebuild:

| Feature | Reason |
|---|---|
| Diamond Markup Language (DML) custom templating engine | Replaced by Next.js + React architecture |
| Synovetics multi-domain hosting control system | Unrelated to music — separate product |
| Diamond Publisher CMS | Overkill — not needed for this site |
| Facebook OAuth / legacy Facebook SDK | Deprecated SDK — use standard OAuth 2.0 if social login is re-added later |
| three.js 3D experimental interface | Interesting but not a priority |
| `spider.pl` Perl scraper | Was for data collection — database is already seeded |

---

## 17. Phased Delivery Plan

### Phase 1 — Monorepo Foundation + Web MVP
- Set up Turborepo with `apps/web`, `apps/mobile`, and shared `packages/*`  
- Next.js web app scaffold with SSR routes and design system foundation  
- Prisma schema aligned to existing MySQL tables  
- Core CI checks (typecheck, lint, unit tests, e2e smoke)  
- Video player with autoplay and watch-next  
- Search (YouTube API)  
- Categories / genre browser  
- User registration, login, logout  
- Favourites (logged-in)  
- Real-time chat (global + per-video)  
- Top 100  
- Mobile-responsive layout  
- All security requirements met  

### Phase 2 — Catalogue
- Artist directory (all 139k artists searchable/browsable)  
- Individual artist pages with video search  
- Genre-filtered artist browsing  
- Related artists  
- Playlists (create, manage, share)  

### Phase 3 — Mobile App + Shared Logic
- Expo React Native app with shared auth, API client, and schemas  
- Shared player queue/history logic in `packages/core`  
- Mobile favourites, search, and category browsing  
- Mobile chat parity for global and per-video channels  

### Phase 4 — AI Tracks
- AI track upload (admin)  
- AI track player and listing pages  
- Voting system  
- User AI track submissions (with admin approval)  

### Phase 5 — Open Source Growth
- Contributor onboarding docs and architecture decision records  
- Public roadmap and issue labels for community contributions  
- User profiles (public)  
- Social login (Google OAuth)  
- Email notifications  
- Recommendation engine (based on favourites + genres)  
- Native app store release process (Android first, iOS second)  

---

## 18. Legacy Fidelity & Agent Handoff Requirements

This section exists to ensure the rebuilt product is recognisably similar to the legacy app on first launch, while remaining easy to iterate and modernise.

### 18.1 Non-Negotiable Legacy Identity

- Preserve the core brand language: loud rock/metal visual tone, dark atmospheric backdrop, high-contrast chrome-like UI accents  
- Preserve the legacy display typography requirement: `Metal Mania` remains the primary hero/display font  
- Preserve signature interaction patterns: right-side related panel, autoplay/next-track behavior, global + per-video chat model  
- Preserve audio personality: support configurable chat sounds (including guitar-style notifications)

### 18.2 Legacy-Compatible UX Contract

- Maintain legacy deep-link behavior for videos via `?v=<youtubeId>` on web routes  
- Existing key routes must remain recognisable (`/search`, `/categories`, `/top100`, `/favourites`, `/account`, `/ai`)  
- Video changes should not require full page reloads  
- "Add to favourites" and "Share to global chat" must remain one-click primary actions near the player  
- Keep the dual-chat concept visible without burying it in secondary navigation

### 18.3 Visual Token Baseline (Tweakable)

- Create a versioned design token file for colors, spacing, radii, shadows, and motion timings  
- Include explicit tokens for legacy-style glow, panel transparency, and title animation speed  
- Keep all brand-critical visual choices tokenized so future agents can adjust style without rewriting components

### 18.4 Parity Acceptance Pack (Required Before MVP Sign-Off)

- A screenshot parity set for core screens: Home/Player, Search, Categories, Top 100, Favourites, Chat state  
- A behavior parity checklist confirming autoplay, watch-next, related panel, and chat room switching  
- A route/API compatibility checklist confirming legacy-style links still resolve correctly  
- Record any intentional deviations from legacy behavior in a short changelog section

### 18.5 Agent-Ready Extension Rules

- Every new feature must be added behind explicit route + schema + test updates in the same change set  
- No feature may bypass shared `schemas` and `api-client` packages  
- Keep UI sections modular (player shell, side panels, chat, library grids) so future tweaks remain localized  
- Document feature flags for experimental functionality (for example: AI track ranking experiments)

### 18.6 Open Source Contributor Safety Rails

- PR template must ask whether legacy identity constraints were preserved  
- Required checks must include: typecheck, lint, unit tests, e2e smoke, and visual snapshot check for core pages  
- Any architecture-level change must include an Architecture Decision Record (ADR)

---

*End of specification.*
