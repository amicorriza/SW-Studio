# Scissor White — SW Studio

Sitio web de la barbería **Scissor White / SW Studio** (Concepción, Chile): landing,
sistema de reservas y panel de administración. Este repo prepara la migración del
sitio (hoy single-file con `localStorage`) a **Firebase**: los clientes agendan y
reciben confirmación por **email**; el staff administra todo desde un panel protegido
por **Firebase Auth**.

## Estado

**Andamiaje listo, implementación pendiente.** La estructura Firebase-ready está
creada; la lógica de conexión (capa de datos, login, función de email) está en
*stubs* que se completan ejecutando el plan.

- Diseño: [`docs/superpowers/specs/2026-06-01-scissor-white-firebase-design.md`](docs/superpowers/specs/2026-06-01-scissor-white-firebase-design.md)
- Plan paso a paso: [`docs/superpowers/plans/2026-06-02-scissor-white-firebase-migration.md`](docs/superpowers/plans/2026-06-02-scissor-white-firebase-migration.md)

## Estructura

```
scissor-white/
├── public/              # Firebase Hosting
│   ├── index.html       # app (copia v15, sin modificar todavía)
│   ├── js/              # firebase-init.js (config), data.js + auth.js (stubs)
│   └── assets/          # imágenes externalizadas (fase 2)
├── functions/           # Cloud Function de email (stub) + tests
├── seed/                # carga inicial a Firestore (datos del v15) — completo
├── tests/rules/         # tests de reglas con el emulador
├── firebase.json        # Hosting + Firestore + Functions + Emuladores
├── .firebaserc          # project id (placeholder)
├── firestore.rules      # reglas de seguridad
└── firestore.indexes.json
```

## Arranque rápido (desarrollo)

```bash
npm install                 # devDeps de tests de reglas
cd functions && npm install && cd ..
cd seed && npm install && cd ..

firebase emulators:start    # http://localhost:5000 (sitio), :4000 (UI)
# en otra terminal, sembrar datos en el emulador:
cd seed && FIRESTORE_EMULATOR_HOST=localhost:8080 GCLOUD_PROJECT=<project-id> npm run seed && cd ..
```

## Pendientes antes de producción

1. Crear proyecto Firebase (plan Blaze) y poner el `project-id` en `.firebaserc`.
2. Pegar la config web en `public/js/firebase-init.js`.
3. Ejecutar el plan (capa de datos, login, función de email, parches de `index.html`).
4. Cargar secretos de Resend y desplegar: `firebase deploy`.

Detalle completo en el plan enlazado arriba.
