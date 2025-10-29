"use client"

import { useState, useEffect } from "react"
import { motion } from "framer-motion"
import { Heart, MessageCircle, Send, ImageIcon, Trash2, X, Loader2 } from "lucide-react"
import {
  collection,
  query,
  orderBy,
  onSnapshot,
  addDoc,
  updateDoc,
  deleteDoc,
  doc,
  getDoc,
  arrayUnion,
  arrayRemove,
  serverTimestamp,
  where,
  getDocs,
} from "firebase/firestore"
import { uploadImageToImgBB } from "../lib/imgbb"
import { db } from "../lib/firebase"
import { useAuth } from "../contexts/AuthContext"

export default function Community() {
  const { currentUser, userProfile, isAdmin } = useAuth()
  const [posts, setPosts] = useState([])
  const [newPostContent, setNewPostContent] = useState("")
  const [newPostImage, setNewPostImage] = useState(null)
  const [imagePreview, setImagePreview] = useState(null)
  const [loading, setLoading] = useState(false)
  const [expandedComments, setExpandedComments] = useState({})
  const [commentInputs, setCommentInputs] = useState({})
  const [postComments, setPostComments] = useState({})
  const [loadingComments, setLoadingComments] = useState({})
  const [communityEnabled, setCommunityEnabled] = useState(true)
  const [settingsLoading, setSettingsLoading] = useState(true)

  useEffect(() => {
    const fetchSettings = async () => {
      try {
        const settingsQuery = query(collection(db, "settings"), where("type", "==", "general"))
        const snapshot = await getDocs(settingsQuery)
        if (!snapshot.empty) {
          const settings = snapshot.docs[0].data()
          setCommunityEnabled(settings.communityEnabled !== false)
        }
      } catch (error) {
        console.error("Error fetching settings:", error)
      } finally {
        setSettingsLoading(false)
      }
    }
    fetchSettings()
  }, [])

  useEffect(() => {
    const postsQuery = query(collection(db, "posts"), orderBy("timestamp", "desc"))
    const unsubscribe = onSnapshot(
      postsQuery,
      async (snapshot) => {
        try {
          const postsData = await Promise.all(
            snapshot.docs.map(async (postDoc) => {
              const postData = { id: postDoc.id, ...postDoc.data() }

              try {
                const authorDoc = await getDoc(doc(db, "users", postData.authorId))
                postData.author = authorDoc.exists() ? authorDoc.data() : { name: "Unknown User" }
              } catch (error) {
                postData.author = { name: "Unknown User" }
              }

              return postData
            }),
          )
          setPosts(postsData)
        } catch (error) {
          console.error("Error processing posts:", error)
        }
      },
      (error) => {
        console.error("Error listening to posts:", error)
      },
    )

    return () => unsubscribe()
  }, [])

  useEffect(() => {
    const unsubscribers = []

    Object.entries(expandedComments).forEach(([postId, isExpanded]) => {
      if (isExpanded && !postComments[postId]) {
        console.log(" Setting up comment listener for post:", postId)
        setLoadingComments((prev) => ({ ...prev, [postId]: true }))
        setPostComments((prev) => ({ ...prev, [postId]: [] }))

        const commentsQuery = query(
          collection(db, "comments"),
          where("postId", "==", postId),
          orderBy("timestamp", "asc"),
        )

        const unsubscribe = onSnapshot(
          commentsQuery,
          async (snapshot) => {
            console.log(" Comments snapshot received for post:", postId)
            console.log(" Number of comments:", snapshot.docs.length)

            if (snapshot.docs.length === 0) {
              console.log(" No comments found in database for this post")
              setPostComments((prev) => ({ ...prev, [postId]: [] }))
              setLoadingComments((prev) => ({ ...prev, [postId]: false }))
              return
            }

            try {
              const comments = await Promise.all(
                snapshot.docs.map(async (commentDoc) => {
                  const commentData = { id: commentDoc.id, ...commentDoc.data() }
                  console.log(" Comment data:", commentData)

                  try {
                    const authorDoc = await getDoc(doc(db, "users", commentData.authorId))
                    commentData.author = authorDoc.exists() ? authorDoc.data() : { name: "Unknown User" }
                  } catch (error) {
                    console.error(" Error fetching comment author:", error)
                    commentData.author = { name: "Unknown User" }
                  }

                  return commentData
                }),
              )

              console.log(" Processed comments:", comments)
              setPostComments((prev) => ({ ...prev, [postId]: comments }))
              setLoadingComments((prev) => ({ ...prev, [postId]: false }))
            } catch (error) {
              console.error(" Error processing comments:", error)
              setPostComments((prev) => ({ ...prev, [postId]: [] }))
              setLoadingComments((prev) => ({ ...prev, [postId]: false }))
            }
          },
          (error) => {
            console.error(" Error listening to comments:", error)
            console.error(" Error code:", error.code)
            console.error(" Error message:", error.message)
            setPostComments((prev) => ({ ...prev, [postId]: [] }))
            setLoadingComments((prev) => ({ ...prev, [postId]: false }))
          },
        )

        unsubscribers.push(unsubscribe)
      }
    })

    return () => {
      unsubscribers.forEach((unsub) => unsub())
    }
  }, [expandedComments])

  const handleImageSelect = (e) => {
    const file = e.target.files?.[0]
    if (file) {
      setNewPostImage(file)
      const reader = new FileReader()
      reader.onloadend = () => {
        setImagePreview(reader.result)
      }
      reader.readAsDataURL(file)
    }
  }

  const handleCreatePost = async (e) => {
    e.preventDefault()

    if (!currentUser) {
      alert("You must be logged in to create a post.")
      return
    }

    if (!newPostContent.trim() && !newPostImage) {
      alert("Please add some content or an image to your post.")
      return
    }

    setLoading(true)
    try {
      console.log(" Creating post for user:", currentUser.uid)
      let imageURL = null

      if (newPostImage) {
        console.log(" Uploading image to imgbb...")
        try {
          imageURL = await uploadImageToImgBB(newPostImage)
          console.log(" Image uploaded successfully:", imageURL)
        } catch (uploadError) {
          console.error(" Image upload error:", uploadError)
          throw new Error(uploadError.message || "Failed to upload image. Please try again.")
        }
      }

      console.log(" Adding post document to Firestore...")
      const postData = {
        authorId: currentUser.uid,
        content: newPostContent.trim(),
        imageURL,
        likes: [],
        commentsCount: 0,
        timestamp: serverTimestamp(),
      }

      console.log(" Post data:", postData)
      const docRef = await addDoc(collection(db, "posts"), postData)
      console.log(" Post created successfully with ID:", docRef.id)

      setNewPostContent("")
      setNewPostImage(null)
      setImagePreview(null)

      console.log(" Post will appear automatically via real-time listener")
    } catch (error) {
      console.error(" Error creating post:", error)
      console.error(" Error code:", error.code)
      console.error(" Error message:", error.message)

      let errorMessage = "Failed to create post. "
      if (error.code === "permission-denied") {
        errorMessage += "You don't have permission to create posts. Please check your Firestore security rules."
      } else if (error.code === "unavailable") {
        errorMessage += "Cannot connect to the database. Please check your internet connection."
      } else if (error.message) {
        errorMessage += error.message
      } else {
        errorMessage += "Please try again."
      }

      alert(errorMessage)
    } finally {
      setLoading(false)
    }
  }

  const handleLike = async (postId, likes) => {
    if (!currentUser) {
      alert("You must be logged in to like posts.")
      return
    }

    try {
      const postRef = doc(db, "posts", postId)
      if (likes.includes(currentUser.uid)) {
        await updateDoc(postRef, {
          likes: arrayRemove(currentUser.uid),
        })
      } else {
        await updateDoc(postRef, {
          likes: arrayUnion(currentUser.uid),
        })
      }
      console.log(" Like updated successfully")
    } catch (error) {
      console.error(" Error liking post:", error)
      alert("Failed to like post. Please try again.")
    }
  }

  const handleDeletePost = async (postId) => {
    if (!currentUser) return

    if (!confirm("Are you sure you want to delete this post?")) {
      return
    }

    try {
      await deleteDoc(doc(db, "posts", postId))
      console.log(" Post deleted successfully")
    } catch (error) {
      console.error(" Error deleting post:", error)
      alert("Failed to delete post. Please try again.")
    }
  }

  const toggleComments = async (postId) => {
    console.log(" Toggling comments for post:", postId)
    console.log(" Current expanded state:", expandedComments[postId])

    const newState = !expandedComments[postId]
    setExpandedComments((prev) => ({
      ...prev,
      [postId]: newState,
    }))

    if (newState && !postComments[postId]) {
      console.log(" Manually fetching comments to debug...")
      try {
        const commentsQuery = query(
          collection(db, "comments"),
          where("postId", "==", postId),
          orderBy("timestamp", "asc"),
        )
        const snapshot = await getDocs(commentsQuery)
        console.log(" Manual fetch result - number of comments:", snapshot.docs.length)
        snapshot.docs.forEach((doc) => {
          console.log(" Comment doc:", doc.id, doc.data())
        })
      } catch (error) {
        console.error(" Manual fetch error:", error)
      }
    }
  }

  const handleAddComment = async (postId) => {
    if (!currentUser) {
      alert("You must be logged in to comment.")
      return
    }

    const commentContent = commentInputs[postId]?.trim()
    if (!commentContent) {
      return
    }

    try {
      console.log(" Adding comment to post:", postId)
      console.log(" Comment content:", commentContent)
      console.log(" Current user:", currentUser.uid)

      const commentData = {
        postId: postId,
        authorId: currentUser.uid,
        content: commentContent,
        parentCommentId: null,
        timestamp: serverTimestamp(),
      }

      console.log(" Comment data to be saved:", commentData)

      const docRef = await addDoc(collection(db, "comments"), commentData)
      console.log(" Comment created with ID:", docRef.id)

      const post = posts.find((p) => p.id === postId)
      const newCount = (post?.commentsCount || 0) + 1
      console.log(" Updating comment count to:", newCount)

      await updateDoc(doc(db, "posts", postId), {
        commentsCount: newCount,
      })

      setCommentInputs((prev) => ({ ...prev, [postId]: "" }))

      console.log(" Comment added successfully, should appear via real-time listener")
    } catch (error) {
      console.error(" Error adding comment:", error)
      console.error(" Error code:", error.code)
      console.error(" Error message:", error.message)

      let errorMessage = "Failed to add comment. "
      if (error.code === "permission-denied") {
        errorMessage += "You don't have permission. Please check Firestore security rules."
      } else {
        errorMessage += "Please try again."
      }

      alert(errorMessage)
    }
  }

  if (settingsLoading) {
    return (
      <div className="min-h-screen py-12 px-4 flex items-center justify-center">
        <div className="animate-spin w-12 h-12 border-4 border-primary border-t-transparent rounded-full"></div>
      </div>
    )
  }

  if (!communityEnabled) {
    return (
      <div className="min-h-screen py-12 px-4">
        <div className="container mx-auto max-w-3xl">
          <div className="text-center py-12">
            <MessageCircle className="w-16 h-16 mx-auto mb-4 opacity-50" />
            <h2 className="text-2xl font-bold mb-2">Community Disabled</h2>
            <p className="text-muted-foreground mb-6">The community page is currently disabled by the administrator.</p>
          </div>
        </div>
      </div>
    )
  }

  if (!currentUser) {
    return (
      <div className="min-h-screen py-12 px-4">
        <div className="container mx-auto max-w-3xl">
          <div className="text-center py-12">
            <MessageCircle className="w-16 h-16 mx-auto mb-4 opacity-50" />
            <h2 className="text-2xl font-bold mb-2">Join the Community</h2>
            <p className="text-muted-foreground mb-6">Please log in to view and create posts in the community.</p>
            <a
              href="/login"
              className="inline-block px-6 py-3 bg-primary hover:bg-primary/90 text-primary-foreground rounded-lg font-medium transition-colors"
            >
              Log In
            </a>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen py-12 px-4">
      <div className="container mx-auto max-w-3xl">
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="mb-8">
          <h1 className="text-4xl font-bold mb-4">Community</h1>
          <p className="text-muted-foreground">Share your thoughts and connect with other learners</p>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="bg-card border border-border rounded-xl p-6 mb-8"
        >
          <form onSubmit={handleCreatePost}>
            <div className="flex gap-4">
              <div className="w-10 h-10 rounded-full bg-primary/20 flex items-center justify-center flex-shrink-0">
                {userProfile?.photoURL ? (
                  <img
                    src={userProfile.photoURL || "/placeholder.svg"}
                    alt={userProfile.name}
                    className="w-full h-full rounded-full object-cover"
                  />
                ) : (
                  <span className="text-primary font-semibold">{userProfile?.name?.[0] || "U"}</span>
                )}
              </div>
              <div className="flex-1">
                <textarea
                  value={newPostContent}
                  onChange={(e) => setNewPostContent(e.target.value)}
                  placeholder="What's on your mind?"
                  className="w-full p-3 bg-background border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary resize-none"
                  rows={3}
                />

                {imagePreview && (
                  <div className="mt-3 relative">
                    <img src={imagePreview || "/placeholder.svg"} alt="Preview" className="max-h-64 rounded-lg" />
                    <button
                      type="button"
                      onClick={() => {
                        setNewPostImage(null)
                        setImagePreview(null)
                      }}
                      className="absolute top-2 right-2 p-2 bg-background/80 hover:bg-background rounded-full"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                )}

                <div className="flex items-center justify-between mt-3">
                  <label className="flex items-center gap-2 px-4 py-2 bg-muted hover:bg-muted/80 rounded-lg cursor-pointer transition-colors">
                    <ImageIcon className="w-5 h-5" />
                    <span className="text-sm">Add Image</span>
                    <input type="file" accept="image/*" onChange={handleImageSelect} className="hidden" />
                  </label>

                  <button
                    type="submit"
                    disabled={loading || (!newPostContent.trim() && !newPostImage)}
                    className="flex items-center gap-2 px-6 py-2 bg-primary hover:bg-primary/90 text-primary-foreground rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    <Send className="w-4 h-4" />
                    <span>{loading ? "Posting..." : "Post"}</span>
                  </button>
                </div>
              </div>
            </div>
          </form>
        </motion.div>

        <div className="space-y-6">
          {posts.map((post, index) => (
            <motion.div
              key={post.id}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: index * 0.05 }}
              className="bg-card border border-border rounded-xl p-6"
            >
              <div className="flex items-start justify-between mb-4">
                <div className="flex gap-3">
                  <div className="w-10 h-10 rounded-full bg-primary/20 flex items-center justify-center flex-shrink-0">
                    {post.author?.photoURL ? (
                      <img
                        src={post.author.photoURL || "/placeholder.svg"}
                        alt={post.author.name}
                        className="w-full h-full rounded-full object-cover"
                      />
                    ) : (
                      <span className="text-primary font-semibold">{post.author?.name?.[0] || "U"}</span>
                    )}
                  </div>
                  <div>
                    <h3 className="font-semibold">{post.author?.name || "Unknown User"}</h3>
                    <p className="text-xs text-muted-foreground">
                      {post.timestamp?.toDate?.()?.toLocaleString() || "Just now"}
                    </p>
                  </div>
                </div>

                {(currentUser?.uid === post.authorId || isAdmin) && (
                  <button
                    onClick={() => handleDeletePost(post.id)}
                    className="p-2 hover:bg-muted rounded-lg transition-colors"
                    title={isAdmin && currentUser?.uid !== post.authorId ? "Admin: Delete post" : "Delete post"}
                  >
                    <Trash2 className="w-4 h-4 text-red-500" />
                  </button>
                )}
              </div>

              <p className="text-foreground mb-4 whitespace-pre-wrap">{post.content}</p>

              {post.imageURL && (
                <img
                  src={post.imageURL || "/placeholder.svg"}
                  alt="Post"
                  className="w-full rounded-lg mb-4 max-h-96 object-cover"
                />
              )}

              <div className="flex items-center gap-4 pt-4 border-t border-border">
                <button
                  onClick={() => handleLike(post.id, post.likes || [])}
                  disabled={!currentUser}
                  className={`flex items-center gap-2 px-4 py-2 rounded-lg transition-colors ${
                    post.likes?.includes(currentUser?.uid) ? "bg-primary/10 text-primary" : "hover:bg-muted"
                  }`}
                >
                  <Heart className={`w-5 h-5 ${post.likes?.includes(currentUser?.uid) ? "fill-current" : ""}`} />
                  <span>{post.likes?.length || 0}</span>
                </button>

                <button
                  onClick={() => toggleComments(post.id)}
                  className="flex items-center gap-2 px-4 py-2 hover:bg-muted rounded-lg transition-colors"
                >
                  <MessageCircle className="w-5 h-5" />
                  <span>{post.commentsCount || 0}</span>
                </button>
              </div>

              {expandedComments[post.id] && (
                <div className="mt-4 pt-4 border-t border-border">
                  {currentUser && (
                    <div className="flex gap-3 mb-4">
                      <div className="w-8 h-8 rounded-full bg-primary/20 flex items-center justify-center flex-shrink-0">
                        <span className="text-primary text-sm font-semibold">{userProfile?.name?.[0] || "U"}</span>
                      </div>
                      <div className="flex-1 flex gap-2">
                        <input
                          type="text"
                          value={commentInputs[post.id] || ""}
                          onChange={(e) => setCommentInputs((prev) => ({ ...prev, [post.id]: e.target.value }))}
                          placeholder="Write a comment..."
                          className="flex-1 px-3 py-2 bg-background border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary"
                          onKeyPress={(e) => {
                            if (e.key === "Enter") {
                              handleAddComment(post.id)
                            }
                          }}
                        />
                        <button
                          onClick={() => handleAddComment(post.id)}
                          className="px-4 py-2 bg-primary hover:bg-primary/90 text-primary-foreground rounded-lg transition-colors"
                        >
                          <Send className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  )}

                  {loadingComments[post.id] ? (
                    <div className="flex items-center justify-center py-8">
                      <Loader2 className="w-6 h-6 animate-spin text-primary" />
                      <span className="ml-2 text-sm text-muted-foreground">Loading comments...</span>
                    </div>
                  ) : postComments[post.id]?.length > 0 ? (
                    <div className="space-y-3 mt-4">
                      {postComments[post.id].map((comment) => (
                        <div key={comment.id} className="flex gap-3 p-3 bg-background rounded-lg">
                          <div className="w-8 h-8 rounded-full bg-primary/20 flex items-center justify-center flex-shrink-0">
                            {comment.author?.photoURL ? (
                              <img
                                src={comment.author.photoURL || "/placeholder.svg"}
                                alt={comment.author.name}
                                className="w-full h-full rounded-full object-cover"
                              />
                            ) : (
                              <span className="text-primary text-sm font-semibold">
                                {comment.author?.name?.[0] || "U"}
                              </span>
                            )}
                          </div>
                          <div className="flex-1">
                            <div className="flex items-center gap-2 mb-1">
                              <span className="font-semibold text-sm">{comment.author?.name || "Unknown"}</span>
                              <span className="text-xs text-muted-foreground">
                                {comment.timestamp?.toDate?.()?.toLocaleString() || "Just now"}
                              </span>
                            </div>
                            <p className="text-sm">{comment.content}</p>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="text-sm text-muted-foreground text-center py-4">
                      No comments yet. Be the first to comment!
                    </div>
                  )}
                </div>
              )}
            </motion.div>
          ))}

          {posts.length === 0 && (
            <div className="text-center py-12 text-muted-foreground">
              <MessageCircle className="w-16 h-16 mx-auto mb-4 opacity-50" />
              <p>No posts yet. Be the first to share something!</p>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
