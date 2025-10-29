import { collection, addDoc, getDocs, query, where, serverTimestamp } from 'firebase/firestore'
import { db } from './firebase'
import { notifyAdminsOfEnrollment } from './notifications'

export async function enrollInFreeCourse(userId, userEmail, userName, course) {
  try {
    const existingPaymentQuery = query(
      collection(db, 'payments'),
      where('userId', '==', userId),
      where('status', '==', 'approved')
    )
    const existingPayments = await getDocs(existingPaymentQuery)

    const alreadyEnrolled = existingPayments.docs.some(doc => {
      const payment = doc.data()
      return payment.courses?.some(c => c.id === course.id)
    })

    if (alreadyEnrolled) {
      return { success: false, message: 'You are already enrolled in this course' }
    }

    const pendingPaymentQuery = query(
      collection(db, 'payments'),
      where('userId', '==', userId),
      where('status', '==', 'pending')
    )
    const pendingPayments = await getDocs(pendingPaymentQuery)

    const hasPending = pendingPayments.docs.some(doc => {
      const payment = doc.data()
      return payment.courses?.some(c => c.id === course.id)
    })

    if (hasPending) {
      return { success: false, message: 'You have a pending payment for this course' }
    }

    const paymentData = {
      userId,
      userName,
      userEmail,
      senderNumber: 'N/A - Free Course',
      transactionId: 'FREE-' + Date.now(),
      courses: [{
        id: course.id,
        title: course.title,
        price: 0,
      }],
      subtotal: 0,
      discountType: 'none',
      discountPercent: 0,
      discountAmount: 0,
      discount: 0,
      couponCode: '',
      finalAmount: 0,
      status: 'approved',
      submittedAt: serverTimestamp(),
      approvedAt: serverTimestamp(),
      isFreeEnrollment: true,
    }

    await addDoc(collection(db, 'payments'), paymentData)
    
    notifyAdminsOfEnrollment({
      userId,
      userName,
      userEmail,
      courses: [{
        id: course.id,
        title: course.title,
      }],
      finalAmount: 0,
      isFreeEnrollment: true,
    }).catch(err => console.error('Failed to notify admins:', err))
    
    return { success: true, message: 'Successfully enrolled in free course!' }
  } catch (error) {
    console.error('Error enrolling in free course:', error)
    return { success: false, message: 'Failed to enroll. Please try again.' }
  }
}
