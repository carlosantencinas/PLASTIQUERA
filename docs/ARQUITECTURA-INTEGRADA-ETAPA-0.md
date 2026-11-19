# PLASTIQUERA — Especificación de integración y etapa 0

**Estado:** especificación aprobada; etapa 0 (auditoría y protección) en curso.  
**Rama de trabajo:** `refactor/etapa-0-auditoria`  
**Alcance:** no modificar ni migrar datos de producción durante esta etapa.

## 1. Decisiones funcionales confirmadas

1. **Inventario de productos por variantes.** Cada producto del catálogo puede tener variantes identificables (por ejemplo, color y, si corresponde, material/acabado). Las existencias se controlan por variante, no se mezclan colores. El catálogo agrupa las variantes bajo el producto padre. Cada trabajo terminado aporta unidades a una variante concreta. Ventas, consignaciones y devoluciones deben identificar la variante.
2. **Conversión de cotización a trabajo.** La cotización aceptada cambia de estado dentro del mismo registro, conservando su ID, datos, cálculo, fecha de creación y trazabilidad de cambios. No se crea una segunda ficha. El consumo de materiales y el ingreso a existencias sólo se generan cuando corresponde al inicio/fin real de producción, según las reglas aprobadas; aceptar una cotización por sí solo no consume materiales ni crea stock.
3. **Finanzas automáticas.** Las operaciones comerciales y de abastecimiento originan movimientos financieros vinculados. Se distingue obligación/venta de dinero efectivamente cobrado o pagado. Los cobros parciales y pagos parciales son movimientos separados. Cada movimiento automático tiene referencia al origen y clave idempotente para impedir duplicados. Los egresos extraordinarios continúan registrándose manualmente.

## 2. Arquitectura funcional objetivo

### Datos maestros
- Clientes y tiendas.
- Productos padre y variantes.
- Materiales/filamentos.
- Equipos e impresoras.
- Configuración y parámetros de costos.

### Operaciones
- Cotizaciones y trabajos (una entidad con estados y eventos).
- Compras.
- Producción y consumos.
- Ventas.
- Entregas en consignación, cobros y devoluciones.
- Pagos y egresos manuales.

### Movimientos derivados
- Kardex de materiales: compra, consumo, ajuste y reversión.
- Kardex de productos: producción terminada, venta, consignación, devolución y ajuste.
- Libro financiero: cuentas por cobrar/pagar y cobros/pagos efectivos.
- Reportes y paneles calculados desde operaciones y movimientos, sin mantener copias manuales.

### Servicios de dominio previstos
- `clients-service`: resolución de clientes por ID.
- `quotes-jobs-service`: transición de estados y trazabilidad.
- `products-variants-service`: catálogo, variantes y existencias por variante.
- `inventory-service`: compras, consumos, ajustes y reversiones.
- `commerce-service`: ventas, consignaciones y devoluciones.
- `finance-service`: obligaciones, cobros, pagos y egresos.
- `repositories/cloud-store`: persistencia y control de concurrencia.

Los módulos de interfaz no modificarán directamente inventarios ni libros financieros. Solicitarán operaciones a los servicios de dominio.

## 3. Modelo de datos objetivo (propuesta, no migrado)

- **Client:** `id`, tipo (cliente/tienda), datos de contacto, estado.
- **Product:** `id`, código único, nombre, descripción, estado.
- **ProductVariant:** `id`, `productId`, atributos normalizados (color y otros atributos aplicables), SKU/código opcional, estado.
- **Job/Quote:** `id`, `status`, `clientId`, `productId`, `variantId`, datos de cotización y producción, cálculos, fechas y versión.
- **JobEvent:** `id`, `jobId`, tipo de transición, fecha, usuario y datos relevantes.
- **StockMovement:** `id`, tipo, entidad/variante, cantidad con signo, fecha, `sourceType`, `sourceId`, `idempotencyKey`.
- **Purchase:** `id`, proveedor, líneas, cantidades, costos, estado y pagos asociados.
- **Sale:** `id`, cliente, líneas por variante, cantidades, precio, estado.
- **Consignment:** `id`, tienda, líneas por variante, entregas, devoluciones y cobros.
- **FinancialEntry:** `id`, tipo, monto, fecha, estado, origen y `idempotencyKey`.
- **Payment:** `id`, dirección (cobro/pago), monto, método, fecha y referencia a obligación/operación.

Los campos y colecciones actuales se conservarán durante la transición. La especificación no autoriza borrar ni renombrar campos legados.

## 4. Reglas de negocio que no se deben romper

1. Una variante no puede venderse ni consignarse por encima de sus unidades disponibles.
2. El stock disponible se calcula por variante: producción terminada + devoluciones - ventas - consignaciones + ajustes válidos.
3. Un trabajo con ventas o movimientos relacionados no se elimina físicamente; se corrige o revierte con trazabilidad.
4. Convertir una cotización no duplica el trabajo ni genera movimientos de inventario.
5. Una transición o reintento no puede duplicar consumos, stock ni finanzas.
6. Una devolución de consignación repone la variante correspondiente y ajusta el saldo comercial.
7. Los cobros parciales sólo registran el dinero recibido; no vuelven a descontar producto.
8. Los pagos parciales sólo registran el dinero pagado; no repiten la compra ni la entrada de material.
9. Los reportes financieros separan ventas/obligaciones de caja efectivamente cobrada/pagada.
10. Las cantidades y costos históricos deben permanecer consultables aunque cambien los datos maestros.

## 5. Auditoría técnica de la implementación observada

Revisión estática del código en `main` al iniciar la etapa 0:

### Persistencia y sincronización
- `src/services/cloud-store.js` apunta actualmente al documento `plastiqueria/principal` y escribe el estado completo (`jobs`, materiales, compras, ventas, productos, clientes, consignaciones, egresos, movimientos de trabajos y configuración).
- `writeSharedState()` ejecuta una transacción que lee el documento y luego lo reemplaza con el estado en memoria. El comentario del código indica que se quitó una comparación con una copia anterior; por ello, dos sesiones pueden sobrescribir cambios de la otra. **Riesgo crítico antes de habilitar dos administradores concurrentes.**
- `src/main.js` encola escrituras dentro de una misma pestaña, pero eso no coordina dos navegadores/dispositivos.
- La suscripción remota aplica el estado recibido al estado en memoria. Debe probarse el comportamiento cuando llega una actualización remota mientras el usuario tiene cambios locales pendientes.
- `src/services/firebase.js` usa Firebase Authentication y Firestore. No se encontró un archivo de reglas Firestore dentro del árbol versionado revisado; las reglas reales deben verificarse en Firebase Console. No inferir ni reemplazar reglas desde el código cliente.
- El código de `app-store.js` declara que no usa almacenamiento persistente local y carga desde Firestore. Sin embargo, `README.md` todavía describe un modo local con localStorage. **Documentación desactualizada que debe corregirse en una tarea separada**, no activar almacenamiento local.

### Inventario de materiales
- `inventory-store.js` centraliza compras y consumos por trabajo.
- `applyJobMaterials` reemplaza movimientos de consumo por trabajo y contempla restauración ante error; hay pruebas automatizadas para varios materiales y stock insuficiente.
- `deletePurchase` sólo elimina el registro de compra y no revierte la entrada de stock (compatibilidad declarada con 3DBoys). Es un riesgo de coherencia si se interpreta como anulación. No cambiar hasta definir reversión segura y revisar dependencias/consumos posteriores.

### Productos y variantes
- `calculations/commerce.js` calcula stock agrupado por `productoId`; aún no existe una dimensión explícita `variantId`.
- Las ventas y consignaciones tienen `productoId`, pero no una referencia normalizada a variante. Se debe diseñar la asignación de datos históricos antes de activar stock por color.
- Los trabajos pueden guardar materiales y color en sus filas de material, pero eso no sustituye una variante comercial del producto terminado.

### Cotizaciones y trabajos
- `jobs-view.js` almacena cotizaciones y trabajos en `appState.jobs` con `estadoTrabajo`. La conversión debe ser una transición de estado sobre el mismo ID, no una copia.
- El consumo de material se aplica cuando el estado es `realizado`; las transiciones actuales requieren pruebas de regresión para evitar aplicar/revertir consumos en momentos incorrectos.
- Los tests actuales verifican cálculos y compatibilidad de trabajos antiguos sin `piezasVendibles`.

### Finanzas
- `management-view.js` calcula ingresos a partir de ventas y pagos efectivamente recibidos de consignaciones; los egresos se guardan en `appState.expenses`.
- La compra tiene un historial y entrada de stock, pero no hay evidencia en los servicios revisados de un libro de movimientos financieros enlazado a compras/pagos.
- Para automatizar finanzas sin duplicar, será necesario diferenciar venta devengada de cobro, y compra de pago. No crear entradas financieras automáticas hasta tener claves idempotentes y pruebas.

### Pruebas
- `package.json` define `npm test` (Node test runner), `npm run build` (Vite).
- Existen pruebas para cálculos de trabajos, comercio e inventario.
- El workflow de GitHub Actions ejecuta pruebas y build antes del despliegue.
- La última ejecución observada para el commit `3d26129d1a19385d636a2e5f3a0439196e4cdce2` terminó correctamente. Esto acredita el pipeline, no una validación integral de datos reales de Firebase.

## 6. Etapa 0 — protección de datos y controles previos

**No ejecutar todavía migraciones, cambios de esquema ni escrituras sobre la base real.**

### Antes de cualquier modificación de producción
1. Exportar desde la aplicación un respaldo JSON completo y guardarlo fuera del equipo.
2. Crear además una copia del documento Firestore `plastiqueria/principal` desde Firebase Console o una exportación administrada de Firestore.
3. Registrar fecha/hora, proyecto Firebase, ruta del documento y tamaño/cantidad de registros de cada colección/campo.
4. Verificar que el respaldo se puede abrir y que contiene todos los campos: `jobs`, `products/productos`, `clients/clientes`, `sales`, `consignments/consignaciones`, `expenses`, `materials`, `purchases`, `jobMovements` y `settings`.
5. No pegar claves privadas, contraseñas ni tokens en GitHub ni en el chat.
6. Verificar en Firebase Console las reglas activas y que sólo los administradores autorizados pueden leer/escribir.
7. Suspender temporalmente las ediciones simultáneas durante una futura migración; los dos administradores no deben operar durante la ventana de migración.
8. Mantener el documento y la ruta actual durante la fase de compatibilidad.

### Controles técnicos requeridos antes de etapa 1
- Control de concurrencia con versión/revisión del documento y rechazo explícito de escrituras obsoletas; nunca aplicar “última escritura gana” silenciosamente.
- Protección contra reemplazo remoto mientras haya cambios locales pendientes.
- Registro de auditoría por operación: usuario, fecha, acción, origen y referencia.
- Respaldo restaurable y procedimiento ensayado en una copia de prueba.
- Pruebas de idempotencia, reversión y sincronización de dos sesiones.

## 7. Matriz mínima de pruebas de aceptación

| Caso | Resultado requerido |
|---|---|
| Dos administradores editan registros distintos a la vez | Ningún cambio se pierde; conflicto explícito si hay colisión |
| Recargar después de guardar | Los datos siguen en Firestore |
| Cotización aceptada | Mismo ID; estado actualizado; sin consumo/stock duplicado |
| Trabajo terminado en variante roja | Aumenta sólo stock de variante roja |
| Venta de variante azul | Reduce sólo variante azul |
| Consignación y devolución | Descuenta y repone la misma variante |
| Reintentar la misma operación | No duplica movimientos ni asientos |
| Cobro parcial | Registra sólo el importe recibido |
| Anular compra consumida parcialmente | Rechazo o reversión controlada; nunca stock negativo silencioso |
| Restaurar respaldo en entorno de prueba | Reproduce registros y cantidades esperadas |

## 8. Fuera de alcance de etapa 0

- No cambiar el documento Firestore ni su ruta.
- No migrar registros ni inventar variantes a partir de datos ambiguos.
- No eliminar módulos ni campos históricos.
- No cambiar reglas de Firebase desde el código cliente.
- No publicar cambios funcionales en `main`.
- No activar aún asientos financieros automáticos ni reversión de compras.

**Criterio de salida de etapa 0:** respaldo JSON y copia Firestore verificados, reglas reales revisadas, inventario de registros documentado, riesgos de concurrencia resueltos en entorno de prueba y pruebas de regresión aprobadas. Sólo entonces se autoriza diseñar y ejecutar la migración compatible de variantes.

## 9. Requisitos funcionales añadidos antes de etapa 1

### Reimpresiones en trabajos finalizados
- Un trabajo en estado `realizado` podrá recibir nuevas tandas de producción mediante una acción explícita **Agregar nueva impresión**.
- La reimpresión no crea otro trabajo ni modifica/reemplaza los datos históricos de la tanda anterior. Se conserva el ID del trabajo y se agrega un evento/tanda de producción independiente vinculada al trabajo.
- Cada tanda registra como mínimo: ID propio, fecha, producto y variante (cuando aplique), cantidad fabricada, piezas fallidas, cantidad vendible, materiales/consumos asociados y usuario/fecha de registro.
- Al confirmar una tanda, sólo las unidades vendibles de esa tanda incrementan el stock de la variante correspondiente. El movimiento debe ser idempotente para impedir que un doble clic o reintento duplique existencias.
- Los materiales de la nueva tanda se descuentan por separado según su consumo real. No se vuelve a aplicar ni a descontar el consumo histórico de las tandas anteriores.
- La vista del trabajo mostrará el acumulado producido y el historial de tandas, permitiendo distinguir producción original y reimpresiones.
- Cualquier corrección o anulación de una tanda deberá generar una reversión trazable; no borrar movimientos históricos.

### Código de barras de productos terminados
- Cada producto tendrá un código de barras generado a partir de su código interno existente (por ejemplo, `AM3D-ACC-0001`); el contenido codificado será exactamente ese código, sin prefijos ni identificadores aleatorios añadidos.
- Formato propuesto: **Code 128**, adecuado para códigos alfanuméricos. Se reutilizará la biblioteca `JsBarcode` ya presente en el proyecto, evitando depender de servicios externos.
- Desde el catálogo se podrá visualizar el código de barras y generar/imprimir etiquetas con nombre, código legible y barras escaneables.
- El código interno debe ser único y estable. Si cambia, se deberá actualizar la etiqueta; no se generarán códigos nuevos en cada impresión.
- **Decisión confirmada por el usuario:** cada variante comercial tendrá su propio código/SKU único y su propio código de barras, además del código general del producto padre. El código de barras de la variante codificará exactamente su SKU; el del producto padre codificará exactamente el código general. No se reutilizará el código padre para etiquetar variantes ni se asignará el mismo SKU a variantes distintas.
- La implementación debe probar lectura con un escáner que funcione como teclado y validar que el texto leído coincide exactamente con el código interno.

### Criterios de aceptación añadidos
| Caso | Resultado requerido |
|---|---|
| Agregar una reimpresión a un trabajo realizado | Se conserva el trabajo y se agrega una tanda independiente |
| Reimpresión de 5 unidades vendibles | El stock de la variante aumenta exactamente en 5 |
| Reimpresión con piezas fallidas | Sólo se suma la cantidad vendible |
| Reintentar el guardado de una tanda | No duplica stock ni consumos |
| Dos reimpresiones del mismo trabajo en fechas distintas | Ambas quedan visibles en el historial y sus cantidades se acumulan |
| Generar etiqueta de producto | Code 128 codifica exactamente el código interno |
| Escanear etiqueta | El lector devuelve el código interno exacto |
| Variantes con SKU distintos | Cada variante genera su propia etiqueta/código |
