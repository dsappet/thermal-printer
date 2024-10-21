import { readFile } from "fs/promises";
import { savePastebinImage } from "../helpers/pastebin";

async function main() {
  try {
    const imagePath = "mascot.png";
    const imageBuffer = await readFile(imagePath);

    const pasteUrl = await savePastebinImage(imageBuffer, "Mascot Image");
    console.log(`Image URL: ${pasteUrl}`);
  } catch (error) {
    console.error("Error:", error);
  }
}

main();
