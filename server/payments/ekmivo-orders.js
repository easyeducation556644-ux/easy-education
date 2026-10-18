import {createHash,randomUUID} from 'node:crypto';
import {getAdminServices,requireAuthenticatedUser} from '../../api/utils/firebase-admin.js';
import {processPaymentAndEnrollUser} from '../../api/utils/process-payment.js';
import {publishEnrollmentSync} from '../../api/_sync-event.js';
import {ekmivoRequest,httpsOrigin,minorUnits,paymentError,assertCompleted,uuidPattern} from './ekmivo-contract.js';

async function pricedCart(db,metadata,user){
 const requested=metadata?.courses;if(!Array.isArray(requested)||!requested.length||requested.length>50)throw paymentError('Select between 1 and 50 courses.');
 const ids=requested.map(c=>c.id);if(ids.some(id=>typeof id!=='string'||!id||id.includes('/'))||new Set(ids).size!==ids.length)throw paymentError('Invalid course selection.');
 const courses=await Promise.all(requested.map(async item=>{
  const doc=await db.collection('courses').doc(item.id).get();if(!doc.exists)throw paymentError('A selected course is unavailable.');const c=doc.data();
  const options=(c.purchaseOptions||[]).filter(o=>o?.id&&o?.label&&Number.isFinite(Number(o.price)));
  const option=options.length?options.find(o=>o.id===item.purchaseOption?.id):null;if(options.length&&!option)throw paymentError('Select a valid purchase option.');
  const price=minorUnits(option?option.price:c.price||0);
  return {id:item.id,title:c.title||'Course',price:price/100,purchaseOption:option?{id:option.id,label:option.label,price:price/100}:null,courseFormat:c.courseFormat||'regular',bundledCourses:(c.bundledCourses||[]).map(x=>typeof x==='string'?x:x.id).filter(Boolean)};
 }));
 const enrolled=await db.collection('userCourses').where('userId','==',user.uid).get(),owned=new Set(enrolled.docs.map(d=>d.data().courseId));if(ids.some(id=>owned.has(id)))throw paymentError('A selected course is already purchased.');
 const subtotal=courses.reduce((n,c)=>n+minorUnits(c.price),0);let discount=0;const code=String(metadata?.couponCode||'').trim();
 if(code){
  const matches=await db.collection('coupons').where('code','==',code).limit(1).get(),coupon=matches.docs[0]?.data();
  if(!coupon?.active||coupon.expiryDate&&coupon.expiryDate.toDate()<=new Date())throw paymentError('Coupon is invalid or expired.');
  if(coupon.minCartValue&&subtotal<minorUnits(coupon.minCartValue))throw paymentError('Coupon minimum cart value not met.');
  if(coupon.couponType==='unique'){
   if(coupon.specificUsers?.length&&!coupon.specificUsers.some(x=>x===user.uid||x===user.email))throw paymentError('Coupon is not available for this account.');
   if(coupon.requiredPurchasedCourses?.some(id=>!owned.has(id))||owned.size<(coupon.minCoursePurchaseCount||0))throw paymentError('Coupon purchase requirements not met.');
  }
  const eligible=courses.filter(c=>!coupon.applicableCourses?.length||coupon.applicableCourses.includes(c.id)).reduce((n,c)=>n+minorUnits(c.price),0);if(!eligible)throw paymentError('Coupon does not apply to this cart.');
  discount=coupon.discountType==='percentage'?Math.min(eligible,Math.round(eligible*Math.max(0,Number(coupon.discountPercent)||0)/100)):Math.min(eligible,minorUnits(coupon.discountAmount||0));
 }
 return {courses,subtotal:subtotal/100,discount:discount/100,couponCode:code,amountMinor:subtotal-discount};
}
export async function createOrder(req){
 const {db,decodedToken:user}=await requireAuthenticatedUser(req),body=req.body||{},key=String(req.headers['idempotency-key']||'');
 if(!/^[A-Za-z0-9_.:-]{16,128}$/.test(key))throw paymentError('A stable Idempotency-Key is required.');
 const app=httpsOrigin(process.env.PUBLIC_APP_URL),mobile=String(body.metadata?.mobileNumber||'');if(!/^(?:88)?01[3-9]\d{8}$/.test(mobile))throw paymentError('A valid mobile number is required.');
 const id=createHash('sha256').update(user.uid+':'+key).digest('hex'),ref=db.collection('ekmivoOrders').doc(id),fingerprint=createHash('sha256').update(JSON.stringify({fullname:body.fullname,email:body.email,amount:body.amount,metadata:body.metadata})).digest('hex');
 const saved=await ref.get();let order=saved.exists?saved.data():null;
 if(order&&order.fingerprint!==fingerprint)throw paymentError('The cart changed. Start a new payment attempt.',409);
 if(!order){
  const cart=await pricedCart(db,body.metadata,user);if(cart.amountMinor<=0||cart.amountMinor!==minorUnits(body.amount))throw paymentError('The cart price changed. Refresh checkout.');
  const payload={amount:cart.amountMinor/100,reference:id,redirect_url:`${app}/checkout-complete?order_id=${id}`,cancel_url:`${app}/payment-cancel?order_id=${id}`,customer_name:String(body.fullname||'').slice(0,120),customer_email:user.email||'',customer_phone:mobile,metadata:{order_id:id}};
  if(process.env.EKMIVO_WEBHOOK_SECRET)payload.webhook_url=`${app}/api/payment-webhook`;
  order={id,userId:user.uid,userName:payload.customer_name,userEmail:user.email||'',mobileNumber:mobile,...cart,currency:'BDT',fingerprint,idempotencyKey:key,payload,status:'pending',createdAt:Date.now()};
  try{await ref.create(order);}catch(e){if(e.code!==6)throw e;order=(await ref.get()).data();if(order.fingerprint!==fingerprint)throw paymentError('The cart changed. Start a new payment attempt.',409);}
 }
 if(order.invoiceId)return {success:true,payment_url:order.paymentUrl,invoice_id:order.invoiceId,order_id:id};
 const lease=randomUUID();await db.runTransaction(async tx=>{const current=(await tx.get(ref)).data();if(current.createLeaseUntil>Date.now())throw paymentError('Payment creation is in progress. Retry shortly.',409);tx.update(ref,{createLease:lease,createLeaseUntil:Date.now()+60000});});
 try{
  const result=await ekmivoRequest('/v1/payment/create',order.payload,order.idempotencyKey);let target;try{target=new URL(result.payment_url);}catch{throw paymentError('Invalid payment URL from gateway.',502);}
  if(!uuidPattern.test(result.invoice_id)||target.protocol!=='https:'||target.username||target.password)throw paymentError('Invalid payment response.',502);
  await ref.update({invoiceId:result.invoice_id,paymentUrl:result.payment_url,createLeaseUntil:0});
  return {success:true,payment_url:result.payment_url,invoice_id:result.invoice_id,order_id:id};
 }finally{await db.runTransaction(async tx=>{const current=(await tx.get(ref)).data();if(current.createLease===lease)tx.update(ref,{createLeaseUntil:0});});}
}
export async function confirmOrder(db,orderId,userId){
 if(!/^[a-f0-9]{64}$/.test(orderId||''))throw paymentError('Invalid order.');
 const ref=db.collection('ekmivoOrders').doc(orderId),snapshot=await ref.get();if(!snapshot.exists)throw paymentError('Order not found.',404);const order=snapshot.data();
 if(userId&&order.userId!==userId)throw paymentError('This order belongs to another account.',403);
 if(!order.invoiceId)throw paymentError('Payment creation is not confirmed.',409);
 const payment=await ekmivoRequest('/v1/payment/verify',{invoice_id:order.invoiceId});assertCompleted(payment,order);
 const lease=randomUUID();const done=await db.runTransaction(async tx=>{const current=(await tx.get(ref)).data();if(current.status==='fulfilled')return true;if(current.fulfilLeaseUntil>Date.now())throw paymentError('Enrollment is in progress. Retry shortly.',503);tx.update(ref,{fulfilLease:lease,fulfilLeaseUntil:Date.now()+120000});return false;});
 let result={success:true,alreadyProcessed:true};
 if(!done){try{
  result=await processPaymentAndEnrollUser({...order,transactionId:order.invoiceId,invoiceId:order.invoiceId,trxId:order.invoiceId,paymentMethod:'Ekmivo',paymentGateway:'Ekmivo',finalAmount:order.amountMinor/100});
  if(!result.success)throw paymentError('Enrollment could not be completed. Retry shortly.',503);
  await ref.update({status:'fulfilled',fulfilledAt:Date.now(),fulfilLeaseUntil:0});
  try{await publishEnrollmentSync({db,userId:order.userId,transactionId:order.invoiceId,enrolledCourseIds:result.enrollmentDetails?.enrolledCourses||order.courses.map(c=>c.id)});}catch{console.error('Enrollment cache sync pending');}
 }finally{await db.runTransaction(async tx=>{const current=(await tx.get(ref)).data();if(current.fulfilLease===lease)tx.update(ref,{fulfilLeaseUntil:0});});}}
 return {success:true,verified:true,alreadyProcessed:result.alreadyProcessed,paymentRecord:result.paymentRecord,payment:{transaction_id:order.invoiceId,invoice_id:order.invoiceId,amount:order.amountMinor/100,currency:'BDT',metadata:{courses:order.courses}},enrollmentDetails:result.enrollmentDetails};
}
export async function confirmForUser(req){const {db,decodedToken}=await requireAuthenticatedUser(req);return confirmOrder(db,req.body?.order_id,decodedToken.uid);}
export async function confirmEvent(event){
 const {db}=getAdminServices(),ref=db.collection('ekmivoWebhookEvents').doc(event.id);
 try{await ref.create({invoiceId:event.invoice_id,status:'received',receivedAt:Date.now()});}catch(e){if(e.code!==6)throw e;const old=(await ref.get()).data();if(old.invoiceId!==event.invoice_id)throw paymentError('Event does not match invoice.',409);if(old.status==='processed')return;}
 const orders=await db.collection('ekmivoOrders').where('invoiceId','==',event.invoice_id).limit(1).get();if(orders.empty)throw paymentError('Order mapping unavailable. Retry later.',503);
 await confirmOrder(db,orders.docs[0].id);await ref.update({status:'processed',processedAt:Date.now()});
}

export async function validateFreeOrder(req){
 const {db,decodedToken:user}=await requireAuthenticatedUser(req);
 if(req.body?.userId!==user.uid)throw paymentError('Enrollment belongs to another account.',403);
 const cart=await pricedCart(db,{courses:req.body.courses,couponCode:req.body.couponCode},user);
 if(cart.amountMinor!==0)throw paymentError('This cart requires a verified payment.',403);
 return cart;
}
