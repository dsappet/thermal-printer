import sharp from "sharp";
import { JSDOM } from "jsdom";
import { savePastebinImage } from "./pastebin";

async function htmlToImage(
  html: string,
  width: number,
  height: number
): Promise<Buffer> {
  const dom = new JSDOM(html);
  const svgElement = dom.window.document.documentElement.outerHTML;

  const svg = `
    <svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
      <foreignObject width="100%" height="100%">
        ${svgElement}
      </foreignObject>
    </svg>
  `;
  const svgBuffer = Buffer.from(svg);

  const imageBuffer = await sharp(svgBuffer)
    // .resize(width, height, { fit: "contain", background: "white" })
    .png()
    .toBuffer();

  return imageBuffer;
}

export async function renderTextToImage(
  text: string,
  resolveWithObject: boolean = false
): Promise<Buffer> {
  try {
    const html = `
      <div style="font-family: Arial, sans-serif; font-size: 12px; white-space: pre-wrap;">
      ${text}
    </div>
  `;
    const width = 384;
    const initialHeight = 25; // Arbitrary large height to ensure all text is rendered

    // Render the image with an initial large height
    let imageBuffer = await htmlToImage(html, width, initialHeight);

    // Trim excess white space from the bottom of the image
    const { data, info } = await sharp(imageBuffer)
      .trim()
      .toBuffer({ resolveWithObject: true });

    // Resize the image to the trimmed height
    // imageBuffer = await sharp(data)
    //   .resize(width, info.height, { fit: "contain", background: "white" })
    //   .png()
    //   .toBuffer({ resolveWithObject });

    const pastebinUrl = await savePastebinImage(imageBuffer);
    const fs = require("fs");
    const path = require("path");

    const outputPath = path.join(__dirname, "output.png");
    fs.writeFileSync(outputPath, data);
    console.log(`Image saved to local file: ${outputPath}`);
    return {data, info};
  } catch (error) {
    console.error("Error rendering text to image:", error);
    throw error;
  }
}
