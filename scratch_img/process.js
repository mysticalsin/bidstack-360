const { Jimp, intToRGBA, rgbaToInt } = require('jimp');

async function processImage() {
  try {
    console.log("Loading image...");
    const image = await Jimp.read('C:\\Users\\Tony\\.gemini\\antigravity\\brain\\71a4b8a8-63bc-4ab4-b9d2-81f7e9d00f38\\media__1780866221722.jpg');
    
    console.log("Autocropping...");
    image.autocrop({ tolerance: 0.1 });
    
    console.log("Processing pixels...");
    image.scan(0, 0, image.bitmap.width, image.bitmap.height, function(x, y, idx) {
      const r = this.bitmap.data[idx + 0];
      const g = this.bitmap.data[idx + 1];
      const b = this.bitmap.data[idx + 2];
      
      // If pixel is very close to white, make it transparent
      if (r > 240 && g > 240 && b > 240) {
        this.bitmap.data[idx + 3] = 0; // Alpha 0
      } else {
        // Optional: anti-aliasing could be improved by using alpha based on brightness
        // For now, strict cutoff since it's 4k.
      }
    });

    console.log("Saving...");
    image.write('d:\\BIDCRM\\apps\\web\\public\\logo-clear.png', (err) => {
      if (err) console.error(err);
      else console.log("Done! Saved as logo-clear.png");
    });
  } catch (err) {
    console.error(err);
  }
}

processImage();
