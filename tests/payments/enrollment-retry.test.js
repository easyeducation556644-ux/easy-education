import {test,mock} from 'node:test';import assert from 'node:assert/strict';
const rows=new Map([['courses/c1',{title:'Course 1',price:100}]]);let failure=true,counter=0;
const snapshot=(key)=>({id:key.split('/')[1],exists:rows.has(key),data:()=>rows.get(key)});
function collection(name,filters=[]){return {
 doc(id=String(++counter)){const key=name+'/'+id;return {key,id,async get(){return snapshot(key);},async set(value){rows.set(key,{...rows.get(key),...value});}};},
 where(f,op,v){return collection(name,[...filters,[f,v]]);},limit(){return this;},
 async get(){const docs=[...rows.keys()].filter(k=>k.startsWith(name+'/')&&filters.every(([f,v])=>rows.get(k)[f]===v)).map(snapshot);return {empty:docs.length===0,docs};},
 async add(v){const r=this.doc();await r.set(v);return r;}
};}
const db={collection,batch(){const operations=[];return {set(ref,value){operations.push([ref,value]);},update(ref,value){operations.push([ref,value]);},async commit(){if(failure)throw Error('injected enrollment write failure');for(const[r,v]of operations)await r.set(v);}};}};
mock.module('firebase-admin/app',{namedExports:{initializeApp:()=>{},getApps:()=>[{}],cert:()=>{},applicationDefault:()=>{}}});
mock.module('firebase-admin/firestore',{namedExports:{getFirestore:()=>db,FieldValue:{serverTimestamp:()=> 'timestamp'}}});
mock.module('firebase-admin/messaging',{namedExports:{getMessaging:()=>({})}});
mock.module('../../api/utils/send-sms.js',{namedExports:{sendEnrollmentSMS:async()=>({success:true})}});
const {processPaymentAndEnrollUser}=await import('../../api/utils/process-payment.js');
test('Ekmivo enrollment retries an interrupted batch and approves only with durable course access',async()=>{
 const p={paymentGateway:'Ekmivo',transactionId:'550e8400-e29b-41d4-a716-446655440000',invoiceId:'550e8400-e29b-41d4-a716-446655440000',userId:'alice',userName:'Alice',userEmail:'a@example.test',courses:[{id:'c1',title:'Course 1'}],finalAmount:100,currency:'BDT'};
 assert.equal((await processPaymentAndEnrollUser(p)).success,false);
 assert.equal(rows.get('payments/ekmivo_'+p.transactionId).status,'processing');assert.equal(rows.has('userCourses/alice_c1'),false);
 failure=false;assert.equal((await processPaymentAndEnrollUser(p)).success,true);
 assert.equal(rows.get('payments/ekmivo_'+p.transactionId).status,'approved');assert.ok(rows.has('userCourses/alice_c1'));
 assert.equal((await processPaymentAndEnrollUser(p)).alreadyProcessed,true);
 assert.equal([...rows.keys()].filter(k=>k.startsWith('payments/')).length,1);
});
