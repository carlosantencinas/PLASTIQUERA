# Reglas de Firestore para el catálogo público

PLASTIQUERA mantiene los datos internos en `plastiqueria/principal`. El catálogo público se guarda por separado en la colección `catalogo_publico` y contiene únicamente código, nombre, descripción, URL de imagen y precio de venta.

En Firebase Console:
1. Abre Firestore Database → Reglas.
2. Conserva las reglas actuales de `plastiqueria/principal` sin cambios.
3. Dentro del bloque `match /databases/{database}/documents`, agrega esta regla:

```javascript
match /catalogo_publico/{trabajoId} {
  allow read: if true;
  allow create, update, delete: if request.auth != null;
}
```

4. Publica las reglas.

No reemplaces las reglas existentes de la colección privada. La regla pública permite leer solo los documentos de `catalogo_publico`; no concede acceso al documento principal ni a los datos internos.
