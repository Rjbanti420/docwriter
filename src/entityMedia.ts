// Entity media helpers.
//
// Entity images are stored (base64 data URL) inside the entity's `fields` JSON
// blob, which the API already round-trips — so no schema change and the image
// travels with the book (and its .db backups). Keep them small: the picker
// downscales to a portrait-sized JPEG before storing.

export interface EntityFields {
  image?: string;
  [key: string]: unknown;
}

export function parseFields(raw: string | null | undefined): EntityFields {
  if (!raw) return {};
  try {
    const v = JSON.parse(raw);
    return v && typeof v === 'object' ? (v as EntityFields) : {};
  } catch {
    return {};
  }
}

export function getEntityImage(raw: string | null | undefined): string | null {
  const image = parseFields(raw).image;
  return typeof image === 'string' && image ? image : null;
}

/** Read a picked file, downscale it (preserving aspect) and return a JPEG data URL. */
export async function fileToDataUrl(file: File, max = 512): Promise<string> {
  const objectUrl = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error('could not read image'));
      el.src = objectUrl;
    });
    const scale = Math.min(1, max / Math.max(img.width, img.height));
    const w = Math.max(1, Math.round(img.width * scale));
    const h = Math.max(1, Math.round(img.height * scale));
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('no 2d context');
    ctx.drawImage(img, 0, 0, w, h);
    return canvas.toDataURL('image/jpeg', 0.85);
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}
