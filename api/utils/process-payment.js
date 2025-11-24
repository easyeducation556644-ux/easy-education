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

    const coursesToEnrollMap = new Map();

    if (courses && courses.length > 0) {
      const batch = db.batch();
      
      console.log(`📚 Processing ${courses.length} course(s) for enrollment:`, courses.map(c => ({ id: c.id, title: c.title })));
      
      for (const course of courses) {
        try {
          if (course.bundleId || course.bundleIds) {
            const bundleIds = course.bundleIds || [course.bundleId];
            console.log(`🔗 Course ${course.id} is part of bundle(s):`, bundleIds);
            
            if (coursesToEnrollMap.has(course.id)) {
              const existing = coursesToEnrollMap.get(course.id);
              if (!existing.bundleIds) {
                existing.bundleIds = existing.bundleId ? [existing.bundleId] : [];
              }
              bundleIds.forEach(bundleId => {
                if (!existing.bundleIds.includes(bundleId)) {
                  existing.bundleIds.push(bundleId);
                }
              });
              existing.bundleId = existing.bundleIds[0];
            } else {
              coursesToEnrollMap.set(course.id, {
                courseId: course.id,
                bundleId: bundleIds[0],
                bundleIds: bundleIds
              });
            }
          } else {
            console.log(`🔍 Checking if course ${course.id} (${course.title}) is a bundle...`);
            
            // Check if bundle info is provided in the course object (from frontend)
            if (course.courseFormat === 'bundle' && course.bundledCourses && course.bundledCourses.length > 0) {
              console.log(`✅ Course ${course.id} is a BUNDLE with ${course.bundledCourses.length} courses (from frontend):`, course.bundledCourses);
              console.log(`📦 Bundle title: ${course.title}`);
              
              // Add the bundle course itself to enrollment map
              if (!coursesToEnrollMap.has(course.id)) {
                coursesToEnrollMap.set(course.id, {
                  courseId: course.id,
                  bundleId: null,
                  isBundle: true
                });
                console.log(`  ✅ Added bundle course itself: ${course.id}`);
              }
              
              // Add all individual courses within the bundle
              course.bundledCourses.forEach(bundledCourseId => {
                console.log(`  ↳ Adding bundled course: ${bundledCourseId}`);
                if (coursesToEnrollMap.has(bundledCourseId)) {
                  const existing = coursesToEnrollMap.get(bundledCourseId);
                  if (!existing.bundleIds) {
                    existing.bundleIds = existing.bundleId ? [existing.bundleId] : [];
                  }
                  if (!existing.bundleIds.includes(course.id)) {
                    existing.bundleIds.push(course.id);
                  }
                  existing.bundleId = existing.bundleIds[0];
                } else {
                  coursesToEnrollMap.set(bundledCourseId, {
                    courseId: bundledCourseId,
                    bundleId: course.id,
                    bundleIds: [course.id]
                  });
                }
              });
            } else {
              // Fallback: Try to fetch from Firestore if bundle info not provided
              try {
                const courseDoc = await db.collection('courses').doc(course.id).get();
                if (courseDoc.exists()) {
                  const courseData = courseDoc.data();
                  
                  if (courseData.courseFormat === 'bundle' && courseData.bundledCourses && courseData.bundledCourses.length > 0) {
                    console.log(`✅ Course ${course.id} is a BUNDLE with ${courseData.bundledCourses.length} courses (from Firestore):`, courseData.bundledCourses);
                    console.log(`📦 Bundle title: ${courseData.title}`);
                    
                    // Add the bundle course itself to enrollment map
                    if (!coursesToEnrollMap.has(course.id)) {
                      coursesToEnrollMap.set(course.id, {
                        courseId: course.id,
                        bundleId: null,
                        isBundle: true
                      });
                      console.log(`  ✅ Added bundle course itself: ${course.id}`);
                    }
                    
                    // Add all individual courses within the bundle
                    courseData.bundledCourses.forEach(bundledCourseId => {
                      console.log(`  ↳ Adding bundled course: ${bundledCourseId}`);
                      if (coursesToEnrollMap.has(bundledCourseId)) {
                        const existing = coursesToEnrollMap.get(bundledCourseId);
                        if (!existing.bundleIds) {
                          existing.bundleIds = existing.bundleId ? [existing.bundleId] : [];
                        }
                        if (!existing.bundleIds.includes(course.id)) {
                          existing.bundleIds.push(course.id);
                        }
                        existing.bundleId = existing.bundleIds[0];
                      } else {
                        coursesToEnrollMap.set(bundledCourseId, {
                          courseId: bundledCourseId,
                          bundleId: course.id,
                          bundleIds: [course.id]
                        });
                      }
                    });
                  } else {
                    console.log(`❌ Course ${course.id} is NOT a bundle (format: ${courseData.courseFormat}, bundledCourses: ${courseData.bundledCourses?.length || 0})`);
                    if (!coursesToEnrollMap.has(course.id)) {
                      coursesToEnrollMap.set(course.id, {
                        courseId: course.id,
                        bundleId: null
                      });
                    }
                  }
                } else {
                  console.error(`❌ Course document ${course.id} not found in Firestore`);
                  if (!coursesToEnrollMap.has(course.id)) {
                    coursesToEnrollMap.set(course.id, {
                      courseId: course.id,
                      bundleId: null
                    });
                  }
                }
              } catch (firestoreError) {
                console.error(`❌ Failed to fetch course ${course.id} from Firestore:`, firestoreError.message);
                console.error(`   This may be due to missing Firebase Admin credentials (FIREBASE_SERVICE_ACCOUNT)`);
                console.error(`   Bundle info should be provided from frontend to avoid this issue.`);
                
                // Add course anyway to prevent total failure
                if (!coursesToEnrollMap.has(course.id)) {
                  coursesToEnrollMap.set(course.id, {
                    courseId: course.id,
                    bundleId: null,
                    credentialError: true
                  });
                }
              }
            }
          }
        } catch (error) {
          console.error(`❌ Error processing course ${course.id}:`, error);
          if (!coursesToEnrollMap.has(course.id)) {
            coursesToEnrollMap.set(course.id, {
              courseId: course.id,
              bundleId: course.bundleId || null
            });
          }
        }
      }
      
      console.log(`\n📋 Final enrollment map (${coursesToEnrollMap.size} courses):`, Array.from(coursesToEnrollMap.entries()).map(([id, data]) => ({ courseId: id, bundleId: data.bundleId })));
      
      
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
        
        // Mark if this is a bundle course itself (not an individual course within a bundle)
        if (enrollmentData.isBundle) {
          userCourseData.isBundle = true;
        }
        
        batch.set(userCourseRef, userCourseData, { merge: true });
      }
      
      await batch.commit();
      const totalEnrolled = coursesToEnrollMap.size;
      console.log(`✅ Successfully enrolled user ${userId} in ${totalEnrolled} course(s) (including bundle courses)`);
      
      // Log all enrolled courses for verification
      console.log('📋 Enrolled courses:');
      for (const [courseId, enrollmentData] of coursesToEnrollMap) {
        console.log(`  - ${courseId}${enrollmentData.isBundle ? ' (BUNDLE)' : ''}${enrollmentData.bundleId ? ` [from bundle: ${enrollmentData.bundleId}]` : ''}`);
      }
      
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
      paymentRecord,
      enrollmentDetails: {
        totalEnrolled: coursesToEnrollMap?.size || 0,
        enrolledCourses: Array.from(coursesToEnrollMap?.keys() || [])
      }
    };

  } catch (error) {
    console.error('Error processing payment:', error);
    return {
      success: false,
      error: error.message
    };
  }
}
