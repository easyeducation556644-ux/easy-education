/**
 * Manual Payment Enrollment Processing
 * Used when webhook fails or for manual verification.
 */

import { processPaymentAndEnrollUser } from './utils/process-payment.js';
import {
  getAdminServices,
  profileHasUserAction,
  profilePageCourseIds,
  requireAuthenticatedUser,
} from './utils/firebase-admin.js';
import { publishEnrollmentSync } from './_sync-event.js';

const RUPANTORPAY_API_KEY = process.env.RUPANTORPAY_API_KEY;
const VERIFY_API_URL = 'https://payment.rupantorpay.com/api/payment/verify-payment';

async function syncEnrollmentCache(userId, transactionId, result) {
  if (!result?.success) return;
  try {
    const { db } = getAdminServices();
    await publishEnrollmentSync({
      db,
      userId,
      transactionId,
      enrolledCourseIds: result.enrollmentDetails?.enrolledCourses || [],
    });
  } catch (error) {
    console.error('Failed to publish enrollment cache sync:', error);
  }
}

function isManualAdminGrant({ couponCode, paymentMethod }) {
  return couponCode === 'MANUAL_ADMIN_GRANT' || paymentMethod === 'Manual Grant by Admin';
}

async function authorizeManualAdminGrant(req, requestCourses) {
  const { userProfile } = await requireAuthenticatedUser(req);
  if (!profileHasUserAction(userProfile, 'grantCourseAccess')) {
    const error = new Error('You do not have permission to grant course access');
    error.statusCode = 403;
    throw error;
  }

  const allowedCourseIds = profilePageCourseIds(userProfile, 'users');
  if (allowedCourseIds !== null) {
    const allowed = new Set(allowedCourseIds);
    const denied = (requestCourses || [])
      .map((course) => course?.id || course?.courseId)
      .filter(Boolean)
      .filter((courseId) => !allowed.has(courseId));
    if (denied.length > 0) {
      const error = new Error('One or more selected courses are outside your assigned Users course scope');
      error.statusCode = 403;
      throw error;
    }
  }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST']);
    return res.status(405).json({ success: false, error: 'Method Not Allowed' });
  }

  const {
    transaction_id,
    userId,
    skipPaymentVerification,
    userName,
    userEmail,
    mobileNumber,
    courses: requestCourses,
    subtotal,
    discount,
    couponCode,
    finalAmount,
    paymentMethod,
  } = req.body;

  if (!userId) {
    return res.status(400).json({ success: false, error: 'Missing userId in request body.' });
  }

  if (skipPaymentVerification && finalAmount === 0) {
    try {
      if (isManualAdminGrant({ couponCode, paymentMethod })) {
        await authorizeManualAdminGrant(req, requestCourses || []);
      }

      console.log('Processing free enrollment for userId:', userId);
      const result = await processPaymentAndEnrollUser({
        userId,
        userName: userName || 'N/A',
        userEmail: userEmail || '',
        mobileNumber: mobileNumber || '',
        transactionId: transaction_id,
        invoiceId: transaction_id,
        trxId: transaction_id,
        paymentMethod: paymentMethod || 'Free Coupon',
        courses: requestCourses || [],
        subtotal: parseFloat(subtotal || 0),
        discount: parseFloat(discount || 0),
        couponCode: couponCode || '',
        finalAmount: 0,
        currency: 'BDT',
      });

      if (result.success) {
        await syncEnrollmentCache(userId, transaction_id, result);
        return res.status(200).json({
          success: true,
          verified: true,
          message: 'Free enrollment successful',
          alreadyProcessed: result.alreadyProcessed,
          coursesEnrolled: requestCourses?.length || 0,
          enrollmentDetails: result.enrollmentDetails,
          payment: {
            transaction_id,
            amount: 0,
            metadata: { userId, courses: requestCourses || [] },
          },
        });
      }

      console.error('Enrollment failed:', result.error, result.details);
      return res.status(500).json({
        success: false,
        error: result.error || 'Enrollment failed',
        details: result.details,
      });
    } catch (error) {
      console.error('Error processing free enrollment:', error);
      return res.status(error.statusCode || 500).json({
        success: false,
        error: error.statusCode ? error.message : 'Failed to process free enrollment. Please try again.',
        details: error.statusCode ? undefined : error.message,
      });
    }
  }

  if (!transaction_id) {
    return res.status(400).json({ success: false, error: 'Missing transaction_id in request body.' });
  }

  if (!RUPANTORPAY_API_KEY) {
    console.error('RUPANTORPAY_API_KEY is missing!');
    return res.status(500).json({ success: false, error: 'Server configuration error' });
  }

  try {
    console.log('Processing enrollment for transaction_id:', transaction_id, 'userId:', userId);
    const verifyResponse = await fetch(VERIFY_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-KEY': RUPANTORPAY_API_KEY,
      },
      body: JSON.stringify({ transaction_id }),
    });

    const paymentData = await verifyResponse.json();
    console.log('RupantorPay verification response:', JSON.stringify(paymentData, null, 2));

    if (paymentData.status !== 'COMPLETED') {
      return res.status(400).json({
        success: false,
        verified: false,
        error: paymentData.message || 'Payment verification failed or not completed',
      });
    }

    let metadata = {};
    if (paymentData.metadata) {
      if (typeof paymentData.metadata === 'string') {
        try {
          metadata = JSON.parse(paymentData.metadata);
        } catch (error) {
          console.error('Failed to parse payment metadata:', error);
        }
      } else if (typeof paymentData.metadata === 'object') {
        metadata = paymentData.metadata;
      }
    }

    const courses = metadata.courses || [];
    const metadataUserId = metadata.userId;
    const metadataMobileNumber = metadata.mobileNumber || '';

    if (!metadataUserId) {
      return res.status(400).json({
        success: false,
        error: 'No userId found in payment metadata. Please ensure metadata was sent during payment creation.',
      });
    }

    if (metadataUserId !== userId) {
      return res.status(403).json({ success: false, error: 'User ID mismatch - this payment belongs to a different user' });
    }

    const result = await processPaymentAndEnrollUser({
      userId: metadataUserId,
      userName: paymentData.fullname || metadata.fullname || 'N/A',
      userEmail: paymentData.email || metadata.email,
      mobileNumber: metadataMobileNumber,
      transactionId: paymentData.transaction_id,
      invoiceId: paymentData.transaction_id,
      trxId: paymentData.trx_id || paymentData.transaction_id,
      paymentMethod: paymentData.payment_method || 'N/A',
      courses,
      subtotal: parseFloat(metadata.subtotal || paymentData.amount),
      discount: parseFloat(metadata.discount || 0),
      couponCode: metadata.couponCode || '',
      finalAmount: parseFloat(paymentData.amount),
      currency: paymentData.currency || 'BDT',
    });

    if (result.success) {
      await syncEnrollmentCache(metadataUserId, paymentData.transaction_id, result);
      return res.status(200).json({
        success: true,
        verified: true,
        message: result.message,
        alreadyProcessed: result.alreadyProcessed,
        coursesEnrolled: courses.length,
        enrollmentDetails: result.enrollmentDetails,
        payment: {
          transaction_id: paymentData.transaction_id,
          amount: paymentData.amount,
          metadata,
        },
      });
    }

    console.error('Enrollment failed:', result.error, result.details);
    return res.status(500).json({
      success: false,
      error: result.error || 'Enrollment failed',
      details: result.details,
    });
  } catch (error) {
    console.error('Error processing enrollment:', error);
    return res.status(500).json({ success: false, error: 'Failed to process enrollment. Please try again.' });
  }
}
