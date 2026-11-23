# Reglas de Firebase Storage para imágenes de productos

La aplicación guarda las imágenes de vista previa en Firebase Storage y conserva únicamente la URL en el producto de Firestore.

En Firebase Console → Storage → Rules, publica estas reglas:

```javascript
rules_version = '2';
service firebase.storage {
  match /b/{bucket}/o {
    match /product-images/{userId}/{productId}/{fileName} {
      allow read: if request.auth != null;
      allow write: if request.auth != null
        && request.auth.uid == userId
        && request.resource.size < 5 * 1024 * 1024
        && request.resource.contentType.matches('image/.*');
    }
  }
}
```

La aplicación reduce la imagen a un máximo de 900 px y la convierte a JPEG antes de subirla.
