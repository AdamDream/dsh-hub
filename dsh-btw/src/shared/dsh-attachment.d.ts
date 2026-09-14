/**
 * Ambient types for `@deepseek-ai/dsh-attachment`, the deployment's durable
 * attachment store. The package is not installed in this workspace; the
 * runtime import is a lazy dynamic import in `src/host/side-chat-service.ts`
 * (the module is always present in the deployment, but keeping the import lazy
 * means the workspace test suite never has to resolve it).
 *
 * Only the surface btw consumes is declared. `admitEncodedImages` is the
 * shared host entry for browser image uploads (canonical-base64 validation +
 * ordered batch commit); `readImage` returns the verified bytes behind a
 * durable reference.
 */
declare module '@deepseek-ai/dsh-attachment' {
  /** Raster image formats accepted by the version-one attachment path. */
  export type ImageMediaType = 'image/png' | 'image/jpeg' | 'image/webp' | 'image/gif'

  /** Durable, serializable reference to one immutable normalized image. */
  export interface ImageAttachmentRef {
    /** Opaque storage identifier; never a filesystem path or bearer URL. */
    attachmentId: string
    /** Media type verified from the stored bytes. */
    mediaType: ImageMediaType
    /** Exact encoded byte length. */
    bytes: number
    /** Intrinsic encoded width in pixels. */
    width: number
    /** Intrinsic encoded height in pixels. */
    height: number
    /** Optional display name stripped of local path information. */
    name?: string
  }

  /** Base64-encoded image upload accompanying one wire request. */
  export interface EncodedImageAttachment {
    /** Declared media type, verified against the decoded bytes during admission. */
    mediaType: ImageMediaType
    /** Canonical base64 encoding of the image bytes. */
    data: string
    /** Optional display name; it is never interpreted as a path. */
    name?: string
  }

  /** Verified bytes behind one durable image reference. */
  export interface StoredImageAttachment {
    ref: ImageAttachmentRef
    data: Uint8Array
  }

  /**
   * Admit one wire image batch: enforce canonical base64 on every member,
   * then delegate batch admission (count/byte limits, media-type and per-image
   * validation, ordered commit) to the attachment store. Returns durable
   * references in the same order as `images`.
   */
  export function admitEncodedImages(
    attachments: unknown,
    images: readonly EncodedImageAttachment[],
  ): Promise<readonly ImageAttachmentRef[]>
}
