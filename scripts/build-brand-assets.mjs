import { readFile, writeFile } from "node:fs/promises";
import sharp from "sharp";

// Única geometría maestra; PNG e ICO se derivan sin red ni recursos externos.
const mark = await readFile(
  new URL("../public/brand/portal-mark.svg", import.meta.url),
);
const source = mark.toString();
// Misma geometría: sólo se invierten marfil y carbón, manteniendo el bermellón.
await writeFile(
  new URL("../public/brand/portal-mark-dark.svg", import.meta.url),
  source.replace(/#FFF8EF|#293638/g, (color) =>
    color === "#FFF8EF" ? "#293638" : "#FFF8EF",
  ),
);
// El SVG de la pestaña sigue la preferencia de color del navegador.
await writeFile(
  new URL("../public/brand/portal-favicon.svg", import.meta.url),
  source.replace(
    "  <circle",
    '  <style>@media(prefers-color-scheme:dark){circle{fill:#293638}path[fill="#293638"]{fill:#FFF8EF}}</style>\n  <circle',
  ),
);
const sizes = [16, 32, 48];
const images = await Promise.all(
  sizes.map((size) => sharp(mark).resize(size, size).png().toBuffer()),
);
const header = Buffer.alloc(6 + images.length * 16);
header.writeUInt16LE(1, 2);
header.writeUInt16LE(images.length, 4);
let offset = header.length;
images.forEach((image, index) => {
  const entry = 6 + index * 16;
  header[entry] = sizes[index];
  header[entry + 1] = sizes[index];
  header.writeUInt16LE(1, entry + 4);
  header.writeUInt16LE(32, entry + 6);
  header.writeUInt32LE(image.length, entry + 8);
  header.writeUInt32LE(offset, entry + 12);
  offset += image.length;
});
await writeFile(
  new URL("../public/favicon.ico", import.meta.url),
  Buffer.concat([header, ...images]),
);
await sharp(mark)
  .resize(180, 180)
  .png()
  .toFile(new URL("../public/apple-touch-icon.png", import.meta.url).pathname);
