# Overview

Easy Education is a Progressive Web Application (PWA) designed to deliver free online courses. It features a React-based frontend using Vite, an Express.js backend for API services, and Firebase for authentication, database management, and push notifications. The platform integrates with RupantorPay for payment processing, ImgBB for image uploads, and includes a comprehensive admin panel for course and enrollment management. The project aims to provide an accessible and engaging learning experience with robust administrative capabilities.

# Recent Changes

**November 20, 2025:** Fixed critical device limit enforcement bug
- **Issue:** Device tracking was not properly counting unique devices. Users could login from 3+ devices without triggering the 2-device limit ban.
- **Root Cause:** The system was checking for new IPs while online but not actually counting total unique devices. Additionally, banned devices were being persisted in the database, allowing them to bypass restrictions after ban expiry.
- **Fix:** 
  - Implemented proper unique device counting using fingerprint and IP combinations
  - Enforced strict 2-device limit - attempting to login from a 3rd device now triggers a 30-minute ban
  - Banned devices are no longer saved to the database, preventing post-ban bypass
  - Added defensive check for existing devices to ensure total device count never exceeds the limit
  - Ban escalation: 3 violations result in permanent account ban
- **Location:** `src/contexts/AuthContext.jsx` in the `checkAndHandleDeviceLogin` function

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
**API Structure:** Endpoints for payment processing (`create-payment`, `verify-payment`, `payment-webhook`), enrollment (`process-enrollment`), image uploads (`upload-image`), and dynamic PWA manifest generation (`manifest.json`).

## Data Storage

**Primary Database:** Firebase Firestore (NoSQL).
**Collections:** `users`, `courses`, `payments`, `settings`, `adminTokens`.
**Image Storage:** ImgBB API for hosting uploaded images.

## Authentication & Authorization

**Authentication Provider:** Firebase Authentication with Google OAuth.
**Authorization Model:** Role-based access control (RBAC) using `isAdmin` and `role` fields in user documents.
**Security:** Firebase Security Rules enforce server-side authorization.

## UI/UX Decisions

The application utilizes a custom design system inspired by Vercel's minimalist aesthetic, supporting dark mode for user preference. Radix UI primitives ensure accessibility, while Tailwind CSS provides flexible styling.

## Technical Implementations

- **Real-Time Presence Detection:** `usePresence` hook tracks user online/offline status, tab visibility, and window focus, synchronizing with Firestore.
- **Enhanced Ban Management:** Dedicated admin page `/admin/ban-management` for real-time user status monitoring, manual ban/unban, device kicking, and ban countdowns. Admins are immune to auto-ban.
- **Device Detection:** Advanced device fingerprinting combined with IP address tracking (via ipify API) for multi-device login detection and ban enforcement. Full-screen ban overlay with countdown for temporary bans.
- **Admin Attribution:** Payment records store `approvedBy` and `rejectedBy` information for admin accountability, displayed in the dashboard and notifications.
- **Notification System:** Admin panel displays real-time ban notification badges via Firestore listeners.
- **IP Geolocation:** Robust IP geolocation with error handling, timeout, and Google Maps integration for device location tracking.

# External Dependencies

**Payment Gateway:** RupantorPay (Bangladesh payment processor)
- **Integration:** RESTful API for checkout and verification, webhook support.
- **Authentication:** API key via `X-API-KEY` header.

**Image Hosting:** ImgBB API
- **Integration:** RESTful API for Base64 image uploads.
- **Authentication:** API key as query parameter.

**IP Address Tracking:** ipify.org (free public API).

**Firebase Services:**
- **Firebase Authentication:** Google OAuth.
- **Firebase Firestore:** Primary NoSQL database.
- **Firebase Cloud Messaging (FCM):** Push notifications for admin alerts, uses VAPID key and `/firebase-messaging-sw.js` service worker. Admin SDK for server-side operations.

**Analytics:** Vercel Analytics (`@vercel/analytics`).

**Build & Development Tools:**
- **Vite:** Frontend build tool.
- **Tailwind CSS:** Utility-first CSS framework.
- **Sharp:** Server-side image processing for PWA icons.
- **Class Variance Authority (CVA):** Type-safe component variants.

**Deployment Platform:** Vercel (uses `vercel.json` for configuration).

**Email Service:** SendGrid (configured but not actively used).