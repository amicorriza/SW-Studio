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
public/barbero/          PWA instalable del profesional: agenda del día y los
                         cuatro botones (Llegó / No llegó / Iniciar / Finalizar),
                         más push por FCM. index.html + manifest + sw.js, todo
                         vanilla. NO habla con Firestore: todo por callables
                         (getMyDay, markAttendance). Íconos generados por
                         scripts/make-barbero-icons.mjs.
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
  Estado: functions/shared/status.js centraliza los ocho BOOKING_STATUSES
  (pending, confirmed, declined, arrived, in_service, completed, no_show,
  cancelled) y BLOCKING_STATUSES, que es el criterio ÚNICO de "esta reserva
  ocupa el horario" -- lista blanca a propósito, ver el comentario del
  archivo. Las transiciones válidas viven en functions/shared/attendance.js
  (canTransition/applyAction, puro y testeable sin emulador); el I/O lo hace
  exports.markAttendance. "Revisar" NO es un estado: es derivado (in_service
  cuyo fin planificado ya pasó con más de 30 min de holgura), y lo calculan
  igual la PWA y el admin.
- isAdmin() es custom claim admin:true O UN UID ESCRITO A MANO, repetido en cuatro
  archivos: firestore.rules, storage.rules (x2), functions/index.js.
- buildBookingDoc() sigue escribiendo status:'pending'; lo que cambia después
  son las transiciones (recordatorio y medición de la atención real).
- Cancelar YA NO borra: escribe status:'cancelled' vía markAttendance y
  conserva el documento. deleteBooking()/deleteBookingAnd() siguen en el
  código, sin uso, para el borrado duro de una reserva de prueba.
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
- computeAvailability y checkConflict() del admin usan isBlockingStatus()
  (functions/shared/status.js; el admin mantiene una copia deliberada por ser
  <script> plano). declined, no_show y cancelled liberan el horario; una
  reserva SIN status lo ocupa, que es el default seguro.
- Acceso del equipo: staff/{id}.uid vincula la ficha con una cuenta de
  Firebase Auth. Lo escribe exports.linkStaffAccount desde el panel Personal;
  la cuenta se crea a mano en la consola. staffDevices/{uid} guarda los
  tokens de FCM y es el ÚNICO lugar donde alguien que no es admin escribe
  directo a Firestore.
- staffAttendanceNudges (onSchedule, cada 2 min) manda los avisos, pero NO
  envía nada salvo businessInfo.nudgesEnabled === true -- mismo interruptor
  que remindersEnabled. Deploy != activación.
- Despliegue manual con quince nombres de función a mano (ver README.md);
  createBooking ya quedó fuera de esa lista una vez y se congeló en silencio.

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
- Tocar el módulo de reseñas de Google.
- Cambiar el diseño visual.
- Desplegar a producción. Todo va a staging; los despliegues los hace Aldo.

Nota (2026-09-01): el proyecto avanzó a etapa B/C -- "holds, recordatorios,
autogestión o WhatsApp" dejó de estar prohibido. El recordatorio de citas
(confirmar/declinar 24h antes) ya está implementado (ver
docs/superpowers/specs/2026-09-01-recordatorio-citas-design.md), y también la
medición de la atención real con PWA y push
(docs/superpowers/specs/2026-09-06-medicion-atencion-real-design.md). Holds,
autogestión completa (modificar/cancelar) y WhatsApp como canal siguen sin
construirse, pero ya no están bloqueados por etapa.

Pendiente inmediato (proyectos 2 y 3 del reporte de KPI, ver ese spec): el
Dashboard con vista simple / vista en detalle y los seis KPI que la medición
recién habilita (asistencia real, no-show, tiempo real, desviación,
ingreso/hora real, ocupación), y después el motor de recomendaciones
semanales.

REGLA DE TRABAJO: si el repo contradice algo de este contexto, detente y avísame
antes de escribir código. No improvises sobre una suposición equivocada.
