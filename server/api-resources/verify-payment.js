import {confirmForUser} from '../payments/ekmivo-orders.js';
export default async function handler(req,res){
 if(req.method!=='POST'){res.setHeader('Allow','POST');return res.status(405).json({success:false,error:'Method Not Allowed'});}
 try{return res.status(200).json(await confirmForUser(req));}catch(e){return res.status(e.statusCode||500).json({success:false,verified:false,error:e.statusCode?e.message:'Payment verification is unavailable. Retry.'});}
}
