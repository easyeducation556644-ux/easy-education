import test from 'node:test'
import assert from 'node:assert/strict'
import {createHash} from 'node:crypto'
import {Store} from './store.js'
import {accountSlots, requireDeviceSlot} from '../../server/jahaji/device-slots.js'
import {FREE_PLAN, validatePlan} from '../../server/jahaji/policy.js'
import handler from '../../server/api-resources/jahaji.js'

async function call(db, action, body, uid='customer', headers={}) {
  const response = {statusCode:200, setHeader(){}, status(code){this.statusCode=code;return this}, json(value){this.body=value;return this}}
  await handler({method:'POST',query:{action},body,headers},response,{db,authenticate:async()=>({decodedToken:{uid,email:uid+'@example.test'},userProfile:{name:'Customer'}})})
  return response
}
const digest = value => createHash('sha256').update(value).digest('hex')
function fixture() {
  const db = new Store()
  for (let n=1;n<=2;n++) {
    const id='computer-'+n, code=String(n).repeat(64)
    db.rows.set('jahajiDevices/'+id,{name:'Computer '+n,createdAt:n,secretHash:digest('a'.repeat(64))})
    db.rows.set('jahajiPairings/'+digest(code),{deviceId:id,expires:Date.now()+60000,used:false})
  }
  return db
}
test('concurrent sign-ins cannot exceed device allowance; disabling frees a slot without resetting usage', async()=>{
  const db=fixture()
  const results=await Promise.all([call(db,'link',{code:'1'.repeat(64)}),call(db,'link',{code:'2'.repeat(64)})])
  assert.deepEqual(results.map(row=>row.statusCode),[200,403])
  db.rows.set('jahajiDevices/computer-1/months/2026-11',{usage:{download:{used:4,reserved:0}}})
  assert.equal((await call(db,'device-access',{id:'computer-1',enabled:false})).statusCode,200)
  assert.equal((await call(db,'link',{code:'2'.repeat(64)})).statusCode,200)
  assert.equal((await call(db,'device-access',{id:'computer-1',enabled:true})).statusCode,403)
  assert.equal(db.rows.get('jahajiDevices/computer-1/months/2026-11').usage.download.used,4)
  assert.equal((await call(db,'device-access',{id:'computer-2',enabled:false},'someone-else')).statusCode,404)
  const denied=await call(db,'reserve',{operation:'disabled-device-job',features:['download'],site:'acs'},'customer',{'x-jahaji-device':'computer-1','x-jahaji-secret':'a'.repeat(64)})
  assert.equal(denied.statusCode,403)
})
test('device capacity follows the active account plan and handles downgrade and unlimited', async()=>{
  const db=fixture(), owner={planId:'paid-plan'}
  db.rows.set('jahajiUsers/customer',owner)
  db.rows.set('jahajiPlans/paid-plan',{...FREE_PLAN,deviceLimit:2})
  assert.equal((await call(db,'link',{code:'1'.repeat(64)})).statusCode,200)
  assert.equal((await call(db,'link',{code:'2'.repeat(64)})).statusCode,200)
  db.rows.get('jahajiPlans/paid-plan').deviceLimit=1
  const slots=await db.runTransaction(tx=>accountSlots(tx,db,'customer',owner))
  assert.equal(slots.allowed.length,1)
  assert.throws(()=>requireDeviceSlot(slots,'computer-2'),/device limit/)
  db.rows.get('jahajiPlans/paid-plan').deviceLimit=-1
  assert.equal((await db.runTransaction(tx=>accountSlots(tx,db,'customer',owner))).allowed.length,2)
  assert.throws(()=>validatePlan({...FREE_PLAN,deviceLimit:0}),/Device limit/)
  assert.equal(validatePlan({...FREE_PLAN,deviceLimit:-1}).deviceLimit,-1)
})
test('expired paid device grants no longer increase the account device limit',async()=>{
  const db=fixture()
  db.rows.set('jahajiPlans/paid-plan',{...FREE_PLAN,deviceLimit:3})
  Object.assign(db.rows.get('jahajiDevices/computer-1'),{uid:'customer',planId:'paid-plan',planExpiresAt:Date.now()-1})
  assert.equal((await db.runTransaction(tx=>accountSlots(tx,db,'customer',{}))).limit,1)
})
