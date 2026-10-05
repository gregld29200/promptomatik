// Images teachers upload into their documents (illustrations, a KPI chart,
// their institute logo). Stored in R2 under the owner's id, so a document can
// only ever embed its own author's images: the key is rebuilt from the
// session, never taken from the request.

import { nanoid } from "nanoid";
import type { Env } from "../env";

export const DOCUMENT_IMAGE_TYPES = ["image/png", "image/jpeg", "image/webp", "image/gif"] as const;
export type DocumentImageType = typeof DOCUMENT_IMAGE_TYPES[number];
export const MAX_DOCUMENT_IMAGE_BYTES = 5 * 1024 * 1024;
/** Upper bound on images embedded in one rendered document. */
export const MAX_IMAGES_PER_DOCUMENT = 12;

const IMAGE_ID_PATTERN = /^[A-Za-z0-9_-]{6,40}$/;

export function isDocumentImageType(value: string): value is DocumentImageType {
  return (DOCUMENT_IMAGE_TYPES as readonly string[]).includes(value);
}

export function isDocumentImageId(value: string): boolean {
  return IMAGE_ID_PATTERN.test(value);
}

function imageKey(userId: string, imageId: string): string {
  return `documents/images/${userId}/${imageId}`;
}

/** Magic bytes, so a renamed file cannot pass as an image. */
export function sniffImageType(bytes: Uint8Array): DocumentImageType | null {
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return "image/png";
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (bytes.length >= 6 && String.fromCharCode(...bytes.slice(0, 4)) === "GIF8") return "image/gif";
  if (
    bytes.length >= 12
    && String.fromCharCode(...bytes.slice(0, 4)) === "RIFF"
    && String.fromCharCode(...bytes.slice(8, 12)) === "WEBP"
  ) return "image/webp";
  return null;
}

export async function storeDocumentImage(
  env: Env,
  userId: string,
  bytes: Uint8Array,
  contentType: DocumentImageType,
): Promise<string> {
  const id = nanoid(16);
  await env.MEDIA.put(imageKey(userId, id), bytes, { httpMetadata: { contentType } });
  return id;
}

export async function getDocumentImage(env: Env, userId: string, imageId: string): Promise<R2ObjectBody | null> {
  if (!isDocumentImageId(imageId)) return null;
  return env.MEDIA.get(imageKey(userId, imageId));
}

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunk = 0x8000;
  for (let index = 0; index < bytes.length; index += chunk) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunk));
  }
  return btoa(binary);
}

/**
 * Data URIs for the images a document references, so the HTML preview and
 * the PDF engine render them without a second authenticated request. Unknown
 * or foreign ids are simply absent; the renderer shows a placeholder.
 */
export async function loadDocumentImages(
  env: Env,
  userId: string,
  imageIds: string[],
): Promise<Record<string, string>> {
  const images: Record<string, string> = {};
  for (const imageId of imageIds.slice(0, MAX_IMAGES_PER_DOCUMENT)) {
    const object = await getDocumentImage(env, userId, imageId);
    if (!object) continue;
    const bytes = new Uint8Array(await object.arrayBuffer());
    const type = sniffImageType(bytes);
    if (!type) continue;
    images[imageId] = `data:${type};base64,${toBase64(bytes)}`;
  }
  return images;
}
