# Overview

Easy Education is a Progressive Web Application (PWA) for delivering free online courses. The platform features a React-based frontend with Vite build tooling, Express.js backend for API routes, and Firebase for authentication, database, and push notifications. The application supports payment processing through RupantorPay, image uploads via ImgBB, and includes comprehensive admin capabilities for course management and enrollment tracking.

# User Preferences

Preferred communication style: Simple, everyday language.

# System Architecture

## Frontend Architecture

**Technology Stack:** React 18 with Vite as the build tool and bundler.

**Rationale:** Vite provides fast development server with hot module replacement and optimized production builds. React offers component-based architecture ideal for building interactive educational interfaces.

**UI Framework:** Radix UI primitives with Tailwind CSS for styling.

**Rationale:** Radix UI provides accessible, unstyled components that can be customized with Tailwind CSS. This combination ensures accessibility compliance while maintaining design flexibility. The application uses a custom design system based on Vercel's minimalist aesthetic with support for dark mode.

**State Management:** React hooks and context for local state, Firebase Firestore for persistent data.

**Rationale:** Avoids complexity of external state management libraries for this application size. Firebase real-time updates handle data synchronization across components.

**Internationalization:** Google Fonts (Hind Siliguri) for Bangla language support.

**Rationale:** Ensures proper rendering of Bengali script across all devices and browsers.

**Progressive Web App:** Service workers for offline functionality, web manifest for installability.

**Rationale:** Enables app-like experience on mobile devices with offline course access and home screen installation.

## Backend Architecture

**Server Framework:** Express.js running on Node.js.

**Rationale:** Lightweight, unopinionated framework suitable for API endpoints and middleware integration. Express handles CORS, JSON parsing, and routing efficiently.

**Deployment Model:** Hybrid approach with Express server and Vercel serverless functions.

**Rationale:** Express server (`server.js`) handles development environment, while `/api` directory contains Vercel serverless functions for production. This allows local development with full Express capabilities while maintaining serverless scalability in production.

**API Structure:**
- `/api/create-payment` - Initiates RupantorPay checkout
- `/api/verify-payment` - Verifies payment status
- `/api/payment-webhook` - Receives payment notifications
- `/api/process-enrollment` - Handles manual enrollment and free course enrollment
- `/api/upload-image` - Proxies image uploads to ImgBB
- `/api/manifest.json` - Dynamically generates PWA manifest from database

**Rationale:** Serverless functions provide automatic scaling and reduced infrastructure management. Each endpoint is isolated for better error handling and deployment.

## Data Storage

**Primary Database:** Firebase Firestore (NoSQL document database).

**Collections:**
- `users` - User profiles with role-based access control
- `courses` - Course catalog with pricing and content
- `payments` - Payment records and enrollment tracking
- `settings` - Application configuration (PWA settings, branding)
- `adminTokens` - FCM tokens for admin push notifications

**Rationale:** Firestore provides real-time synchronization, offline support, and automatic scaling. Document model fits the nested structure of courses with lessons and modules. Firebase Security Rules enable granular access control.

**Image Storage:** ImgBB API for hosting uploaded images.

**Rationale:** External image hosting reduces Firebase Storage costs and provides CDN delivery. ImgBB offers free tier with generous limits suitable for educational content.

**Alternatives Considered:** Firebase Storage was considered but rejected due to cost implications and complexity of managing file permissions.

## Authentication & Authorization

**Authentication Provider:** Firebase Authentication with Google OAuth.

**Rationale:** Reduces friction in user onboarding (no password to remember), provides trusted authentication, and integrates seamlessly with Firestore security rules.

**Authorization Model:** Role-based access control (RBAC) with `isAdmin` and `role` fields in user documents.

**Rationale:** Simple two-tier system (admin/user) sufficient for educational platform needs. Admins can manage courses, view payments, and send notifications.

**Security:** Firebase Security Rules enforce server-side authorization.

**Rationale:** Client-side checks are supplemented by database-level rules preventing unauthorized data access even if client code is compromised.

## External Dependencies

**Payment Gateway:** RupantorPay (Bangladesh payment processor)
- **Integration:** RESTful API with webhook support
- **Endpoints Used:**
  - `POST https://payment.rupantorpay.com/api/payment/checkout` - Create payment session
  - `POST https://payment.rupantorpay.com/api/payment/verify-payment` - Verify transaction status
- **Authentication:** API key via `X-API-KEY` header
- **Environment Variable:** `RUPANTORPAY_API_KEY`
- **Webhook Events:** Receives `COMPLETED`, `PENDING`, `ERROR` status updates
- **Purpose:** Handles paid course enrollments with mobile banking integration

**Image Hosting:** ImgBB API
- **Integration:** RESTful API with Base64 image upload
- **Endpoint:** `POST https://api.imgbb.com/1/upload`
- **Authentication:** API key as query parameter
- **Environment Variable:** `IMGBB_API_KEY`
- **Constraints:** 32MB file size limit, standard image formats only (JPEG, PNG, GIF, BMP)
- **Purpose:** Stores course thumbnails, user avatars, and instructional images

**Firebase Services:**
- **Firebase Authentication:** Google OAuth provider for user login
- **Firebase Firestore:** NoSQL database for all application data
- **Firebase Cloud Messaging (FCM):** Push notifications for admin alerts
  - **VAPID Key:** Used for browser push notification authorization
  - **Service Worker:** `/firebase-messaging-sw.js` handles background messages
  - **Admin SDK:** Server-side Firebase Admin for secure messaging operations
  - **Environment Variables:** `FIREBASE_SERVICE_ACCOUNT` (JSON credentials)

**Analytics:** Vercel Analytics
- **Integration:** `@vercel/analytics` package
- **Purpose:** Track page views and user interactions without cookies

**Build & Development Tools:**
- **Vite:** Frontend build tool and dev server
- **Tailwind CSS:** Utility-first CSS framework with PostCSS/Autoprefixer
- **Sharp:** Server-side image processing for PWA icon generation
- **Class Variance Authority (CVA):** Type-safe component variants

**Email Service:** SendGrid (referenced in `/functions/send-grid`)
- **Status:** Configured but not actively used in current codebase
- **Environment Variables:** `SENDGRID_API_KEY`, `SENDGRID_FROM_EMAIL`
- **Purpose:** Transactional email capabilities (payment confirmations, enrollment notifications)

**Deployment Platform:** Vercel
- **Configuration:** `vercel.json` defines rewrites, headers, and function timeouts
- **Serverless Functions:** 30-second max duration for payment and upload operations
- **Environment:** Production uses serverless architecture, development uses Express server