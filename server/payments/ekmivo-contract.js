// Contract source: https://ekmivo-web.vercel.app/developers (public docs only).
import {createHmac,timingSafeEqual} from 'node:crypto';
export const uuidPattern=/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;
export function paymentError(message,statusCode=400){return Object.assign(new Error(message),{statusCode});}
export function httpsOrigin(value){let url;try{url=new URL(value);}catch{throw paymentError('Payment service configuration is missing.',503);}if(url.protocol!=='https:'||url.username||url.password||url.pathname!=='/'||url.search||url.hash)throw paymentError('A public HTTPS origin is required.',503);return url.origin;}
export function minorUnits(value){const text=String(value);if(!/^\d+(?:\.\d{1,2})?$/.test(text))throw paymentError('Invalid payment amount.');const [whole,fraction='']=text.split('.');const n=Number(whole)*100+Number(fraction.padEnd(2,'0'));if(!Number.isSafeInteger(n))throw paymentError('Invalid payment amount.');return n;}
export async function ekmivoRequest(path,payload,idempotencyKey,{env=process.env,fetcher=fetch}={}){
 const origin=httpsOrigin(env.EKMIVO_API_ORIGIN),key=env.EKMIVO_API_KEY;
 if(!/^ek_(?:live|test)_/.test(key||''))throw paymentError('Payment service is not configured.',503);
 const response=await fetcher(new URL(path,origin),{method:'POST',headers:{Authorization:`Bearer ${key}`,'Content-Type':'application/json',...(idempotencyKey?{'Idempotency-Key':idempotencyKey}:{})},body:JSON.stringify(payload),redirect:'error',signal:AbortSignal.timeout(15000)});
 let data;try{data=await response.json();}catch{throw paymentError('Payment service returned an invalid response.',502);}
 if(!response.ok)throw paymentError('Payment service could not confirm the request. Please retry.',response.status===429?429:502);
 return data;
}
export function assertCompleted(payment,order){
 if(payment.invoice_id!==order.invoiceId)throw paymentError('Payment does not match this order.',409);
 if(payment.status!=='COMPLETED')throw paymentError(`Payment is ${['PENDING','FAILED','EXPIRED','CANCELLED','REFUNDED'].includes(payment.status)?payment.status:'unconfirmed'}.`,409);
 if(!Number.isSafeInteger(payment.amount_minor)||payment.amount_minor!==order.amountMinor||payment.currency!=='BDT'||payment.reference!==order.id)throw paymentError('Payment amount, currency or reference does not match this order.',409);
}
export function verifyWebhook(raw,headers,secret,now=Date.now()){
 if(!secret)throw paymentError('Webhook is not configured.',503);
 const timestamp=String(headers['x-ekmivo-timestamp']||''),signature=String(headers['x-ekmivo-signature']||'');
 if(!/^\d+$/.test(timestamp)||Math.abs(now/1000-Number(timestamp))>300||!/^v1=[a-f0-9]{64}$/.test(signature))throw paymentError('Invalid webhook signature.',401);
 const expected=createHmac('sha256',secret).update(timestamp+'.').update(raw).digest();
 if(!timingSafeEqual(expected,Buffer.from(signature.slice(3),'hex')))throw paymentError('Invalid webhook signature.',401);
 let event;try{event=JSON.parse(raw.toString('utf8'));}catch{throw paymentError('Invalid webhook body.');}
 if(!uuidPattern.test(event.id)||event.id!==headers['x-ekmivo-event-id']||!uuidPattern.test(event.invoice_id)||event.type!=='payment.verified'||event.status!=='COMPLETED')throw paymentError('Invalid webhook event.');
 return event;
}
export async function readWebhookBody(req){
 const parsed=Object.getOwnPropertyDescriptor(req,'body')?.value;
 if(Buffer.isBuffer(parsed)){if(parsed.length>65536)throw paymentError('Webhook body too large.',413);return parsed;}
 const chunks=[];let size=0;for await(const chunk of req){const b=Buffer.from(chunk);size+=b.length;if(size>65536)throw paymentError('Webhook body too large.',413);chunks.push(b);}if(!size)throw paymentError('Raw webhook body is required.');return Buffer.concat(chunks);
}
