/**
 * RupantorPay Payment Webhook Handler
 * Receives payment notifications from RupantorPay and processes enrollment
 * Official Docs: https://rupantorpay.com/developers/docs
 * 
 * CRITICAL FIXES according to official documentation:
 * 1. Webhook receives: transactionId, paymentMethod, paymentAmount, paymentFee, currency, status
 * 2. Status can be: PENDING, COMPLETED, or ERROR
 * 3. Must verify payment with API before processing
 */

import { processPaymentAndEnrollUser } from './utils/process-payment.js';

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

  try {
    const webhookData = req.body;
    
    console.log('RupantorPay webhook received:', {
      transactionId: webhookData.transactionId,
      status: webhookData.status,
      paymentAmount: webhookData.paymentAmount,
      paymentMethod: webhookData.paymentMethod
    });

    // Only process completed payments
    if (webhookData.status !== 'COMPLETED') {
      console.log(`Webhook received with status: ${webhookData.status}, not processing`);
      return res.status(200).json({ 
        success: true, 
        message: "Webhook received but payment not completed" 
      });
    }

    const transactionId = webhookData.transactionId;
    
    if (!transactionId) {
      console.error('❌ No transaction ID in webhook data');
      return res.status(400).json({
        success: false,
        error: "No transaction ID in webhook data"
      });
    }

    // Verify payment with RupantorPay to prevent fraud
    const verifyResponse = await fetch(VERIFY_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-KEY': RUPANTORPAY_API_KEY
      },
      body: JSON.stringify({ transaction_id: transactionId })
    });

    const paymentData = await verifyResponse.json();

    if (paymentData.status !== 'COMPLETED') {
      console.log('Payment verification failed or not completed:', paymentData.status);
      return res.status(200).json({ 
        success: true, 
        message: "Webhook received but payment not completed" 
      });
    }

    console.log('✅ Webhook - Payment verified successfully!');
    console.log('Transaction ID:', paymentData.transaction_id);
    console.log('Amount:', paymentData.amount);

    // Parse metadata - may be JSON string or object
    let metadata = {};
    if (paymentData.metadata) {
      if (typeof paymentData.metadata === 'string') {
        try {
          metadata = JSON.parse(paymentData.metadata);
          console.log('✅ Webhook - Metadata parsed from string');
        } catch (e) {
          console.error('❌ Webhook - Failed to parse metadata:', e);
          console.error('Raw metadata:', paymentData.metadata);
        }
      } else if (typeof paymentData.metadata === 'object') {
        metadata = paymentData.metadata;
        console.log('✅ Webhook - Metadata is already object');
      }
    }

    console.log('Webhook - Parsed metadata:', metadata);

    const courses = metadata.courses || [];
    const userId = metadata.userId;

    if (!userId) {
      console.error('❌ No userId in payment metadata:', metadata);
      return res.status(200).json({ 
        success: true, 
        message: "Webhook received but no user ID in metadata" 
      });
    }

    // Process payment and enroll user in courses
    const result = await processPaymentAndEnrollUser({
      userId,
      userName: paymentData.fullname || metadata.fullname || 'N/A',
      userEmail: paymentData.email || metadata.email,
      transactionId: paymentData.transaction_id,
      invoiceId: paymentData.transaction_id,
      trxId: paymentData.trx_id || paymentData.transaction_id,
      paymentMethod: paymentData.payment_method || webhookData.paymentMethod || 'N/A',
      courses,
      subtotal: parseFloat(metadata.subtotal || paymentData.amount),
      discount: parseFloat(metadata.discount || 0),
      couponCode: metadata.couponCode || '',
      finalAmount: parseFloat(paymentData.amount),
      currency: paymentData.currency || 'BDT'
    });

    if (result.success) {
      console.log('Webhook processed successfully:', result.message);
      return res.status(200).json({ 
        success: true, 
        message: result.message,
        alreadyProcessed: result.alreadyProcessed 
      });
    } else {
      console.error('Error processing webhook payment:', result.error);
      return res.status(500).json({
        success: false,
        error: result.error
      });
    }

  } catch (error) {
    console.error("Error processing webhook:", error);
    return res.status(500).json({
      success: false,
      error: "Failed to process webhook"
    });
  }
}