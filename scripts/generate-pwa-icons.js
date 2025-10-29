import sharp from 'sharp';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const publicDir = join(__dirname, '..', 'public');

async function generateIcons() {
  try {
    const sourceIcon = join(publicDir, 'placeholder-logo.png');
    
    console.log('Generating 192x192 icon...');
    await sharp(sourceIcon)
      .resize(192, 192, {
        fit: 'contain',
        background: { r: 59, g: 130, b: 246, alpha: 1 }
      })
      .png()
      .toFile(join(publicDir, 'icon-192x192.png'));
    
    console.log('Generating 512x512 icon...');
    await sharp(sourceIcon)
      .resize(512, 512, {
        fit: 'contain',
        background: { r: 59, g: 130, b: 246, alpha: 1 }
      })
      .png()
      .toFile(join(publicDir, 'icon-512x512.png'));
    
    console.log('✓ PWA icons generated successfully!');
    console.log('  - icon-192x192.png');
    console.log('  - icon-512x512.png');
  } catch (error) {
    console.error('Error generating icons:', error);
    process.exit(1);
  }
}

generateIcons();
