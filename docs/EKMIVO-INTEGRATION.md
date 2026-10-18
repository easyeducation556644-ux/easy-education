# Ekmivo integration — public-documentation-only implementation

## Contract used

Read on 2026-10-18 from the public Developers portal:

- https://ekmivo-web.vercel.app/developers/quickstart
- https://ekmivo-web.vercel.app/developers/authentication
- https://ekmivo-web.vercel.app/developers/payments/create
- https://ekmivo-web.vercel.app/developers/payments/verify
- https://ekmivo-web.vercel.app/developers/webhooks
- https://ekmivo-web.vercel.app/developers/api-reference
- https://ekmivo-web.vercel.app/developers/go-live

No Ekmivo implementation files, internal routes, database state or unpublished behavior were consulted for this integration. Easy Education's own code was inspected and modified.

Create: POST /v1/payment/create, Authorization: Bearer <key>, Content-Type: application/json and stable 16–128-character Idempotency-Key. amount is BDT, not paisa. Persist returned invoice_id with the merchant order; redirect to payment_url. The return URL embeds our own order_id, so no undocumented callback query parameters are assumed.

Verify: POST /v1/payment/verify with invoice_id. Fulfill only on COMPLETED and matching invoice_id, amount_minor (paisa), BDT currency and reference. We store order/cart details locally instead of assuming metadata is returned by Verify.

Optional webhooks: use webhook_url at creation only when EKMIVO_WEBHOOK_SECRET is configured. HMAC-SHA256 uses the secret string, timestamp + '.' + exact raw body, v1=hex signature, 300-second tolerance, matching header/body event UUID, persistent deduplication, followed by Verify. Raw parsing works in the Express route; the serverless handler reads the raw stream and disables body parsing. No reconstruction of parsed JSON for signature checks.

## Required configuration before cutover

Set these on the Easy Education server, never in client variables or Git:

1. EKMIVO_API_ORIGIN: the officially published HTTPS API origin.
2. EKMIVO_API_KEY: merchant key with payments:write and payments:read from the intended workspace/environment.
3. PUBLIC_APP_URL: Easy Education's canonical public HTTPS origin.
4. EKMIVO_WEBHOOK_SECRET: optional automatic webhook signing secret associated with that key; omit to use authenticated redirect + Verify only.

Existing Firebase Admin credentials remain necessary. New ekmivoOrders and ekmivoWebhookEvents collections are server-only; the repository's default-deny Firestore rules do not expose them to clients. No Ekmivo credentials were generated, guessed or committed.

## Documentation gaps and honest limits

The public portal explicitly labels its API origin as unpublished and uses $EKMIVO_API_ORIGIN placeholders. It also says the guaranteed idempotency retention window is unpublished. We cannot determine the real production origin from these docs and have not filled that gap from prior knowledge or Ekmivo source code. Repeated creation uses the same stored key and exact stored request; no undocumented retention duration is promised.

Implementation is possible against the published contract. Actual gateway connectivity, key permissions/domain rules, sandbox payment and real paid enrollment cannot be certified until the published origin and merchant credentials are configured. No undocumented domain-authentication headers were invented. The key's environment is authoritative.

Do not merge/deploy the provider switch until configuration is present and a sandbox create → checkout → return → Verify → enrollment pass succeeds. Drain existing Rupantor Pay pending checkouts before cutover; old invoices/history are retained, but new Ekmivo callbacks use merchant order_id, not legacy transaction query parameters.

## Behavior and validation

- Authenticated server-priced cart and coupon calculation; customer amount cannot choose the payable total or grant additional bundle courses.
- Merchant-created stable order, durable invoice mapping, same-payload retries and per-order creation/fulfillment leases.
- Unconfirmed, pending, mismatched, failed, cancelled or expired payments do not fulfill or display a paid-success state.
- Deterministic payment record; approval and course enrollment commit in the same Firestore batch. An interrupted batch remains retryable.
- Duplicate/retried callbacks do not enroll twice. Signed events are persisted and acknowledged only after confirmation/fulfillment; transient failures return a retryable failure.
- Cart remains on cancellation/failure; success clears only the matching submitted cart. Existing free/manual enrollment paths remain; customer free claims are authenticated and checked against server prices/coupons.
- npm run test:payments: 7 tests pass, including interrupted enrollment retry and real helper idempotence with an isolated in-memory database.
- npm run build: passed (existing bundle-size warning). Local HTTP smoke: unauthenticated creation rejected; raw webhook fails closed without a secret.
- No production payment, real Firestore enrollment, provider callback delivery or browser/device pass claimed.

The repository already had stale imports in server.js; these now point to the existing server/api-resources handlers so the local HTTP server starts. Existing package.json/package-lock mismatch for @unpirator dependencies was repaired for reproducible installation.
