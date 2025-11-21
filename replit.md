# Overview

Easy Education is a Progressive Web Application (PWA) designed to deliver free online courses. It features a React-based frontend, an Express.js backend for API services, and Firebase for authentication, database management, and push notifications. The platform integrates with RupantorPay for payment processing, ImgBB for image uploads, and includes a comprehensive admin panel for course and enrollment management. The project aims to provide an accessible and engaging learning experience with robust administrative capabilities, targeting market potential in online education.

# User Preferences

Preferred communication style: Simple, everyday language.

# Recent Changes

## November 21, 2025 - Authentication & Ban Management Fixes

Fixed three critical bugs in multi-device authentication and ban system:

1. **Unban Logout Issue**: Fixed issue where users remained logged in with empty device list after admin unban. Now properly logs out all devices using `forceLogoutAt` mechanism.

2. **Multi-Device Ban Display**: Fixed critical bug where multiple logged-in devices were redirected to login during ban instead of showing ban overlay. Implemented ban-aware authentication flow that checks `isBanActive` status before processing `forceLogoutAt`, ensuring devices stay logged in and display BanOverlay during active bans.

3. **Device Kick Enforcement**: Improved kicked device logout through enhanced fingerprint detection and `forceLogoutAt` synchronization. Kicked devices now properly log out immediately.

**Technical Implementation**:
- Added `lastAckedLogoutAt` localStorage tracking (initialized to 0 instead of null) to ensure first logout events always trigger
- Implemented device fingerprint fallback using stored fingerprint when `getDeviceInfo()` fails
- Added early return in ban expiry logic to prevent re-banning with stale device data
- Implemented 5-minute validity window for `forceLogoutAt` to ignore stale timestamps
- Added ban-active gating that prioritizes BanOverlay display over forced logout during active bans
- Added auto-cleanup of old `forceLogoutAt` flags (>2 minutes) on successful login to prevent spurious logouts
- Enhanced expired ban detection in auth listener for offline scenarios

# System Architecture

## Frontend Architecture

**Technology Stack:** React 18 with Vite.
**UI Framework:** Radix UI primitives with Tailwind CSS, following a minimalist Vercel-inspired design system with dark mode support.
**State Management:** React hooks and Context API for local state, Firebase Firestore for persistent data.
**Internationalization:** Google Fonts (Hind Siliguri) for Bangla language support.
**Progressive Web App:** Service workers for offline functionality and web manifest for installability.

## Backend Architecture

**Server Framework:** Express.js on Node.js.
**Deployment Model:** Hybrid approach utilizing an Express server for development and Vercel serverless functions (located in `/api`) for production, offering scalability.
**API Structure:** Endpoints for payment processing, enrollment, image uploads, and dynamic PWA manifest generation.

## Data Storage

**Primary Database:** Firebase Firestore (NoSQL).
**Collections:** `users`, `courses`, `payments`, `settings`, `adminTokens`.
**Image Storage:** ImgBB API for hosting uploaded images.

## Authentication & Authorization

**Authentication Provider:** Firebase Authentication with Google OAuth.
**Authorization Model:** Role-based access control (RBAC) using `isAdmin` and `role` fields in user documents.
**Security:** Firebase Security Rules enforce server-side authorization.

## UI/UX Decisions

The application utilizes a custom design system inspired by Vercel's minimalist aesthetic, supporting dark mode. Radix UI primitives ensure accessibility, while Tailwind CSS provides flexible styling.

## Technical Implementations

- **Real-Time Presence Detection:** Tracks user online/offline status, tab visibility, and window focus, synchronizing with Firestore.
- **Simplified Device-Based Ban System:** Automatically bans users for 30 minutes when they attempt login from a new device (if existing devices are detected). Third violation results in permanent ban. Full-screen ban overlay with countdown timer. Auto-logout and device cleanup when temporary ban expires. Admin users are immune to auto-ban.
- **Enhanced Ban Management:** Dedicated admin page for real-time user status monitoring, manual ban/unban, device kicking, and ban countdowns. Manual unban clears all ban history and device records. Includes a self-healing system for `forceLogoutAt` flags and a "Clear Logout Flags" emergency button.
- **Device Detection:** Advanced device fingerprinting combined with IP address tracking for multi-device login detection and ban enforcement. Devices are tracked and stored in Firestore. Includes robust `clearBanCacheAt` mechanism for clearing stale ban info on clients.
- **Bundle Courses:** Admins can create course bundles (packages) that automatically enroll users in multiple courses upon purchase. Course creation form includes "Single" vs "Bundle" format option with multi-select for bundled courses. Payment processing auto-enrolls users in all bundled courses.
- **Admin Attribution:** Payment records store `approvedBy` and `rejectedBy` for admin accountability.
- **Notification System:** Admin panel displays real-time ban notification badges via Firestore listeners.
- **IP Geolocation:** Robust multi-API fallback system (ipwho.is, freeipapi.com, ipapi.co) with error handling, timeout, and Google Maps integration for device location tracking, supporting `navigator.userAgentData.platform` for improved accuracy.

# External Dependencies

**Payment Gateway:** RupantorPay (Bangladesh payment processor)
- **Integration:** RESTful API for checkout and verification, webhook support.

**Image Hosting:** ImgBB API
- **Integration:** RESTful API for Base64 image uploads.

**IP Address Tracking:** ipify.org (free public API).

**Firebase Services:**
- **Firebase Authentication:** Google OAuth.
- **Firebase Firestore:** Primary NoSQL database.
- **Firebase Cloud Messaging (FCM):** Push notifications for admin alerts, uses VAPID key and `/firebase-messaging-sw.js` service worker. Admin SDK for server-side operations.

**Analytics:** Vercel Analytics (`@vercel/analytics`).

**Deployment Platform:** Vercel (uses `vercel.json` for configuration).