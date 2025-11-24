# Overview

Easy Education is a Progressive Web Application (PWA) delivering free online courses. It features a React-based frontend, an Express.js backend, and Firebase for authentication, database, and notifications. The platform integrates with RupantorPay for payments and ImgBB for image uploads, alongside a comprehensive admin panel for course and enrollment management. The project aims to provide an accessible and engaging learning experience with robust administrative capabilities, targeting the online education market.

# Recent Changes

**November 24, 2025** - Bundle Course Enrollment Fix & Enhanced Error Handling:
- CRITICAL FIX: Bundle course enrollment now correctly creates userCourses entries for BOTH the bundle course itself AND all individual courses within the bundle
- Added `isBundle` flag to userCourse entries for proper bundle identification and hiding from course listings
- Fixed purchased bundle courses not being hidden from Home and Courses pages - now properly tracked and filtered
- Enhanced enrollment error handling: detailed error logging with stack traces, structured error responses with details field, improved frontend toast messages showing specific error information
- Enrollment response now includes `enrollmentDetails` (totalEnrolled count and enrolledCourses array) for both paid and free paths
- Enhanced resources display UI on course cards: classes and resources shown side-by-side with gradient rounded backgrounds and color-coded badges (blue for classes, green for resources)
- Backend logs now show detailed enrollment verification including which courses were enrolled and whether they are bundles or individual courses
- Previous: Bundle Course Access Fix & UI Improvements (CourseClasses and CourseWatch userCourses collection checks, free course enrollment flow updates, resource titles display, class duration removal)

**November 23, 2025** - UX Improvements & Offline Enhancement:
- Added dismissible close button to update notification for non-critical updates (critical version mismatches still force updates)
- Extended device removal grace period to 5 minutes to prevent false positive logouts during video seeking/forwarding
- Enhanced service worker with better offline support: cache-first strategy for static assets (images, fonts, CSS, JS), Bangla offline fallback page, and smart caching that skips Firebase/external APIs
- Improved offline PWA functionality with comprehensive resource caching while maintaining Firebase auth integrity

**November 22, 2025** - Ban System & Service Worker Fixes:
- Fixed service worker update notification loop - now properly handles cache updates and dismissal without persistent false notifications
- Removed early ban check from signIn function to prevent login-logout loop - banned users can now login and see ban overlay
- Enhanced ban expiry logic to properly kick all devices via kickedDevices array for reliable multi-device logout
- Fixed admin unban to correctly increment permanentBanCount when unbanning permanent bans
- Ban overlay now displays correctly on all devices when multi-device login is detected
- ProtectedRoute component provides security guard to prevent banned users from accessing protected routes

# User Preferences

Preferred communication style: Simple, everyday language.

# System Architecture

## Frontend Architecture

**Technology Stack:** React 18 with Vite.
**UI Framework:** Radix UI primitives with Tailwind CSS, minimalist Vercel-inspired design, dark mode support.
**State Management:** React hooks and Context API, Firebase Firestore for persistent data.
**Internationalization:** Google Fonts (Hind Siliguri) for Bangla language support.
**Progressive Web App:** Service workers for offline functionality, web manifest for installability, and an auto-update system for cache refresh and version tracking.

## Backend Architecture

**Server Framework:** Express.js on Node.js.
**Deployment Model:** Hybrid approach using an Express server for development and Vercel serverless functions (`/api`) for production.
**API Structure:** Endpoints for payment processing, enrollment, image uploads, and dynamic PWA manifest generation.

## Data Storage

**Primary Database:** Firebase Firestore (NoSQL) with collections for `users`, `courses`, `payments`, `settings`, and `adminTokens`.
**Image Storage:** ImgBB API.

## Authentication & Authorization

**Authentication Provider:** Firebase Authentication with Google OAuth.
**Authorization Model:** Role-based access control (RBAC) using `isAdmin` and `role` fields.
**Security:** Firebase Security Rules for server-side authorization.
**Ban System:** Simplified device-based ban system with automatic 30-minute bans for new device logins (if existing devices are detected), escalating to permanent bans after three violations. Includes full-screen ban overlay, auto-logout, and device cleanup. Admins are immune. Enhanced Ban Management via admin panel for real-time monitoring, manual ban/unban, device kicking, and ban countdowns, with full audit trails. Advanced device fingerprinting and IP address tracking for multi-device login detection. Pre-login ban checks prevent banned users from accessing the app even with cleared caches. Auto-permanent ban flag (after 3 temporary bans) makes accounts irreversibly locked, with UI indicators.

## UI/UX Decisions

Custom design system inspired by Vercel's minimalist aesthetic, supporting dark mode. Radix UI primitives for accessibility, Tailwind CSS for flexible styling. Mobile-responsive UI for BanOverlay and Admin Ban Management pages.

## Technical Implementations

- **Real-Time Presence Detection:** Tracks user online/offline status, tab visibility, and window focus.
- **Advanced Coupon System:** Universal and Unique coupon types with conditional validation (specific users, required courses, minimum purchase count/value). Admin panel for management.
- **Bundle Courses:** Admins can create course bundles that automatically enroll users in multiple courses upon purchase. MyCourses displays bundle provenance metadata while hiding bundle wrappers. Purchased bundles are hidden from course listings on Home and Courses pages.
- **Admin Attribution:** Payment records store `approvedBy` and `rejectedBy`.
- **Notification System:** Admin panel displays real-time ban notification badges via Firestore listeners.
- **IP Geolocation:** Robust multi-API fallback system with error handling and Google Maps integration for device location tracking.

# External Dependencies

**Payment Gateway:** RupantorPay (RESTful API for checkout and verification, webhook support).
**Image Hosting:** ImgBB API (RESTful API for Base64 image uploads).
**IP Address Tracking:** ipify.org.
**Firebase Services:** Firebase Authentication (Google OAuth), Firebase Firestore, Firebase Cloud Messaging (FCM) for push notifications (via VAPID key and `/firebase-messaging-sw.js`, Admin SDK).
**Analytics:** Vercel Analytics (`@vercel/analytics`).
**Deployment Platform:** Vercel (`vercel.json` configuration).