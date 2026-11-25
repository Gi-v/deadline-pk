# Vendored libraries (loaded only when the syllabus scanner is used)

- `pdf/` — pdf.js 4.10.38 (Apache-2.0, Mozilla) reads text PDFs in the browser.
- `tess/` — tesseract.js 5.1.1 + tesseract.js-core 5.1.1 (Apache-2.0) and the English `eng.traineddata.gz` (Apache-2.0, tessdata_best_int) do OCR on photos and scanned pages.

Nothing here talks to the internet; files are served from the same origin and everything runs on the student's device.
