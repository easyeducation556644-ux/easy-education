# Easy Education — Content Recovery (Emergency)

This feature adds an **Admin Panel → Database Restore** page and a tightly scoped server-side endpoint at `/api/restore-content`.

## Critical safety notes

- **Never** set Firestore Rules to `allow read, write: if true`; it is not required.
- No additional Vercel environment variables or explicit UID allowlist are required. Existing authenticated **Full Admin** accounts can use the tool. The server checks the Firebase ID token (revocation checked) and corresponding `users/{uid}` role on every request.
- This uses the Firebase Admin credentials already configured on the Vercel backend; **do not upload or commit a service-account key**.
- NOTE: the Firestore `users` collection had been exposed during the incident. Verify that current Full Admin user profiles have not been maliciously promoted before deploying; do not assume a profile role is a trusted independent authority.
- Before running restore, **export/snapshot the current production Firestore database** (including records created since the attack), verify that payment/access Cloud Function triggers will not mutate state, and ideally perform the same recovery on a staging project first.

## Approved input file

The recovery operator must choose `EasyEducation-SIGNED-CONTENT-RESTORE.json`, provided separately and kept **PRIVATE**. This file contains only 2,581 content documents from the original browser cache, plus SHA-256 Merkle proofs verifying each row against a fixed trusted recovery root committed into the endpoint. Tampered or invented rows will be rejected. Do **NOT** commit the backup JSON into GitHub, expose it on the website, or upload students' payment/profile data into static assets.

Collection counts: `categories=7`, `courses=170`, `chapters=283`, `classes=2121`.

## Workflow

1. Deploy and open `/admin/restore` as an existing Full Admin.
2. Select the approved JSON on your own device; this never becomes a public/static asset.
3. Click **Check Missing Documents**. This is read-only and checks original IDs against live Firestore in small batches.
4. Review counts. Confirm an independent live database backup. Type `RESTORE MISSING CONTENT` and click **Restore Missing Content**.
5. The endpoint uses `DocumentReference.create()` only. It never overwrites, updates, or deletes existing records. If interrupted, re-run preflight and continue safely; existing records will be skipped.
6. Download the audit report and check the live course pages, user access and production logs. After recovery, remove or disable the emergency restore route before it becomes a permanent administrative entry point.

## Not included in this pass

- Missing `subjects` documents. The original cache contained **none**. Do not generate placeholder subjects.
- Class records not found in the cache, including classes for 137 of 170 recovered course IDs.
- `users`, `payments`, `userCourses`, `settings`, `adminTokens`, `announcements`, `examAttempts`, or any other collections. Their security and financial implications require a separate independently verified recovery step.
- No automatic deployment, no Firestore rules changes, and no database writes are performed by this pull request itself.

## Operational caveats

- A serverless import of >2,000 records requires multiple requests; the admin UI displays progress. If the connection fails or token expires, only already-created records remain; run a new preflight before retrying.
- This restore snapshot is incomplete and potentially stale. It does not promise full reconstruction of the pre-incident database.
- Environment variable changes may require a Vercel redeploy for functions to pick them up.
