# Overview

Easy Education is a Progressive Web Application (PWA) providing free online courses. It utilizes a React frontend, an Express.js backend, and Firebase for core services like authentication, database, and notifications. The platform integrates with RupantorPay for payments and ImgBB for image hosting. It includes a comprehensive admin panel for course and enrollment management, aiming to offer an accessible and engaging learning experience within the online education market.

# User Preferences

Preferred communication style: Simple, everyday language.

# System Architecture

## Frontend Architecture

**Technology Stack:** React 18 with Vite.
**UI Framework:** Radix UI primitives with Tailwind CSS, supporting dark mode and a minimalist Vercel-inspired design.
**State Management:** React hooks and Context API, leveraging Firebase Firestore for persistent data.
**Internationalization:** Google Fonts (Hind Siliguri) for Bangla language support.
**Progressive Web App:** Service workers for offline functionality (cache-first for static assets, Bangla offline page), web manifest for installability, and an auto-update system.
**UI/UX Decisions:** Custom design system inspired by Vercel, mobile-responsive UI, 98% width course add/edit modal, mobile-first optimized course details with YouTube iframe embeds.

## Backend Architecture

**Server Framework:** Express.js on Node.js, deployed using a hybrid approach with an Express server for development and Vercel serverless functions (`/api`) for production.
**API Structure:** Endpoints for payment processing, enrollment, image uploads, dynamic PWA manifest generation, and SMS notifications.

## Data Storage

**Primary Database:** Firebase Firestore (NoSQL) for `users`, `courses`, `payments`, `settings`, and `adminTokens`.
**Image Storage:** ImgBB API.

## Authentication & Authorization

**Authentication Provider:** Firebase Authentication with Google OAuth.
**Authorization Model:** Role-based access control (RBAC) using `isAdmin` and `role` fields, enforced by Firebase Security Rules.
**Ban System:** Device-based ban system with automatic temporary bans for new device logins, escalating to permanent bans. Features a full-screen ban overlay, auto-logout, device cleanup, and an admin panel for management (manual ban/unban, device kicking, ban countdowns, audit trails). Includes advanced device fingerprinting and IP address tracking for multi-device login detection, and pre-login ban checks.

## Technical Implementations

- **Real-Time Presence Detection:** Tracks user online/offline status, tab visibility, and window focus.
- **Advanced Coupon System:** Supports universal and unique coupon types with conditional validation.
- **Bundle Courses:** Admins can create course bundles that automatically enroll users in multiple courses; purchased bundles are hidden from general listings.
- **Admin Attribution:** Payment records store `approvedBy` and `rejectedBy` for audit.
- **Notification System:** Admin panel displays real-time ban notification badges via Firestore listeners.
- **IP Geolocation:** Robust multi-API fallback system with error handling and Google Maps integration.
- **SMS Notifications:** Automated enrollment confirmation messages via bulksmsbd.net API with mandatory Bangladeshi mobile number validation during checkout.
- **Class Reactions System:** Icon-based reaction system (Lucide React icons) with 5 colorful reaction types (Like, Love, Haha, Wow, Angry) styled with exact Facebook reaction colors using hex values (#1778F2 blue, #F0284A pink, #F7B125 yellow, #FAD664 gold, #E9710F orange). Each reaction displays real-time counts, user's selection is highlighted with matching color borders and backgrounds, and all reactions are visible in a single horizontal row. Icons are device-independent ensuring consistent display across all platforms.
- **Class Comments Management:** Admin panel includes a dedicated "Class Comments" page that displays all class comments and replies with breadcrumb-style navigation (Course → Class → Reply info). Admins can delete any comment and navigate directly to the class where the comment was posted.
- **Multiple Telegram Links:** Course management supports multiple Telegram group links (stored in `telegramLinks` array with backward-compatible `telegramLink` field). Users can add/remove multiple links during course creation/editing, and all links are displayed to students after form submission.

# External Dependencies

**Payment Gateway:** RupantorPay (RESTful API, webhook support).
**Image Hosting:** ImgBB API (RESTful API for Base64 image uploads).
**IP Address Tracking:** ipify.org.
**SMS Gateway:** bulksmsbd.net (RESTful API for sending SMS notifications).
**Firebase Services:** Firebase Authentication (Google OAuth), Firebase Firestore, Firebase Cloud Messaging (FCM).
**Analytics:** Vercel Analytics (`@vercel/analytics`).
**Deployment Platform:** Vercel.