import {createHash} from 'node:crypto'
import test from 'node:test'
import assert from 'node:assert/strict'
import handler from '../../server/api-resources/jahaji.js'

// Serialize transactions like Firestore's retry-on-conflict behavior.
class Store {
  rows = new Map()
  tail = Promise.resolve()
  collection(path) {return {doc: id => this.doc(path + '/' + id)}}
  doc(path) {
    return {id: path.split('/').at(-1), path, collection: name => this.collection(path + '/' + name),
      get: async () => this.snap(path)}
  }
  snap(path) {
    const value = this.rows.get(path)
    return {id: path.split('/').at(-1), exists: !!value, data: () => structuredClone(value)}
  }
  runTransaction(callback) {
    const result = this.tail.then(async () => {
      const writes = []
      const tx = {get: async ref => this.snap(ref.path),
        set: (ref, value, options) => writes.push([ref.path, options?.merge ? {...this.rows.get(ref.path), ...structuredClone(value)} : structuredClone(value)]),
        create: (ref, value) => writes.push([ref.path, structuredClone(value)]),
        update: (ref, value) => writes.push([ref.path, {...this.rows.get(ref.path), ...structuredClone(value)}])}
      const output = await callback(tx)
      for (const [key, value] of writes) this.rows.set(key, value)
      return output
    })
    this.tail = result.catch(() => {})
    return result
  }
}

async function call(db, action, body, headers = {}, authenticate) {
  const response = {statusCode: 200, setHeader() {}, status(code) {this.statusCode = code; return this}, json(value) {this.body = value; return this}}
  await handler({method: body === undefined ? 'GET' : 'POST', query: {action}, body, headers}, response, {db, authenticate})
  return response
}

async function device() {
  const db = new Store()
  const id = 'a'.repeat(64), secret = 'b'.repeat(64)
  const headers = {'x-jahaji-device': id, 'x-jahaji-secret': secret}
  assert.equal((await call(db, 'register', {id, secret, name: 'Test PC'})).statusCode, 200)
  return {db, id, headers}
}

test('a device cannot be recreated with a new proof or reset usage by linking an email', async () => {
  const {db, id, headers} = await device()
  await call(db, 'reserve', {operation: 'first-operation', features: ['download'], site: 'acs'}, headers)
  await call(db, 'settle', {operation: 'first-operation', feature: 'download', success: true}, headers)
  assert.equal((await call(db, 'register', {id, secret: 'c'.repeat(64)})).statusCode, 409)
  db.rows.get('jahajiDevices/' + id).uid = 'test-user'
  db.rows.set('jahajiUsers/test-user', {name: 'Test user'})
  const state = (await call(db, 'status', undefined, headers)).body
  assert.equal(state.usage.download.used, 1)
})

test('concurrent sixth reservation is rejected and duplicate settlement charges once', async () => {
  const {db, headers} = await device()
  const results = await Promise.all(Array.from({length: 6}, (_, index) => call(db, 'reserve', {
    operation: 'operation-' + index, features: ['download'], site: 'acs'}, headers)))
  assert.equal(results.filter(result => result.statusCode === 200).length, 5)
  assert.equal(results.filter(result => result.statusCode === 429).length, 1)
  for (let index = 0; index < 2; index++) await call(db, 'settle', {operation: 'operation-0', feature: 'download', success: true}, headers)
  const state = (await call(db, 'status', undefined, headers)).body
  assert.deepEqual(state.usage.download, {used: 1, reserved: 4})
})

test('failed operations release quota and retry preserves completed stages', async () => {
  const {db, headers} = await device()
  const body = {operation: 'retry-operation', features: ['download', 'watermark'], site: 'retina'}
  await call(db, 'reserve', body, headers)
  await call(db, 'settle', {operation: body.operation, feature: 'download', success: true}, headers)
  await call(db, 'settle', {operation: body.operation, feature: 'watermark', success: false}, headers)
  await call(db, 'reserve', body, headers)
  const state = (await call(db, 'status', undefined, headers)).body
  assert.deepEqual(state.usage.download, {used: 1, reserved: 0})
  assert.deepEqual(state.usage.watermark, {used: 0, reserved: 1})
})

test('ban is checked on every reservation even with a valid device proof', async () => {
  const {db, id, headers} = await device()
  db.rows.get('jahajiDevices/' + id).banned = true
  assert.equal((await call(db, 'reserve', {operation: 'blocked-operation', features: ['download'], site: 'acs'}, headers)).statusCode, 403)
  assert.equal((await call(db, 'admin-users', undefined, {})).statusCode, 401)
})

test('one-time browser sign-in attaches the account without resetting device usage', async () => {
  const {db, id, headers} = await device()
  await call(db, 'reserve', {operation: 'anonymous-operation', features: ['download'], site: 'acs'}, headers)
  await call(db, 'settle', {operation: 'anonymous-operation', feature: 'download', success: true}, headers)
  const code = 'c'.repeat(64)
  db.rows.set('jahajiPairings/' + createHash('sha256').update(code).digest('hex'),
    {deviceId: id, expires: Date.now() + 10000, used: false})
  const authenticate = async () => ({decodedToken: {uid: 'real-user', email: 'test@example.com'}, userProfile: {name: 'Test person'}})
  assert.equal((await call(db, 'link', {code}, {}, authenticate)).statusCode, 200)
  assert.equal((await call(db, 'link', {code}, {}, authenticate)).statusCode, 410)
  const state = (await call(db, 'status', undefined, headers)).body
  assert.equal(state.device.userName, 'Test person')
  assert.equal(state.usage.download.used, 1)
})

test('delegated roles enforce server permissions', async () => {
  const {db} = await device()
  const authenticate = async () => ({decodedToken: {uid: 'staff-user'}, userProfile: {role: 'user'}})
  assert.equal((await call(db, 'admin-access', undefined, {}, authenticate)).statusCode, 403)
  db.rows.set('jahajiStaff/staff-user', {role: 'viewer'})
  assert.equal((await call(db, 'admin-plan', {id: 'example-plan'}, {}, authenticate)).statusCode, 403)
  db.rows.set('jahajiStaff/staff-user', {role: 'support'})
  assert.equal((await call(db, 'admin-plan', {id: 'example-plan'}, {}, authenticate)).statusCode, 403)
  assert.equal((await call(db, 'admin-staff', undefined, {}, authenticate)).statusCode, 403)
})

test('two devices share an account plan but keep independent usage; banning the user blocks both', async () => {
  const {db, id, headers} = await device()
  const second = 'd'.repeat(64)
  const secondHeaders = {'x-jahaji-device': second, 'x-jahaji-secret': 'e'.repeat(64)}
  await call(db, 'register', {id: second, secret: 'e'.repeat(64), name: 'Second PC'})
  db.rows.get('jahajiDevices/' + id).uid = 'same-user'
  db.rows.get('jahajiDevices/' + second).uid = 'same-user'
  db.rows.set('jahajiUsers/same-user', {name: 'Same person', planId: 'paid-plan'})
  db.rows.set('jahajiPlans/paid-plan', {name: 'One download', limits: {download: 1}, sites: ['acs'], deleted: false})
  const operation = {operation: 'first-device-job', features: ['download'], site: 'acs'}
  assert.equal((await call(db, 'reserve', operation, headers)).statusCode, 200)
  assert.equal((await call(db, 'reserve', {...operation, operation: 'second-device-job'}, secondHeaders)).statusCode, 200)
  assert.equal((await call(db, 'reserve', {...operation, operation: 'extra-device-job'}, headers)).statusCode, 429)
  db.rows.get('jahajiUsers/same-user').banned = true
  assert.equal((await call(db, 'reserve', {...operation, operation: 'banned-device-job'}, secondHeaders)).statusCode, 403)
})

test('existing full site admins can enter without a notification token; normal users cannot', async () => {
  const {db} = await device()
  const admin = async () => ({decodedToken: {uid: 'site-admin'}, userProfile: {role: 'admin'}})
  const response = await call(db, 'admin-access', undefined, {}, admin)
  assert.equal(response.statusCode, 200)
  assert.equal(response.body.full, true)
  const limited = async () => ({decodedToken: {uid: 'limited-admin'}, userProfile: {role: 'admin', adminAccess: {mode: 'limited'}}})
  assert.equal((await call(db, 'admin-access', undefined, {}, limited)).statusCode, 403)
  const user = async () => ({decodedToken: {uid: 'regular-user'}, userProfile: {role: 'user'}})
  assert.equal((await call(db, 'admin-access', undefined, {}, user)).statusCode, 403)
})
