import { auth } from './firebase.js';

const CLOUDINARY_CLOUD_NAME = 'ixkzxqpv';
const CLOUDINARY_UPLOAD_PRESET = 'plastiqueria_productos';

async function optimizedImage(file, crop = { x: 50, y: 50, zoom: 1 }) {
  if (!(file instanceof File) || !file.type.startsWith('image/')) throw new Error('Selecciona un archivo de imagen válido.');
  if (file.size > 12 * 1024 * 1024) throw new Error('La imagen supera el límite de 12 MB.');
  if (!globalThis.createImageBitmap) throw new Error('Actualiza Chrome para optimizar esta imagen.');
  const bitmap = await createImageBitmap(file);
  try {
    const zoom = Math.max(0.05, Math.min(2.5, Number(crop.zoom ?? 1)));
    const side = Math.min(bitmap.width, bitmap.height) / zoom;
    const x = (bitmap.width - side) * Math.max(0, Math.min(100, Number(crop.x ?? 50))) / 100;
    const y = (bitmap.height - side) * Math.max(0, Math.min(100, Number(crop.y ?? 50))) / 100;
    const outputSize = 640;
    const canvas = document.createElement('canvas');
    canvas.width = outputSize;
    canvas.height = outputSize;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('No se pudo preparar la vista previa.');
    context.fillStyle = '#fff';
    context.fillRect(0, 0, outputSize, outputSize);
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = 'high';
    const scale = outputSize / side;
    context.drawImage(bitmap, -x * scale, -y * scale, bitmap.width * scale, bitmap.height * scale);
    return await new Promise((resolve, reject) => canvas.toBlob(
      blob => blob ? resolve(blob) : reject(new Error('No se pudo comprimir la imagen.')),
      'image/jpeg', 0.82
    ));
  } finally { bitmap.close?.(); }
}

export async function uploadProductImage(file, productId, crop = { x: 50, y: 50 }) {
  if (!CLOUDINARY_CLOUD_NAME || !CLOUDINARY_UPLOAD_PRESET) {
    throw new Error('Falta configurar Cloudinary para las imágenes de productos.');
  }
  if (!auth?.currentUser) throw new Error('Debes iniciar sesión para subir imágenes.');

  const image = await optimizedImage(file, crop);
  const safeProductId = String(productId || 'producto').replace(/[^a-zA-Z0-9_-]/g, '-').slice(0, 80);
  const formData = new FormData();
  formData.append('file', image, `producto-${safeProductId}.jpg`);
  formData.append('upload_preset', CLOUDINARY_UPLOAD_PRESET);
  formData.append('public_id', `producto-${safeProductId}-${Date.now()}`);

  const endpoint = `https://api.cloudinary.com/v1_1/${CLOUDINARY_CLOUD_NAME}/image/upload`;
  const response = await fetch(endpoint, { method: 'POST', body: formData });
  let result;
  try { result = await response.json(); }
  catch { throw new Error('Cloudinary respondió con un formato inesperado.'); }

  if (!response.ok || !result.secure_url) {
    const message = result?.error?.message || `Error HTTP ${response.status}`;
    throw new Error('Cloudinary no pudo guardar la imagen: ' + message);
  }
  return result.secure_url;
}
