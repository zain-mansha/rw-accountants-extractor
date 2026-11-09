# OCR runtime notices

Extractor includes a pinned, offline OCR runtime for Windows x64:

- Tesseract.js 7.0.0 and tesseract.js-core 7.0.0, Apache-2.0. The core is
  built from the Tesseract OCR engine and uses the LSTM-only portable WebAssembly
  core. The application pins the `tesseract-core-lstm` build for every device.
- English `eng.traineddata` from the Tesseract `tessdata_best` project, Apache-2.0.
  Its SHA-256 is recorded in `ocr-engine.json` and checked before every scan.
- PDF.js 6.5.438, Apache-2.0.
- `@napi-rs/canvas` 1.1.0 and its Windows x64 binary, MIT.

The corresponding license files are included beside the vendored packages.
No language model, OCR core, renderer, or update is downloaded at run time.
The only OCR engine used by the application is the pinned bundle; an unavailable
or damaged component stops OCR with an error instead of switching engines.
