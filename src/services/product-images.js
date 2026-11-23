import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { auth, storage } from './firebase.js';

async function optimizedImage(file, crop = { x: 50, y: 50 }) {
  if (!(file instanceof File) || !file.type.startsWith('image/')) throw new Error('Selecciona un archivo de imagen válido.');
  if (file.size > 12 * 1024 * 1024) throw new Error('La imagen supera el límite de 12 MB.');
  if (!globalThis.createImageBitmap) throw new Error('Actualiza Chrome para optimizar esta imagen.');
  const bitmap = await createImageBitmap(file);
  try {
    const side = Math.min(bitmap.width, bitmap.height);
    const x = Math.round((bitmap.width - side) * Math.max(0, Math.min(100, Number(crop.x ?? 50))) / 100);
    const y = Math.round((bitmap.height - side) * Math.max(0, Math.min(100, Number(crop.y ?? 50))) / 100);
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
    context.drawImage(bitmap, x, y, side, side, 0, 0, outputSize, outputSize);
    return await new Promise((resolve, reject) => canvas.toBlob(
      blob => blob ? resolve(blob) : reject(new Error('No se pudo comprimir la imagen.')),
      'image/jpeg', 0.82
    ));
  } finally { bitmap.close?.(); }
}

export async function uploadProductImage(file, productId, crop = { x: 50, y: 50 }) {
  if (!storage) throw new Error('Firebase Storage no está configurado. Verifica VITE_FIREBASE_STORAGE_BUCKET.');
  const user = auth?.currentUser;
  if (!user) throw new Error('Debes iniciar sesión para subir imágenes.');
  const image = await optimizedImage(file, crop);
  const imageRef = ref(storage, `product-images/${user.uid}/${productId}/preview-${Date.now()}.jpg`);
  await uploadBytes(imageRef, image, { contentType: 'image/jpeg', cacheControl: 'public,max-age=31536000' });
  return getDownloadURL(imageRef);
}
