'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { pathToFileURL } = require('node:url');

const root = __dirname;
const vendor = path.join(root, 'vendor', 'ocr');
const nodeModules = path.join(vendor, 'node_modules');
const pdfjsRoot = path.join(nodeModules, 'pdfjs-dist');
const MODEL_SHA256 = '8280aed0782fe27257a68ea10fe7ef324ca0f8d85bd2fd145d1c2b560bcb66ba';
const ENGINE_VERSION = '7.0.0';
const CORE_VERSION = '7.0.0';
const PDFJS_VERSION = '6.5.438';
const CANVAS_VERSION = '1.1.0';
let runtimeValidated = false;
let ocrWorkerPromise = null;

function packageVersion(packageName) {
  const packagePath = path.join(nodeModules, packageName, 'package.json');
  return JSON.parse(fs.readFileSync(packagePath, 'utf8')).version;
}

function validateRuntime() {
  if (runtimeValidated) return;
  if (process.platform !== 'win32' || process.arch !== 'x64') {
    throw new Error(`The bundled OCR package requires Windows x64. This device reports ${process.platform} ${process.arch}.`);
  }
  const expected = [
    ['tesseract.js', ENGINE_VERSION],
    ['tesseract.js-core', CORE_VERSION],
    ['pdfjs-dist', PDFJS_VERSION],
    ['@napi-rs/canvas', CANVAS_VERSION],
  ];
  for (const [name, version] of expected) {
    let actual;
    try { actual = packageVersion(name); }
    catch { throw new Error(`The bundled OCR package is incomplete: ${name} is missing. Reinstall the latest Extractor build.`); }
    if (actual !== version) throw new Error(`The bundled OCR package has an unexpected ${name} version (${actual}; Extractor requires ${version}). Reinstall the latest Extractor build.`);
  }
  const modelPath = path.join(vendor, 'models', 'eng.traineddata');
  let digest;
  try { digest = crypto.createHash('sha256').update(fs.readFileSync(modelPath)).digest('hex'); }
  catch { throw new Error('The bundled English OCR model is missing. Reinstall the latest Extractor build.'); }
  if (digest !== MODEL_SHA256) throw new Error('The bundled English OCR model failed its integrity check. Reinstall the latest Extractor build.');
  for (const relative of [
    'legacy/build/pdf.mjs', 'legacy/build/pdf.worker.mjs',
    'cmaps/UniGB-UCS2-H.bcmap', 'standard_fonts/FoxitSerif.pfb',
    'wasm/jbig2.wasm', 'wasm/openjpeg.wasm', 'wasm/qcms_bg.wasm',
    'wasm/quickjs-eval.wasm',
  ]) {
    if (!fs.existsSync(path.join(pdfjsRoot, relative))) throw new Error(`The bundled PDF renderer is incomplete (${relative} is missing). Reinstall the latest Extractor build.`);
  }
  runtimeValidated = true;
}

function getOcrWorker() {
  if (!ocrWorkerPromise) {
    ocrWorkerPromise = (async () => {
      const { createWorker, OEM } = require(path.join(nodeModules, 'tesseract.js'));
      const worker = await createWorker('eng', OEM.LSTM_ONLY, {
        workerPath: path.join(nodeModules, 'tesseract.js', 'src', 'worker-script', 'node', 'index.js'),
        corePath: path.join(nodeModules, 'tesseract.js-core', 'tesseract-core-lstm.js'),
        langPath: path.join(vendor, 'models'),
        gzip: false,
        cacheMethod: 'none',
      });
      await worker.setParameters({ preserve_interword_spaces: '1', user_defined_dpi: '180' });
      return worker;
    })().catch(error => {
      ocrWorkerPromise = null;
      throw error;
    });
  }
  return ocrWorkerPromise;
}

function groupTesseractLines(blocks, page, scale, offsetX, offsetY) {
  const lines = [];
  for (const block of blocks || []) {
    for (const paragraph of block.paragraphs || []) {
      for (const rawLine of paragraph.lines || []) {
        const words = (rawLine.words || []).filter(word => String(word.text || '').trim())
          .sort((a, b) => a.bbox.x0 - b.bbox.x0);
        let segment = [];
        const flush = () => {
          if (!segment.length) return;
          const minX = Math.min(...segment.map(word => word.bbox.x0));
          const minY = Math.min(...segment.map(word => word.bbox.y0));
          const maxX = Math.max(...segment.map(word => word.bbox.x1));
          const maxY = Math.max(...segment.map(word => word.bbox.y1));
          lines.push({
            page,
            text: segment.map(word => word.text).join(' ').replace(/\s+/g, ' ').trim(),
            x: (minX + offsetX) * 2 / scale,
            y: (minY + offsetY) * 2 / scale,
            width: (maxX - minX) * 2 / scale,
            height: (maxY - minY) * 2 / scale,
            confidence: segment.reduce((sum, word) => sum + Number(word.confidence || 0), 0) / segment.length / 100,
          });
          segment = [];
        };
        for (const word of words) {
          const previous = segment.at(-1);
          const gap = previous ? word.bbox.x0 - previous.bbox.x1 : 0;
          const wordHeight = (word.bbox.y1 - word.bbox.y0) * 2 / scale;
          // OCR engines can join separate table cells into one line. Split at
          // content-relative gaps while preserving ordinary word spacing.
          if (previous && gap * 2 / scale > Math.max(16, wordHeight * 1.2)) flush();
          segment.push(word);
        }
        flush();
      }
    }
  }
  return lines;
}

function visualInkRatio(canvas, createCanvas) {
  const width = 300;
  const height = Math.max(1, Math.min(500, Math.round(width * canvas.height / canvas.width)));
  const sample = createCanvas(width, height);
  const context = sample.getContext('2d');
  context.fillStyle = '#fff';
  context.fillRect(0, 0, width, height);
  context.drawImage(canvas, 0, 0, width, height);
  const pixels = context.getImageData(0, 0, width, height).data;
  let dark = 0;
  for (let index = 0; index < pixels.length; index += 4) {
    const gray = (pixels[index] * 30 + pixels[index + 1] * 59 + pixels[index + 2] * 11) / 100;
    if (gray < 220) dark++;
  }
  return dark / (width * height);
}

function rotate180(canvas, createCanvas) {
  const rotated = createCanvas(canvas.width, canvas.height);
  const context = rotated.getContext('2d');
  context.translate(canvas.width, canvas.height);
  context.rotate(Math.PI);
  context.drawImage(canvas, 0, 0);
  return rotated;
}

function mergeRegions(pageNumber, pageWidth, pageHeight, payload) {
  const regions = [];
  for (const region of payload.invoiceRetryRegions || []) {
    if (Number(region.page) === pageNumber) regions.push({
      left: Number(region.left), top: Number(region.top),
      right: Number(region.left) + Number(region.width),
      bottom: Number(region.top) + Number(region.height),
    });
  }
  for (const region of payload.bankRetryRegions || []) {
    if (Number(region.page) === pageNumber) regions.push({ left: 0, top: Number(region.top), right: pageWidth * 2, bottom: Number(region.bottom) });
  }
  for (const row of payload.dairyFooterRows || []) {
    if (Number(row.page) !== pageNumber) continue;
    const y1 = Math.min(Number(row.vatY), Number(row.totalY));
    const y2 = Math.max(Number(row.vatY), Number(row.totalY));
    regions.push({ left: 0, top: Math.max(0, y1 - 36), right: pageWidth * 2, bottom: Math.min(pageHeight * 2, y2 + 36) });
  }
  if (!regions.length) return null;
  const left = Math.max(0, Math.min(...regions.map(region => region.left)));
  const top = Math.max(0, Math.min(...regions.map(region => region.top)));
  const right = Math.min(pageWidth * 2, Math.max(...regions.map(region => region.right)));
  const bottom = Math.min(pageHeight * 2, Math.max(...regions.map(region => region.bottom)));
  if (!(right > left && bottom > top)) return null;
  return { left, top, right, bottom };
}

async function run(payload) {
  validateRuntime();
  const { getDocument, GlobalWorkerOptions } = await import(pathToFileURL(path.join(pdfjsRoot, 'legacy', 'build', 'pdf.mjs')).href);
  const { createCanvas } = require(path.join(nodeModules, '@napi-rs', 'canvas'));
  const worker = await getOcrWorker();
  GlobalWorkerOptions.workerSrc = pathToFileURL(path.join(pdfjsRoot, 'legacy', 'build', 'pdf.worker.mjs')).href;
  const pdfPath = path.resolve(String(payload.filePath || ''));
  if (!pdfPath.toLowerCase().endsWith('.pdf') || !fs.existsSync(pdfPath)) throw new Error('The selected PDF could not be found.');
  const scale = Math.min(5, Math.max(1.5, Number(payload.scale) || 2.5));
  const requestedPages = Array.isArray(payload.pages) ? new Set(payload.pages.map(Number).filter(page => Number.isInteger(page) && page > 0)) : null;
  const data = new Uint8Array(fs.readFileSync(pdfPath));
  const cMapUrl = pathToFileURL(path.join(pdfjsRoot, 'cmaps') + path.sep).href;
  const standardFontDataUrl = pathToFileURL(path.join(pdfjsRoot, 'standard_fonts') + path.sep).href;
  const wasmUrl = pathToFileURL(path.join(pdfjsRoot, 'wasm') + path.sep).href;
  let document;
  let loadingTask;
  try {
    loadingTask = getDocument({
      data,
      ...(payload.password ? { password: String(payload.password) } : {}),
      cMapUrl, cMapPacked: true, standardFontDataUrl, wasmUrl,
      // Render embedded or bundled standard fonts only. Installed fonts differ
      // between PCs and can otherwise change the OCR input pixels.
      useSystemFonts: false, isEvalSupported: false, verbosity: 0,
    });
    document = await loadingTask.promise;
  } catch (error) {
    if (error?.name === 'PasswordException' || /password/i.test(String(error?.message || ''))) {
      throw new Error('This PDF is password-protected. Enter the password supplied with the statement and try again.');
    }
    throw new Error(`The bundled PDF renderer could not open this PDF: ${error?.message || error}`);
  }

  const pageCount = document.numPages;
  const lines = [];
  const parts = [];
  const visualPages = [];
  let completed = 0;
  try {
    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber++) {
      if (requestedPages?.size && !requestedPages.has(pageNumber)) continue;
      const page = await document.getPage(pageNumber);
      const fullViewport = page.getViewport({ scale });
      const pageWidth = fullViewport.width / scale;
      const pageHeight = fullViewport.height / scale;
      const region = mergeRegions(pageNumber, pageWidth, pageHeight, payload);
      const fullCanvasWidth = Math.ceil(fullViewport.width);
      const fullCanvasHeight = Math.ceil(fullViewport.height);
      let viewport = fullViewport;
      let canvas;
      let offsetX = 0;
      let offsetY = 0;
      if (region) {
        // Retry requests only need the balance interval, but rendering a full
        // 5x page and cropping afterwards still allocates and rasterizes every
        // pixel. Offset the PDF viewport over a region-sized canvas so the
        // renderer clips to that interval from the start.
        const sourceX = Math.max(0, Math.floor(region.left * scale / 2));
        const sourceY = Math.max(0, Math.floor(region.top * scale / 2));
        const sourceRight = Math.min(fullCanvasWidth, Math.ceil(region.right * scale / 2));
        const sourceBottom = Math.min(fullCanvasHeight, Math.ceil(region.bottom * scale / 2));
        const cropWidth = Math.max(1, sourceRight - sourceX);
        const cropHeight = Math.max(1, sourceBottom - sourceY);
        viewport = page.getViewport({ scale, offsetX: -sourceX, offsetY: -sourceY });
        canvas = createCanvas(cropWidth, cropHeight);
        offsetX = sourceX;
        offsetY = sourceY;
      } else {
        canvas = createCanvas(fullCanvasWidth, fullCanvasHeight);
      }
      const context = canvas.getContext('2d');
      context.fillStyle = '#fff';
      context.fillRect(0, 0, canvas.width, canvas.height);
      await page.render({ canvasContext: context, viewport, background: '#fff' }).promise;
      if (visualInkRatio(canvas, createCanvas) >= 0.012) visualPages.push(pageNumber);

      const ocrCanvas = canvas;

      let result = await worker.recognize(ocrCanvas.toBuffer('image/png'), {}, { text: true, blocks: true });
      let pageLines = groupTesseractLines(result.data.blocks, pageNumber, scale, offsetX, offsetY);
      let pageText = String(result.data.text || '').trim();
      if (scale >= 4.5 && visualPages.includes(pageNumber) && pageLines.length < 5) {
        const rotated = rotate180(ocrCanvas, createCanvas);
        const rotatedResult = await worker.recognize(rotated.toBuffer('image/png'), {}, { text: true, blocks: true });
        const rotatedLines = groupTesseractLines(rotatedResult.data.blocks, pageNumber, scale, offsetX, offsetY)
          .map(line => ({
            ...line,
            x: (offsetX + ocrCanvas.width - ((line.x * scale / 2 - offsetX) + line.width * scale / 2)) * 2 / scale,
            y: (offsetY + ocrCanvas.height - ((line.y * scale / 2 - offsetY) + line.height * scale / 2)) * 2 / scale,
          }));
        if (rotatedLines.length > pageLines.length) {
          pageLines = rotatedLines;
          pageText = String(rotatedResult.data.text || '').trim();
        }
      }
      lines.push(...pageLines);
      if (pageText) parts.push(pageText);
      completed++;
      process.stdout.write(`PAGE:${JSON.stringify({ requestId: payload.requestId || '', page: pageNumber, pageCount: document.numPages, ocrLanguage: 'eng', ocrEngine: `Tesseract.js ${ENGINE_VERSION}`, ocrModel: 'eng tessdata_best', text: pageText, lines: pageLines })}\n`);
      page.cleanup();
      if (completed % 2 === 0) await new Promise(resolve => setImmediate(resolve));
    }
  } finally {
    await loadingTask?.destroy();
  }
  return {
    ok: true,
    pages: pageCount,
    ocrLanguage: 'eng',
    ocrEngine: `Tesseract.js ${ENGINE_VERSION}`,
    ocrCore: `tesseract.js-core ${CORE_VERSION} LSTM portable`,
    ocrModel: `eng tessdata_best sha256:${MODEL_SHA256}`,
    pdfRenderer: `PDF.js ${PDFJS_VERSION}`,
    text: parts.join('\n'),
    lines,
    visualPages,
  };
}

async function main() {
  const readline = require('node:readline');
  const input = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
  try {
    for await (const line of input) {
      if (!line.trim()) continue;
      let payload = {};
      try {
        payload = JSON.parse(line);
        const result = await run(payload);
        process.stdout.write(`RESULT:${JSON.stringify({ ...result, requestId: payload.requestId || '' })}\n`);
      } catch (error) {
        process.stdout.write(`RESULT:${JSON.stringify({ ok: false, requestId: payload.requestId || '', error: String(error?.message || error) })}\n`);
      }
    }
  } finally {
    if (ocrWorkerPromise) {
      try { await (await ocrWorkerPromise).terminate(); } catch {}
      ocrWorkerPromise = null;
    }
  }
}

main().catch(error => {
  process.stderr.write(`${String(error?.stack || error)}\n`);
  process.exitCode = 1;
});
