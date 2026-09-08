# Scissor White — Página de gestión de reservas (reagendar/cancelar) — Roadmap de diseño

- **Fecha:** 2026-09-08
- **Estado:** BORRADOR — decisiones abiertas, no es un spec cerrado ni un plan de implementación. Ver `docs/superpowers/plans/2026-09-08-correos-transaccionales-plan.md` (Fuera de alcance) para el correo que hoy deriva a WhatsApp mientras esto no exista.
- **Por qué existe este documento:** Aldo pidió, en la revisión del rediseño de correos (2026-09-08), dejar la página de gestión ("el usuario debe poder reagendar si está dentro de la ventana de tiempo permitida") como trabajo pendiente y armar un plan para diseñarla. Este documento es ese punto de partida — no un spec terminado, porque todavía faltan decisiones de producto que solo Aldo puede tomar.

## Lo que NO hay que heredar sin revisar

Existe un spec viejo, `docs/superpowers/specs/2026-07-30-autogestion-citas-design.md`, con su plan hermano `docs/superpowers/plans/2026-07-30-autogestion-citas-plan.md`, que cubre exactamente este problema (confirmar/modificar/cancelar con `manageToken`, página `public/mi-reserva.html`, tope de 2 modificaciones, ventana de 3 horas). **Nunca se implementó** — el propio spec de recordatorios que SÍ está en producción (`2026-09-01-recordatorio-citas-design.md`, línea 6) dice explícitamente que esa branch (`feature/autogestion-citas`) "quedó desactualizada respecto a main y nunca se fusionó" y que, por decisión de Aldo, el sistema de recordatorios se diseñó **desde cero**, sin heredar esas decisiones de arquitectura. Verificado en este repo: `functions/bookingRules.js` y `public/mi-reserva.html` no existen.

Este documento sigue el mismo criterio: puede tomar ideas sueltas del spec viejo (están bien pensadas), pero ninguna decisión de ese documento se da por buena solo por existir — cada una se revisa contra el código real de hoy.

## Lo que sí existe hoy y es reutilizable

- **Token de alta entropía por reserva:** `reminderToken` (32 hex, `crypto.randomBytes(16)`, generado en `buildBookingDoc()` — `functions/createBooking.js:98`) YA cumple el rol que el spec viejo quería inventar de cero como `manageToken`. No hace falta un campo nuevo: `confirmar_url`/`declinar_url` del correo de reserva ya viajan con este token, y una futura `gestionar_url` puede reusar el mismo valor.
- **Página intermedia con patrón probado:** `public/confirmar-cita.html` ya resuelve "cargar el link no ejecuta la acción, hace falta un tap explícito" (necesario porque Gmail/Outlook Safe Links prefetchean enlaces). Una página de gestión nueva sigue el mismo patrón, no uno nuevo.
- **Callable de lectura por token, sin exponerlo de vuelta:** `exports.getBookingForReminderAction` (`functions/index.js:564`) ya es el ejemplo de cómo leer una reserva por `reminderToken` sin filtrar el token en la respuesta.
- **`status.js`/`attendance.js`:** los estados `'declined'`/`'cancelled'` y `BLOCKING_STATUSES` ya existen y ya gobiernan qué libera un horario (`computeAvailability`). Cancelar desde gestión probablemente reutiliza esto tal cual, no un estado nuevo.
- **Ventana de 3 horas:** ya confirmada por Aldo (2026-09-08) para el correo de reserva — mismo número que proponía el spec viejo para modificar/cancelar. Buena señal de que es el criterio de negocio real, no una suposición del diseñador.

## Decisiones que hay que tomar con Aldo antes de escribir un spec cerrado

1. **¿Reagendar reusa el widget de reservas existente (`public/index.html`, con el motor de disponibilidad real `getAvailability`), o es una pantalla nueva e independiente?** El spec viejo optaba por reusar el widget vía un modo de edición (`#reservar&editCode=...`). Sigue pareciendo lo más barato — evita duplicar el cálculo de disponibilidad — pero hay que confirmar que el widget actual (que ha cambiado bastante desde julio) todavía se presta para eso.
2. **¿Cuántas veces puede reagendar un cliente la misma reserva?** El spec viejo ponía un tope de 2. ¿Se mantiene ese número, se descarta el tope, o es otro?
3. **¿Reagendar y cancelar comparten la misma página/link, o son flujos separados?** (el spec viejo los combinaba en una sola pantalla con 3 botones: confirmar/modificar/cancelar).
4. **¿Se reenvía un correo con el detalle actualizado después de reagendar?** Si sí, ¿con qué formato — el nuevo diseño 2026-09-08, o el que se decida entonces?
5. **¿La ventana de 3 horas aplica igual a reagendar que a cancelar, o son números distintos?**
6. **¿Quién se entera cuando el cliente reagenda/cancela desde este flujo?** Hoy, declinar desde `confirmar-cita.html` solo avisa por correo a `SHOP_EMAIL`. La app del barbero (medición de atención real, 2026-09) ya tiene FCM — ¿vale la pena empujar un push real en vez de (o además de) el correo?
7. **Nombre y URL de la página** — por coherencia con `confirmar-cita.html`, la propuesta natural es `public/gestionar-cita.html`, pero es una sugerencia, no una decisión tomada.

## Cómo seguir desde acá

Este documento no se convierte directamente en un plan de implementación (`writing-plans` exige requisitos ya decididos, y varios de los de arriba no lo están). El siguiente paso es una sesión corta de `superpowers:brainstorming` con Aldo para cerrar las 7 preguntas de arriba, después de la cual este documento se reemplaza por un spec cerrado (con su "Decisiones tomadas con el usuario", mismo formato que ya usa el resto de `docs/superpowers/specs/`) y recién ahí un plan tipo `docs/superpowers/plans/*.md` con tareas TDD ejecutables — mismo proceso en dos pasos que ya siguió `2026-09-01-recordatorio-citas-design.md` → `2026-09-01-recordatorio-citas-plan.md`.

## Mientras tanto

El correo de reserva y el de confirmación (`docs/superpowers/plans/2026-09-08-correos-transaccionales-plan.md`) NO enlazan a esta página — todavía no existe. En su lugar, ambos correos derivan los cambios de día/hora a WhatsApp (mismo número que ya usa el resto del sitio para esto). Esa nota de WhatsApp se reemplaza por el link real de gestión cuando este trabajo se implemente — no antes.
