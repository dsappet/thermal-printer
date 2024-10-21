import OpenAI from "openai";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

export const generateImage = async (prompt: string): Promise<Buffer> => {
  const response = await openai.images.generate({
    model: "dall-e-3", // cheaper
    prompt,
    n: 1,
    size: "1024x1024", // 512x512 256x256,1024x1024 are also options
    response_format: "b64_json",
  });

  // console.log(response.data[0].url); // this is the url of the image if response_format is url
  const base64Data = response.data[0].b64_json;
  if (!base64Data) {
    throw new Error("No image data returned from OpenAI");
  }
  const buffer = Buffer.from(base64Data, "base64");
  const fs = require("fs");
  fs.writeFileSync("generated_image.png", buffer);
  console.log("Image saved as generated_image.png");
  return buffer;
};
