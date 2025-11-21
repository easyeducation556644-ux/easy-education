# Overview

Easy Education is a Progressive Web Application (PWA) designed to deliver free online courses. It features a React-based frontend, an Express.js backend for API services, and Firebase for authentication, database management, and push notifications. The platform integrates with RupantorPay for payment processing, ImgBB for image uploads, and includes a comprehensive admin panel for course and enrollment management. The project aims to provide an accessible and engaging learning experience with robust administrative capabilities, targeting market potential in online education.

# User Preferences

Preferred communication style: Simple, everyday language.

# Recent Changes

## November 21, 2025 - Service Worker Auto-Update, Advanced Coupons & Bundle Courses

**Service Worker Auto-Update System:**
- Implemented automatic cache refresh mechanism to ensure users always get the latest version without manual cache clearing
- Service worker with version tracking sends FORCE_UPDATE/RELOAD_PAGE messages when new versions are detected
- UpdateNotification component handles all edge cases (no registration, waiting worker, active worker)
- PWA library checks for updates every 60 seconds and dispatches custom events
- Multiple fallback paths ensure reliable page reload even when registration state is unclear
- Listens for both RELOAD_PAGE and FORCE_UPDATE messages globally

**Advanced Coupon System:**
- Created comprehensive coupon management system with two types: Universal and Unique
- Universal coupons: Reusable codes for any user (fixed amount or percentage discount)
- Unique coupons: One-time use codes with advanced conditions:
  - Specific users: Comma-separated list of user IDs who can use the coupon
  - Required purchased courses: Users must own specific courses to use the coupon
  - Minimum course purchase count: Users must have purchased N courses to qualify
  - Minimum cart value: Cart must meet minimum amount for coupon to apply
- ManageCoupons admin page with create/edit/delete functionality and filtering
- Checkout validation with proper loading guards (isCartLoaded, isCouponLoaded, isPurchasedLoaded)
- Coupon validation includes bundled course ownership from userCourses collection

**Bundle Course System Enhancements:**
- MyCourses now fetches bundle provenance from payments collection
- Attaches `fromBundle` and `bundleId` metadata to each course showing which bundle granted access
- Uses Map-based deduplication by courseId to prevent duplicate display
- Hides bundle wrapper courses from user view while maintaining bundle awareness
- Payment processor automatically enrolls users in all bundled courses on purchase

**Technical Implementation:**
- Service worker registered in App.jsx with version comparison logic
- UpdateNotification component integrated into App.jsx layout
- Checkout uses three loading flags to prevent race conditions in coupon validation
- MyCourses uses async for loops (not forEach) for proper bundle metadata fetching
- All features tested and working with development server

## November 21, 2025 - Security Fixes & Mobile Responsive Ban UI

**Security & Privacy Enhancements:**
- Removed all sensitive data from client-side logs and ban messages (IP addresses, device fingerprints, platform details)
- Sanitized ban reasons to only show generic messages: "একাধিক ডিভাইস থেকে একই সময়ে লগইন সনাক্ত করা হয়েছে"
- Fixed ban notifications to exclude full devices array and sensitive metadata
- Eliminated console logging of user tracking data for privacy compliance

**Mobile Responsive UI:**
- Made BanOverlay component fully responsive with proper text scaling (text-xs/sm/md breakpoints)
- Updated Ban Management admin page with mobile-first design:
  - Responsive padding: p-4 md:p-6
  - Flexible header layout with stacked buttons on mobile
  - Wrapped filter buttons and search bar
  - Responsive user cards with stacked layouts on mobile
  - Mobile-optimized modals for device viewing and ban actions
  - Shortened button text on small screens ("Clear Flags" vs "Clear Logout Flags")
  - Responsive icon sizes (w-3.5 md:w-4) and font sizes (text-xs md:text-sm)
- BannedNotifications page already had responsive classes

**Bug Fixes:**
- Fixed toDate() crash with fallback: `banExpiresAt.toDate ? banExpiresAt.toDate() : new Date(banExpiresAt)`
- Improved error handling for ban expiry timestamp parsing

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
- **Service Worker Auto-Update:** Automatic cache refresh mechanism with version tracking. Service worker sends FORCE_UPDATE/RELOAD_PAGE messages when new versions are detected. UpdateNotification component provides user-friendly update prompts. PWA library checks for updates every 60 seconds.
- **Advanced Coupon System:** Two coupon types (Universal and Unique) with conditional validation. Unique coupons support specific users, required purchased courses, minimum course purchase count, and minimum cart value conditions. Admin panel for creating, editing, and managing coupons with real-time filtering.
- **Bundle Courses:** Admins can create course bundles (packages) that automatically enroll users in multiple courses upon purchase. Course creation form includes "Single" vs "Bundle" format option with multi-select for bundled courses. Payment processing auto-enrolls users in all bundled courses. MyCourses displays bundle provenance metadata (fromBundle, bundleId) while hiding bundle wrappers.
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