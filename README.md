# Plastiquería — AM3D

Aplicación web para administrar un taller de impresión 3D. Este repositorio es independiente: el proyecto original `3DBoys` permanece intacto.

Aplicación publicada: https://carlosantencinas.github.io/PLASTIQUERA/

## Módulos

- **Panel principal:** resumen de trabajos, productos, ventas y cuentas pendientes.
- **Trabajos:** registro, edición, costos de material, energía, mantenimiento y mano de obra; fallas, margen, piezas vendibles y consumo de inventario.
- **Inventario y compras:** filamentos, resinas, insumos y equipos; conversión de unidades, costo promedio ponderado, ajustes e historial de consumo por trabajo.
- **Productos:** catálogo, códigos, variantes, asignación de trabajos y stock calculado.
- **Clientes:** directorio de clientes y tiendas.
- **Ventas:** registro, control de cantidades, historial, CSV e impresión.
- **Consignaciones:** entregas, pagos acumulados o parciales, devoluciones y saldos.
- **Respaldo:** exportación e importación de datos JSON con validación previa.

## Persistencia y sincronización

La persistencia de la aplicación es **exclusivamente Firebase Firestore**. No utiliza `localStorage` ni IndexedDB como almacenamiento de datos del negocio. El estado se mantiene en memoria durante la sesión y se carga desde Firestore al autenticar.

El documento compartido configurado por la aplicación es:

- Colección: `plastiqueria`
- Documento: `principal`

La sincronización utiliza transacciones y un campo de revisión (`_revision`). Si detecta una modificación externa desde otra sesión, bloquea el guardado para evitar sobrescribir cambios. La confirmación de guardado se emite después de que Firestore confirma la escritura.

La caché de interfaz de la PWA no sustituye a Firestore. Para consultar o modificar datos se requiere conexión a internet y una sesión autenticada.

## Firebase

La aplicación incorpora acceso por correo y contraseña, sin registro público. Las cuentas se crean desde Firebase Authentication.

Configura estas seis variables como *Repository secrets* en **Settings → Secrets and variables → Actions → Secrets**:

- `VITE_FIREBASE_API_KEY`
- `VITE_FIREBASE_AUTH_DOMAIN`
- `VITE_FIREBASE_PROJECT_ID`
- `VITE_FIREBASE_STORAGE_BUCKET`
- `VITE_FIREBASE_MESSAGING_SENDER_ID`
- `VITE_FIREBASE_APP_ID`

Para desarrollo local, usa un archivo `.env.local` con las mismas variables. No incluyas credenciales de servicio ni claves administrativas en el cliente web.

**Reglas de Firestore:** deben permitir leer y escribir el documento `plastiqueria/principal` sólo a las cuentas autorizadas. La condición genérica `request.auth != null` autentica al usuario, pero no limita por sí sola qué usuarios pueden acceder. Revisa las reglas desplegadas en Firebase Console antes de incorporar otras cuentas.

## Respaldo y migración

Exporta respaldos JSON periódicamente y conserva una copia fuera del equipo. La importación valida las colecciones, identificadores, códigos, cantidades y referencias antes de reemplazar el estado de la sesión y solicitar el guardado en Firestore. No importes un respaldo para resolver conflictos de sincronización: primero identifica cuál es la versión vigente.

Se conservan los campos legados de productos, clientes y consignaciones para facilitar la compatibilidad con datos anteriores. Los movimientos históricos de material se reconstruyen cuando corresponde para evitar descontar dos veces el mismo consumo.

## PWA

Incluye manifiesto, iconos y caché de recursos de interfaz para facilitar su instalación. La sincronización con Firestore requiere conexión.

## Desarrollo

Requiere Node.js 22 o superior.

```bash
npm install
npm run dev
npm test
npm run build
```

GitHub Actions ejecuta las pruebas, compila y publica automáticamente en GitHub Pages al actualizar `main`.

Repositorio: https://github.com/carlosantencinas/PLASTIQUERA
