/**
 * Allowed MIME types for uploaded documents and employee attachments.
 */
export const ALLOWED_MIME_TYPES = [
  'application/pdf',
  'image/png',
  'image/jpeg',
] as const;

export type AllowedMimeType = (typeof ALLOWED_MIME_TYPES)[number];

export const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024; // 10 MB limit per AGENTS.md / PHASE1_SPEC

/**
 * Validates binary buffer headers against expected magic byte signatures.
 * Prevents file extension / MIME type spoofing attacks.
 */
export function validateMagicBytes(buffer: Uint8Array, mime: string): boolean {
  if (!buffer || buffer.length < 4) {
    return false;
  }

  switch (mime) {
    case 'application/pdf':
      // %PDF- (hex: 25 50 44 46 2D)
      return (
        buffer.length >= 5 &&
        buffer[0] === 0x25 &&
        buffer[1] === 0x50 &&
        buffer[2] === 0x44 &&
        buffer[3] === 0x46 &&
        buffer[4] === 0x2d
      );

    case 'image/png':
      // \x89PNG\r\n\x1a\n (hex: 89 50 4E 47 0D 0A 1A 0A)
      return (
        buffer.length >= 8 &&
        buffer[0] === 0x89 &&
        buffer[1] === 0x50 &&
        buffer[2] === 0x4e &&
        buffer[3] === 0x47 &&
        buffer[4] === 0x0d &&
        buffer[5] === 0x0a &&
        buffer[6] === 0x1a &&
        buffer[7] === 0x0a
      );

    case 'image/jpeg':
      // SOI marker + marker prefix: FF D8 FF
      return (
        buffer.length >= 3 &&
        buffer[0] === 0xff &&
        buffer[1] === 0xd8 &&
        buffer[2] === 0xff
      );

    default:
      return false;
  }
}
