// এই ফাইলটি Root ফোল্ডারের api/upload-image.js এ আছে
// এই ফাইলটি Vercel এ সার্ভারলেস ফাংশন হিসেবে রান করে

const IMGBB_API_KEY = process.env.IMGBB_API_KEY;
const IMGBB_UPLOAD_URL = `https://api.imgbb.com/1/upload?key=${IMGBB_API_KEY}`;

// সার্ভারলেস ফাংশন হ্যান্ডলার
export default async function handler(req, res) {
  // শুধুমাত্র POST রিকোয়েস্ট সাপোর্ট করে
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST']);
    return res.status(405).json({ success: false, error: "Method Not Allowed" });
  }
  
  if (!IMGBB_API_KEY) {
    console.error("IMGBB_API_KEY is missing!");
    return res.status(500).json({ success: false, error: "Server configuration error: Image service key missing." });
  }
  
  // ক্লায়েন্ট থেকে JSON বডি parse করা হচ্ছে
  const { image } = req.body;
  
  if (!image) {
    return res.status(400).json({ success: false, error: "Missing 'image' base64 string in request body." });
  }
  
  try {
    // Base64 স্ট্রিংটিকে URL-encoded বডিতে ফরম্যাট করা হচ্ছে
    // ImgBB API এর এই ফরম্যাট প্রয়োজন: image=<base64_string>
    const formData = new URLSearchParams();
    // কোনো decodeURIComponent ব্যবহার না করে সরাসরি Base64 স্ট্রিং পাঠানো হচ্ছে
    formData.append('image', image);
    
    // ImgBB API এ কল করা হচ্ছে
    const imgbbResponse = await fetch(IMGBB_UPLOAD_URL, {
      method: 'POST',
      headers: {
        // এটি application/x-www-form-urlencoded ফরম্যাট ব্যবহার করে
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: formData.toString(), // URLSearchParams থেকে স্ট্রিং তৈরি করে পাঠানো হচ্ছে
    });
    
    const imgbbData = await imgbbResponse.json();
    
    // ImgBB এর রেসপন্স যাচাই করা হচ্ছে
    if (!imgbbResponse.ok || !imgbbData.success) {
      console.error("ImgBB API Error:", imgbbData);
      // ImgBB থেকে আসা error ক্লায়েন্টকে ফেরত পাঠানো হচ্ছে
      return res.status(imgbbResponse.status).json({
        success: false,
        error: imgbbData.error?.message || imgbbData.error || "ImgBB upload failed due to API error."
      });
    }
    
    // সফল হলে, আপলোড করা ছবির URL ক্লায়েন্টকে পাঠানো হচ্ছে
    return res.status(200).json({
      success: true,
      url: imgbbData.data.url,
      display_url: imgbbData.data.display_url
    });
    
  } catch (error) {
    console.error("Server Error during ImgBB upload:", error);
    return res.status(500).json({ success: false, error: `Internal Server Error: ${error.message}` });
  }
}