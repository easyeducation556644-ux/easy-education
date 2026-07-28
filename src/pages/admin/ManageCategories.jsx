"use client"

import { useState, useEffect } from "react"
import { motion } from "framer-motion"
import {
  Plus,
  Edit,
  Trash2,
  Loader2,
  ImageIcon,
  ArrowUp,
  ArrowDown,
} from "lucide-react"
import {
  collection,
  getDocs,
  addDoc,
  updateDoc,
  deleteDoc,
  doc,
  serverTimestamp,
  writeBatch,
} from "firebase/firestore"
import { db } from "../../lib/firebase"
import { uploadImageToImgBB } from "../../lib/imgbb"
import { normalizeCategoryOrder } from "../../lib/categoryOrder"
import { toast } from "../../hooks/use-toast"
import ConfirmDialog from "../../components/ConfirmDialog"

export default function ManageCategories() {
  const [categories, setCategories] = useState([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [editingCategory, setEditingCategory] = useState(null)
  const [uploading, setUploading] = useState(false)
  const [savingOrder, setSavingOrder] = useState(false)
  const [confirmDialog, setConfirmDialog] = useState({ isOpen: false, title: "", message: "", onConfirm: () => {} })
  const [formData, setFormData] = useState({
    title: "",
    imageURL: "",
  })

  useEffect(() => {
    fetchCategories()
  }, [])

  const fetchCategories = async () => {
    try {
      const snapshot = await getDocs(collection(db, "categories"))
      const data = normalizeCategoryOrder(
        snapshot.docs.map((categoryDoc) => ({
          id: categoryDoc.id,
          ...categoryDoc.data(),
        })),
      )
      setCategories(data)

      const needsNormalization = data.some((category, index) => {
        const storedCategory = snapshot.docs.find(
          (categoryDoc) => categoryDoc.id === category.id,
        )
        return Number(storedCategory?.data()?.displayOrder) !== index
      })

      if (needsNormalization) {
        const batch = writeBatch(db)
        data.forEach((category, index) => {
          batch.update(doc(db, "categories", category.id), {
            displayOrder: index,
          })
        })
        await batch.commit()
      }
    } catch (error) {
      console.error("Error fetching categories:", error)
    } finally {
      setLoading(false)
    }
  }

  const handleImageUpload = async (e) => {
    const file = e.target.files[0]
    if (!file) return

    setUploading(true)
    try {
      const imageUrl = await uploadImageToImgBB(file)
      setFormData({ ...formData, imageURL: imageUrl })
      toast({
        variant: "success",
        title: "Image Uploaded",
        description: "Image uploaded successfully!",
      })
    } catch (error) {
      console.error("Error uploading image:", error)
      toast({
        variant: "error",
        title: "Upload Failed",
        description: "Failed to upload image",
      })
    } finally {
      setUploading(false)
    }
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    setLoading(true)

    try {
      if (editingCategory) {
        await updateDoc(doc(db, "categories", editingCategory.id), {
          ...formData,
          updatedAt: serverTimestamp(),
        })
      } else {
        await addDoc(collection(db, "categories"), {
          ...formData,
          displayOrder: categories.length,
          createdAt: serverTimestamp(),
        })
      }

      setFormData({ title: "", imageURL: "" })
      setShowForm(false)
      setEditingCategory(null)
      fetchCategories()
      toast({
        variant: "success",
        title: editingCategory ? "Category Updated" : "Category Created",
        description: editingCategory ? "Category updated successfully!" : "Category created successfully!",
      })
    } catch (error) {
      console.error("Error saving category:", error)
      toast({
        variant: "error",
        title: "Save Failed",
        description: "Failed to save category",
      })
    } finally {
      setLoading(false)
    }
  }

  const handleEdit = (category) => {
    setEditingCategory(category)
    setFormData({
      title: category.title,
      imageURL: category.imageURL,
    })
    setShowForm(true)
  }

  const handleDelete = async (id) => {
    setConfirmDialog({
      isOpen: true,
      title: "Delete Category",
      message: "Are you sure you want to delete this category? This action cannot be undone.",
      variant: "destructive",
      onConfirm: async () => {
        try {
          await deleteDoc(doc(db, "categories", id))
          fetchCategories()
          toast({
            variant: "success",
            title: "Category Deleted",
            description: "Category deleted successfully!",
          })
        } catch (error) {
          console.error("Error deleting category:", error)
          toast({
            variant: "error",
            title: "Deletion Failed",
            description: "Failed to delete category",
          })
        }
      }
    })
  }

  const handleMoveCategory = async (categoryId, direction) => {
    if (savingOrder) return

    const currentIndex = categories.findIndex(
      (category) => category.id === categoryId,
    )
    const targetIndex = currentIndex + direction
    if (
      currentIndex < 0 ||
      targetIndex < 0 ||
      targetIndex >= categories.length
    ) {
      return
    }

    const reordered = [...categories]
    const previousOrderById = new Map(
      categories.map((category) => [category.id, category.displayOrder]),
    )
    const [movedCategory] = reordered.splice(currentIndex, 1)
    reordered.splice(targetIndex, 0, movedCategory)
    const normalized = reordered.map((category, index) => ({
      ...category,
      displayOrder: index,
    }))

    setCategories(normalized)
    setSavingOrder(true)

    try {
      const batch = writeBatch(db)
      normalized.forEach((category, index) => {
        if (Number(previousOrderById.get(category.id)) !== index) {
          batch.update(doc(db, "categories", category.id), {
            displayOrder: index,
            updatedAt: serverTimestamp(),
          })
        }
      })
      await batch.commit()
      toast({
        variant: "success",
        title: "Order Updated",
        description: "Category position updated successfully!",
      })
    } catch (error) {
      console.error("Error updating category order:", error)
      await fetchCategories()
      toast({
        variant: "error",
        title: "Order Update Failed",
        description: "Failed to update category position",
      })
    } finally {
      setSavingOrder(false)
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold">Manage Categories</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Use the arrow buttons to control the category order on the homepage.
          </p>
        </div>
        <button
          onClick={() => {
            setShowForm(!showForm)
            if (showForm) {
              setEditingCategory(null)
              setFormData({ title: "", imageURL: "" })
            }
          }}
          className="flex items-center justify-center gap-2 rounded-lg bg-primary px-4 py-2 text-primary-foreground transition-colors hover:bg-primary/90 sm:shrink-0"
        >
          <Plus className="w-4 h-4" />
          Add Category
        </button>
      </div>

      {showForm && (
        <motion.div
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
          className="bg-card border border-border rounded-xl p-6"
        >
          <h2 className="text-xl font-semibold mb-4">{editingCategory ? "Edit Category" : "Add New Category"}</h2>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-sm font-medium mb-2">Title</label>
              <input
                type="text"
                value={formData.title}
                onChange={(e) => setFormData({ ...formData, title: e.target.value })}
                className="w-full px-4 py-2 bg-background border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary"
                required
              />
            </div>

            <div>
              <label className="block text-sm font-medium mb-2">
                Category Image <span className="text-xs text-muted-foreground">(Optional)</span>
              </label>
              <div className="space-y-3">
                {formData.imageURL && (
                  <div className="relative w-full aspect-video rounded-lg overflow-hidden border border-border">
                    <img
                      src={formData.imageURL || "/placeholder.svg"}
                      alt="Preview"
                      className="w-full h-full object-cover"
                    />
                  </div>
                )}
                <div className="flex items-center gap-3">
                  <label className="flex items-center gap-2 px-4 py-2 bg-muted hover:bg-muted/80 rounded-lg cursor-pointer transition-colors">
                    <ImageIcon className="w-4 h-4" />
                    <span className="text-sm">{uploading ? "Uploading..." : "Choose Image"}</span>
                    <input
                      type="file"
                      accept="image/*"
                      onChange={handleImageUpload}
                      className="hidden"
                      disabled={uploading}
                    />
                  </label>
                  {uploading && <Loader2 className="w-5 h-5 animate-spin text-primary" />}
                  {formData.imageURL && (
                    <button
                      type="button"
                      onClick={() => setFormData({ ...formData, imageURL: "" })}
                      className="px-3 py-2 bg-red-500/10 hover:bg-red-500/20 text-red-500 rounded-lg transition-colors text-sm"
                    >
                      Remove
                    </button>
                  )}
                </div>
              </div>
            </div>

            <div className="flex gap-3">
              <button
                type="submit"
                disabled={loading || uploading}
                className="px-6 py-2 bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 transition-colors disabled:opacity-50"
              >
                {loading ? "Saving..." : editingCategory ? "Update" : "Create"}
              </button>
              <button
                type="button"
                onClick={() => {
                  setShowForm(false)
                  setEditingCategory(null)
                  setFormData({ title: "", imageURL: "" })
                }}
                className="px-6 py-2 bg-muted hover:bg-muted/80 rounded-lg transition-colors"
              >
                Cancel
              </button>
            </div>
          </form>
        </motion.div>
      )}

      {loading && categories.length === 0 ? (
        <div className="text-center py-12">
          <Loader2 className="w-8 h-8 animate-spin mx-auto text-primary" />
        </div>
      ) : categories.length > 0 ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {categories.map((category, index) => (
            <motion.div
              key={category.id}
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              className="bg-card border border-border rounded-xl overflow-hidden group"
            >
              <div className="aspect-video bg-gradient-to-br from-primary/20 to-secondary/20 relative">
                {category.imageURL ? (
                  <img
                    src={category.imageURL || "/placeholder.svg"}
                    alt={category.title}
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-primary/10 to-secondary/10">
                    <div className="text-center px-4">
                      <h3 className="text-2xl md:text-3xl font-bold bg-gradient-to-r from-primary to-secondary bg-clip-text text-transparent">
                        {category.title}
                      </h3>
                    </div>
                  </div>
                )}
              </div>
              <div className="p-4">
                <div className="mb-3 flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-xs font-medium text-muted-foreground">
                      Position {index + 1}
                    </p>
                    <h3 className="truncate text-lg font-semibold">
                      {category.title}
                    </h3>
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    <button
                      type="button"
                      onClick={() => handleMoveCategory(category.id, -1)}
                      disabled={savingOrder || index === 0}
                      className="rounded-lg border border-border p-2 transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-35"
                      aria-label={`Move ${category.title} up`}
                      title="Move up"
                    >
                      <ArrowUp className="h-4 w-4" />
                    </button>
                    <button
                      type="button"
                      onClick={() => handleMoveCategory(category.id, 1)}
                      disabled={
                        savingOrder || index === categories.length - 1
                      }
                      className="rounded-lg border border-border p-2 transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-35"
                      aria-label={`Move ${category.title} down`}
                      title="Move down"
                    >
                      <ArrowDown className="h-4 w-4" />
                    </button>
                  </div>
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={() => handleEdit(category)}
                    className="flex-1 px-4 py-2 bg-primary/10 hover:bg-primary/20 text-primary rounded-lg transition-colors flex items-center justify-center gap-2"
                  >
                    <Edit className="w-4 h-4" />
                    Edit
                  </button>
                  <button
                    onClick={() => handleDelete(category.id)}
                    className="flex-1 px-4 py-2 bg-red-500/10 hover:bg-red-500/20 text-red-500 rounded-lg transition-colors flex items-center justify-center gap-2"
                  >
                    <Trash2 className="w-4 h-4" />
                    Delete
                  </button>
                </div>
              </div>
            </motion.div>
          ))}
        </div>
      ) : (
        <div className="text-center py-12 bg-card border border-border rounded-xl">
          <ImageIcon className="w-16 h-16 mx-auto mb-4 text-muted-foreground" />
          <p className="text-muted-foreground">No categories yet. Create your first category!</p>
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
