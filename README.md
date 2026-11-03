# Plastiquería

Aplicación web para administrar un taller de impresión 3D. Es un repositorio independiente: **3DBoys permanece intacto**.

## Módulos

- **Panel principal:** resumen de trabajos, productos, ventas y cuentas pendientes de consignación.
- **Trabajos:** registro, edición, costos de material/energía/mantenimiento/mano de obra, fallas, margen, piezas vendibles y consumo de inventario.
- **Inventario y compras:** filamentos, resinas, insumos y equipos; conversión de unidades; costo promedio ponderado; ajustes; historial y consumo por trabajo.
- **Productos:** catálogo, códigos, asignación de trabajos y stock calculado.
- **Clientes:** directorio de clientes y tiendas.
- **Ventas:** registro, control de cantidades, historial, CSV e impresión.
- **Consignaciones:** entregas, pagos acumulados/parciales, devoluciones, saldos pendientes y saldos a favor.
- **Respaldo:** exportación e importación de datos JSON.

## Persistencia local

Sin configuración de Firebase, los datos se guardan en el navegador mediante localStorage. No se comparten entre dispositivos ni usuarios. Exporta respaldos periódicos y guárdalos fuera del equipo.

La importación reemplaza los datos locales actuales. Antes de importar, descarga un respaldo del estado vigente. El importador admite los nombres de campos usados por el documento de 3DBoys (productos, clientes y consignaciones).

## Firebase Authentication y Firestore

La aplicación incorpora acceso por correo/contraseña (sin registro público) y sincronización opcional con el documento compartido `talleres3dboys/principal`.

Se conservan los campos legados `jobs`, `materials`, `purchases`, `sales`, `productos`, `clientes` y `consignaciones`. Plastiquería añade `jobMovements` para registrar consumos de material por trabajo. Al importar datos antiguos, reconstruye los movimientos históricos a partir de los trabajos y materiales para evitar volver a descontar el mismo consumo al editarlos.

La sincronización usa transacciones y compara las listas con la última lectura. Si detecta cambios externos —incluidos cambios realizados desde 3DBoys u otra sesión— detiene la escritura para evitar sobrescribirlos. Los cambios se guardan primero en el navegador; si falla la nube, los datos locales se conservan. Si hay datos locales y remotos, la aplicación solicita elegir qué fuente utilizar.

**Antes de activar Firebase:**
1. Haz un respaldo del documento `talleres3dboys/principal`.
2. Revisa las reglas de Firestore para que sólo usuarios autenticados y autorizados puedan leer/escribir.
3. Crea manualmente las cuentas autorizadas en Firebase Authentication (no hay registro público).
4. Configura las seis variables `VITE_FIREBASE_*`.

Para desarrollo, configura esas variables en `.env.local`. Para GitHub Pages, agrégalas como *Repository secrets* en **Settings → Secrets and variables → Actions → Secrets**. Son valores de configuración pública del cliente web; nunca incluyas cuentas de servicio ni credenciales administrativas.

Si las variables no están definidas, la aplicación permanece en modo local.

## PWA

Incluye manifiesto, icono y caché de interfaz para instalar la aplicación y abrir la estructura básica sin conexión. La sincronización con Firestore requiere conexión.

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
