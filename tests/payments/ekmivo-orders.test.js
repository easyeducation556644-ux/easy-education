import {test,mock} from 'node:test';import assert from 'node:assert/strict';
class DB{
 constructor(){this.rows=new Map();this.serial=Promise.resolve();}
 collection(name){const db=this;return {doc(id){const key=name+'/'+id;return {id,async get(){return {id,exists:db.rows.has(key),data:()=>structuredClone(db.rows.get(key))};},async create(v){if(db.rows.has(key))throw Object.assign(Error('exists'),{code:6});db.rows.set(key,structuredClone(v));},async update(v){db.rows.set(key,{...db.rows.get(key),...structuredClone(v)});}};},where(field,_,value){return {limit(){return this;},async get(){const docs=[...db.rows.entries()].filter(([k,v])=>k.startsWith(name+'/')&&v[field]===value).map(([k,v])=>({id:k.split('/')[1],data:()=>structuredClone(v)}));return {empty:!docs.length,docs};}};}};}
 async runTransaction(fn){const prior=this.serial;let done;this.serial=new Promise(r=>done=r);await prior;try{return await fn({get:r=>r.get(),update:(r,v)=>r.update(v)});}finally{done();}}
}
const db=new DB();let enrollmentCalls=0,failEnrollment=false;
mock.module('../../api/utils/firebase-admin.js',{namedExports:{getAdminServices:()=>({db}),requireAuthenticatedUser:async(req)=>{if(!req.headers.authorization)throw Object.assign(Error('auth'),{statusCode:401});return {db,decodedToken:{uid:req.headers.authorization,email:'user@example.test'}};}}});
mock.module('../../api/utils/process-payment.js',{namedExports:{processPaymentAndEnrollUser:async()=>{enrollmentCalls++;return {success:!failEnrollment};}}});
mock.module('../../api/_sync-event.js',{namedExports:{publishEnrollmentSync:async()=>{}}});
const {createOrder,confirmForUser,confirmEvent,validateFreeOrder}=await import('../../server/payments/ekmivo-orders.js');
const invoice='550e8400-e29b-41d4-a716-446655440000';
const env={EKMIVO_API_ORIGIN:process.env.EKMIVO_API_ORIGIN,EKMIVO_API_KEY:process.env.EKMIVO_API_KEY,PUBLIC_APP_URL:process.env.PUBLIC_APP_URL};
test('merchant flow: stored order, stable retries, authenticated ownership, mismatch rejection and duplicate callbacks',async()=>{
 Object.assign(process.env,{EKMIVO_API_ORIGIN:'https://api.example',EKMIVO_API_KEY:'ek_test_fixture',PUBLIC_APP_URL:'https://merchant.example'});
 const previous=globalThis.fetch;let verifiedAmount=10000,created=0,payload;
 globalThis.fetch=async(url,options)=>({ok:true,json:async()=>{if(url.pathname.endsWith('/create')){created++;payload=JSON.parse(options.body);return {invoice_id:invoice,status:'PENDING',payment_url:'https://checkout.example/checkout/token'};}return {invoice_id:invoice,status:'COMPLETED',amount_minor:verifiedAmount,currency:'BDT',reference:payload.reference};}});
 try{
  db.rows.set('courses/course1',{title:'Course',price:100});
  const req={headers:{authorization:'alice','idempotency-key':'stable-order-123456789'},body:{fullname:'Alice',email:'user@example.test',amount:'100.00',metadata:{mobileNumber:'8801712345678',courses:[{id:'course1'}]}}};
  const order=await createOrder(req);assert.ok(order.order_id);assert.equal(payload.amount,100);assert.equal(new URL(payload.redirect_url).searchParams.get('order_id'),order.order_id);assert.equal(payload.metadata.userId,undefined);
  assert.deepEqual(await createOrder(req),order);assert.equal(created,1);
  await assert.rejects(()=>createOrder({...req,body:{...req.body,amount:'1.00'}}),/cart changed/);
  await assert.rejects(()=>confirmForUser({headers:{authorization:'bob'},body:{order_id:order.order_id}}),/another account/);
  verifiedAmount=9999;await assert.rejects(()=>confirmForUser({headers:req.headers,body:{order_id:order.order_id}}),/does not match/);assert.equal(enrollmentCalls,0);
  verifiedAmount=10000;failEnrollment=true;await assert.rejects(()=>confirmForUser({headers:req.headers,body:{order_id:order.order_id}}),/Enrollment/);failEnrollment=false;
  const result=await confirmForUser({headers:req.headers,body:{order_id:order.order_id}});assert.equal(result.verified,true);const calls=enrollmentCalls;
  const event={id:'550e8400-e29b-41d4-a716-446655440001',invoice_id:invoice};await confirmEvent(event);await confirmEvent(event);assert.equal(enrollmentCalls,calls);
  await assert.rejects(()=>confirmEvent({...event,invoice_id:'550e8400-e29b-41d4-a716-446655440002'}),/does not match/);
  await assert.rejects(()=>validateFreeOrder({headers:req.headers,body:{userId:'alice',courses:[{id:'course1'}]}}),/requires a verified payment/);
 }finally{globalThis.fetch=previous;for(const [k,v]of Object.entries(env)){if(v===undefined)delete process.env[k];else process.env[k]=v;}}
});
