import test from "node:test"
import assert from "node:assert/strict"
import { createSignedState, decryptSecret, encryptSecret, verifySignedState } from "../../server/bot/crypto.js"

process.env.BOT_CREDENTIAL_KEY = "test-only-high-entropy-key"
process.env.GOOGLE_DRIVE_STATE_SECRET = "test-only-oauth-state-key"

test("credentials encrypt and decrypt without exposing plaintext", () => {
  const encrypted = encryptSecret("sensitive-value")
  assert.notEqual(encrypted, "sensitive-value")
  assert.equal(decryptSecret(encrypted), "sensitive-value")
})

test("OAuth state is signed and rejects modification", () => {
  const state = createSignedState({ purpose: "google-drive", telegramUserId: "123" })
  assert.equal(verifySignedState(state).telegramUserId, "123")
  assert.throws(() => verifySignedState(`${state}x`))
})
