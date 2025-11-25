"use client"

import { useState, useEffect } from "react"
import { Link, useNavigate } from "react-router-dom"
import { motion } from "framer-motion"
import { Search, TrendingUp, ArrowRight, BookOpen, Award, Infinity } from "lucide-react"
import CourseCard from "../components/CourseCard"
import { collection, query, orderBy, limit, getDocs, where } from "firebase/firestore"
import { db } from "../lib/firebase"
import { useAuth } from "../contexts/AuthContext"
import useEmblaCarousel from "embla-carousel-react"
import Autoplay from "embla-carousel-autoplay"

export default function Home() {
  const navigate = useNavigate()
  const { isAdmin, currentUser } = useAuth()
  const [searchQuery, setSearchQuery] = useState("")
  const [trendingCourses, setTrendingCourses] = useState([])
  const [categories, setCategories] = useState([])
  const [loading, setLoading] = useState(true)
  const [purchasedBundleCourses, setPurchasedBundleCourses] = useState(new Set())
  
  const [emblaRef] = useEmblaCarousel(
    { 
      loop: true, 
      align: 'start',
      slidesToScroll: 1,
      containScroll: false,
      breakpoints: {
        '(max-width: 640px)': { 
          align: 'center',
          loop: true
        }
      }
    },
    [Autoplay({ delay: 3000, stopOnInteraction: false })]
  )

  useEffect(() => {
    fetchData()
  }, [isAdmin, currentUser])

  const fetchData = async () => {
    try {
      if (!db) {
        console.warn(" Firebase not available, skipping data fetch")
        setLoading(false)
        return
      }

      let purchasedBundleSet = new Set()
      
      if (currentUser) {
        const userCoursesQuery = query(collection(db, "userCourses"), where("userId", "==", currentUser.uid))
        const userCoursesSnapshot = await getDocs(userCoursesQuery)
        
        for (const doc of userCoursesSnapshot.docs) {
          const userCourse = doc.data()
          // If this userCourse entry is for a bundle course itself, hide it
          if (userCourse.isBundle) {
            purchasedBundleSet.add(userCourse.courseId)
          }
          // Also hide bundles if user has courses from that bundle
          if (userCourse.bundleId) {
            purchasedBundleSet.add(userCourse.bundleId)
          }
        }
        setPurchasedBundleCourses(purchasedBundleSet)
      }

      const coursesQuery = query(collection(db, "courses"), orderBy("createdAt", "desc"))
      const coursesSnapshot = await getDocs(coursesQuery)
      let coursesData = coursesSnapshot.docs.map((doc) => ({
        id: doc.id,
        ...doc.data(),
      }))
      
      if (!isAdmin) {
        coursesData = coursesData.filter(course => course.publishStatus !== "draft")
      }
      
      if (currentUser && purchasedBundleSet.size > 0) {
        coursesData = coursesData.filter(course => 
          course.courseFormat !== 'bundle' || !purchasedBundleSet.has(course.id)
        )
      }
      
      setTrendingCourses(coursesData)

      const categoriesQuery = query(collection(db, "categories"), limit(8))
      const categoriesSnapshot = await getDocs(categoriesQuery)
      const categoriesData = categoriesSnapshot.docs.map((doc) => ({
        id: doc.id,
        ...doc.data(),
      }))
      setCategories(categoriesData)
    } catch (error) {
      console.error(" Error fetching data:", error)
      // Continue with empty data
    } finally {
      setLoading(false)
    }
  }

  const handleSearch = (e) => {
    e.preventDefault()
    if (searchQuery.trim()) {
      navigate("/courses", { state: { searchQuery: searchQuery.trim() } })
      setSearchQuery("")
    }
  }

  const handleCategoryClick = (category) => {
    navigate("/courses", { state: { categoryFilter: category.title } })
  }

  return (
    <div className="min-h-screen">
      <section className="relative bg-gradient-to-br from-blue-50 via-purple-50 to-pink-50 dark:from-gray-900 dark:via-gray-800 dark:to-gray-900 py-12 md:py-20 lg:py-24 px-4 overflow-hidden">
        {/* Decorative floating elements - hidden on mobile, shown on larger screens */}
        <div className="hidden lg:block absolute top-20 left-10 w-16 h-16 opacity-10 dark:opacity-20 animate-bounce" style={{ animationDelay: '0s', animationDuration: '3s' }}>
          <BookOpen className="w-full h-full text-orange-500 dark:text-orange-400" />
        </div>
        <div className="hidden lg:block absolute top-40 right-20 w-12 h-12 opacity-10 dark:opacity-20 animate-bounce" style={{ animationDelay: '1s', animationDuration: '4s' }}>
          <Award className="w-full h-full text-purple-500 dark:text-purple-400" />
        </div>
        <div className="hidden lg:block absolute bottom-32 left-20 w-10 h-10 opacity-10 dark:opacity-20 animate-bounce" style={{ animationDelay: '2s', animationDuration: '3.5s' }}>
          <TrendingUp className="w-full h-full text-blue-500 dark:text-blue-400" />
        </div>

        <div className="container mx-auto relative z-10">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 lg:gap-12 items-center">
            {/* Left Content */}
            <div className="order-2 lg:order-1">
              <motion.div
                initial={{ opacity: 0, x: -20 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ duration: 0.5 }}
                className="mb-6"
              >
                <span className="inline-flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-orange-500 to-red-500 text-white rounded-full text-xs md:text-sm font-bold shadow-lg">
                  20% OFF | LEARN FROM TODAY
                </span>
              </motion.div>

              <motion.h1
                initial={{ opacity: 0, x: -20 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: 0.1, duration: 0.5 }}
                className="text-3xl sm:text-4xl md:text-5xl lg:text-6xl font-bold mb-6 leading-tight text-gray-900 dark:text-white"
              >
                Best Academic Online Learning Platform
              </motion.h1>

              <motion.p
                initial={{ opacity: 0, x: -20 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: 0.2, duration: 0.5 }}
                className="text-base md:text-lg text-gray-600 dark:text-gray-300 mb-8 leading-relaxed max-w-lg"
              >
                Access quality education from anywhere, anytime. Start your learning journey today with courses designed to help you achieve your goals and excel in your studies.
              </motion.p>

              <motion.div
                initial={{ opacity: 0, x: -20 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: 0.3, duration: 0.5 }}
                className="flex flex-col sm:flex-row items-start sm:items-center gap-4"
              >
                <Link
                  to="/courses"
                  className="inline-flex items-center gap-2 px-6 py-3 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-all font-semibold text-sm shadow-lg shadow-blue-500/30 group"
                >
                  Explore Courses
                  <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
                </Link>
                <form onSubmit={handleSearch} className="relative w-full sm:w-auto">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="Search courses..."
                    className="w-full sm:w-64 pl-10 pr-4 py-3 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm placeholder:text-muted-foreground/60"
                  />
                </form>
              </motion.div>
            </div>

            {/* Right Image */}
            <div className="order-1 lg:order-2">
              <motion.div
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ duration: 0.5 }}
                className="relative"
              >
                <div className="relative w-full aspect-square max-w-md mx-auto lg:max-w-full">
                  <img
                    src="/assets/hero-image.jpg"
                    alt="Online Learning Illustration"
                    className="w-full h-full object-contain drop-shadow-2xl rounded-2xl"
                  />
                  {/* Decorative elements around image */}
                  <div className="absolute -top-4 -right-4 w-20 h-20 bg-yellow-400 rounded-full opacity-30 blur-xl"></div>
                  <div className="absolute -bottom-4 -left-4 w-24 h-24 bg-purple-400 rounded-full opacity-30 blur-xl"></div>
                </div>
              </motion.div>
            </div>
          </div>
        </div>
      </section>

      {/* Categories */}
      {categories.length > 0 && (
        <section className="py-12 md:py-14 px-4 bg-muted/30">
          <div className="container mx-auto max-w-6xl">
            <div className="flex items-center gap-3 mb-8">
              <h2 className="text-3xl md:text-4xl font-serif font-bold">Browse by Category</h2>
            </div>

            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3 md:gap-4">
              {categories.map((category, index) => (
                <motion.div
                  key={category.id}
                  initial={{ opacity: 0, scale: 0.9 }}
                  animate={{ opacity: 1, scale: 1 }}
                  transition={{ delay: index * 0.05 }}
                >
                  <button onClick={() => handleCategoryClick(category)} className="w-full text-left">
                    <div className="bg-card border border-border rounded-lg overflow-hidden hover:border-primary hover:shadow-lg transition-all group cursor-pointer">
                      <div className="aspect-video bg-gradient-to-br from-primary/20 to-secondary/20 relative overflow-hidden">
                        {category.imageURL ? (
                          <img
                            src={category.imageURL || "/placeholder.svg"}
                            alt={category.title}
                            className="w-full h-full object-cover group-hover:scale-110 transition-transform duration-300"
                          />
                        ) : (
                          <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-primary/10 to-secondary/10 p-4">
                            <h3 className="text-center font-bold text-lg md:text-xl bg-gradient-to-r from-primary to-secondary bg-clip-text text-transparent">
                              {category.title}
                            </h3>
                          </div>
                        )}
                      </div>
                      <div className="p-3">
                        <h3 className="text-sm md:text-base font-semibold text-center group-hover:text-primary transition-colors">
                          {category.title}
                        </h3>
                      </div>
                    </div>
                  </button>
                </motion.div>
              ))}
            </div>
          </div>
        </section>
      )}

      {/* Trending Courses */}
      <section className="py-12 md:py-14 px-4 bg-gradient-to-b from-background via-primary/5 to-background">
        <div className="container mx-auto max-w-7xl">
          <div className="flex items-center gap-3 mb-8">
            <TrendingUp className="w-6 h-6 text-primary" />
            <h2 className="text-3xl md:text-4xl font-serif font-bold">Trending Courses</h2>
          </div>

          {loading ? (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
              {[...Array(8)].map((_, i) => (
                <div key={i} className="bg-card border border-border rounded-xl p-4 animate-pulse">
                  <div className="aspect-video bg-muted rounded-lg mb-4"></div>
                  <div className="h-6 bg-muted rounded mb-2"></div>
                  <div className="h-4 bg-muted rounded w-2/3"></div>
                </div>
              ))}
            </div>
          ) : trendingCourses.length > 0 ? (
            <div className="overflow-hidden" ref={emblaRef}>
              <div className="flex gap-3 sm:gap-4 md:gap-5 px-1">
                {trendingCourses.map((course) => (
                  <div
                    key={course.id}
                    className="flex-[0_0_calc(80%_-_12px)] min-w-0 sm:flex-[0_0_calc(45%_-_16px)] md:flex-[0_0_calc(30%_-_20px)] lg:flex-[0_0_calc(22%_-_20px)]"
                  >
                    <CourseCard course={course} showMinimal={true} />
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div className="text-center py-12 text-muted-foreground">
              <p>No courses available yet. Check back soon!</p>
            </div>
          )}

          <div className="text-center mt-10">
            <Link
              to="/courses"
              className="inline-flex items-center gap-2 px-8 py-3 bg-primary hover:bg-primary/90 text-primary-foreground rounded-xl transition-all font-medium group"
            >
              View All Courses
              <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
            </Link>
          </div>
        </div>
      </section>
    </div>
  )
}
