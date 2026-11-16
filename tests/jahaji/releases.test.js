import test from 'node:test'
import assert from 'node:assert/strict'
import {validateRelease} from '../../server/jahaji/releases.js'

const valid = {version: '3.0.9', url: 'https://github.com/easyeducation556644-ux/easy-education/releases/download/v3.0.9/Jahaji-3.0.9-Setup.exe', sha256: 'a'.repeat(64), size: 100, published: true}
test('release publishing validates version, trusted installer source and checksum', () => {
  assert.equal(validateRelease(valid).version, '3.0.9')
  for (const patch of [{version: '../bad'}, {url: 'https://evil.test/setup.exe'}, {url: valid.url.replace('https:', 'http:')}, {sha256: 'bad'}, {size: 0}, {size: 2**31}]) {
    assert.throws(() => validateRelease({...valid, ...patch}))
  }
})
