import fs from 'node:fs';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';

const [file, password] = process.argv.slice(2);
const data = new Uint8Array(fs.readFileSync(file));
const doc = await pdfjs.getDocument({ data, password, useSystemFonts: true }).promise;

console.log(`pages: ${doc.numPages}`);

const page = await doc.getPage(1);
const { items } = await page.getTextContent();

console.log(`text items on page 1: ${items.length}`);

const rows = items
  .filter(i => i.str.trim())
  .map(i => ({
    str: i.str,
    x: Math.round(i.transform[4]),
    y: Math.round(i.transform[5]),
    w: Math.round(i.width),
  }))
  .sort((a, b) => b.y - a.y || a.x - b.x);

console.log(JSON.stringify(rows.slice(0, 80), null, 1));