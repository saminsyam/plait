/**
 * Prepare a photo for the Vision call. We downscale + recompress before sending
 * so the upload is small and Claude sees an image at its optimal resolution —
 * a full-res iPhone photo (~4000px, multi-MB) is slower to upload and gives no
 * accuracy benefit, since the API resizes large images server-side anyway.
 */
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';

// Dense two-column menus need enough resolution for the small text to stay
// legible; 1280px keeps the upload small (~150–300KB) while preserving OCR
// accuracy. (1024 lost too much detail on tight menus.)
const MAX_EDGE = 1280;

export type PreparedImage = { uri: string; base64: string };

/**
 * Resize so the longest edge is at most MAX_EDGE, recompress to JPEG, and
 * return both a displayable uri and the base64 for the API.
 */
export async function prepareMenuImage(uri: string): Promise<PreparedImage> {
  const context = ImageManipulator.manipulate(uri);
  context.resize({ width: MAX_EDGE });
  const ref = await context.renderAsync();
  const result = await ref.saveAsync({
    compress: 0.6, // enough for OCR; keeps the upload ~half the size of q0.8
    format: SaveFormat.JPEG,
    base64: true,
  });

  if (!result.base64) {
    throw new Error('Could not process the image. Try another photo.');
  }
  console.log('[Vision] Compressed image base64 length:', result.base64.length);
  return { uri: result.uri, base64: result.base64 };
}
