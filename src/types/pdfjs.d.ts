/**
 * pdfjs-dist ships types for its package entry but not for the deep ESM build
 * paths, which are what the bundler and Node's ESM loader both need. Only the
 * surface this project touches is declared.
 */
declare module 'pdfjs-dist/build/pdf.mjs' {
  export const GlobalWorkerOptions: { workerSrc: string; workerPort: Worker | null };
  export function getDocument(args: {
    data: Uint8Array;
    password?: string;
    useSystemFonts?: boolean;
    isEvalSupported?: boolean;
    disableAutoFetch?: boolean;
    disableStream?: boolean;
  }): {
    promise: Promise<{
      numPages: number;
      getPage(n: number): Promise<{
        getTextContent(): Promise<{ items: Array<{ str: string; transform: number[] }> }>;
      }>;
    }>;
  };
}
