import { useState, useEffect } from "react"
import { motion } from "framer-motion"
import { User, Building, Phone, Facebook, Linkedin, Github, Camera, Monitor, MapPin, Calendar } from "lucide-react"
import { doc, updateDoc } from "firebase/firestore"
import { db } from "../lib/firebase"
import { uploadImageToImgBB } from "../lib/imgbb"
import { useAuth } from "../contexts/AuthContext"

export default function Profile() {
  const { currentUser, userProfile, refreshUserProfile } = useAuth()
  const [formData, setFormData] = useState({
    name: "",
    institution: "",
    phone: "",
    facebook: "",
    linkedin: "",
    github: "",
  })
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState("")
  const [photoFile, setPhotoFile] = useState(null)
  const [photoPreview, setPhotoPreview] = useState(null)

  useEffect(() => {
    if (userProfile) {
      setFormData({
        name: userProfile.name || "",
        institution: userProfile.institution || "",
        phone: userProfile.phone || "",
        facebook: userProfile.socialLinks?.facebook || "",
        linkedin: userProfile.socialLinks?.linkedin || "",
        github: userProfile.socialLinks?.github || "",
      })
      setPhotoPreview(userProfile.photoURL || null)
    }
  }, [userProfile])

  const handleChange = (e) => {
    setFormData({
      ...formData,
      [e.target.name]: e.target.value,
    })
  }

  const handlePhotoSelect = (e) => {
    const file = e.target.files?.[0]
    if (file) {
      setPhotoFile(file)
      const reader = new FileReader()
      reader.onloadend = () => {
        setPhotoPreview(reader.result)
      }
      reader.readAsDataURL(file)
    }
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (!currentUser) {
      setMessage("You must be logged in to update your profile.")
      return
    }

    setLoading(true)
    setMessage("")

    try {
      console.log(" Starting profile update for user:", currentUser.uid)
      let photoURL = userProfile?.photoURL || ""

      if (photoFile) {
        console.log(" Uploading profile photo to imgbb...")
        try {
          photoURL = await uploadImageToImgBB(photoFile)
          console.log(" Photo uploaded successfully:", photoURL)
        } catch (uploadError) {
          console.error(" Photo upload error:", uploadError)
          throw new Error(uploadError.message || "Failed to upload photo. Please try again.")
        }
      }

      console.log(" Updating user document...")
      const userRef = doc(db, "users", currentUser.uid)

      const updateData = {
        name: formData.name,
        institution: formData.institution,
        phone: formData.phone,
        socialLinks: {
          facebook: formData.facebook,
          linkedin: formData.linkedin,
          github: formData.github,
        },
      }

      if (photoURL) {
        updateData.photoURL = photoURL
      }

      console.log(" Update data:", updateData)

      await updateDoc(userRef, updateData)
      console.log(" User document updated successfully")

      await new Promise((resolve) => setTimeout(resolve, 500))
      await refreshUserProfile()
      console.log(" Profile refreshed")

      setMessage("Profile updated successfully!")
      setPhotoFile(null)
      setTimeout(() => setMessage(""), 3000)
    } catch (error) {
      console.error(" Error updating profile:", error)
      console.error(" Error code:", error.code)
      console.error(" Error message:", error.message)

      let errorMessage = "Failed to update profile. "
      if (error.code === "permission-denied") {
        errorMessage += "You don't have permission to update this profile. Check Firestore security rules."
      } else if (error.code === "not-found") {
        errorMessage += "User profile not found. Please try logging out and back in."
      } else if (error.code === "unavailable") {
        errorMessage += "Cannot connect to database. Check your internet connection."
      } else if (error.message) {
        errorMessage += error.message
      } else {
        errorMessage += "Please try again."
      }

      setMessage(errorMessage)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen py-12 px-4">
      <div className="container mx-auto max-w-3xl">
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="mb-8">
          <h1 className="text-4xl font-bold mb-2">Profile Settings</h1>
          <p className="text-muted-foreground">Manage your account information</p>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
          className="bg-card border border-border rounded-xl p-8"
        >
          {message && (
            <div
              className={`mb-6 p-4 rounded-lg ${
                message.includes("success")
                  ? "bg-green-500/10 border border-green-500/20 text-green-500"
                  : "bg-red-500/10 border border-red-500/20 text-red-500"
              }`}
            >
              {message}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-6">
            {/* Profile Photo */}
            <div className="flex flex-col items-center mb-8">
              <div className="relative">
                <div className="w-32 h-32 rounded-full bg-primary/20 flex items-center justify-center overflow-hidden">
                  {photoPreview ? (
                    <img
                      src={photoPreview || "/placeholder.svg"}
                      alt="Profile"
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <User className="w-16 h-16 text-primary" />
                  )}
                </div>
                <label className="absolute bottom-0 right-0 p-2 bg-primary hover:bg-primary/90 text-primary-foreground rounded-full cursor-pointer transition-colors">
                  <Camera className="w-5 h-5" />
                  <input type="file" accept="image/*" onChange={handlePhotoSelect} className="hidden" />
                </label>
              </div>
              <p className="text-sm text-muted-foreground mt-2">Click the camera icon to change photo</p>
            </div>

            {/* Name */}
            <div>
              <label htmlFor="name" className="block text-sm font-medium mb-2">
                Full Name
              </label>
              <div className="relative">
                <User className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-muted-foreground" />
                <input
                  id="name"
                  name="name"
                  type="text"
                  value={formData.name}
                  onChange={handleChange}
                  required
                  className="w-full pl-10 pr-4 py-3 bg-background border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary"
                />
              </div>
            </div>

            {/* Institution */}
            <div>
              <label htmlFor="institution" className="block text-sm font-medium mb-2">
                Institution
              </label>
              <div className="relative">
                <Building className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-muted-foreground" />
                <input
                  id="institution"
                  name="institution"
                  type="text"
                  value={formData.institution}
                  onChange={handleChange}
                  className="w-full pl-10 pr-4 py-3 bg-background border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary"
                />
              </div>
            </div>

            {/* Phone */}
            <div>
              <label htmlFor="phone" className="block text-sm font-medium mb-2">
                Phone Number
              </label>
              <div className="relative">
                <Phone className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-muted-foreground" />
                <input
                  id="phone"
                  name="phone"
                  type="tel"
                  value={formData.phone}
                  onChange={handleChange}
                  className="w-full pl-10 pr-4 py-3 bg-background border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary"
                />
              </div>
            </div>

            {/* Social Links */}
            <div className="pt-6 border-t border-border">
              <h3 className="text-lg font-semibold mb-4">Social Links</h3>

              <div className="space-y-4">
                <div>
                  <label htmlFor="facebook" className="block text-sm font-medium mb-2">
                    Facebook
                  </label>
                  <div className="relative">
                    <Facebook className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-muted-foreground" />
                    <input
                      id="facebook"
                      name="facebook"
                      type="url"
                      value={formData.facebook}
                      onChange={handleChange}
                      placeholder="https://facebook.com/username"
                      className="w-full pl-10 pr-4 py-3 bg-background border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary"
                    />
                  </div>
                </div>

                <div>
                  <label htmlFor="linkedin" className="block text-sm font-medium mb-2">
                    LinkedIn
                  </label>
                  <div className="relative">
                    <Linkedin className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-muted-foreground" />
                    <input
                      id="linkedin"
                      name="linkedin"
                      type="url"
                      value={formData.linkedin}
                      onChange={handleChange}
                      placeholder="https://linkedin.com/in/username"
                      className="w-full pl-10 pr-4 py-3 bg-background border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary"
                    />
                  </div>
                </div>

                <div>
                  <label htmlFor="github" className="block text-sm font-medium mb-2">
                    GitHub
                  </label>
                  <div className="relative">
                    <Github className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-muted-foreground" />
                    <input
                      id="github"
                      name="github"
                      type="url"
                      value={formData.github}
                      onChange={handleChange}
                      placeholder="https://github.com/username"
                      className="w-full pl-10 pr-4 py-3 bg-background border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary"
                    />
                  </div>
                </div>
              </div>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full py-3 bg-primary hover:bg-primary/90 text-primary-foreground rounded-lg font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loading ? "Saving..." : "Save Changes"}
            </button>
          </form>
        </motion.div>

        {userProfile?.devices && userProfile.devices.length > 0 && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.2 }}
            className="bg-card border border-border rounded-xl p-8 mt-6"
          >
            <h2 className="text-2xl font-bold mb-6 flex items-center gap-2">
              <Monitor className="w-6 h-6" />
              Active Devices ({userProfile.devices.length})
            </h2>
            <div className="space-y-4">
              {userProfile.devices.map((device, idx) => (
                <div key={idx} className="p-4 bg-muted/50 rounded-lg border border-border">
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-2">
                        <Monitor className="w-5 h-5 text-primary" />
                        <p className="font-semibold">Device {idx + 1}</p>
                      </div>
                      <div className="space-y-1 text-sm text-muted-foreground">
                        {device.ipAddress && device.ipAddress !== 'unknown' && (
                          <div className="flex items-center gap-2">
                            <MapPin className="w-4 h-4" />
                            <span className="font-medium">IP:</span>
                            <span className="font-mono">{device.ipAddress}</span>
                          </div>
                        )}
                        <div className="flex items-center gap-2">
                          <Monitor className="w-4 h-4" />
                          <span className="font-medium">Platform:</span>
                          <span>{device.platform || 'Unknown'}</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <Monitor className="w-4 h-4" />
                          <span className="font-medium">Resolution:</span>
                          <span>{device.screenResolution || 'Unknown'}</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <Calendar className="w-4 h-4" />
                          <span className="font-medium">Last Seen:</span>
                          <span>{new Date(device.timestamp || device.lastSeen).toLocaleString()}</span>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
            <p className="mt-4 text-sm text-muted-foreground">
              If you see a device you don't recognize, please contact support immediately.
            </p>
          </motion.div>
        )}
      </div>
    </div>
  )
}
