/// <reference lib="webworker" />
import * as pdfjs from 'pdfjs-dist/build/pdf.mjs';
import { extractPages, passwordReject } from '../parser/pdf.ts';
import { parsePages } from '../parser/index.ts';
import { parseStatements, type ParsedStatement } from '../parser/statement.ts';
import { isRejected, type ParseResult } from '../core/types.ts';

/**
 * All PDF work happens here. Reading a 200-file batch on the main thread would
 * freeze the page for minutes; more importantly, keeping the documents inside a
 * worker that contains no network code makes the privacy claim easy to check.
 */

// pdf.js normally spawns its own worker. Inside a worker that means a nested
// worker, which most browsers allow; where they do not, pdf.js falls back to
// running inline — still off the main thread, which is what matters here.
try {
  pdfjs.GlobalWorkerOptions.workerPort = new Worker(
    new URL('pdfjs-dist/build/pdf.worker.mjs', import.meta.url),
    { type: 'module' },
  );
} catch {
  pdfjs.GlobalWorkerOptions.workerSrc = '';
}

const loadPdf = ({ data, password }: { data: Uint8Array; password?: string }) =>
  pdfjs.getDocument({
    data,
    password,
    useSystemFonts: true,
    // No document should ever cause script evaluation or an outbound fetch.
    isEvalSupported: false,
    disableAutoFetch: true,
    disableStream: true,
  }).promise;

export interface ParseRequest {
  type: 'parse';
  jobId: number;
  file: string;
  data: ArrayBuffer;
  password?: string;
}

export type WorkerResponse =
  | { type: 'parsed'; jobId: number; result: ParseResult; statements: ParsedStatement[] }
  | { type: 'failed'; jobId: number; file: string; message: string };

self.onmessage = async (event: MessageEvent<ParseRequest>) => {
  const { jobId, file, data, password } = event.data;
  try {
    let result: ParseResult;
    let statements: ParsedStatement[] = [];
    try {
      // pdf.js detaches the buffer it is given, so the pages are read once and
      // both the confirmation path and the statement path work from them.
      const pages = await extractPages(loadPdf, new Uint8Array(data), password);
      result = parsePages(file, pages);
      if (isRejected(result) && result.reject === 'monthly_statement') {
        statements = parseStatements(file, pages);
      }
    } catch (err) {
      const reject = passwordReject(err);
      if (!reject) throw err;
      result = { file, reject };
    }
    self.postMessage({ type: 'parsed', jobId, result, statements } satisfies WorkerResponse);
  } catch (err) {
    const message = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
    self.postMessage({ type: 'failed', jobId, file, message } satisfies WorkerResponse);
  }
};
