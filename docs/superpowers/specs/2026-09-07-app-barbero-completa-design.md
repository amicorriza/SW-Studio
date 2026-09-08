# Scissor White — App del barbero completa (agenda navegable, métricas, clientes y horario)

- **Fecha:** 2026-09-07
- **Proyecto:** Scissor White / SW Studio (barbería, Concepción, Chile)
- **Etapa:** B/C. De la lista PROHIBIDO del CLAUDE.md siguen vigentes: no migrar a framework,
  no reescribir los HTML monolíticos, no tocar el módulo de reseñas de Google, no cambiar el
  diseño visual, no desplegar a producción.
- **Rama:** `feature/medicion-atencion-real`.
- **Origen:** pedido directo del usuario — *"permíteme revisar la agenda de otros días.
  Permíteme además salir de esta vista e ir a una vista similar a la de admin, pero con las
  métricas/agenda/clientes/horarios"*.
- **Continúa** `2026-09-06-medicion-atencion-real-design.md`, que dejó la PWA como
  "agenda de hoy + cuatro botones".

## Decisiones tomadas con el usuario

Tres preguntas, tres respuestas, todas por la opción de menor privilegio:

1. **Los tres módulos**: métricas propias, clientes y horarios.
2. **Clientes sin datos de contacto**: nombre, cuántas veces lo atendió ÉL, última visita y
   servicios. Sin teléfono ni correo.
3. **Horario de solo consulta**: el barbero lo ve, no lo edita. Los cambios de disponibilidad
   siguen pasando por el salón, que es quien responde por lo que el widget publica.

## Lo que ya está hecho (navegación de días)

`getMyDay` aceptaba `request.data.date` desde el primer día; faltaba la interfaz. Ya entregado:
flechas ‹ ›, botón **Hoy**, fecha legible.

**Fuera de hoy la agenda es de solo lectura**, y es la decisión de diseño que sostiene todo lo
demás: `markAttendance` sella SIEMPRE la hora del servidor y corregirla es admin-only, así que
"Finalizar" sobre una cita de ayer escribiría una duración inventada — el dato que este
proyecto entero existe para medir. Un aviso lo dice en pantalla en vez de dejar botones que
mienten.

"Hoy" jamás sale del reloj del teléfono: es lo que devolvió la primera llamada sin fecha,
resuelta en la zona del negocio. La aritmética de días opera sobre la clave `YYYY-MM-DD` en
UTC, para que el horario de verano del navegador no se meta en una fecha ya resuelta.

## Arquitectura

### La barrera que hay que respetar

Un barbero **no puede leer `bookings` ni `patients`** (`firestore.rules`, admin-only) ni
escribir `staff`. Eso no es un obstáculo a rodear: es exactamente el aislamiento que el usuario
pidió. Todo módulo nuevo pasa por un callable con Admin SDK que filtra por `staffId` en el
servidor, igual que `getMyDay` y `markAttendance`.

### Dos callables nuevas, no tres

| Callable | Devuelve | Notas |
|---|---|---|
| `getMyRange({from,to})` | Sus reservas del rango, proyección de `getMyDay` **más** `date` y `svcId` | Alimenta Métricas. Tope de **92 días**: sin él, un rango abierto trae el historial completo a un teléfono. Usa el índice `bookings(barberId,date)` que ya existe. |
| `getMyClients()` | Por cliente: nombre, atenciones **con él**, última visita, servicio más frecuente | Se arma desde `bookings`, **nunca** desde `patients`. |

**Horarios no lleva callable.** `getMyDay` ya resuelve la ficha del profesional; se le agrega
`schedule` al retorno. Una superficie nueva menos que auditar.

### Por qué Clientes no toca `patients`

`patients` guarda teléfono, correo, notas e historial de fotos. La decisión 2 dice que nada de
eso llega al teléfono del barbero. La forma más segura de garantizarlo no es filtrar campos al
salir: es **no abrir la colección**. Todo lo que Clientes necesita ya está en las reservas que
él atendió.

### La clave opaca

La agrupación se hace por correo — es la clave de unión real, la misma que usa `patients` — pero
**el correo no viaja**. La respuesta lleva `key`, los primeros 12 hex de un SHA-256 del correo
normalizado. Sin agrupar por correo, dos clientes distintos llamados "Juan Pérez" se fusionarían
en una sola ficha; agrupando por nombre el dato sería sencillamente falso.

Reservas sin correo (las que toma el salón por teléfono) se agrupan por nombre normalizado con
prefijo `n:`. Es una aproximación declarada, no un descuido: sin correo no hay identidad fuerte,
y el propio `onBookingCreated` ya decide por eso no crear ficha en `patients`.

### Módulo puro

`functions/shared/clients.js` — `aggregateMyClients(bookings)` y `clientKey(email, name)`, sin
`firebase-admin`, testeables con `node --test` y sin emulador. Mismo patrón que
`shared/attendance.js` y `shared/availability.js`. El callable solo hace I/O.

### Front

Barra inferior de cuatro secciones: **Agenda · Métricas · Clientes · Perfil**. "Perfil" absorbe
la barra que hoy ya está abajo (Activar avisos / Salir) y suma el horario semanal — así no
quedan dos barras inferiores compitiendo por el pulgar.

**Métricas no trae lógica de cálculo nueva.** `public/js/metrics.js` ya es puro, sin DOM y sin
Firestore: la PWA lo carga con un `<script>` clásico igual que el admin y reusa `mAttendance`,
`mRealTime` y compañía. Duplicar esas fórmulas sería garantizar que diverjan.

## Verificación

- **Unitarias** (`npm test`): `aggregateMyClients` — un cliente con varias visitas, dos
  homónimos con correos distintos que NO se fusionan, reservas sin correo, cuáles estados
  cuentan como atención, el servicio más frecuente con empate.
- **e2e contra el emulador**: `getMyRange` rechaza rangos mayores a 92 días; no devuelve
  `email` ni `phone`; un barbero no ve las reservas de otro; `getMyClients` no expone el correo
  ni la clave en claro.
- **Navegador**: las cuatro pestañas, y que Métricas pinte los mismos números que `metrics.js`
  calcula sobre el mismo fixture.

## Riesgos

- **La lista de deploy manual pasa de quince a diecisiete nombres.** CLAUDE.md ya documenta que
  `createBooking` se cayó de esa lista una vez y se congeló en silencio. Actualizar el comando
  del README es parte de la tarea, no un paso posterior.
- **Volumen**: 92 días de un barbero activo son unos cientos de documentos. Aceptable para una
  llamada puntual, no para un poller. Métricas se carga a demanda, no en cada foco.
