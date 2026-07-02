import sharp from "sharp";

const svg = `<svg width="512" height="512" xmlns="http://www.w3.org/2000/svg">
  <rect width="512" height="512" rx="80" fill="#030712"/>
  <circle cx="256" cy="240" r="140" fill="none" stroke="#eab308" stroke-width="16"/>
  <text x="256" y="260" text-anchor="middle" font-size="120" font-weight="bold" fill="#fbbf24" font-family="Arial">AU</text>
  <text x="256" y="420" text-anchor="middle" font-size="60" font-weight="bold" fill="#a3a3a3" font-family="Arial">ILS</text>
</svg>`;

const buf = Buffer.from(svg);
await sharp(buf).resize(512, 512).png().toFile("public/icon-512.png");
await sharp(buf).resize(192, 192).png().toFile("public/icon-192.png");
console.log("Icons generated");
