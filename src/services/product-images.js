import { auth } from './firebase.js';

const CLOUDINARY_CLOUD_NAME = 'ixkzxqpv';
const CLOUDINARY_UPLOAD_PRESET = 'plastiqueria_productos';
const MAX_IMAGE_BYTES = 12 * 1024 * 1024;
const MAX_WIDTH = 1080;
const MAX_HEIGHT = 1920;

async function optimizedImage(file) {
  if (!(file instanceof File) || !file.type.startsWith('image/')) throw new Error('Selecciona un archivo de imagen válido.');
  if (file.size > MAX_IMAGE_BYTES) throw new Error('Cada imagen debe pesar como máximo 12 MB.');
  if (!globalThis.createImageBitmap) throw new Error('Actualiza Chrome para optimizar esta imagen.');
  const bitmap = await createImageBitmap(file);
  try {
    // Conserva la proporción original y limita el resultado a un formato vertical
    // apto para móviles, sin recortar ni deformar el producto.
    const scale = Math.min(MAX_WIDTH / bitmap.width, MAX_HEIGHT / bitmap.height, 1);
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('No se pudo preparar la imagen.');
    context.fillStyle = '#fff';
    context.fillRect(0, 0, width, height);
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = 'high';
    context.drawImage(bitmap, 0, 0, width, height);
    return await new Promise((resolve, reject) => canvas.toBlob(
      blob => blob ? resolve(blob) : reject(new Error('No se pudo comprimir la imagen.')),
      'image/jpeg', 0.90
    ));
  } finally { bitmap.close?.(); }
}

export async function uploadProductImage(file, productId) {
  if (!CLOUDINARY_CLOUD_NAME || !CLOUDINARY_UPLOAD_PRESET) {
    throw new Error('Falta configurar Cloudinary para las imágenes de productos.');
  }
  if (!auth?.currentUser) throw new Error('Debes iniciar sesión para subir imágenes.');

  const image = await optimizedImage(file);
  const safeProductId = String(productId || 'producto').replace(/[^a-zA-Z0-9_-]/g, '-').slice(0, 80);
  const formData = new FormData();
  formData.append('file', image, `producto-${safeProductId}.jpg`);
  formData.append('upload_preset', CLOUDINARY_UPLOAD_PRESET);
  formData.append('public_id', `producto-${safeProductId}-${Date.now()}-${Math.random().toString(36).slice(2,8)}`);

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
