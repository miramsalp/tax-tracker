import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';

/**
 * pdf.js loader for Node. The browser worker supplies its own; both feed the
 * same parser, so what the CLI reports is what the app will produce.
 */
export const loadPdf = ({ data, password }) =>
  pdfjs.getDocument({ data, password, useSystemFonts: true, isEvalSupported: false }).promise;
