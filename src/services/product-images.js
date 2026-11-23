import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { auth, storage } from './firebase.js';

async function optimizedImage(file) {
  if (!(file instanceof File) || !file.type.startsWith('image/')) throw new Error('Selecciona un archivo de imagen válido.');
  if (file.size > 12 * 1024 * 1024) throw new Error('La imagen supera el límite de 12 MB.');
  if (!globalThis.createImageBitmap) throw new Error('Actualiza Chrome para optimizar esta imagen.');
  const bitmap = await createImageBitmap(file);
  try {
    const scale = Math.min(1, 900 / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const context = canvas.getContext('2d');
    if (!context) throw new Error('No se pudo preparar la vista previa.');
    context.fillStyle = '#fff'; context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    return await new Promise((resolve, reject) => canvas.toBlob(
      blob => blob ? resolve(blob) : reject(new Error('No se pudo comprimir la imagen.')),
      'image/jpeg', 0.82
    ));
  } finally { bitmap.close?.(); }
}

export async function uploadProductImage(file, productId) {
  if (!storage) throw new Error('Firebase Storage no está configurado. Verifica VITE_FIREBASE_STORAGE_BUCKET.');
  const user = auth?.currentUser;
  if (!user) throw new Error('Debes iniciar sesión para subir imágenes.');
  const image = await optimizedImage(file);
  const imageRef = ref(storage, `product-images/${user.uid}/${productId}/preview-${Date.now()}.jpg`);
  await uploadBytes(imageRef, image, { contentType: 'image/jpeg', cacheControl: 'public,max-age=31536000' });
  return getDownloadURL(imageRef);
}
