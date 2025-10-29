/**
 * Client-side Image Upload Helper
 * Serverless function কে call করবে
 */

// API_URL সেট করা হচ্ছে
const API_URL = import.meta.env.VITE_API_URL || 'https://easy-education.vercel.app'

/**
 * File কে Base64 এ রূপান্তর করা হচ্ছে
 */
function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.readAsDataURL(file)
    reader.onload = () => resolve(reader.result)
    reader.onerror = (error) => reject(error)
  })
}

/**
 * File আপলোড করে (যা সার্ভারলেস ফাংশনকে কল করে)
 */
export async function uploadImageToImgBB(file) {
  if (!file) {
    throw new Error("No file provided for upload")
  }
  
  // File type এবং .heic ফরম্যাট চেক করা হচ্ছে
  if (!file.type.startsWith("image/") || file.name.toLowerCase().endsWith('.heic')) {
    throw new Error("File must be a standard image type (JPEG, PNG, etc.). HEIC is not supported.")
  }
  
  // File size (32MB max) চেক করা হচ্ছে
  const maxSize = 32 * 1024 * 1024
  if (file.size > maxSize) {
    throw new Error("Image size must be less than 32MB")
  }
  
  try {
    console.log("[Upload] Starting upload...")
    console.log("[Upload] File:", file.name, `(${(file.size / 1024).toFixed(2)} KB)`)
    
    // File কে Base64 এ রূপান্তর
    const base64 = await fileToBase64(file)
    // Data URI header (data:image/jpeg;base64,) রিমুভ করা হচ্ছে
    const base64Data = base64.replace(/^data:image\/\w+;base64,/, "")
    
    // সার্ভারলেস ফাংশনকে কল
    const response = await fetch(`${API_URL}/api/upload-image`, {
      method: "POST",
      headers: {
        // Base64 ডেটা JSON ফরম্যাটে পাঠানো হচ্ছে
        "Content-Type": "application/json",
      },
      // এখানে Base64 স্ট্রিংটিকে কোনো অতিরিক্ত এনকোডিং ছাড়াই পাঠানো হচ্ছে
      body: JSON.stringify({ image: base64Data }),
    })
    
    if (!response.ok) {
      // সার্ভার থেকে আসা JSON error parse করা হচ্ছে
      const errorText = await response.text();
      try {
        const errorData = JSON.parse(errorText);
        throw new Error(errorData.error || "Upload failed from server")
      } catch (e) {
        // যদি সার্ভার JSON না পাঠায়
        throw new Error(`Server returned non-JSON error (Status ${response.status}): ${errorText.substring(0, 100)}`)
      }
    }
    
    const data = await response.json()
    
    if (!data.success || !data.url) {
      throw new Error("Invalid success response from ImgBB")
    }
    
    console.log("[Upload] Success:", data.url)
    return data.url
    
  } catch (error) {
    console.error("[Upload] Failed:", error)
    throw new Error(`Failed to upload image: ${error.message}`)
  }
}

/**
 * Upload base64 string to server (নেমড এক্সপোর্ট হিসেবে রাখা হয়েছে)
 */
export async function uploadBase64ToImgbb(base64String) {
  // এই ফাংশনটি যেহেতু ব্যবহার হচ্ছে না, এর লজিক সরল রাখা হয়েছে
  if (!base64String) {
    throw new Error("No base64 string provided")
  }
  
  // ... (যদি আপনি ভবিষ্যতে এটি ব্যবহার করেন তবে একই Base64 লজিক এখানে আসবে) ...
  throw new Error("This function is currently disabled for primary image upload.")
}