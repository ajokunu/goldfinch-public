/**
 * Cross-platform file picking (P7-6 CSV import, P7-9 attachments).
 *
 * - Native: expo-document-picker (lazily required so the web bundle never
 *   touches the native module; typed against the narrow surface we use).
 * - Web: a transient <input type="file"> element -- no library needed.
 *
 * The returned PickedFile abstracts the platform differences feature code
 * would otherwise care about: `text()` for CSV parsing, `blob()` for direct
 * presigned-PUT uploads. Cancellation resolves to null (it is a user action,
 * not an error); real failures throw FilePickerError after logging.
 */
import { Platform } from 'react-native';

import { logger } from './logger';

export class FilePickerError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'FilePickerError';
  }
}

export interface PickedFile {
  /** Original file name, e.g. "checking-2026.csv". */
  name: string;
  /** Size in bytes when the platform reports it (validate vs ATTACHMENT_MAX_BYTES). */
  size: number | null;
  /** Reported MIME type; null when the platform cannot determine one. */
  mimeType: string | null;
  /** Native: file:// cache URI. Web: an object URL for the picked File. */
  uri: string;
  /** Read the file contents as UTF-8 text (CSV import path). */
  text(): Promise<string>;
  /** Read the file contents as a Blob (attachment presigned-PUT path). */
  blob(): Promise<Blob>;
}

export interface PickFileOptions {
  /**
   * Acceptable MIME types, e.g. ['text/csv'] or ATTACHMENT_ALLOWED_CONTENT_TYPES.
   * Empty/omitted = any file.
   */
  mimeTypes?: readonly string[];
}

// ---------------------------------------------------------------------------
// Native (expo-document-picker, lazily required)
// ---------------------------------------------------------------------------

/** The narrow expo-document-picker surface this module uses. */
interface DocumentPickerAsset {
  name: string;
  size?: number;
  uri: string;
  mimeType?: string;
}

interface DocumentPickerResult {
  canceled: boolean;
  assets: DocumentPickerAsset[] | null;
}

interface DocumentPickerModule {
  getDocumentAsync(options: {
    type?: string | string[];
    copyToCacheDirectory?: boolean;
    multiple?: boolean;
  }): Promise<DocumentPickerResult>;
}

function loadDocumentPicker(): DocumentPickerModule {
  try {
    // Lazy require keeps the native module out of the web bundle path and
    // out of module-evaluation order on cold start.
    return require('expo-document-picker') as DocumentPickerModule;
  } catch (error) {
    logger.error('expo-document-picker failed to load', { error });
    throw new FilePickerError(
      'expo-document-picker is unavailable; run npm install and rebuild',
      { cause: error },
    );
  }
}

/** Read a native file:// URI through fetch (supported by RN networking). */
async function readNativeUri(uri: string): Promise<Response> {
  const response = await fetch(uri);
  if (!response.ok) {
    throw new FilePickerError(`Reading picked file failed (HTTP ${response.status})`);
  }
  return response;
}

async function pickFileNative(options: PickFileOptions): Promise<PickedFile | null> {
  const picker = loadDocumentPicker();
  let result: DocumentPickerResult;
  try {
    result = await picker.getDocumentAsync({
      type:
        options.mimeTypes && options.mimeTypes.length > 0
          ? [...options.mimeTypes]
          : undefined,
      copyToCacheDirectory: true,
      multiple: false,
    });
  } catch (error) {
    logger.error('Document picker failed', { error });
    throw new FilePickerError('Opening the document picker failed', { cause: error });
  }

  if (result.canceled) return null;
  const asset = result.assets?.[0];
  if (!asset) {
    logger.error('Document picker returned no asset despite not being canceled', {
      result,
    });
    throw new FilePickerError('The document picker returned no file');
  }

  const { uri, name, size, mimeType } = asset;
  return {
    name,
    size: typeof size === 'number' ? size : null,
    mimeType: mimeType ?? null,
    uri,
    text: async () => (await readNativeUri(uri)).text(),
    blob: async () => (await readNativeUri(uri)).blob(),
  };
}

// ---------------------------------------------------------------------------
// Web (<input type="file">)
// ---------------------------------------------------------------------------

function pickFileWeb(options: PickFileOptions): Promise<PickedFile | null> {
  return new Promise<PickedFile | null>((resolve, reject) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.multiple = false;
    if (options.mimeTypes && options.mimeTypes.length > 0) {
      input.accept = options.mimeTypes.join(',');
    }
    // Some browsers ignore events from detached inputs; keep it off-screen.
    input.style.position = 'fixed';
    input.style.left = '-9999px';
    document.body.appendChild(input);

    let settled = false;
    const settle = (value: PickedFile | null, error?: unknown): void => {
      if (settled) return;
      settled = true;
      window.removeEventListener('focus', onWindowFocus);
      input.remove();
      if (error !== undefined) {
        logger.error('Web file picker failed', { error });
        reject(
          error instanceof FilePickerError
            ? error
            : new FilePickerError('Picking a file failed', { cause: error }),
        );
        return;
      }
      resolve(value);
    };

    const onChange = (): void => {
      const file = input.files?.[0];
      if (!file) {
        settle(null);
        return;
      }
      settle({
        name: file.name,
        size: file.size,
        mimeType: file.type === '' ? null : file.type,
        uri: URL.createObjectURL(file),
        text: () => file.text(),
        blob: () => Promise.resolve(file),
      });
    };

    // Browsers that implement the dialog `cancel` event report cancellation
    // directly; for the rest, a window refocus without a change event within
    // a grace period means the dialog was dismissed.
    const onCancel = (): void => settle(null);
    const onWindowFocus = (): void => {
      window.setTimeout(() => settle(null), 1000);
    };

    input.addEventListener('change', onChange, { once: true });
    input.addEventListener('cancel', onCancel, { once: true });
    window.addEventListener('focus', onWindowFocus, { once: true });

    try {
      input.click();
    } catch (error) {
      settle(null, error);
    }
  });
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

/**
 * Open the platform file picker. Resolves the picked file, or null when the
 * user cancels. Throws FilePickerError (already logged) on real failures.
 */
export function pickFile(options: PickFileOptions = {}): Promise<PickedFile | null> {
  return Platform.OS === 'web' ? pickFileWeb(options) : pickFileNative(options);
}
