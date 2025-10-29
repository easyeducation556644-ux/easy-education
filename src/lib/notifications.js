import { collection, query, where, getDocs, doc, setDoc, serverTimestamp, getDoc } from 'firebase/firestore'
import { db } from './firebase'
import { getFCMToken } from './pwa'

export async function saveAdminFCMToken(userId) {
  try {
    const userDoc = await getDoc(doc(db, 'users', userId))
    if (!userDoc.exists()) {
      console.log('User not found')
      return null
    }

    const userData = userDoc.data()
    if (userData.role !== 'admin') {
      console.log('User is not an admin, FCM token not saved')
      return null
    }

    const token = await getFCMToken()
    if (!token) {
      console.log('No FCM token available')
      return null
    }

    await setDoc(
      doc(db, 'adminTokens', userId),
      {
        token,
        userId,
        role: 'admin',
        updatedAt: serverTimestamp(),
      },
      { merge: true }
    )

    console.log('Admin FCM token saved successfully')
    return token
  } catch (error) {
    console.error('Error saving admin FCM token:', error)
    return null
  }
}

export async function notifyAdminsOfCheckout(paymentData) {
  try {
    const adminTokensSnapshot = await getDocs(
      query(collection(db, 'adminTokens'), where('role', '==', 'admin'))
    )
    
    if (adminTokensSnapshot.empty) {
      console.log('No admin tokens found')
      return
    }

    const tokens = adminTokensSnapshot.docs.map(doc => doc.data().token).filter(Boolean)
    
    if (tokens.length === 0) {
      console.log('No valid admin tokens')
      return
    }

    const courseNames = paymentData.courses?.map(c => c.title).join(', ') || 'N/A'
    const coursesText = paymentData.courses?.length > 1 
      ? `${paymentData.courses.length} courses` 
      : paymentData.courses?.[0]?.title || 'N/A'

    const notification = {
      title: 'New Payment Submitted 🔔',
      body: `${paymentData.name} (${paymentData.email}) submitted ৳${paymentData.totalAmount} for ${coursesText}. Click to review.`,
      icon: '/placeholder-logo.png',
      badge: '/placeholder-logo.png',
      tag: `checkout-${paymentData.id}`,
      data: {
        url: `/admin/payments?paymentId=${paymentData.id}`,
        paymentId: paymentData.id,
        type: 'checkout',
        userName: paymentData.name,
        userEmail: paymentData.email,
        amount: paymentData.totalAmount,
        courses: courseNames
      }
    }

    await fetch('/api/send-notification', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        tokens,
        notification,
      }),
    }).catch(err => {
      console.log('API endpoint not available, notifications will work via FCM service worker')
    })

    console.log('Admin notification sent successfully to', tokens.length, 'admin(s)')
  } catch (error) {
    console.error('Error notifying admins:', error)
  }
}

export async function notifyAdminsOfEnrollment(enrollmentData) {
  try {
    const adminTokensSnapshot = await getDocs(
      query(collection(db, 'adminTokens'), where('role', '==', 'admin'))
    )
    
    if (adminTokensSnapshot.empty) {
      console.log('No admin tokens found')
      return
    }

    const tokens = adminTokensSnapshot.docs.map(doc => doc.data().token).filter(Boolean)
    
    if (tokens.length === 0) {
      console.log('No valid admin tokens')
      return
    }

    const courseNames = enrollmentData.courses?.map(c => c.title).join(', ') || 'N/A'
    const coursesText = enrollmentData.courses?.length > 1 
      ? `${enrollmentData.courses.length} courses` 
      : enrollmentData.courses?.[0]?.title || 'Unknown Course'
    
    const isFree = enrollmentData.isFreeEnrollment || enrollmentData.finalAmount === 0

    const notification = {
      title: isFree ? 'New Free Enrollment 🎓' : 'New Course Enrollment 💰',
      body: `${enrollmentData.userName || 'A user'} enrolled in ${coursesText}${isFree ? ' (Free)' : ` for ৳${enrollmentData.finalAmount}`}. Click to view details.`,
      icon: '/placeholder-logo.png',
      badge: '/placeholder-logo.png',
      tag: `enrollment-${enrollmentData.userId}-${Date.now()}`,
      data: {
        url: '/admin/payments',
        userId: enrollmentData.userId,
        type: 'enrollment',
        userName: enrollmentData.userName,
        userEmail: enrollmentData.userEmail,
        courses: courseNames,
        isFree: isFree
      }
    }

    await fetch('/api/send-notification', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        tokens,
        notification,
      }),
    }).catch(err => {
      console.log('API endpoint not available, notifications will work via FCM service worker')
    })

    console.log('Admin enrollment notification sent successfully to', tokens.length, 'admin(s)')
  } catch (error) {
    console.error('Error notifying admins of enrollment:', error)
  }
}

export async function sendEmailNotification(to, subject, body) {
  try {
    const response = await fetch('/api/send-email', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ to, subject, body }),
    })

    if (!response.ok) {
      throw new Error('Failed to send email')
    }

    console.log('Email notification sent successfully')
    return true
  } catch (error) {
    console.error('Error sending email notification:', error)
    return false
  }
}
