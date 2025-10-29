"use client"

import { useState, useEffect } from "react"
import { Link, useNavigate } from "react-router-dom"
import { ShoppingCart, Trash2, Users, Check, Clock, Tag } from "lucide-react"
import { useCart } from "../contexts/CartContext"
import { useAuth } from "../contexts/AuthContext"
import { collection, query, where, getDocs } from "firebase/firestore"
import { db } from "../lib/firebase"
import ProgressBar from "./ProgressBar"
import { toast } from "../hooks/use-toast"

export default function CourseCard({ course, onAddToCart, showProgress = false }) {
  const { addToCart, removeFromCart, cartItems, openCart } = useCart()
  const { currentUser } = useAuth()
  const navigate = useNavigate()
  const [isPurchased, setIsPurchased] = useState(false)
  const [isInCart, setIsInCart] = useState(false)
  const [loading, setLoading] = useState(true)
  const [progress, setProgress] = useState(0)
  const [hasPendingPayment, setHasPendingPayment] = useState(false)

  // Check cart status whenever cart or course ID changes
  useEffect(() => {
    checkIfInCart()
  }, [cartItems, course.id])

  // Check purchase status whenever user or course ID changes
  useEffect(() => {
    setLoading(true)
    checkIfPurchased()
    checkPendingPayment()
  }, [currentUser, course.id])

  useEffect(() => {
    if (isPurchased) {
      calculateProgress()
    }
  }, [isPurchased, currentUser])

  const checkIfPurchased = async () => {
    if (!currentUser) {
      setIsPurchased(false)
      setLoading(false)
      return
    }

    try {
      const paymentsQuery = query(
        collection(db, "payments"),
        where("userId", "==", currentUser.uid),
        where("status", "==", "approved"),
      )
      const paymentsSnapshot = await getDocs(paymentsQuery)

      const purchased = paymentsSnapshot.docs.some((doc) => {
        const payment = doc.data()
        return payment.courses?.some((c) => c.id === course.id)
      })

      setIsPurchased(purchased)
    } catch (error) {
      console.error("Error checking purchase status:", error)
      setIsPurchased(false)
    } finally {
      setLoading(false)
    }
  }

  const checkPendingPayment = async () => {
    if (!currentUser) {
      setHasPendingPayment(false)
      return
    }

    try {
      const pendingQuery = query(
        collection(db, "payments"),
        where("userId", "==", currentUser.uid),
        where("status", "==", "pending"),
      )
      const pendingSnapshot = await getDocs(pendingQuery)

      const hasPending = pendingSnapshot.docs.some((doc) => {
        const payment = doc.data()
        return payment.courses?.some((c) => c.id === course.id)
      })

      setHasPendingPayment(hasPending)
    } catch (error) {
      console.error("Error checking pending payment:", error)
      setHasPendingPayment(false)
    }
  }

  const calculateProgress = async () => {
    try {
      const classesQuery = query(collection(db, "classes"), where("courseId", "==", course.id))
      const classesSnapshot = await getDocs(classesQuery)
      const totalClasses = classesSnapshot.size

      if (totalClasses === 0) {
        setProgress(0)
        return
      }

      const watchedQuery = query(
        collection(db, "userProgress"),
        where("userId", "==", currentUser.uid),
        where("courseId", "==", course.id),
      )
      const watchedSnapshot = await getDocs(watchedQuery)
      const watchedClasses = watchedSnapshot.size

      setProgress(Math.round((watchedClasses / totalClasses) * 100))
    } catch (error) {
      console.error("Error calculating progress:", error)
      setProgress(0)
    }
  }

  const checkIfInCart = () => {
    const inCart = cartItems.some((item) => item.id === course.id)
    setIsInCart(inCart)
  }

  const handleAddToCart = (e) => {
    e.preventDefault()
    e.stopPropagation()
    const success = addToCart(course)
    if (success) {
      openCart()
    } else {
      toast({
        variant: "warning",
        title: "Already in Cart",
        description: "This course is already in your cart!",
      })
    }
  }

  const handleRemoveFromCart = (e) => {
    e.preventDefault()
    e.stopPropagation()
    removeFromCart(course.id)
  }

  const truncateDescription = (text, maxLength = 120) => {
    if (!text) return ""
    return text.length > maxLength ? text.substring(0, maxLength) + "..." : text
  }

  const courseUrl = `/course/${course.slug || course.id}`
  
  return (
    <Link to={courseUrl}>
      <div className="bg-card border border-border rounded-xl overflow-hidden hover:border-primary hover:shadow-lg transition-all group relative h-full flex flex-col">
        <div className="aspect-video bg-gradient-to-br from-primary/20 to-secondary/20 relative overflow-hidden">
          {course.thumbnailURL ? (
            <img
              src={course.thumbnailURL || "/placeholder.svg"}
              alt={course.title}
              className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
              loading="lazy"
            />
          ) : (
            <div className="w-full h-full flex items-center justify-center">
              <Users className="w-16 h-16 text-primary/50" />
            </div>
          )}
          {course.status && (
            <div className="absolute top-2 right-2">
              <span className={`px-2 py-1 rounded-full text-xs font-semibold uppercase ${
                course.status === "running" 
                  ? "bg-green-500 text-white" 
                  : course.status === "ongoing" 
                  ? "bg-blue-500 text-white" 
                  : "bg-gray-500 text-white"
              }`}>
                {course.status}
              </span>
            </div>
          )}
        </div>
        <div className="p-5 flex flex-col flex-1">
          <h3 className="font-semibold text-lg mb-2 line-clamp-2 group-hover:text-primary transition-colors">
            {course.title}
          </h3>
          {course.tags && course.tags.length > 0 ? (
            <div className="flex flex-wrap gap-1.5 mb-3 min-h-[40px]">
              {course.tags.slice(0, 6).map((tag, index) => (
                <span
                  key={index}
                  className="inline-flex items-center gap-1 px-2 py-1 bg-primary/10 text-primary text-xs rounded-full font-medium"
                >
                  <Tag className="w-3 h-3" />
                  {tag}
                </span>
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground mb-3 line-clamp-2 leading-relaxed">
              {truncateDescription(course.description)}
            </p>
          )}
          <div className="flex items-center justify-end mb-3">
            <span className="px-3 py-1 bg-primary/10 text-primary text-xs rounded-full font-medium">
              {course.category}
            </span>
          </div>

          {/* Price Display */}
          <div className="mb-3 mt-auto">
            {course.price && course.price > 0 ? (
              <div className="flex items-center gap-2">
                <span className="text-2xl font-bold text-primary">৳{course.price}</span>
                {course.originalPrice && course.originalPrice > course.price && (
                  <span className="text-sm text-muted-foreground line-through">৳{course.originalPrice}</span>
                )}
              </div>
            ) : (
              <span className="text-2xl font-bold text-green-600 dark:text-green-400">Free</span>
            )}
          </div>

          {loading ? (
            <div className="w-full h-10 flex items-center justify-center border border-border rounded-lg text-muted-foreground text-sm">
              Loading Status...
            </div>
          ) : isPurchased ? (
            <>
              <div className="mb-3">
                <ProgressBar progress={progress} showLabel={true} showPercentage={true} animated={false} />
              </div>
              <button 
                onClick={(e) => {
                  e.preventDefault()
                  e.stopPropagation()
                  navigate(course.type === "batch" ? `/course/${course.slug || course.id}/subjects` : `/course/${course.slug || course.id}/chapters`)
                }}
                className="w-full px-4 py-2 bg-green-500/20 text-green-700 dark:text-green-400 rounded-lg transition-colors flex items-center justify-center gap-2 text-sm font-medium hover:bg-green-500/30"
              >
                <Check className="w-4 h-4" />
                Continue Course
              </button>
            </>
          ) : hasPendingPayment ? (
            <button
              disabled
              className="w-full px-4 py-2 bg-yellow-500/20 text-yellow-700 dark:text-yellow-400 rounded-lg flex items-center justify-center gap-2 text-sm font-medium cursor-not-allowed opacity-90"
            >
              <Clock className="w-4 h-4" />
              Request Pending
            </button>
          ) : isInCart ? (
            <button
              onClick={handleRemoveFromCart}
              className="w-full px-4 py-2 bg-red-500/20 hover:bg-red-500/30 text-red-700 dark:text-red-400 rounded-lg transition-colors flex items-center justify-center gap-2 text-sm font-medium"
            >
              <Trash2 className="w-4 h-4" />
              Remove from Cart
            </button>
          ) : !course.price || course.price === 0 || course.price === "0" || course.price === null ? (
            <button 
              onClick={(e) => {
                e.preventDefault()
                e.stopPropagation()
                navigate(courseUrl)
              }}
              className="w-full px-4 py-2 bg-primary hover:bg-primary/90 text-primary-foreground rounded-lg transition-colors flex items-center justify-center gap-2 text-sm font-medium"
            >
              Enroll Free
            </button>
          ) : (
            <button 
              onClick={(e) => {
                e.preventDefault()
                e.stopPropagation()
                navigate(courseUrl)
              }}
              className="w-full px-4 py-2 bg-primary hover:bg-primary/90 text-primary-foreground rounded-lg transition-colors flex items-center justify-center gap-2 text-sm font-medium"
            >
              Buy Now
            </button>
          )}
        </div>
      </div>
    </Link>
  )
}
