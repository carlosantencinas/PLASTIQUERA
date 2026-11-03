# Plastiquería

Aplicación web de gestión para un taller de impresión 3D. Proyecto nuevo e independiente del repositorio original **3DBoys**.

## Módulos disponibles

- **Trabajos:** costos, energía, mantenimiento, mano de obra, fallas, margen, piezas vendibles, edición e historial.
- **Inventario y compras:** filamentos, resinas, insumos y equipos; unidades normalizadas; costo promedio ponderado; ajustes y consumos asociados a trabajos.
- **Productos:** catálogo, códigos, asignación de trabajos y existencias derivadas.
- **Clientes:** directorio de clientes y tiendas.
- **Ventas:** registro, validación de existencias, historial, CSV e impresión.
- **Consignaciones:** entregas a tiendas, pagos acumulados, pagos parciales, devoluciones, saldos pendientes y saldos a favor.
- **Panel principal:** resumen comercial y operativo.

## Persistencia y respaldo

La versión desplegada guarda datos en el almacenamiento local del navegador. Los datos no se sincronizan entre dispositivos ni usuarios. Usa **Exportar respaldo** regularmente y conserva los archivos JSON fuera del navegador.

La importación de un respaldo reemplaza los datos locales actuales. Antes de importar, exporta una copia del estado vigente.

## Firebase

El cliente de Firebase está preparado, pero la lectura y escritura en Firestore todavía están deshabilitadas. La migración debe conservar el documento compartido `talleres3dboys/principal`, revisar las reglas de seguridad y establecer control de concurrencia antes de activar sincronización. No se debe modificar ni borrar la base original durante la migración.

Configura las variables `VITE_FIREBASE_*` en un archivo local `.env.local` para desarrollo. No incluyas credenciales privadas ni cuentas de servicio en el frontend.

## Aplicación instalable

Plastiquería incluye un manifiesto y caché de aplicación para instalarse como PWA y abrir su interfaz básica sin conexión. La sincronización en la nube, cuando se habilite, requerirá conexión.

## Desarrollo

Requiere Node.js 22 o superior.

```bash
npm install
npm run dev
npm test
npm run build
```

## Despliegue

GitHub Actions ejecuta las pruebas, compila y publica en GitHub Pages al actualizar `main`.

Repositorio: https://github.com/carlosantencinas/PLASTIQUERA
