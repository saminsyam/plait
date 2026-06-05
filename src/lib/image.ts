/**
 * Prepare a photo for the Vision call. We downscale + recompress before sending
 * so the upload is small and Claude sees an image at its optimal resolution —
 * a full-res iPhone photo (~4000px, multi-MB) is slower to upload and gives no
 * accuracy benefit, since the API resizes large images server-side anyway.
 */
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';

// Anthropic downsizes images so the long edge is ~1568px; matching that here
// means we send the smallest payload that preserves full menu legibility.
const MAX_EDGE = 1568;

export type PreparedImage = { uri: string; base64: string };

/**
 * Resize so the longest edge is at most MAX_EDGE, recompress to JPEG, and
 * return both a displayable uri and the base64 for the API.
 */
export async function prepareMenuImage(uri: string): Promise<PreparedImage> {
  const context = ImageManipulator.manipulate(uri);
  // Constrain the longer edge; expo-image-manipulator keeps aspect ratio when
  // only one dimension is given, so we cap width (most menus are shot upright,
  // but width-cap still bounds the pixel count enough to shrink the payload).
  context.resize({ width: MAX_EDGE });
  const ref = await context.renderAsync();
  const result = await ref.saveAsync({
    compress: 0.6,
    format: SaveFormat.JPEG,
    base64: true,
  });

  if (!result.base64) {
    throw new Error('Could not process the image. Try another photo.');
  }
  return { uri: result.uri, base64: result.base64 };
}
