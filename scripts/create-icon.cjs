const fs = require('node:fs/promises');
const path = require('node:path');
// Uses the same Lucide film glyph family as the application (ISC).
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256" viewBox="0 0 256 256"><rect x="8" y="8" width="240" height="240" rx="54" fill="#2c685e"/><g transform="translate(56 56) scale(6)" fill="none" stroke="#f4edd5" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="2" width="20" height="20" rx="2.18" ry="2.18"/><path d="M7 2v20M17 2v20M2 12h20M2 7h5M2 17h5M17 17h5M17 7h5"/></g></svg>`;
(async () => {
  const sharp = require(process.env.FRAME_SHARP_MODULE || 'sharp');
  const directory = path.resolve(__dirname, '../assets'); await fs.mkdir(directory, { recursive: true });
  await fs.writeFile(path.join(directory, 'icon.svg'), svg);
  const png = await sharp(Buffer.from(svg)).png().toBuffer();
  await fs.writeFile(path.join(directory, 'icon.png'), png);
  const header = Buffer.alloc(22); header.writeUInt16LE(1, 2); header.writeUInt16LE(1, 4);
  header.writeUInt16LE(1, 10); header.writeUInt16LE(32, 12); header.writeUInt32LE(png.length, 14); header.writeUInt32LE(22, 18);
  await fs.writeFile(path.join(directory, 'icon.ico'), Buffer.concat([header, png]));
})();
