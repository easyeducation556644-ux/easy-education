/**
 * RupantorPay Payment Verification API
 * Verifies payment status using transaction_id
 * Official Docs: https://rupantorpay.com/developers/docs
 * 
 * CRITICAL FIXES according to official documentation:
 * 1. Correct endpoint: /api/payment/verify-payment
 * 2. Response format: returns payment details directly (not wrapped in data object)
 * 3. Status is string: "COMPLETED", "PENDING", or "ERROR"
 */

const RUPANTORPAY_API_KEY = process.env.RUPANTORPAY_API_KEY;
const VERIFY_API_URL = 'https://payment.rupantorpay.com/api/payment/verify-payment';

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

  const { transaction_id } = req.body;

  if (!transaction_id) {
    return res.status(400).json({ 
      success: false, 
      error: "Missing transaction_id in request body." 
    });
  }

  try {
    console.log('Verifying payment with transaction_id:', transaction_id);
    
    const response = await fetch(VERIFY_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-KEY': RUPANTORPAY_API_KEY
      },
      body: JSON.stringify({ 
        transaction_id: transaction_id
      })
    });

    const paymentData = await response.json();
    
    console.log('RupantorPay verification response:', JSON.stringify(paymentData, null, 2));
    console.log('Response status code:', response.status);

    // According to docs: response is direct object with status field
    if (paymentData.status === 'COMPLETED') {
      // Parse metadata if it's a JSON string
      let metadata = {};
      if (paymentData.metadata) {
        if (typeof paymentData.metadata === 'string') {
          try {
            metadata = JSON.parse(paymentData.metadata);
            console.log('✅ Metadata parsed from string');
          } catch (e) {
            console.error('❌ Failed to parse metadata:', e);
            console.error('Raw metadata:', paymentData.metadata);
          }
        } else if (typeof paymentData.metadata === 'object') {
          metadata = paymentData.metadata;
          console.log('✅ Metadata is already object');
        }
      }

      console.log('✅ Payment verified successfully!');
      console.log('Transaction ID:', paymentData.transaction_id);
      console.log('Amount:', paymentData.amount);
      console.log('Parsed metadata:', metadata);

      return res.status(200).json({
        success: true,
        verified: true,
        payment: {
          fullname: paymentData.fullname || 'N/A',
          email: paymentData.email || 'N/A',
          amount: paymentData.amount,
          transaction_id: paymentData.transaction_id,
          trx_id: paymentData.trx_id,
          status: paymentData.status,
          payment_method: paymentData.payment_method || 'N/A',
          currency: paymentData.currency || 'BDT',
          metadata: metadata
        }
      });
    } else if (paymentData.status === 'PENDING') {
      return res.status(200).json({
        success: true,
        verified: false,
        status: 'pending',
        message: "Payment is still pending"
      });
    } else if (paymentData.status === 'ERROR' || paymentData.status === false) {
      console.error('❌ Payment verification failed');
      return res.status(400).json({
        success: false,
        verified: false,
        error: paymentData.message || "Payment verification failed"
      });
    } else {
      // Unexpected status
      console.error('❌ Unexpected status:', paymentData.status);
      return res.status(400).json({
        success: false,
        verified: false,
        error: "Unexpected payment status"
      });
    }
  } catch (error) {
    console.error("Error verifying payment:", error);
    return res.status(500).json({
      success: false,
      error: "Failed to verify payment. Please try again."
    });
  }
}