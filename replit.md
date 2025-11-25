# Overview

Easy Education is a Progressive Web Application (PWA) delivering free online courses. It features a React-based frontend, an Express.js backend, and Firebase for authentication, database, and notifications. The platform integrates with RupantorPay for payments and ImgBB for image uploads, alongside a comprehensive admin panel for course and enrollment management. The project aims to provide an accessible and engaging learning experience with robust administrative capabilities, targeting the online education market.

# Recent Changes

**November 25, 2025 (Part 5)** - Phone Number Integration, Payment Search & Telegram Modal Enhancements:
- Integrated phone number tracking throughout enrollment flow - checkout now captures mobile number and saves it to payment records
- Enhanced admin payments page with phone number column and improved notification system displaying phone numbers in toasts
- Implemented comprehensive search functionality on ManagePayments - search by course name, user name, email, phone number, or transaction ID with live result count display
- Search filter safely handles legacy payment records without phone numbers using default empty string fallbacks
- Redesigned Telegram submission flow - replaced inline forms with professional modal dialogs on CourseChapters and CourseSubjects pages
- Added prominent Bangla "টেলিগ্রাম গ্রুপে যুক্ত হন" button above course content for easy discovery
- Implemented two-step required form in modal: Step 1 captures Telegram ID, Step 2 captures mobile number with Bangla instructions
- Added smooth step transitions with Framer Motion animations, validation states, and loading indicators
- Success state displays confirmation message with direct Telegram group link button
- Modal includes warning text about one-time submission limit to ensure accurate data collection
- All Telegram forms now use Bangla language for better user experience (toast notifications, form labels, buttons)

**November 25, 2025 (Part 4)** - Demo Video Thumbnails & SMS Format Update:
- Fixed demo video thumbnails not displaying - implemented improved YouTube ID extraction using robust regex parser
- Thumbnails now load with mqdefault.jpg quality with automatic fallback to default.jpg if unavailable
- Updated SMS notification format from Bangla to English with custom template including user name, course name, and Telegram community link
- SMS message format: "Hello, [Name] you have successfully enrolled to '[Course]' course. Regards, Easy Education Team\n\nJoin Here:\nhttps://t.me/Easy_Education_01"
- Enhanced video player with proper error handling for invalid YouTube URLs

**November 25, 2025 (Part 3)** - Course Modal, Mobile Checkout & SMS Notifications:
- Expanded course add/edit modal to 98% viewport width (max-w-[98vw]) for maximum screen utilization
- Updated course details page: hero image displays first on mobile above course info, demo videos use YouTube iframe embeds with responsive grid (2 columns mobile, 4 columns desktop)
- Added mandatory Bangladeshi mobile number field to checkout page with strict validation (supports 880XXXXXXXXXX or 01XXXXXXXXX formats)
- Implemented SMS notification system using bulksmsbd.net API - sends enrollment confirmation messages to students after successful course enrollment
- Mobile number properly threaded through entire enrollment flow: Checkout → process-enrollment → process-payment → send-sms
- SMS credentials (BULKSMS_API_KEY, BULKSMS_SENDER_ID) securely stored in Replit Secrets
- SMS sending includes graceful error handling and detailed logging for troubleshooting

**November 25, 2025 (Part 2)** - Course Details UI Enhancements & Demo Videos Feature:
- Reorganized course details page layout - moved course image to sidebar above purchase section for better visual hierarchy
- Implemented demo videos section with CustomVideoPlayer component displaying YouTube videos as cards with titles below course description
- Expanded course add/edit modal to 70% viewport width with two-column desktop layout (single column on mobile) to reduce scrolling
- Added vertical divider between columns in modal for clear visual separation
- Implemented demo video management allowing admins to add multiple YouTube links with titles during course creation/editing
- Fixed critical state management race condition in ManageCourses modal using atomic state updates to prevent demoVideos undefined crashes
- Refactored modal state to use single atomic state object (`modalState = {isOpen, form, editingCourse}`) with backward-compatibility layer
- Added smart setFormData wrapper supporting both functional and direct updates while maintaining proper nested state structure
- Demo videos persist in Firestore and display correctly on course detail pages with responsive card layout

**November 25, 2025 (Part 1)** - UX Improvements & Carousel Fix:
- Fixed home page carousel to show 20% of next slide on desktop for preview effect
- Corrected carousel calc() CSS syntax for proper browser parsing
- Fixed course class card image positioning - images now consistently display at top of cards regardless of resource availability
- Improved responsive margins between carousel slides on mobile
- Verified Jodit rich text editor integration in course edit modal

**November 24, 2025 (Part 3)** - CourseCard UI Refinements & Uniform Layout:
- Removed user icon from course card placeholders - replaced with clean gradient background
- Implemented uniform card heights using min-height for resources section - prevents layout shifts when resources are missing
- Enhanced resources badge colors in light mode - darker text (blue-800, green-800) for better readability
- Added responsive resources display with flex-wrap and scrollable overflow for 6-7+ resource items
- Resources section now supports multiple rows with smooth scrolling, maintaining clean layout at all screen sizes

**November 24, 2025 (Part 2)** - Bundle Course Individual Access Fix & Frontend-Backend Data Flow Optimization:
- CRITICAL FIX: Bundle course individual course access now works correctly - users can access all courses within purchased bundles
- Fixed `courseToEnrollMap is not defined` error that prevented bundle enrollment completion
- Optimized bundle enrollment to work without Firebase Admin credentials by passing bundle metadata from frontend
- Frontend (Checkout.jsx) now normalizes bundledCourses to send only course IDs, preventing serialization issues
- Backend (process-payment.js) handles both string IDs and course objects defensively for backward compatibility
- Added validation to skip invalid bundled course entries with error logging
- Bundle enrollment now creates userCourse entries for both the bundle itself AND all individual courses, ensuring proper access control
- Frontend-first approach reduces dependency on Firebase Admin SDK for bundle expansion

**November 24, 2025 (Part 1)** - Bundle Course Enrollment Fix & Enhanced Error Handling:
- Bundle course enrollment now correctly creates userCourses entries for BOTH the bundle course itself AND all individual courses within the bundle
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
**API Structure:** Endpoints for payment processing, enrollment, image uploads, dynamic PWA manifest generation, and SMS notifications.

## Data Storage

**Primary Database:** Firebase Firestore (NoSQL) with collections for `users`, `courses`, `payments`, `settings`, and `adminTokens`.
**Image Storage:** ImgBB API.

## Authentication & Authorization

**Authentication Provider:** Firebase Authentication with Google OAuth.
**Authorization Model:** Role-based access control (RBAC) using `isAdmin` and `role` fields.
**Security:** Firebase Security Rules for server-side authorization.
**Ban System:** Simplified device-based ban system with automatic 30-minute bans for new device logins (if existing devices are detected), escalating to permanent bans after three violations. Includes full-screen ban overlay, auto-logout, and device cleanup. Admins are immune. Enhanced Ban Management via admin panel for real-time monitoring, manual ban/unban, device kicking, and ban countdowns, with full audit trails. Advanced device fingerprinting and IP address tracking for multi-device login detection. Pre-login ban checks prevent banned users from accessing the app even with cleared caches. Auto-permanent ban flag (after 3 temporary bans) makes accounts irreversibly locked, with UI indicators.

## UI/UX Decisions

Custom design system inspired by Vercel's minimalist aesthetic, supporting dark mode. Radix UI primitives for accessibility, Tailwind CSS for flexible styling. Mobile-responsive UI for BanOverlay and Admin Ban Management pages. Course add/edit modal at 98% width for maximum content visibility. Course details page optimized for mobile-first viewing with YouTube iframe embeds.

## Technical Implementations

- **Real-Time Presence Detection:** Tracks user online/offline status, tab visibility, and window focus.
- **Advanced Coupon System:** Universal and Unique coupon types with conditional validation (specific users, required courses, minimum purchase count/value). Admin panel for management.
- **Bundle Courses:** Admins can create course bundles that automatically enroll users in multiple courses upon purchase. MyCourses displays bundle provenance metadata while hiding bundle wrappers. Purchased bundles are hidden from course listings on Home and Courses pages.
- **Admin Attribution:** Payment records store `approvedBy` and `rejectedBy`.
- **Notification System:** Admin panel displays real-time ban notification badges via Firestore listeners.
- **IP Geolocation:** Robust multi-API fallback system with error handling and Google Maps integration for device location tracking.
- **SMS Notifications:** Automated Bangla enrollment confirmation messages sent via bulksmsbd.net API with mandatory Bangladeshi mobile number validation during checkout.

# External Dependencies

**Payment Gateway:** RupantorPay (RESTful API for checkout and verification, webhook support).
**Image Hosting:** ImgBB API (RESTful API for Base64 image uploads).
**IP Address Tracking:** ipify.org.
**SMS Gateway:** bulksmsbd.net (RESTful API for sending Bangla SMS notifications to students).
**Firebase Services:** Firebase Authentication (Google OAuth), Firebase Firestore, Firebase Cloud Messaging (FCM) for push notifications (via VAPID key and `/firebase-messaging-sw.js`, Admin SDK).
**Analytics:** Vercel Analytics (`@vercel/analytics`).
**Deployment Platform:** Vercel (`vercel.json` configuration).
