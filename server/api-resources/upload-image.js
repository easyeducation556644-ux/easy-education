// Root/api/upload-image.js
// Vercel serverless function

const PRIMARY_KEY = process.env.IMGBB_API_KEY;
const FALLBACK_KEY = "0d267be5e8928ea39f484023c8f8f5bc";

function getUploadUrl(key) {
  return `https://api.imgbb.com/1/upload?key=${key}`;
}

async function uploadWithKey(image, apiKey) {
  const formData = new URLSearchParams();
  formData.append("image", image);

  const response = await fetch(getUploadUrl(apiKey), {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: formData.toString(),
  });

  const data = await response.json();

  if (!response.ok || !data.success) {
    throw new Error(
      data?.error?.message || data?.error || "ImgBB upload failed"
    );
  }

  return data.data;
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", ["POST"]);
    return res
      .status(405)
      .json({ success: false, error: "Method Not Allowed" });
  }

  if (!PRIMARY_KEY) {
    console.error("IMGBB_API_KEY missing");
    return res.status(500).json({
      success: false,
      error: "Server misconfiguration: IMGBB key missing",
    });
  }

  const { image } = req.body;

  if (!image) {
    return res.status(400).json({
      success: false,
      error: "Missing 'image' base64 string",
    });
  }

  try {
    // 1️⃣ Try primary key
    const data = await uploadWithKey(image, PRIMARY_KEY);

    return res.status(200).json({
      success: true,
      url: data.url,
      display_url: data.display_url,
      provider: "imgbb-primary",
    });
  } catch (primaryError) {
    console.warn("Primary ImgBB failed, trying fallback…");

    try {
      // 2️⃣ Try fallback key
      const data = await uploadWithKey(image, FALLBACK_KEY);

      return res.status(200).json({
        success: true,
        url: data.url,
        display_url: data.display_url,
        provider: "imgbb-fallback",
      });
    } catch (fallbackError) {
      console.error("Both ImgBB uploads failed", fallbackError);

      return res.status(500).json({
        success: false,
        error: "Image upload failed on all ImgBB keys",
      });
    }
  }
}
