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
import { getAdminServices, isFullAdminProfile, requireAuthenticatedUser } from './utils/firebase-admin.js';
import { publishEnrollmentSync } from './_sync-event.js';

const RUPANTORPAY_API_KEY = process.env.RUPANTORPAY_API_KEY;
const VERIFY_API_URL = 'https://payment.rupantorpay.com/api/payment/verify-payment';
const MAX_MANUAL_GRANT_COURSES = 50;
const LIMITED_ADMIN_ROLES = new Set([
  'class_pdf_admin',
  'exam_create_admin',
  'class_exam_admin',
  'users_admin',
  'staff_admin',
]);

function canGrantCourseAccess(userProfile = {}) {
  if (isFullAdminProfile(userProfile)) return true;
  const limitedAdmin =
    LIMITED_ADMIN_ROLES.has(userProfile?.role) ||
    (userProfile?.role === 'admin' && userProfile?.adminAccess?.mode === 'limited');
  return limitedAdmin && userProfile?.adminAccess?.manageUsers === true;
}

function cleanId(value) {
  return typeof value === 'string' ? value.trim() : '';
}

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
    // Enrollment has already succeeded. Cache invalidation is best-effort and can be
    // republished by another successful verification/webhook call using stable IDs.
    console.error('Failed to publish enrollment cache sync:', error);
  }
}

async function handlePermissionedManualGrant(req, res) {
  const { decodedToken, userProfile, db } = await requireAuthenticatedUser(req);
  if (!canGrantCourseAccess(userProfile)) {
    return res.status(403).json({ success: false, error: 'Manage Users permission is required' });
  }

  const userId = cleanId(req.body?.userId);
  const courseIds = Array.isArray(req.body?.courseIds)
    ? [...new Set(req.body.courseIds.map(cleanId).filter(Boolean))]
    : [];

  if (!userId) {
    return res.status(400).json({ success: false, error: 'A target user is required' });
  }
  if (courseIds.length === 0) {
    return res.status(400).json({ success: false, error: 'Select at least one course' });
  }
  if (courseIds.length > MAX_MANUAL_GRANT_COURSES) {
    return res.status(400).json({
      success: false,
      error: `You can grant at most ${MAX_MANUAL_GRANT_COURSES} courses at once`,
    });
  }

  const targetUserSnapshot = await db.collection('users').doc(userId).get();
  if (!targetUserSnapshot.exists) {
    return res.status(404).json({ success: false, error: 'Target user was not found' });
  }
  const targetUser = targetUserSnapshot.data() || {};

  const courseRefs = courseIds.map((courseId) => db.collection('courses').doc(courseId));
  const courseSnapshots = await db.getAll(...courseRefs);
  const courses = courseSnapshots
    .filter((snapshot) => snapshot.exists)
    .map((snapshot) => {
      const data = snapshot.data() || {};
      return {
        id: snapshot.id,
        title: String(data.title || 'Untitled Course').slice(0, 180),
        price: Number(data.price || 0),
        courseFormat: data.courseFormat || 'single',
        bundledCourses: Array.isArray(data.bundledCourses) ? data.bundledCourses : [],
      };
    });

  if (courses.length !== courseIds.length) {
    return res.status(400).json({ success: false, error: 'One or more selected courses no longer exist' });
  }

  const transactionId = `MANUAL_${Date.now()}_${userId}_${decodedToken.uid}`;
  const result = await processPaymentAndEnrollUser({
    userId,
    userName: targetUser.name || targetUser.displayName || 'User',
    userEmail: targetUser.email || '',
    mobileNumber: targetUser.mobileNumber || targetUser.phone || '',
    transactionId,
    invoiceId: transactionId,
    trxId: transactionId,
    paymentMethod: 'Manual Grant by Admin',
    courses,
    subtotal: 0,
    discount: 0,
    couponCode: 'MANUAL_ADMIN_GRANT',
    finalAmount: 0,
    currency: 'BDT',
  });

  if (!result?.success) {
    return res.status(500).json({
      success: false,
      error: result?.error || 'Failed to grant course access',
      details: result?.details,
    });
  }

  await syncEnrollmentCache(userId, transactionId, result);
  return res.status(200).json({
    success: true,
    verified: true,
    message: 'Course access granted successfully',
    alreadyProcessed: result.alreadyProcessed,
    coursesEnrolled: courses.length,
    enrollmentDetails: result.enrollmentDetails,
  });
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST']);
    return res.status(405).json({
      success: false,
      error: "Method Not Allowed"
    });
  }

  if (req.body?.grantCourseAccessOnly === true) {
    try {
      return await handlePermissionedManualGrant(req, res);
    } catch (error) {
      console.error('Permissioned manual grant failed:', error);
      return res.status(error?.statusCode || 500).json({
        success: false,
        error: error?.message || 'Failed to grant course access',
      });
    }
  }

  const { transaction_id, userId, skipPaymentVerification, userName, userEmail, mobileNumber, courses: requestCourses, subtotal, discount, couponCode, finalAmount, paymentMethod } = req.body;

  if (!userId) {
    return res.status(400).json({
      success: false,
      error: "Missing userId in request body."
    });
  }

  if (skipPaymentVerification && finalAmount === 0) {
    try {
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
        currency: 'BDT'
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
            metadata: {
              userId,
              courses: requestCourses || []
            }
          }
        });
      } else {
        console.error('Enrollment failed:', result.error, result.details);
        return res.status(500).json({
          success: false,
          error: result.error || 'Enrollment failed',
          details: result.details
        });
      }
    } catch (error) {
      console.error("Error processing free enrollment:", error);
      console.error("Error stack:", error.stack);
      return res.status(500).json({
        success: false,
        error: "Failed to process free enrollment. Please try again.",
        details: error.message
      });
    }
  }

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
    const metadataMobileNumber = metadata.mobileNumber || '';

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
      currency: paymentData.currency || 'BDT'
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
          metadata: metadata
        }
      });
    } else {
      console.error('Enrollment failed:', result.error, result.details);
      return res.status(500).json({
        success: false,
        error: result.error || 'Enrollment failed',
        details: result.details
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