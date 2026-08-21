/**
 * RupantorPay Payment Creation API
 * Official Docs: https://rupantorpay.com/developers/docs
 */

const RUPANTORPAY_API_KEY = process.env.RUPANTORPAY_API_KEY;
const PAYMENT_API_URL = 'https://payment.rupantorpay.com/api/payment/checkout';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST']);
    return res.status(405).json({
      success: false,
      error: "Method Not Allowed"
    });
  }
  
  if (!RUPANTORPAY_API_KEY) {
    console.error("RUPANTORPAY_API_KEY is missing!");
    return res.status(500).json({
      success: false,
      error: "Server configuration error: Payment service key missing."
    });
  }
  
  const { fullname, email, amount, metadata } = req.body;
  
  console.log('📥 Received payment request:', { fullname, email, amount, metadata });
  
  if (!fullname || !email || !amount) {
    return res.status(400).json({
      success: false,
      error: "Missing required fields: fullname, email, and amount are required."
    });
  }
  
  const host = req.headers.host;
  const protocol = host?.includes('localhost') ? 'http' : 'https';
  const baseUrl = `${protocol}://${host}`;
  
  try {
    const paymentData = {
      fullname: fullname,
      email: email,
      amount: String(parseFloat(amount).toFixed(2)),
      // ✅ FIXED: Changed to /checkout-complete instead of /payment-success
      success_url: `${baseUrl}/checkout-complete`,
      cancel_url: `${baseUrl}/checkout`,
      webhook_url: `${baseUrl}/api/payment-webhook`,
      metadata: metadata || {}
    };
    
    console.log('Creating RupantorPay payment:', {
      fullname,
      email,
      amount: paymentData.amount,
      baseUrl,
      metadata: metadata
    });
    
    const response = await fetch(PAYMENT_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-KEY': RUPANTORPAY_API_KEY,
        'X-CLIENT': host || 'localhost'
      },
      body: JSON.stringify(paymentData)
    });
    
    const data = await response.json();
    console.log('RupantorPay create payment response:', JSON.stringify(data, null, 2));
    console.log('Response status code:', response.status);
    
    if ((data.status === 1 || data.status === true) && data.payment_url) {
      console.log('✅ Payment created successfully');
      console.log('Payment URL:', data.payment_url);
      
      return res.status(200).json({
        success: true,
        payment_url: data.payment_url,
        message: data.message || "Payment link created successfully"
      });
    } else {
      console.error('❌ RupantorPay error response:', data);
      
      return res.status(400).json({
        success: false,
        error: data.message || data.error || "Failed to create payment link"
      });
    }
  } catch (error) {
    console.error("Error creating payment:", error);
    return res.status(500).json({
      success: false,
      error: "Failed to process payment request. Please try again."
    });
  }
}