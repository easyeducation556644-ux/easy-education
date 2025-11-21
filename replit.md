# Overview

Easy Education is a Progressive Web Application (PWA) designed to deliver free online courses. It features a React-based frontend, an Express.js backend for API services, and Firebase for authentication, database management, and push notifications. The platform integrates with RupantorPay for payment processing, ImgBB for image uploads, and includes a comprehensive admin panel for course and enrollment management. The project aims to provide an accessible and engaging learning experience with robust administrative capabilities, targeting market potential in online education.

# User Preferences

Preferred communication style: Simple, everyday language.

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
- **Enhanced Ban Management:** Dedicated admin page for real-time user status monitoring, manual ban/unban, device kicking, and ban countdowns. Admins are immune to auto-ban. Includes a self-healing system for `forceLogoutAt` flags and a "Clear Logout Flags" emergency button.
- **Device Detection:** Advanced device fingerprinting combined with IP address tracking for multi-device login detection and ban enforcement. Enforces a strict 2-device limit with ban escalation. Includes robust `clearBanCacheAt` mechanism for clearing stale ban info on clients.
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