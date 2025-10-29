/**
 * Manual Payment Enrollment Processing
 * Used when webhook fails or for manual verification
 * Official Docs: https://rupantorpay.com/developers/docs
 * 
 * CRITICAL FIXES according to official documentation:
 * 1. Verify endpoint returns direct payment object (not wrapped)
 * 2. Status is string: "COMPLETED", "PENDING", or "ERROR"
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
  
  const { transaction_id, userId, skipPaymentVerification, userName, userEmail, courses: requestCourses, subtotal, discount, couponCode, finalAmount, paymentMethod } = req.body;
  
  if (!userId) {
    return res.status(400).json({
      success: false,
      error: "Missing userId in request body."
    });
  }
  
  // Handle free enrollment (100% discount coupon)
  if (skipPaymentVerification && finalAmount === 0) {
    try {
      console.log('Processing free enrollment for userId:', userId);
      
      const result = await processPaymentAndEnrollUser({
        userId,
        userName: userName || 'N/A',
        userEmail: userEmail || '',
        transactionId: transaction_id,
        invoiceId: transaction_id,
        trxId: transaction_id,
        paymentMethod: paymentMethod || 'Free Coupon',
        courses: requestCourses || [],
        subtotal: parseFloat(subtotal || 0),
        discount: parseFloat(discount || 0),
        couponCode: couponCode || '',
        finalAmount: 0,
        currency: 'BDT'
      });
      
      if (result.success) {
        return res.status(200).json({
          success: true,
          verified: true,
          message: 'Free enrollment successful',
          alreadyProcessed: result.alreadyProcessed,
          coursesEnrolled: requestCourses?.length || 0,
          payment: {
            transaction_id,
            amount: 0,
            metadata: {
              userId,
              courses: requestCourses || []
            }
          }
        });
      } else {
        return res.status(500).json({
          success: false,
          error: result.error
        });
      }
    } catch (error) {
      console.error("Error processing free enrollment:", error);
      return res.status(500).json({
        success: false,
        error: "Failed to process free enrollment. Please try again."
      });
    }
  }
  
  // Regular payment processing
  if (!transaction_id) {
    return res.status(400).json({
      success: false,
      error: "Missing transaction_id in request body."
    });
  }
  
  if (!RUPANTORPAY_API_KEY) {
    console.error("RUPANTORPAY_API_KEY is missing!");
    return res.status(500).json({
      success: false,
      error: "Server configuration error"
    });
  }
  
  try {
    console.log('Processing enrollment for transaction_id:', transaction_id, 'userId:', userId);
    
    // Verify payment with RupantorPay
    const verifyResponse = await fetch(VERIFY_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-KEY': RUPANTORPAY_API_KEY
      },
      body: JSON.stringify({ transaction_id })
    });
    
    const paymentData = await verifyResponse.json();
    console.log('RupantorPay verification response:', JSON.stringify(paymentData, null, 2));
    
    if (paymentData.status !== 'COMPLETED') {
      return res.status(400).json({
        success: false,
        verified: false,
        error: paymentData.message || "Payment verification failed or not completed"
      });
    }
    
    // Parse metadata - may be JSON string or object
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
    
    console.log('Parsed metadata:', metadata);
    
    const courses = metadata.courses || [];
    const metadataUserId = metadata.userId;
    
    // Validate user ID matches
    if (!metadataUserId) {
      return res.status(400).json({
        success: false,
        error: "No userId found in payment metadata. Please ensure metadata was sent during payment creation."
      });
    }
    
    if (metadataUserId !== userId) {
      return res.status(403).json({
        success: false,
        error: "User ID mismatch - this payment belongs to a different user"
      });
    }
    
    // Process enrollment
    const result = await processPaymentAndEnrollUser({
      userId: metadataUserId,
      userName: paymentData.fullname || metadata.fullname || 'N/A',
      userEmail: paymentData.email || metadata.email,
      transactionId: paymentData.transaction_id,
      invoiceId: paymentData.transaction_id,
      trxId: paymentData.trx_id || paymentData.transaction_id,
      paymentMethod: paymentData.payment_method || 'N/A',
      courses,
      subtotal: parseFloat(metadata.subtotal || paymentData.amount),
      discount: parseFloat(metadata.discount || 0),
      couponCode: metadata.couponCode || '',
      finalAmount: parseFloat(paymentData.amount),
      currency: paymentData.currency || 'BDT'
    });
    
    if (result.success) {
      return res.status(200).json({
        success: true,
        verified: true,
        message: result.message,
        alreadyProcessed: result.alreadyProcessed,
        coursesEnrolled: courses.length,
        payment: {
          transaction_id: paymentData.transaction_id,
          amount: paymentData.amount,
          metadata: metadata
        }
      });
    } else {
      return res.status(500).json({
        success: false,
        error: result.error
      });
    }
    
  } catch (error) {
    console.error("Error processing enrollment:", error);
    return res.status(500).json({
      success: false,
      error: "Failed to process enrollment. Please try again."
    });
  }
}