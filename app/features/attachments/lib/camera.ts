/**
 * Camera capture for attachments (P7-9 "capture/pick image or pdf").
 *
 * - Native: expo-image-picker, lazily required with the same narrow-surface
 *   pattern as src/lib/filePicker.ts uses for expo-document-picker. When the
 *   module is not installed in the build, capture degrades gracefully: the
 *   failure is logged and a CameraCaptureError with actionable copy is thrown
 *   (the pick-a-file path still works) -- never a crash, never a silent no-op,
 *   matching the P7-8 precedent for optional native modules.
 * - Web: the shared pickFile() with an image accept list. Mobile browsers
 *   surface their native "Take Photo" option for image file inputs, so the
 *   capture affordance exists without any extra dependency.
 *
 * Cancellation resolves to null (user action, not an error).
 */
import { Platform } from 'react-native';

import {
  pickFile,
  FilePickerError,
  type PickedFile,
} from '../../../src/lib/filePicker';
import { logger } from '../../../src/lib/logger';

export class CameraCaptureError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'CameraCaptureError';
  }
}

const WEB_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/heic'] as const;

// ---------------------------------------------------------------------------
// Native (expo-image-picker, lazily required)
// ---------------------------------------------------------------------------

/** The narrow expo-image-picker surface this module uses. */
interface ImagePickerAsset {
  uri: string;
  fileName?: string | null;
  mimeType?: string;
  fileSize?: number;
}

interface ImagePickerResult {
  canceled: boolean;
  assets: ImagePickerAsset[] | null;
}

interface ImagePickerModule {
  requestCameraPermissionsAsync(): Promise<{ granted: boolean }>;
  launchCameraAsync(options?: {
    mediaTypes?: string | string[];
    quality?: number;
  }): Promise<ImagePickerResult>;
}

function loadImagePicker(): ImagePickerModule {
  try {
    // Lazy require keeps the optional native module out of module-evaluation
    // order; builds without it only fail (loudly) when capture is attempted.
    return require('expo-image-picker') as ImagePickerModule;
  } catch (error) {
    logger.error('expo-image-picker failed to load; camera capture unavailable', {
      error,
    });
    throw new CameraCaptureError(
      'Camera capture is not available in this build. Use "Add file" instead.',
      { cause: error },
    );
  }
}

/** Read a native file:// URI through fetch (supported by RN networking). */
async function readNativeUri(uri: string): Promise<Response> {
  const response = await fetch(uri);
  if (!response.ok) {
    throw new CameraCaptureError(
      `Reading the captured photo failed (HTTP ${response.status})`,
    );
  }
  return response;
}

async function capturePhotoNative(): Promise<PickedFile | null> {
  const picker = loadImagePicker();

  let granted: boolean;
  try {
    granted = (await picker.requestCameraPermissionsAsync()).granted;
  } catch (error) {
    logger.error('Camera permission request failed', { error });
    throw new CameraCaptureError('Requesting camera access failed.', {
      cause: error,
    });
  }
  if (!granted) {
    throw new CameraCaptureError(
      'Camera access was denied. Allow it in system settings, or use "Add file".',
    );
  }

  let result: ImagePickerResult;
  try {
    result = await picker.launchCameraAsync({ mediaTypes: 'images', quality: 0.8 });
  } catch (error) {
    logger.error('Camera capture failed', { error });
    throw new CameraCaptureError('Opening the camera failed.', { cause: error });
  }

  if (result.canceled) return null;
  const asset = result.assets?.[0];
  if (!asset) {
    logger.error('Camera returned no asset despite not being canceled', { result });
    throw new CameraCaptureError('The camera returned no photo.');
  }

  const { uri } = asset;
  return {
    name: asset.fileName ?? `photo-${Date.now()}.jpg`,
    size: typeof asset.fileSize === 'number' ? asset.fileSize : null,
    mimeType: asset.mimeType ?? 'image/jpeg',
    uri,
    text: async () => (await readNativeUri(uri)).text(),
    blob: async () => (await readNativeUri(uri)).blob(),
  };
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

/**
 * Capture (native camera) or, on web, pick an image -- mobile browsers offer
 * their own "Take Photo" entry for image file inputs. Resolves null on user
 * cancel; throws CameraCaptureError / FilePickerError (already logged) on
 * real failures.
 */
export function capturePhoto(): Promise<PickedFile | null> {
  if (Platform.OS === 'web') {
    return pickFile({ mimeTypes: WEB_IMAGE_TYPES });
  }
  return capturePhotoNative();
}

export { FilePickerError };
