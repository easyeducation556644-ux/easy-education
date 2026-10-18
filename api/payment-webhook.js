import {readWebhookBody,verifyWebhook} from '../server/payments/ekmivo-contract.js';
import {confirmEvent} from '../server/payments/ekmivo-orders.js';
export const config={api:{bodyParser:false}};
export default async function handler(req,res){
 if(req.method!=='POST'){res.setHeader('Allow','POST');return res.status(405).json({success:false,error:'Method Not Allowed'});}
 try{const event=verifyWebhook(await readWebhookBody(req),req.headers,process.env.EKMIVO_WEBHOOK_SECRET);await confirmEvent(event);return res.status(200).json({success:true});}
 catch(e){console.error('Ekmivo webhook unconfirmed:',e.statusCode||503);return res.status(e.statusCode||503).json({success:false,error:e.statusCode?e.message:'Webhook processing is unconfirmed. Retry.'});}
}
