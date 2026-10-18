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

import {confirmForUser,validateFreeOrder} from '../server/payments/ekmivo-orders.js';

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
      let freeCart = null;
      if (isManualAdminGrant({ couponCode, paymentMethod })) {
        await authorizeManualAdminGrant(req, requestCourses || []);
      } else {
        freeCart = await validateFreeOrder(req);
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
        courses: freeCart?.courses || requestCourses || [],
        subtotal: freeCart?.subtotal ?? parseFloat(subtotal || 0),
        discount: freeCart?.discount ?? parseFloat(discount || 0),
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

  try {
    return res.status(200).json(await confirmForUser(req));
  } catch (error) {
    return res.status(error.statusCode || 500).json({success:false,verified:false,error:error.statusCode ? error.message : 'Payment verification is unavailable. Retry.'});
  }
}
