/**
 * Convert BUGS.md to BUGS.pdf using Playwright + marked.
 * Embedded screenshots are resolved relative to BUGS.md.
 */
import { chromium } from 'playwright';
import { marked }   from 'marked';
import * as fs      from 'fs';
import * as path    from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const mdPath    = path.join(__dirname, 'BUGS.md');
const pdfPath   = path.join(__dirname, 'BUGS.pdf');

const md   = fs.readFileSync(mdPath, 'utf8');
const body = marked.parse(md);

const html = `<!doctype html>
<html><head><meta charset="utf-8"><title>NexterBackup QA Bug Report</title>
<style>
  @page { size: A4; margin: 18mm 16mm; }
  body {
    font: 11pt/1.5 -apple-system, "Segoe UI", Helvetica, Arial, sans-serif;
    color: #222;
    max-width: 100%;
  }
  h1 { font-size: 22pt; margin: 0 0 8pt; border-bottom: 2px solid #444; padding-bottom: 6pt; }
  h2 { font-size: 15pt; margin: 18pt 0 6pt; color: #b00020; border-bottom: 1px solid #ddd; padding-bottom: 2pt; page-break-after: avoid; }
  h3 { font-size: 12pt; margin: 10pt 0 4pt; }
  h4 { font-size: 11pt; margin: 8pt 0 4pt; color: #555; }
  table { border-collapse: collapse; width: 100%; margin: 8pt 0; font-size: 10pt; }
  th, td { border: 1px solid #ccc; padding: 4pt 6pt; text-align: left; vertical-align: top; }
  th { background: #f4f4f4; }
  pre { background: #f6f8fa; padding: 8pt; border-radius: 4px; font: 9pt Consolas, "Courier New", monospace; overflow-x: auto; white-space: pre-wrap; word-break: break-word; page-break-inside: avoid; }
  code { background: #f0f0f0; padding: 1px 4px; border-radius: 3px; font: 9.5pt Consolas, "Courier New", monospace; }
  pre code { background: transparent; padding: 0; }
  img { max-width: 100%; border: 1px solid #ddd; margin: 6pt 0; page-break-inside: avoid; }
  hr { border: none; border-top: 1px dashed #aaa; margin: 14pt 0; }
  blockquote { border-left: 3px solid #b00020; padding-left: 10pt; color: #555; margin: 8pt 0; }
  a { color: #0a60c2; text-decoration: none; }
  ul, ol { margin: 4pt 0 4pt 18pt; }
  li { margin: 2pt 0; }
  strong { color: #000; }
  /* Severity highlight */
  td:nth-child(2):contains("Blocker") { color: #b00020; font-weight: bold; }
</style>
</head><body>
${body}
</body></html>`;

const htmlPath = path.join(__dirname, '_bugs.html');
fs.writeFileSync(htmlPath, html);

const browser = await chromium.launch();
const context = await browser.newContext();
const page    = await context.newPage();

await page.goto('file://' + htmlPath.replace(/\\/g, '/'), { waitUntil: 'networkidle' });
await page.pdf({
  path: pdfPath,
  format: 'A4',
  printBackground: true,
  margin: { top: '18mm', bottom: '18mm', left: '16mm', right: '16mm' },
});

await browser.close();
fs.unlinkSync(htmlPath);

console.log('Wrote ' + pdfPath);
console.log('Size : ' + (fs.statSync(pdfPath).size / 1024).toFixed(1) + ' KB');
