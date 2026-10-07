// Turn any photo into a FUT-style cut-out: remove the background in the
// browser, trim to the person, shrink to a small webp that fits in a
// Firestore document (1 MB cap).
const BG_LIB = 'https://cdn.jsdelivr.net/npm/@imgly/background-removal@1.7.0/+esm';

export async function processPhoto(file, { removeBg = true, onStatus = () => {} } = {}) {
  let blob = file;
  if (removeBg) {
    try {
      onStatus('Loading the cut-out model. The first time takes a while.');
      const { removeBackground } = await import(BG_LIB);
      onStatus('Cutting out the background');
      blob = await removeBackground(file, {
        model: 'isnet_fp16',
        output: { format: 'image/png' },
        progress: (key, cur, total) => {
          if (key.startsWith('fetch') && total) onStatus(`Downloading the model ${Math.round(cur / total * 100)}%`);
        },
      });
    } catch (e) {
      console.warn('Background removal failed, using the photo as is', e);
      onStatus('Could not remove the background, using the photo as is');
      blob = file;
    }
  }
  onStatus('Shrinking');
  const bmp = await createImageBitmap(blob);
  const box = removeBg ? opaqueBounds(bmp) : { x: 0, y: 0, w: bmp.width, h: bmp.height };
  const scale = Math.min(1, 520 / box.w, 720 / box.h);
  const c = document.createElement('canvas');
  c.width = Math.round(box.w * scale); c.height = Math.round(box.h * scale);
  const g = c.getContext('2d');
  g.drawImage(bmp, box.x, box.y, box.w, box.h, 0, 0, c.width, c.height);
  // The model leaves faint haze where the background was; drop it.
  if (removeBg) {
    const img = g.getImageData(0, 0, c.width, c.height), a = img.data;
    for (let i = 3; i < a.length; i += 4) if (a[i] < 60) a[i] = 0;
    g.putImageData(img, 0, 0);
  }
  for (const q of [.86, .74, .6, .45]) {
    const url = c.toDataURL('image/webp', q);
    if (url.length < 700_000) return url;
  }
  return c.toDataURL('image/webp', .35);
}

// Bounding box of pixels that are not see-through, so the head sits at the
// top of the image whatever the original framing was.
function opaqueBounds(bmp) {
  const c = document.createElement('canvas');
  const s = Math.min(1, 400 / Math.max(bmp.width, bmp.height));
  c.width = Math.max(1, Math.round(bmp.width * s)); c.height = Math.max(1, Math.round(bmp.height * s));
  const g = c.getContext('2d', { willReadFrequently: true });
  g.drawImage(bmp, 0, 0, c.width, c.height);
  const { data } = g.getImageData(0, 0, c.width, c.height);
  let x0 = c.width, y0 = c.height, x1 = -1, y1 = -1;
  for (let y = 0; y < c.height; y++) for (let x = 0; x < c.width; x++) {
    if (data[(y * c.width + x) * 4 + 3] > 128) {
      if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
    }
  }
  if (x1 < 0) return { x: 0, y: 0, w: bmp.width, h: bmp.height };
  const pad = 2;
  x0 = Math.max(0, x0 - pad); y0 = Math.max(0, y0 - pad);
  x1 = Math.min(c.width - 1, x1 + pad); y1 = Math.min(c.height - 1, y1 + pad);
  return { x: x0 / s, y: y0 / s, w: (x1 - x0 + 1) / s, h: (y1 - y0 + 1) / s };
}
