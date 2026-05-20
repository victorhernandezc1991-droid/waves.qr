// Genera iconos PWA (192 y 512) a partir de public/logo-waves.png
// Uso: node scripts/gen-icons.mjs
import sharp from "sharp";

const src = "public/logo-waves.png";

await sharp(src).resize(192, 192).toFile("public/icon-192.png");
console.log("✅ public/icon-192.png");

await sharp(src).resize(512, 512).toFile("public/icon-512.png");
console.log("✅ public/icon-512.png");
