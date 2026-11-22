# Incident recovery: production security handoff (23 Nov 2026)

## Important: GitHub/Vercel is not Firestore Rules deployment
The `firestore.rules` file has been hardened in this PR. **Merging this PR does NOT publish Firebase Security Rules.** Deploy them separately. Firestore Admin SDK also bypasses all of these rules.

**Do not run the enrollment restoration until the checks below pass.** Do not expose any recovered payment or user JSON in a public repository.

## 1. Current vulnerable rules and what changed

- A signed-in client could create `payments` with `status: "approved"` under the previous repository rules. That allowed payment-based course access without a verified payment. New rules only allow user-created *pending* payments.
- `src/lib/enrollment.js` no longer creates `approved` payments or `userCourses` via the browser; free course requests use the server, which independently validates the Firebase UID and free cart.
- `users` documents are no longer readable by every signed-in account. Own profile/admin reads only. Owners cannot modify role/permissions/bans/entitlements.
- Ordinary users cannot list `adminTokens`. Full admins alone may delete top-level content/client records.
- Self-owned posts/comments cannot change author ID; notification read status only.
- Media upload proxy uses verified Firebase ID tokens, 3MB maximum, an hourly per-user transaction quota, and only the secret `IMGBB_API_KEY` in server environment.
- Anonymous users cannot write usage-metric documents through Admin SDK; authenticated users have an hourly quota.
- Offline-download token requests require the actual class video URL and an existing `userCourses` entitlement (admins excepted).
- Server auth helpers verify token revocation.
- The MyCourses payment-derived fallback is **disabled by default**. It is only activated by `VITE_VERIFIED_PAYMENT_FALLBACK=enabled` after payment source integrity is established. Restored `userCourses` records work without this flag.

## 2. Verify production administrator authorization before publishing rules

**The existing rules already relied on `adminTokens/{uid}`. The hardened rules additionally require that the same UID has `users/{uid}.role == "admin"`.** The `adminTokens` collection also has notification-token usage elsewhere, so its exact live document IDs must be inspected, rather than assumed.

Use a test/staging Firebase project to exercise:
- authorized original full admin can create/edit/delete a test content document, access Administration, and approve a test pending payment;
- limited admin cannot elevate roles or delete protected content;
- normal signed-in user can update name/device status but cannot change `role`, `adminAccess`, bans, or create approved payment;
- normal user can only read their own `users`, `payments`, `userCourses`;
- `posts`/`comments` author ID cannot be changed; notifications cannot be rewritten to other types;
- free enrollment works with a genuinely free catalog course;
- the restored content and imported class/chapter/subject routes work under the rules;
- Jahaji and provider-specific collections accessed by Admin SDK are unaffected.

**No staging emulator run or live rules access occurred in this session.** Never replace live rules with an untested file when admin token records may be missing.

After validating, deploy from repository root using the authenticated Firebase CLI and the correct project:

```bash
firebase login
firebase deploy --project easy-education-real --only firestore:rules
```

Confirm the active rules in Firebase Console > Firestore Database > Rules and run the above authorization checks against the actual project. A Vercel deploy does not deploy these rules.

## 3. Backend/credentials verification

- Rotate the ImgBB provider key that was previously embedded in `server/api-resources/upload-image.js`, **and** rotate `IMGBB_API_KEY` if compromised. The old fallback key was hardcoded in public source.
- Audit Vercel environment variables and service accounts. Remove unnecessary admin credentials, rotate any exposed service-account keys or webhook secrets, and restrict IAM permissions. Never commit service-account JSON or exported user/payment data.
- Verify webhook secret is configured; manually confirm it rejects unsigned/replayed events.
- Review all full-admin and moderator UIDs in Firebase Auth and `users`, especially accounts created/modified during the November 18 incident. A forged admin profile during old open rules may remain privileged until revoked.
- Enable Firestore Data Access logs, Google Cloud audit logging/alerts, automated backups with verified restore tests, App Check where supported, and alerts for abnormal writes/deletes.
- Check any secondary Firebase/operations project independently; Jahaji collections were reached through separate backend auth in inspected code. Their absence from attacker's displayed export does **not** prove the backend was uncompromised.
- Client-readable `courses`/`subjects`/`chapters`/`classes` remain publicly readable under the current compatibility policy. This prevents unauthorized *writes* but does not prevent scraping publicly exposed class metadata. Moving paid class content behind entitlement-checked reads requires UI/query migration and security-rule integration tests before rollout.

## 4. Restore old access only after verified payment evidence

- Take a fresh **live** backup first; do not overwrite live collections with stale cache.
- Run the private `EasyEducation-Final-Recovery-2026-11-23.zip` script in preflight mode.
- Reconcile original approved-payment provenance with payment gateway/admin grants, UID in Firebase Auth, and course IDs in the live collection.
- Only create missing `userCourses/{uid}_{courseId}`; do not modify existing enrollments or grant access based only on imported `approved` status when provenance is uncertain.
- Verify several affected paid, bundle, free, manually granted, and archived-course accounts against `MyCourses`, course detail, class playback, and offline video.
- The original `subjects` records were missing in recovery backup; reconstruct only reviewed candidate labels while preserving legacy IDs. Never pretend guessed subjects are exact originals.

## 5. Rollback and residual risks

- Keep a protected backup of the previous deployed Firestore rules and test a rollback in staging.
- The existing admin UI uses browser Firestore writes for some delete and approval operations; after tightening full-admin/owner checks test each workflow.
- Firebase security rules cannot protect server-side Admin SDK requests. Any compromised service account or insufficiently authenticated API still poses risk. Completing this audit requires inspecting live settings and behavior.
- Merging code alone is **not** equivalent to production hardening; do not declare the system fully secured until the live Firestore Rules/credential/role checks pass.
