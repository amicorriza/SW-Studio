# Contexto P0 — SW Studio

Sistema de agendamiento sobre Firebase (Hosting, Firestore, Functions Node 22
en southamerica-east1, Auth, Storage). Producción: scissorwhite.cl.
Resend para correo, Google Places para reseñas.

public/index.html        landing + widget de reservas, ~4.000 líneas, JS y CSS inline
public/admin/index.html  panel admin, ~3.700 líneas, JS y CSS inline
public/js/data.js        única capa que habla con Firestore, Storage y Functions
public/js/metrics.js     agregaciones puras del Dashboard de métricas (KPIs,
                         ingresos por servicio, tendencias). NO toca Firestore
                         ni el DOM; <script> clásico sin bundler, require-able
                         por Node. Tests en tests/unit/metrics.test.js (`npm test`).
functions/               callables y triggers
firestore.rules, storage.rules

Estado conocido, a verificar antes de tocar nada:
- Solape y zona horaria: la fuente única es functions/shared/availability.js
  y functions/shared/timezone.js. public/index.html mantiene una copia
  deliberada y fiel (documentada como tal, <script> plano sin bundler).
  public/admin/index.html ya NO diverge: checkConflict()/checkScheduleBlock()
  usan el mismo criterio de minutos-desde-medianoche (antes usaban objetos
  Date en hora del navegador del admin -- ver el historial del goal
  2026-08-24 en docs/superpowers/plans si hace falta el detalle).
  Validación: functions/shared/validate.js es la única implementación real
  (isValidBookingPayload). firestore.rules mantiene isValidBooking() como
  copia CEL muerta (documentación) y isValidEmail() como el único gate real
  del camino de escritura directa del admin -- esa brecha (el admin no pasa
  por isValidBookingPayload) sigue sin cerrar, es trabajo aparte.
  Estado: functions/shared/status.js centraliza DEFAULT_BOOKING_STATUS
  ('pending'), pero sigue sin existir ninguna transición de estado en el
  repo -- eso no cambió con este goal.
- isAdmin() es custom claim admin:true O UN UID ESCRITO A MANO, repetido en cuatro
  archivos: firestore.rules, storage.rules (x2), functions/index.js.
- buildBookingDoc() escribe status:'pending' fijo y nada lo cambia jamás.
- deleteBooking() hace deleteDoc: cancelar destruye el registro.
- log() escribe en memoria; saveAdmin() solo persiste services, staff y businessInfo.
  adminLog nunca se escribe desde el panel.
- Panel de Servicios: la acción por defecto es "Retirar" (status:'inactive'),
  no borrar. El borrado duro sigue existiendo pero solo sobre servicios ya
  inactivos y tras doble confirmación (escribir el nombre exacto + modal).
  Cada servicio tiene `order` (entero) que gobierna el orden en el panel Y en
  el widget de reservas (public/index.html refreshCatalog lo respeta); a los
  servicios sin `order` se les asigna su índice al cargar (normalizeSvcOrder)
  y se persiste al primer guardado. `updatedAt` (ISO) se setea en cada
  alta/edición/duplicado/ajuste masivo. Reordenar a mano (arrastrar / ↑↓)
  solo con filtro "Todos" + orden manual.
- computeAvailability no filtra por status.
- Despliegue manual con ocho nombres de función a mano; createBooking ya quedó
  fuera de esa lista una vez y se congeló en silencio.

INVARIANTES — ningún goal puede romperlos:
- La zona horaria del negocio gobierna, nunca la del navegador (IANA, zonedInstant()).
- Precio, duración y recursos se resuelven en el servidor, jamás desde el payload.
- Dentro de transacciones solo tx.get(), nunca db.get() suelto.
- El widget falla abierto: si la disponibilidad no carga, muestra todo disponible.
- Nada del catálogo se borra; los servicios retirados pasan a inactive.
- availability/{fecha} nunca contiene PII.

PROHIBIDO en todas las etapas 0 y A:
- Migrar a React, Vue o cualquier framework.
- Reescribir los HTML monolíticos: sustituir funciones, no reestructurar.
- Implementar holds, recordatorios, autogestión o WhatsApp (eso es etapa B y C).
- Tocar el módulo de reseñas de Google.
- Cambiar el diseño visual.
- Desplegar a producción. Todo va a staging; los despliegues los hace Aldo.

REGLA DE TRABAJO: si el repo contradice algo de este contexto, detente y avísame
antes de escribir código. No improvises sobre una suposición equivocada.
