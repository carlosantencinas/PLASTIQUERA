# Plastiquería

Sistema de gestión para taller de impresión 3D.

## Objetivo

Modernizar la aplicación 3DBoys conservando inicialmente sus funcionalidades, la lógica de negocio y el esquema de datos existente en Firebase.

## Tecnologías

- Vite
- JavaScript modular (ES modules)
- Firebase Authentication
- Cloud Firestore
- CSS responsive

## Estado del proyecto

Etapa inicial: estructura base y validación de conexión. La aplicación no debe escribir en Firestore hasta revisar las reglas de seguridad y contar con un respaldo de los datos actuales.

## Desarrollo local

1. Instalar Node.js LTS.
2. Ejecutar `npm install`.
3. Crear `.env.local` a partir de `.env.example` y completar la configuración web del proyecto Firebase.
4. Ejecutar `npm run dev`.

## Configuración Firebase

Las variables `VITE_FIREBASE_*` son configuración pública de cliente. No incluir claves privadas, credenciales de cuentas de servicio ni secretos administrativos.

## Principio de migración

El repositorio original `3DBoys` y los datos actuales de Firebase deben permanecer sin cambios durante esta etapa.