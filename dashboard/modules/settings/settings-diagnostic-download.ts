import type { LocalDataDiagnosticExport } from '../../../src/shared/local-data-privacy';

export interface DiagnosticDownloadAnchor {
  href: string;
  download: string;
  click: () => void;
  remove: () => void;
}

export interface DiagnosticDownloadAdapter {
  createBlob: (contents: string, type: string) => Blob;
  createObjectUrl: (blob: Blob) => string;
  revokeObjectUrl: (url: string) => void;
  createAnchor: () => DiagnosticDownloadAnchor;
  appendAnchor: (anchor: DiagnosticDownloadAnchor) => void;
  defer: (operation: () => void) => void;
}

export function downloadLocalDataDiagnostic(
  diagnostic: LocalDataDiagnosticExport,
  filename: string,
  adapter: DiagnosticDownloadAdapter = browserDownloadAdapter(),
): void {
  let url = '';
  let anchor: DiagnosticDownloadAnchor | null = null;
  try {
    const blob = adapter.createBlob(
      JSON.stringify(diagnostic, null, 2),
      'application/json;charset=utf-8',
    );
    url = adapter.createObjectUrl(blob);
    if (!url) throw new Error('DIAGNOSTIC_DOWNLOAD_UNAVAILABLE');
    anchor = adapter.createAnchor();
    anchor.href = url;
    anchor.download = filename;
    adapter.appendAnchor(anchor);
    anchor.click();
  } finally {
    anchor?.remove();
    if (url) releaseObjectUrl(adapter, url);
  }
}

function browserDownloadAdapter(): DiagnosticDownloadAdapter {
  if (
    typeof Blob !== 'function'
    || typeof URL === 'undefined'
    || typeof URL.createObjectURL !== 'function'
    || typeof URL.revokeObjectURL !== 'function'
    || typeof document === 'undefined'
    || !document.body
    || typeof document.createElement !== 'function'
  ) {
    throw new Error('DIAGNOSTIC_DOWNLOAD_UNAVAILABLE');
  }

  return {
    createBlob: (contents, type) => new Blob([contents], { type }),
    createObjectUrl: blob => URL.createObjectURL(blob),
    revokeObjectUrl: url => URL.revokeObjectURL(url),
    createAnchor: () => document.createElement('a'),
    appendAnchor: anchor => document.body.append(anchor as HTMLAnchorElement),
    defer: operation => {
      globalThis.setTimeout(operation, 0);
    },
  };
}

function releaseObjectUrl(adapter: DiagnosticDownloadAdapter, url: string): void {
  const revoke = () => {
    try {
      adapter.revokeObjectUrl(url);
    } catch {
      // The download already completed; URL cleanup failure is non-fatal.
    }
  };
  try {
    adapter.defer(revoke);
  } catch {
    revoke();
  }
}
