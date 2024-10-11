export async function savePastebinImage(
  imageBuffer: Buffer,
  title: string = "Image"
): Promise<string> {
  const apiDevKey = process.env.PASTEBIN_API_DEV_KEY;
  const apiUserKey = process.env.PASTEBIN_API_USER_KEY;
  if (!apiDevKey || !apiUserKey) {
    throw new Error("PASTEBIN_API_KEY is not set in environment variables");
  }

  // Convert image buffer to base64
  const base64Image = imageBuffer.toString("base64");

  // Prepare the form data for Pastebin API
  const formData = new URLSearchParams();
  formData.append("api_dev_key", apiDevKey);
  formData.append("api_user_key", apiUserKey);
  formData.append("api_option", "paste");
  // formData.append("api_paste_name", title);
  formData.append("api_paste_code", base64Image);
  // formData.append("api_paste_format", "text");
  formData.append("api_paste_private", "2"); // 0 = public, 1 = unlisted, 2 = private
  formData.append("api_paste_expire_date", "10M"); // expires in 10 minutes

  try {
    const response = await fetch("https://pastebin.com/api/api_post.php", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: formData.toString(),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(
        `HTTP error! status: ${response.status}, message: ${errorText}`
      );
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const pasteUrl = await response.text();
    console.log(`Image saved to Pastebin: ${pasteUrl}`);
    return pasteUrl;
  } catch (error) {
    console.error("Error saving image to Pastebin:", error);
    throw error;
  }
}
