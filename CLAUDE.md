# Contexto P0 — SW Studio

Sistema de agendamiento sobre Firebase (Hosting, Firestore, Functions Node 22
en southamerica-east1, Auth, Storage). Producción: scissorwhite.cl.
Resend para correo, Google Places para reseñas.

public/login/index.html  puerta ÚNICA del equipo. Ni /admin/ ni /barbero/ tienen
                         formulario: los dos mandan acá sin sesión. Decide el
                         destino una sola vez -- claim admin -> /admin/, si no
                         getMyDay responde -> /barbero/, si ninguna cierra la
                         sesión y dice qué falta. El scope de la PWA se amplió
                         a "/" para que la app instalada no salte al navegador
                         al ir a /login (start_url sigue en /barbero/).
public/index.html        landing + widget de reservas, ~4.000 líneas, JS y CSS inline
public/admin/index.html  panel admin, ~3.700 líneas, JS y CSS inline
public/js/data.js        única capa que habla con Firestore, Storage y Functions
public/js/metrics.js     agregaciones puras del Dashboard de métricas (KPIs,
                         ingresos por servicio, tendencias). NO toca Firestore
                         ni el DOM; <script> clásico sin bundler, require-able
                         por Node. Tests en tests/unit/metrics.test.js (`npm test`).
public/js/insights.js    motor de recomendaciones del Dashboard: 13 reglas que
                         reciben las agregaciones ya calculadas y deciden qué
                         decir. Mismo patrón que metrics.js (script clásico,
                         export dual, cero DOM). Lo importante es la escalera
                         de muestra mínima: bajo 10 atenciones medidas NO
                         opina, y bajo 20 no sugiere precio. Máximo 3 tarjetas,
                         una por tipo. Tests en tests/unit/insights.test.js.
public/barbero/          PWA instalable del profesional. Cuatro secciones en la
                         barra inferior: Agenda, Métricas, Clientes y Perfil
                         (horario de SOLO CONSULTA + avisos + salir). La agenda
                         navega días con ‹ ›, pero FUERA DE HOY es de solo
                         lectura a propósito: markAttendance sella la hora del
                         servidor y corregirla es admin-only, así que marcar una
                         cita de ayer inventaría una duración. Métricas NO
                         recalcula nada: carga public/js/metrics.js, el mismo
                         módulo del Dashboard. Clientes se arma desde bookings y
                         NUNCA abre patients (tiene teléfono, correo y fotos);
                         agrupa por correo pero devuelve una clave opaca, porque
                         agrupar por nombre fusionaría homónimos. Sigue sin
                         hablar con Firestore: todo por callables (getMyDay,
                         getMyRange, getMyClients, markAttendance), más push
                         por FCM. Los cuatro botones de la atención (Llegó / No
                         llegó / Iniciar / Finalizar) viven en la Agenda.
                         index.html + manifest + sw.js, todo vanilla. Íconos
                         generados por scripts/make-barbero-icons.mjs.
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
  Validación: functions/shared/validate.js es la única implementación real.
  Dos funciones a propósito: isValidBookingPayload (camino público, correo
  OBLIGATORIO porque ahí llega la confirmación) e isValidAdminBookingPayload
  (panel, correo OPCIONAL porque el salón agenda por teléfono). Las dos exigen
  fecha y hora REALES, no solo con formato: '2026-02-30' calza el regex y
  después revienta en zonedInstant().
  NINGÚN cliente escribe bookings, ni siquiera el admin: firestore.rules tiene
  create/update en false y las tres vías pasan por callables con Admin SDK
  (createBooking, adminSaveBooking, markAttendance). El borrado sigue
  permitido al admin como salida de emergencia. isValidBooking() e
  isValidEmail() quedan en las reglas como copias CEL muertas.
  Estado: functions/shared/status.js centraliza los ocho BOOKING_STATUSES
  (pending, confirmed, declined, arrived, in_service, completed, no_show,
  cancelled) y BLOCKING_STATUSES, que es el criterio ÚNICO de "esta reserva
  ocupa el horario" -- lista blanca a propósito, ver el comentario del
  archivo. Las transiciones válidas viven en functions/shared/attendance.js
  (canTransition/applyAction, puro y testeable sin emulador); el I/O lo hace
  exports.markAttendance. "Revisar" NO es un estado: es derivado (in_service
  cuyo fin planificado ya pasó con más de 30 min de holgura), y lo calculan
  igual la PWA y el admin.
- isAdmin() es SOLO el custom claim admin:true. El UID escrito a mano que
  servía de respaldo se retiró el 2026-09-07 (Fase 3), de los CINCO sitios donde
  vivía: firestore.rules, storage.rules (x2), y en functions/index.js tanto
  assertAdmin() como isAdminRequest() -- este último no estaba en el inventario
  y habría tirado un ReferenceError en markAttendance. El criterio sigue
  DUPLICADO entre CEL y JS por necesidad (las reglas no importan JS), así que
  cualquier cambio va en los cinco a la vez. tests/rules fija que el UID solo ya
  no alcanza. Sumar un admin ahora es poner el claim, sin tocar código.
- buildBookingDoc() sigue escribiendo status:'pending'; lo que cambia después
  son las transiciones (recordatorio y medición de la atención real).
- Cancelar YA NO borra: escribe status:'cancelled' vía markAttendance y
  conserva el documento. deleteBooking()/deleteBookingAnd() siguen en el
  código, sin uso, para el borrado duro de una reserva de prueba.
- log() hace DOS cosas: anota la acción y guarda el catálogo (admSave()), y
  muchos llamadores dependen de lo segundo, así que su valor de retorno sigue
  siendo el de admSave(). La anotación va al callable adminLogEvent y NO se
  espera: es auditoría, no parte de la operación. La hora y el autor los pone
  el SERVIDOR. Se ve en el panel Actividad. Antes se perdía al recargar: 23
  llamadas anotando operaciones reales que nadie persistía ni mostraba.
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
- Acceso del equipo: el vínculo ficha<->cuenta de Auth vive en
  staffAccounts/{staffId} (admin-only), NO en staff/{id}. staff tiene lectura
  PÚBLICA porque el widget de reservas necesita nombres, fotos y horarios;
  guardar ahí el uid y el correo del profesional los dejaría legibles por
  cualquiera que abra el sitio. Lo escribe exports.linkStaffAccount desde el
  panel Personal (la cuenta se crea a mano en la consola), y el panel lo lee
  en un mapa D.staffAccounts aparte -- nunca pegado al objeto de staff,
  porque saveAdmin() persiste ese array entero y lo devolvería a staff/{id}.
  staffDevices/{uid} guarda los tokens de FCM y es el ÚNICO lugar donde
  alguien que no es admin escribe directo a Firestore.
- Login: la puerta es /login y nada más. /admin/ y /barbero/
  (mismo origen, misma app). Si un barbero entra por el login del panel, el
  panel lo redirige a /barbero/ -- y lo decide preguntándole al servidor
  (loadAdmin() falló Y getMyDay responde), NO con una quinta copia del
  predicado isAdmin() en el navegador. Un error de red no redirige a nadie,
  porque entonces getMyDay también cae. tests/browser/admin-redirect-barbero.mjs
  fija los cinco casos, incluido el que importa: que el admin NO sea expulsado.
  Al revés (un admin que abre /barbero/) la PWA SÍ lee el claim en el navegador,
  y no es contradictorio: desde la Fase 3 el claim es el ÚNICO criterio, así que
  no hay predicado de dos partes que copiar, y decide una navegación, no un
  permiso.
- Alcances: un barbero NO puede leer `bookings` (regla admin-only) ni escribir
  `staff`. Ve solo lo suyo vía getMyDay, que filtra por su staffId, y
  markAttendance rechaza las citas de otro. El admin ve y puede todo.
- staffAttendanceNudges (onSchedule, cada 2 min) manda los avisos, pero NO
  envía nada salvo businessInfo.nudgesEnabled === true -- mismo interruptor
  que remindersEnabled. Deploy != activación.
- Despliegue manual con diecinueve nombres de función a mano (ver README.md);
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

El Dashboard ya tiene los dos niveles de lectura del reporte
(docs/superpowers/specs/2026-09-06-dashboard-kpi-simple-detalle-design.md):
vista simple con 5 KPI por defecto y vista en detalle con tiempo planificado
vs. real, asistencia, ocupación efectiva y mapa de horas débiles.

Dos cosas que conviene no "arreglar" sin leer el spec:
- `mFilterPeriod` (reservas del período) INCLUYE los no_show a propósito: son
  demanda real y el numerador del KPI de no-show. El ingreso los excluye vía
  `mRevenue`. Son dos conceptos distintos que antes eran el mismo filtro.
- Todo tiempo real es MEDIANA, nunca promedio (reporte §2), y las atenciones
  cerradas a mano (`durSource:'manual'`) se cuentan aparte pero no se
  excluyen del cálculo.

El motor de recomendaciones está completo
(docs/superpowers/specs/2026-09-07-motor-recomendaciones-completo-design.md):
13 reglas del §7 más la comparación contra el período anterior. La 3 (precio
equivalente) no es una tarjeta aparte a propósito -- el ejemplo del §8 la
muestra dentro de la tarjeta de sobretiempo, que es donde está.

Dos cosas de insights.js que NO hay que "arreglar" sin leer el spec:
- `REGLAS` está ordenado y ese orden ES la jerarquía del §8. Como se emite una
  sola tarjeta por tipo, insertar una regla al medio cambia lo que ve el
  usuario sin que nadie lo note. `REGLA_ORDEN` existe para que un test lo fije.
- Dentro de las positivas, `asistencia_sana` va ÚLTIMA. Dispara casi todas las
  semanas (es el estado normal) y si fuera primera taparía para siempre a
  "mejora operacional" y "servicio líder", que sí son noticia.

REGLA DE TRABAJO: si el repo contradice algo de este contexto, detente y avísame
antes de escribir código. No improvises sobre una suposición equivocada.
