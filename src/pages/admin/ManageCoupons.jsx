
import { toast } from "../../hooks/use-toast"

import { useState, useEffect } from "react"
import { motion } from "framer-motion"
import { Plus, Edit, Trash2, Tag } from "lucide-react"
import { collection, getDocs, addDoc, updateDoc, deleteDoc, doc, serverTimestamp, Timestamp } from "firebase/firestore"
import { db } from "../../lib/firebase"
import ConfirmDialog from "../../components/ConfirmDialog"

export default function ManageCoupons() {
  const [coupons, setCoupons] = useState([])
  const [courses, setCourses] = useState([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [editingId, setEditingId] = useState(null)
  const [confirmDialog, setConfirmDialog] = useState({ isOpen: false, title: "", message: "", onConfirm: () => {} })

  const [formData, setFormData] = useState({
    code: "",
    couponType: "universal",
    discountPercent: 10,
    discountType: "percentage",
    discountAmount: 0,
    minCartValue: 0,
    applicableCourses: [],
    specificUsers: "",
    requiredPurchasedCourses: [],
    minCoursePurchaseCount: 0,
    active: true,
    expiryDate: "",
  })

  useEffect(() => {
    fetchCoupons()
    fetchCourses()
  }, [])

  const fetchCoupons = async () => {
    try {
      const snapshot = await getDocs(collection(db, "coupons"))
      const data = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }))
      setCoupons(data)
    } catch (error) {
      console.error("Error fetching coupons:", error)
    } finally {
      setLoading(false)
    }
  }

  const fetchCourses = async () => {
    try {
      const snapshot = await getDocs(collection(db, "courses"))
      const data = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }))
      setCourses(data)
    } catch (error) {
      console.error("Error fetching courses:", error)
    }
  }

  const handleSubmit = async (e) => {
    e.preventDefault()

    try {
      const couponData = {
        code: formData.code.toUpperCase(),
        couponType: formData.couponType,
        discountPercent: Number(formData.discountPercent),
        discountType: formData.discountType,
        discountAmount: Number(formData.discountAmount),
        minCartValue: Number(formData.minCartValue),
        applicableCourses: formData.applicableCourses,
        specificUsers: formData.couponType === "unique" && formData.specificUsers 
          ? formData.specificUsers.split(',').map(u => u.trim()).filter(Boolean)
          : [],
        requiredPurchasedCourses: formData.couponType === "unique" 
          ? formData.requiredPurchasedCourses 
          : [],
        minCoursePurchaseCount: formData.couponType === "unique" 
          ? Number(formData.minCoursePurchaseCount) 
          : 0,
        active: formData.active,
        expiryDate: formData.expiryDate ? Timestamp.fromDate(new Date(formData.expiryDate)) : null,
        updatedAt: serverTimestamp(),
      }

      if (editingId) {
        await updateDoc(doc(db, "coupons", editingId), couponData)
        toast({
          title: "Success",
          description: "Coupon updated successfully!",
        })
      } else {
        await addDoc(collection(db, "coupons"), {
          ...couponData,
          createdAt: serverTimestamp(),
        })
        toast({
          title: "Success",
          description: "Coupon created successfully!",
        })
      }

      setShowForm(false)
      setEditingId(null)
      setFormData({
        code: "",
        couponType: "universal",
        discountPercent: 10,
        discountType: "percentage",
        discountAmount: 0,
        minCartValue: 0,
        applicableCourses: [],
        specificUsers: "",
        requiredPurchasedCourses: [],
        minCoursePurchaseCount: 0,
        active: true,
        expiryDate: "",
      })
      fetchCoupons()
    } catch (error) {
      console.error("Error saving coupon:", error)
      toast({
        variant: "error",
        title: "Error",
        description: "Failed to save coupon",
      })
    }
  }

  const handleEdit = (coupon) => {
    setFormData({
      code: coupon.code || "",
      couponType: coupon.couponType || "universal",
      discountPercent: coupon.discountPercent || 10,
      discountType: coupon.discountType || "percentage",
      discountAmount: coupon.discountAmount || 0,
      minCartValue: coupon.minCartValue || 0,
      applicableCourses: coupon.applicableCourses || [],
      specificUsers: Array.isArray(coupon.specificUsers) ? coupon.specificUsers.join(', ') : "",
      requiredPurchasedCourses: coupon.requiredPurchasedCourses || [],
      minCoursePurchaseCount: coupon.minCoursePurchaseCount || 0,
      active: coupon.active !== false,
      expiryDate: coupon.expiryDate?.toDate?.()?.toISOString().split("T")[0] || "",
    })
    setEditingId(coupon.id)
    setShowForm(true)
  }

  const handleDelete = async (id) => {
    setConfirmDialog({
      isOpen: true,
      title: "Delete Coupon",
      message: "Are you sure you want to delete this coupon? This action cannot be undone.",
      variant: "destructive",
      onConfirm: async () => {
        try {
          await deleteDoc(doc(db, "coupons", id))
          toast({
            title: "Success",
            description: "Coupon deleted successfully!",
          })
          fetchCoupons()
        } catch (error) {
          console.error("Error deleting coupon:", error)
          toast({
            variant: "error",
            title: "Error",
            description: "Failed to delete coupon",
          })
        }
      }
    })
  }

  const resetForm = () => {
    setShowForm(false)
    setEditingId(null)
    setFormData({
      code: "",
      couponType: "universal",
      discountPercent: 10,
      discountType: "percentage",
      discountAmount: 0,
      minCartValue: 0,
      applicableCourses: [],
      specificUsers: "",
      requiredPurchasedCourses: [],
      minCoursePurchaseCount: 0,
      active: true,
      expiryDate: "",
    })
  }

  const toggleCourseSelection = (courseId) => {
    setFormData((prev) => ({
      ...prev,
      applicableCourses: prev.applicableCourses.includes(courseId)
        ? prev.applicableCourses.filter((id) => id !== courseId)
        : [...prev.applicableCourses, courseId],
    }))
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="animate-spin w-12 h-12 border-4 border-primary border-t-transparent rounded-full"></div>
      </div>
    )
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-3xl font-bold flex items-center gap-2">
          <Tag className="w-8 h-8 text-primary" />
          Manage Coupons
        </h1>
        <button
          onClick={() => setShowForm(true)}
          className="flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 transition-colors"
        >
          <Plus className="w-5 h-5" />
          New Coupon
        </button>
      </div>

      {showForm && (
        <motion.div
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
          className="bg-card border border-border rounded-xl p-6 mb-6 max-h-[80vh] overflow-y-auto"
        >
          <h2 className="text-xl font-semibold mb-4">{editingId ? "Edit Coupon" : "Create New Coupon"}</h2>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium mb-2">
                  Coupon Code <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  value={formData.code}
                  onChange={(e) => setFormData({ ...formData, code: e.target.value.toUpperCase() })}
                  className="w-full px-4 py-2 bg-input border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary uppercase"
                  placeholder="SUMMER2024"
                  required
                />
              </div>

              <div>
                <label className="block text-sm font-medium mb-2">Coupon Type</label>
                <select
                  value={formData.couponType}
                  onChange={(e) => setFormData({ ...formData, couponType: e.target.value })}
                  className="w-full px-4 py-2 bg-input border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary"
                >
                  <option value="universal">Universal (All Users)</option>
                  <option value="unique">Unique (Specific Conditions)</option>
                </select>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium mb-2">Discount Type</label>
                <select
                  value={formData.discountType}
                  onChange={(e) => setFormData({ ...formData, discountType: e.target.value })}
                  className="w-full px-4 py-2 bg-input border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary"
                >
                  <option value="percentage">Percentage (%)</option>
                  <option value="fixed">Fixed Amount (BDT)</option>
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium mb-2">
                  {formData.discountType === "percentage" ? "Discount %" : "Discount Amount (BDT)"}
                  <span className="text-red-500">*</span>
                </label>
                <input
                  type="number"
                  value={formData.discountType === "percentage" ? formData.discountPercent : formData.discountAmount}
                  onChange={(e) =>
                    setFormData({
                      ...formData,
                      [formData.discountType === "percentage" ? "discountPercent" : "discountAmount"]: e.target.value,
                    })
                  }
                  min="1"
                  max={formData.discountType === "percentage" ? "100" : "999999"}
                  className="w-full px-4 py-2 bg-input border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary"
                  required
                />
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium mb-2">Minimum Cart Value (BDT)</label>
              <input
                type="number"
                value={formData.minCartValue}
                onChange={(e) => setFormData({ ...formData, minCartValue: e.target.value })}
                min="0"
                className="w-full px-4 py-2 bg-input border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary"
                placeholder="0 for no minimum"
              />
            </div>

            <div>
              <label className="block text-sm font-medium mb-2">Applicable Courses (Leave empty for all courses)</label>
              <div className="grid grid-cols-2 gap-2 max-h-48 overflow-y-auto p-3 bg-input border border-border rounded-lg">
                {courses.map((course) => (
                  <label key={course.id} className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={formData.applicableCourses.includes(course.id)}
                      onChange={() => toggleCourseSelection(course.id)}
                      className="w-4 h-4"
                    />
                    <span className="text-sm truncate">{course.title}</span>
                  </label>
                ))}
              </div>
            </div>

            {formData.couponType === "unique" && (
              <div className="space-y-4 p-4 border border-blue-500 rounded-lg bg-blue-500/5">
                <h3 className="font-semibold text-blue-600">Unique Coupon Conditions</h3>
                
                <div>
                  <label className="block text-sm font-medium mb-2">
                    Specific Users (Optional - Email/UID, comma separated)
                  </label>
                  <textarea
                    value={formData.specificUsers}
                    onChange={(e) => setFormData({ ...formData, specificUsers: e.target.value })}
                    className="w-full px-4 py-2 bg-input border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary"
                    placeholder="user1@example.com, user2@example.com, uid123"
                    rows="2"
                  />
                  <p className="text-xs text-muted-foreground mt-1">
                    Leave empty to allow all users. Enter user emails or UIDs separated by commas.
                  </p>
                </div>

                <div>
                  <label className="block text-sm font-medium mb-2">
                    Required Purchased Courses (Optional)
                  </label>
                  <div className="grid grid-cols-2 gap-2 max-h-48 overflow-y-auto p-3 bg-input border border-border rounded-lg">
                    {courses.map((course) => (
                      <label key={course.id} className="flex items-center gap-2 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={formData.requiredPurchasedCourses.includes(course.id)}
                          onChange={() => {
                            setFormData((prev) => ({
                              ...prev,
                              requiredPurchasedCourses: prev.requiredPurchasedCourses.includes(course.id)
                                ? prev.requiredPurchasedCourses.filter((id) => id !== course.id)
                                : [...prev.requiredPurchasedCourses, course.id],
                            }))
                          }}
                          className="w-4 h-4"
                        />
                        <span className="text-sm truncate">{course.title}</span>
                      </label>
                    ))}
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">
                    User must have purchased these courses to use this coupon.
                  </p>
                </div>

                <div>
                  <label className="block text-sm font-medium mb-2">
                    Minimum Course Purchase Count (Optional)
                  </label>
                  <input
                    type="number"
                    value={formData.minCoursePurchaseCount}
                    onChange={(e) => setFormData({ ...formData, minCoursePurchaseCount: e.target.value })}
                    min="0"
                    className="w-full px-4 py-2 bg-input border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary"
                    placeholder="0 for no minimum"
                  />
                  <p className="text-xs text-muted-foreground mt-1">
                    User must have purchased at least this many courses (e.g., 3, 5).
                  </p>
                </div>
              </div>
            )}

            <div>
              <label className="block text-sm font-medium mb-2">Expiry Date (Optional)</label>
              <input
                type="date"
                value={formData.expiryDate}
                onChange={(e) => setFormData({ ...formData, expiryDate: e.target.value })}
                className="w-full px-4 py-2 bg-input border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary"
              />
            </div>

            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                id="active"
                checked={formData.active}
                onChange={(e) => setFormData({ ...formData, active: e.target.checked })}
                className="w-4 h-4"
              />
              <label htmlFor="active" className="text-sm font-medium">
                Active
              </label>
            </div>

            <div className="flex gap-3">
              <button
                type="submit"
                className="px-6 py-2 bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 transition-colors"
              >
                {editingId ? "Update" : "Create"} Coupon
              </button>
              <button
                type="button"
                onClick={resetForm}
                className="px-6 py-2 bg-muted rounded-lg hover:bg-muted/80 transition-colors"
              >
                Cancel
              </button>
            </div>
          </form>
        </motion.div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {coupons.map((coupon) => (
          <div
            key={coupon.id}
            className={`bg-card border rounded-xl p-6 ${coupon.active ? "border-primary" : "border-border opacity-60"}`}
          >
            <div className="flex items-start justify-between mb-4">
              <div className="flex-1">
                <h3 className="font-bold text-2xl mb-2 font-mono">{coupon.code}</h3>
                <p className="text-3xl font-bold text-primary mb-2">
                  {coupon.discountType === "percentage"
                    ? `${coupon.discountPercent}% OFF`
                    : `৳${coupon.discountAmount} OFF`}
                </p>
                {coupon.minCartValue > 0 && (
                  <p className="text-xs text-muted-foreground">Min: ৳{coupon.minCartValue}</p>
                )}
                {coupon.expiryDate && (
                  <p className="text-xs text-muted-foreground">
                    Expires: {coupon.expiryDate?.toDate?.()?.toLocaleDateString()}
                  </p>
                )}
                <p className="text-xs text-muted-foreground mt-1">Status: {coupon.active ? "Active" : "Inactive"}</p>
              </div>
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => handleEdit(coupon)}
                className="flex-1 p-2 hover:bg-primary/10 rounded-lg transition-colors"
              >
                <Edit className="w-4 h-4 text-primary mx-auto" />
              </button>
              <button
                onClick={() => handleDelete(coupon.id)}
                className="flex-1 p-2 hover:bg-destructive/10 rounded-lg transition-colors"
              >
                <Trash2 className="w-4 h-4 text-destructive mx-auto" />
              </button>
            </div>
          </div>
        ))}
      </div>

      {coupons.length === 0 && (
        <div className="text-center py-12">
          <Tag className="w-16 h-16 text-muted-foreground mx-auto mb-4" />
          <p className="text-muted-foreground">No coupons yet. Create your first one!</p>
        </div>
      )}

      <ConfirmDialog
        isOpen={confirmDialog.isOpen}
        onClose={() => setConfirmDialog({ ...confirmDialog, isOpen: false })}
        onConfirm={confirmDialog.onConfirm}
        title={confirmDialog.title}
        message={confirmDialog.message}
        variant={confirmDialog.variant}
      />
    </div>
  )
}
