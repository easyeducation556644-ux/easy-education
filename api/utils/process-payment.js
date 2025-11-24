import { initializeApp, getApps, cert, applicationDefault } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { getMessaging } from 'firebase-admin/messaging';

let db;
let messaging;

function initializeFirebase() {
  if (getApps().length === 0) {
    const serviceAccount = process.env.FIREBASE_SERVICE_ACCOUNT 
      ? JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT)
      : null;

    if (serviceAccount) {
      initializeApp({
        credential: cert(serviceAccount)
      });
    } else {
      try {
        // Try to use Application Default Credentials (ADC)
        initializeApp({
          credential: applicationDefault(),
          projectId: 'easy-educat'
        });
      } catch (error) {
        // If ADC is not available, initialize with project ID only
        // This will work for Firestore operations in some environments
        console.warn('Firebase Admin SDK initialized with limited credentials. Some operations may fail.');
        initializeApp({
          projectId: 'easy-educat'
        });
      }
    }
  }
  db = getFirestore();
  try {
    messaging = getMessaging();
  } catch (error) {
    console.warn('Firebase Messaging not initialized:', error.message);
  }
}

async function notifyAdminsOfEnrollment(enrollmentData) {
  if (!db) {
    initializeFirebase();
  }
  
  try {
    const adminTokensSnapshot = await db
      .collection('adminTokens')
      .where('role', '==', 'admin')
      .get();
    
    if (adminTokensSnapshot.empty) {
      console.log('No admin tokens found for notification');
      return;
    }

    const tokens = adminTokensSnapshot.docs
      .map(doc => doc.data().token)
      .filter(Boolean);
    
    if (tokens.length === 0) {
      console.log('No valid admin tokens for notification');
      return;
    }

    const courseNames = enrollmentData.courses?.map(c => c.title).join(', ') || 'N/A';
    const coursesText = enrollmentData.courses?.length > 1 
      ? `${enrollmentData.courses.length} courses` 
      : enrollmentData.courses?.[0]?.title || 'Unknown Course';
    
    const isFree = enrollmentData.isFreeEnrollment || enrollmentData.finalAmount === 0;

    const message = {
      notification: {
        title: isFree ? 'New Free Enrollment 🎓' : 'New Course Enrollment 💰',
        body: `${enrollmentData.userName || 'A user'} enrolled in ${coursesText}${isFree ? ' (Free)' : ` for ৳${enrollmentData.finalAmount}`}. Click to view details.`,
      },
      data: {
        url: '/admin/payments',
        userId: enrollmentData.userId || '',
        type: 'enrollment',
        userName: enrollmentData.userName || '',
        userEmail: enrollmentData.userEmail || '',
        courses: courseNames,
        isFree: String(isFree)
      },
      tokens: tokens
    };

    if (messaging) {
      const response = await messaging.sendEachForMulticast(message);
      console.log(`Admin enrollment notification sent successfully to ${response.successCount}/${tokens.length} admin(s)`);
      
      if (response.failureCount > 0) {
        console.log('Failed tokens:', response.responses.filter(r => !r.success).map((r, i) => ({ token: tokens[i], error: r.error })));
      }
    } else {
      console.log('Firebase Messaging not available, skipping admin notification');
    }
  } catch (error) {
    console.error('Error notifying admins of enrollment:', error);
  }
}

export async function processPaymentAndEnrollUser(paymentData) {
  if (!db) {
    initializeFirebase();
  }

  const {
    userId,
    userName,
    userEmail,
    transactionId,
    trxId,
    paymentMethod,
    courses,
    subtotal,
    discount,
    couponCode,
    finalAmount,
    currency
  } = paymentData;

  try {
    const existingPaymentQuery = await db
      .collection('payments')
      .where('transactionId', '==', transactionId)
      .where('status', '==', 'approved')
      .limit(1)
      .get();

    if (!existingPaymentQuery.empty) {
      console.log(`Payment ${transactionId} already processed`);
      return {
        success: true,
        alreadyProcessed: true,
        message: 'Payment already processed'
      };
    }

    const paymentRecord = {
      userId,
      userName,
      userEmail,
      transactionId,
      invoiceId: paymentData.invoiceId || transactionId,
      trxId: trxId || transactionId,
      paymentMethod: paymentMethod || 'ZiniPay',
      courses: courses || [],
      subtotal: parseFloat(subtotal || finalAmount),
      discount: parseFloat(discount || 0),
      couponCode: couponCode || '',
      finalAmount: parseFloat(finalAmount),
      status: 'approved',
      submittedAt: FieldValue.serverTimestamp(),
      approvedAt: FieldValue.serverTimestamp(),
      paymentGateway: 'ZiniPay',
      currency: currency || 'BDT'
    };

    const paymentDocRef = await db.collection('payments').add(paymentRecord);
    const paymentId = paymentDocRef.id;

    if (courses && courses.length > 0) {
      const batch = db.batch();
      const coursesToEnrollMap = new Map();
      
      for (const course of courses) {
        try {
          const courseDoc = await db.collection('courses').doc(course.id).get();
          if (courseDoc.exists()) {
            const courseData = courseDoc.data();
            
            if (courseData.courseFormat === 'bundle' && courseData.bundledCourses && courseData.bundledCourses.length > 0) {
              console.log(`Course ${course.id} is a bundle, adding bundled courses:`, courseData.bundledCourses);
              courseData.bundledCourses.forEach(bundledCourseId => {
                coursesToEnrollMap.set(bundledCourseId, {
                  courseId: bundledCourseId,
                  bundleId: course.id
                });
              });
            } else {
              coursesToEnrollMap.set(course.id, {
                courseId: course.id,
                bundleId: null
              });
            }
          }
        } catch (error) {
          console.error(`Error fetching course ${course.id} for bundle check:`, error);
          coursesToEnrollMap.set(course.id, {
            courseId: course.id,
            bundleId: null
          });
        }
      }
      
      for (const [courseId, enrollmentData] of coursesToEnrollMap) {
        const userCourseRef = db.collection('userCourses').doc(`${userId}_${courseId}`);
        const userCourseData = {
          userId,
          courseId: enrollmentData.courseId,
          enrolledAt: FieldValue.serverTimestamp(),
          progress: 0
        };
        
        if (enrollmentData.bundleId) {
          userCourseData.bundleId = enrollmentData.bundleId;
        }
        
        batch.set(userCourseRef, userCourseData, { merge: true });
      }
      
      await batch.commit();
      console.log(`Successfully enrolled user ${userId} in ${coursesToEnrollMap.size} course(s) (including bundle courses)`);
      
      try {
        await notifyAdminsOfEnrollment({
          userId,
          userName,
          userEmail,
          courses,
          finalAmount,
          isFreeEnrollment: finalAmount === 0
        });
      } catch (notifyError) {
        console.error('Failed to notify admins:', notifyError);
      }

      try {
        if (!db) {
          console.error('Firestore not initialized, skipping notification creation');
        } else {
          const isFree = finalAmount === 0;
          const coursesText = courses?.length > 1 
            ? `${courses.length} courses` 
            : courses?.[0]?.title || 'Unknown Course';
          
          const sanitizedUserName = (userName || userEmail || 'User').substring(0, 100);
          const sanitizedCoursesText = coursesText.substring(0, 200);
          
          await db.collection('notifications').add({
            type: 'enrollment',
            title: isFree ? 'New Free Enrollment' : 'New Course Enrollment',
            message: `${sanitizedUserName} enrolled in ${sanitizedCoursesText}${isFree ? ' (Free)' : ` for ৳${finalAmount}`}`,
            userId: userId || 'unknown',
            userName: sanitizedUserName,
            userEmail: (userEmail || 'unknown').substring(0, 100),
            courses: courses?.map(c => ({ id: c.id, title: (c.title || 'Untitled').substring(0, 100) })) || [],
            amount: parseFloat(finalAmount) || 0,
            transactionId: transactionId,
            paymentId: paymentId,
            isFree,
            isRead: false,
            createdAt: FieldValue.serverTimestamp(),
            link: '/admin/payments'
          });
          console.log('Created notification record for admin');
        }
      } catch (notificationError) {
        console.error('Failed to create notification record:', notificationError);
      }
    }

    return {
      success: true,
      alreadyProcessed: false,
      message: 'Payment processed and user enrolled successfully',
      paymentRecord
    };

  } catch (error) {
    console.error('Error processing payment:', error);
    return {
      success: false,
      error: error.message
    };
  }
}
