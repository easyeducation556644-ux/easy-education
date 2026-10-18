"use client"

import { useEffect, useState } from "react"
import { useNavigate, useLocation } from "react-router-dom"
import { motion } from "framer-motion"
import { CheckCircle, AlertCircle, ArrowRight, BookOpen, Loader2 } from "lucide-react"
import {useCart} from "../contexts/CartContext"
import { useAuth } from "../contexts/AuthContext"

export default function CheckoutComplete() {
 const {currentUser}=useAuth(),{clearCart}=useCart(),location=useLocation(),navigate=useNavigate();
 const [isProcessing,setIsProcessing]=useState(true),[confirmed,setConfirmed]=useState(false),[message,setMessage]=useState(''),[courses,setCourses]=useState([]),[retry,setRetry]=useState(0);
 const orderId=new URLSearchParams(location.search).get('order_id');
 const free=location.state?.isFreeEnrollment===true;
 useEffect(()=>{
  if(free){setConfirmed(true);setIsProcessing(false);setCourses(location.state?.courses||[]);return;}
  if(!currentUser){setIsProcessing(false);setMessage('Sign in to confirm this payment, then return to this page.');return;}
  let cancelled=false;
  async function confirm(){
   setIsProcessing(true);setMessage('');
   try{
    if(!orderId)throw Error('No order reference was returned. Open Payment history or contact support.');
    const response=await fetch('/api/process-enrollment',{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${await currentUser.getIdToken()}`},body:JSON.stringify({order_id:orderId,userId:currentUser.uid})});
    const data=await response.json();if(!response.ok||!data.success||!data.verified)throw Error(data.error||'Payment is not confirmed yet.');
    if(cancelled)return;setCourses(data.payment?.metadata?.courses||[]);setConfirmed(true);setIsProcessing(false);
    // Only clear the matching cart after server-side verification and enrollment.
    try { const attempt=JSON.parse(sessionStorage.getItem('ekmivo-payment-attempt')||'null');
    if(sessionStorage.getItem('ekmivo-pending-order')===orderId&&attempt?.userId===currentUser.uid){
     const submitted=JSON.parse(attempt.fingerprint).metadata.courses;
     const current=JSON.parse(localStorage.getItem('cart')||'[]');
     if(JSON.stringify(current.map(c=>[c.id,c.purchaseOption?.id||null,Number(c.price)]).sort())===JSON.stringify(submitted.map(c=>[c.id,c.purchaseOption?.id||null,Number(c.price)]).sort()))clearCart();
     sessionStorage.removeItem('ekmivo-payment-attempt');sessionStorage.removeItem('ekmivo-pending-order');sessionStorage.removeItem('appliedCoupon');
    }} catch { /* Enrollment is confirmed even if browser storage is unavailable. */ }
   }catch(error){if(!cancelled){setMessage(error.message);setIsProcessing(false);}}
  }
  void confirm();return()=>{cancelled=true;};
  // Cart clearing must not start another verification loop.
  // eslint-disable-next-line react-hooks/exhaustive-deps
 },[currentUser,orderId,retry,free]);
  if (isProcessing) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-background via-primary/5 to-background flex items-center justify-center px-4">
        <div className="text-center">
          <Loader2 className="w-12 h-12 animate-spin text-primary mx-auto mb-4" />
          <p className="text-muted-foreground">Processing your enrollment...</p>
        </div>
      </div>
    )
  }
  
  return (
    <div className="min-h-screen bg-gradient-to-br from-background via-primary/5 to-background flex items-center justify-center px-4 py-8 sm:py-12">
      <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} className="max-w-2xl w-full">
        {/* Main Success Card */}
        <div className="bg-card border border-border rounded-2xl p-6 sm:p-8 text-center shadow-xl mb-6">
          <motion.div
            initial={{ scale: 0 }}
            animate={{ scale: 1 }}
            transition={{ delay: 0.2, type: "spring" }}
            className="w-16 h-16 sm:w-20 sm:h-20 bg-gradient-to-br from-primary/20 to-accent/20 rounded-full flex items-center justify-center mx-auto mb-6 relative"
          >
            {confirmed?<CheckCircle className="w-8 h-8 sm:w-12 sm:h-12 text-primary" />:<AlertCircle className="w-8 h-8 sm:w-12 sm:h-12 text-muted-foreground" />}
            <motion.div
              animate={{ rotate: 360 }}
              transition={{ duration: 3, repeat: Infinity, ease: "linear" }}
              className="absolute inset-0 rounded-full border-2 border-transparent border-t-primary border-r-accent opacity-30"
            />
          </motion.div>

          <motion.h1
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.3 }}
            className="text-2xl sm:text-3xl font-bold mb-2 bg-gradient-to-r from-green-600 to-green-500 bg-clip-text text-transparent"
          >
            {confirmed?"Payment Successful!":"Payment not confirmed"}
          </motion.h1>

          <motion.p
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.4 }}
            className="text-muted-foreground mb-6 text-sm sm:text-base"
          >
            {confirmed?"Your course enrollment has been completed successfully. You can now access your course from your dashboard.":message}
          </motion.p>

          {/* Purchased Courses Section */}
          {courses.length > 0 && (
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.6 }}
              className="bg-muted/50 rounded-xl p-4 mb-6 text-left"
            >
              <h3 className="font-semibold mb-3 flex items-center gap-2 text-sm sm:text-base">
                <BookOpen className="w-4 h-4 text-primary flex-shrink-0" />
                Courses Purchased
              </h3>
              <div className="space-y-2">
                {courses.map((course, index) => (
                  <div key={index} className="flex items-start gap-2 text-xs sm:text-sm">
                    <span className="text-primary font-bold flex-shrink-0">•</span>
                    <span className="text-muted-foreground line-clamp-2">{course.title || "Course"}</span>
                  </div>
                ))}
              </div>
            </motion.div>
          )}


          {!confirmed&&<button className="w-full py-3 bg-primary text-primary-foreground rounded-lg mb-4" onClick={()=>currentUser?setRetry(n=>n+1):navigate('/login')}>{currentUser?'Check again':'Sign in'}</button>}
          {/* Action Buttons */}
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.6 }}
            className="space-y-3"
          >
            <button
              onClick={() => navigate("/my-courses")}
              className="w-full py-2.5 sm:py-3 bg-gradient-to-r from-primary to-accent hover:from-primary/90 hover:to-accent/90 text-primary-foreground rounded-lg transition-all font-medium flex items-center justify-center gap-2 text-sm sm:text-base"
            >
              <BookOpen className="w-4 h-4 flex-shrink-0" />
              Go to My Courses
              <ArrowRight className="w-4 h-4 flex-shrink-0" />
            </button>
            <button
              onClick={() => navigate("/courses")}
              className="w-full py-2.5 sm:py-3 bg-muted hover:bg-muted/80 text-foreground rounded-lg transition-colors font-medium text-sm sm:text-base"
            >
              Browse More Courses
            </button>
          </motion.div>
        </div>

        {/* Support Card */}
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.75 }}
          className="bg-card border border-border rounded-xl p-4 sm:p-6 text-center"
        >
          <p className="text-xs sm:text-sm text-muted-foreground mb-3">Having issues with your payment?</p>
          <a
            href="mailto:support@easyeducation.com"
            className="text-primary hover:text-primary/80 font-medium text-xs sm:text-sm transition-colors"
          >
            Contact Support
          </a>
        </motion.div>
      </motion.div>
    </div>
  )
}