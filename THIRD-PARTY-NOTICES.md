# Third-party components

- **Electron 44.7.0**, downloaded from the official electron/electron GitHub release and checked against its SHASUMS256.txt. Electron is MIT-licensed; the runtime’s LICENSE and LICENSES.chromium.html files contain its notices. [Electron](https://www.electronjs.org/).
- **SheetJS Community Edition 0.20.3**, vendored as `dist/vendor/xlsx.full.min.js` from the official cdn.sheetjs.com distribution. It is Apache-2.0-licensed. Its library header retains the copyright notice; the full license is in `dist/vendor/SHEETJS-LICENSE.txt`. [SheetJS](https://docs.sheetjs.com/).
- **Node.js 22.23.3**, a workspace development runtime downloaded from nodejs.org and verified with SHA-256. It is not required by the packaged desktop executable. Its license is retained in `.tools/node-v22.23.3-win-x64/LICENSE`.
