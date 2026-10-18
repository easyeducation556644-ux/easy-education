import {createOrder} from '../payments/ekmivo-orders.js';
export default async function handler(req,res){
 if(req.method!=='POST'){res.setHeader('Allow','POST');return res.status(405).json({success:false,error:'Method Not Allowed'});}
 try{return res.status(200).json(await createOrder(req));}catch(e){console.error('Ekmivo payment creation failed:',e.statusCode||500);return res.status(e.statusCode||500).json({success:false,error:e.statusCode?e.message:'Payment creation is unconfirmed. Retry with the same cart.'});}
}
