# Prepago parcial con Flow — diseño

Fecha: 2026-09-08
Estado: aprobado en brainstorming, pendiente de plan de implementación

## 1. Objetivo

Cobrar un **abono del 30%** al reservar los dos servicios de asesoría con
visagismo, para que el cupo de 120 minutos deje de regalarse: hoy cualquiera
agenda una asesoría de $55.000 sin costo y, si no aparece, la barbería pierde
media mañana sin recurso alguno.

El abono **no es una multa**. Con la política acordada (§2) nadie pierde
dinero por no presentarse: el abono queda como saldo a favor por seis meses.
Lo que el abono compra es (a) caja adelantada, (b) un cupo que sólo se ocupa
si alguien puso plata, y (c) un cliente identificado de verdad. La disuasión
del no-show es un efecto secundario, no la promesa.

Volumen actual: **dos asesorías por semana**. La integración no se paga con
el ahorro de gestión; se paga con el cupo que deja de regalarse.

## 2. Política

| Situación | Qué pasa con el abono |
|---|---|
| El cliente se atiende | Se descuenta del total. Paga el 70% restante en el local. |
| Cancela, a cualquier hora | Queda como **saldo a favor**, vigente 6 meses. |
| No se presenta | Queda como **saldo a favor**, vigente 6 meses. |
| Pasan 6 meses sin usarlo | Vence. La barbería se queda con el monto. |
| No completa el pago en 15 min | El cupo se libera. No hubo cobro. |

**Nunca sale dinero de vuelta.** No se usa `refund/create` de Flow ni ningún
otro mecanismo de devolución. Esto es una decisión explícita: la devolución
automática exige un segundo webhook público, una segunda máquina de estados
(`created` → `accepted` / `rejected` / `cancelled`) y un caso de "la
devolución quedó rechazada y nadie se enteró" que alguien tendría que vigilar.
Todo eso desaparece del proyecto.

**Registrarse es obligatorio** para reservar los dos servicios con abono. Sin
cuenta verificada no hay dueño a quien amarrarle un saldo de seis meses.

Una consecuencia que hay que aceptar con los ojos abiertos: **no queda ningún
caso en que el cliente pierda el abono** salvo el vencimiento. La ventana de
3 horas que se discutió en el brainstorming se eliminó porque, con esta
política, no distinguía nada.

### Texto para las políticas de servicio

Redacción propuesta, pendiente de aprobación de Aldo:

> Las Asesorías con Visagismo requieren un abono del 30% al reservar y una
> cuenta en el Club SW. El abono se descuenta del valor final del servicio.
> Si cancelas o no puedes asistir, **el abono no se pierde ni se devuelve en
> dinero: queda como saldo a favor en tu cuenta, disponible por 6 meses**
> para cualquier servicio de Scissor White. Pasados los 6 meses, el saldo
> caduca.

Ese texto debe aparecer en dos lugares: en la página de políticas y **dentro
del widget, antes de que el cliente pague** — no después.

## 3. Alcance

**Entra en este spec:**

- Abono del 30% en `vis` y `vis-b`, calculado en el servidor.
- Hold del cupo mientras el cliente paga, con vencimiento automático.
- Integración con Flow: creación de orden, confirmación y retorno.
- Cuenta mínima de cliente (§4) con identidad verificada.
- Saldo a favor con vencimiento a 6 meses, visible **para el salón** en el
  panel y **para el cliente** en el correo.

**No entra — es el spec 2 (cuentas de cliente):**

- Área "Mi cuenta" en el sitio, con hoja de vida navegable.
- Historial de visitas para el cliente.
- Gasto del saldo por autogestión (en este spec lo descuenta el salón a mano).
- Migración del Club SW de casilla auto-declarada a membresía real.
- Beneficios del Club (10 y 20 visitas) atados a la cuenta.

**No entra, y no está planificado:**

- Devoluciones de dinero por cualquier vía.
- Abono en servicios distintos de las dos asesorías.
- Cobro del 70% restante por la plataforma. Se paga en el local, como hoy.
- Guardar datos de tarjeta. El checkout es de Flow: **cero alcance PCI**.

## 4. Identidad del cliente (cuenta mínima)

### El problema que resuelve

El "Club SW" ya existe en `public/index.html:2286`, pero **no es una cuenta**:
es una casilla que el cliente marca al reservar, que escribe `club:'member'`
en el documento, sobre un correo que él mismo tecleó. `countClubVisits()`
(`functions/patients.js`) cuenta visitas por ese correo.

Sin verificación, un saldo de $16.500 vigente seis meses cuelga de un string.
Un correo mal escrito se lo regala a un desconocido; un correo ajeno escrito a
propósito es un fraude trivial. Con plata de por medio la identidad tiene que
estar verificada.

### La solución

**Google Sign-In como opción principal, enlace mágico por correo como
respaldo.** Ambos vía Firebase Auth, que ya está en el proyecto.

Google es la opción principal por una razón concreta de flujo: se resuelve en
un popup, **sin sacar al cliente del sitio**. El enlace mágico obliga a irse
al correo y volver en medio de la reserva, y al volver hay que restaurar la
selección de servicio, barbero, día y hora — con el riesgo de que el cupo ya
no exista. El enlace mágico queda como respaldo para quien no tenga Google.

El correo autoritativo es **el de la cuenta de Auth**, nunca uno tecleado.
Eso elimina de raíz el error de tipeo.

La cuenta se exige **sólo** cuando el servicio tiene `depositPct > 0`. El
resto del catálogo reserva exactamente como hoy, sin fricción nueva.

### Nota de conversión

Obligar a crear cuenta antes de pagar suma un paso al embudo del servicio más
caro del catálogo. A dos reservas por semana no se va a ver en las métricas,
pero el efecto existe y no hay forma de medirlo con los datos que tenemos (el
widget no instrumenta abandono). Queda dicho.

## 5. Modelo de datos

### `services/{id}`

| Campo | Tipo | Notas |
|---|---|---|
| `depositPct` | entero 0-100 | Ausente o `0` = sin abono. Sólo `vis` y `vis-b` en `30`. |

Un solo campo resuelve *cuáles* servicios llevan abono y *cuánto*, y se
administra desde el panel de Servicios que ya existe.

### `businessInfo/main`

| Campo | Default | Notas |
|---|---|---|
| `depositsEnabled` | `false` | Interruptor maestro. **Desplegar no es activar** — mismo patrón que `remindersEnabled` y `nudgesEnabled`. |
| `depositHoldMin` | `15` | Minutos que dura el hold del cupo. |
| `creditMonths` | `6` | Vigencia del saldo a favor. |

Con `depositsEnabled` en `false`, `createBooking` ignora `depositPct` por
completo y todo funciona como hoy. Es el interruptor de emergencia si Flow
falla en producción.

### `bookings/{id}` — campos nuevos

| Campo | Tipo | Notas |
|---|---|---|
| `uid` | string | Cuenta del cliente. Presente sólo en reservas con abono. |
| `depositRequired` | bool | Congelado al crear: si mañana cambia `depositPct`, esta reserva no muta. |
| `depositAmount` | entero CLP | Calculado en el servidor desde `price × depositPct / 100`. |
| `depositStatus` | string | `pending` \| `paid` \| `expired` \| `credited` \| `applied` |
| `holdUntil` | ISO string | Sólo mientras `status === 'pending_payment'`. |
| `paymentId` | string | Referencia al último `payments/{id}`. |

Dos palabras que no son sinónimos y conviene no cruzar: `applied` es **el
abono descontado del servicio** cuando el cliente se atendió; `consumed`
(§`clientCredits`) es **un saldo a favor gastado** en una reserva posterior.

Nada de esto llega a `availability/{fecha}`: `recomputeAvailabilityForDate`
sólo escribe barbero y rangos horarios, así que el invariante de "availability
nunca contiene PII" se mantiene sin trabajo extra.

### `payments/{id}` — colección nueva

| Campo | Notas |
|---|---|
| `bookingId` | |
| `commerceOrder` | `${code}-${attempt}`. Flow rechaza los repetidos. |
| `attempt` | entero. Un abandono seguido de un reintento es un intento nuevo sobre el mismo hold. |
| `amount` | entero CLP. |
| `status` | `created` \| `paid` \| `rejected` \| `expired` |
| `flowToken`, `flowOrder` | Devueltos por Flow. |
| `rawStatus` | Respuesta cruda de `getStatus`, para auditar sin depender de Flow. |
| `createdAt`, `paidAt` | |

Reglas: `allow read: if isAdmin(); allow write: if false;`. Sólo el Admin SDK
escribe acá, igual que `bookings`.

### `clientCredits/{uid}` — colección nueva

```
{
  email: 'cliente@correo.cl',       // el de la cuenta de Auth, no el tecleado
  entries: [
    { id, type: 'earned',   amount: 16500, bookingId, createdAt, expiresAt },
    { id, type: 'consumed', amount: 16500, bookingId, createdAt }
  ]
}
```

**El saldo no se almacena, se calcula**: suma de `earned` no vencidas menos
`consumed`. Un saldo persistido se desincroniza en cuanto una escritura falle
a la mitad, y el síntoma sería plata que aparece o desaparece sin rastro. A
dos reservas por semana el costo de calcularlo es irrelevante.

`expiresAt` = fecha de la reserva que lo originó **+ 6 meses**. El vencimiento
se evalúa al leer, no necesita tarea programada — a diferencia del hold, que
sí la necesita porque tiene que refrescar `availability/{fecha}`.

Reglas: `allow read: if isAdmin() || (request.auth != null && request.auth.uid == uid); allow write: if false;`
La lectura del dueño no se usa todavía en este spec (el cliente ve su saldo en
el correo), pero deja el terreno listo para el spec 2 y no expone nada de
nadie más.

### `patients/{id}` — un campo

Se le agrega `uid` cuando la reserva vino de una cuenta, para poder cruzar la
ficha del CRM con el saldo. La ficha sigue siendo admin-only y **nunca** se
expone al cliente: tiene fotos y notas internas.

## 6. Flujo

### Camino feliz

1. El cliente elige una asesoría. El widget ya conoce `depositPct` (el
   catálogo es de lectura pública) y muestra **el monto del abono y la
   política** antes de pedir cualquier dato.
2. Elige día, hora y barbero como siempre.
3. **Inicia sesión** (Google, o enlace mágico). Si ya tiene sesión, este paso
   no existe.
4. `createBooking` escribe la reserva con `status:'pending_payment'` y
   `holdUntil = ahora + 15 min`. **Ese estado bloquea el cupo.**
5. `createDepositPayment` crea el documento en `payments`, llama a
   `payment/create` de Flow y devuelve la URL de redirección.
6. El cliente paga en el checkout de Flow.
7. Flow llama a `flowConfirm` (servidor a servidor). La función **ignora el
   body**, consulta `payment/getStatus` con el token y, si está pagado y el
   monto calza, pasa la reserva a `status:'pending'` y
   `depositStatus:'paid'`.
8. Flow devuelve al cliente a `flowReturn`, que redirige a la página de
   confirmación.
9. Recién ahí salen los correos y se crea/actualiza la ficha del cliente.

De `pending` en adelante, **todo el sistema existente sigue igual**: el
recordatorio a 24h, confirmar/declinar, la PWA del barbero, la medición de la
atención real. El prepago se acopla antes de `pending` y no toca nada después.

### Por qué son dos callables y no uno

`createBooking` corre dentro de `db.runTransaction()`. Una transacción de
Firestore **puede reintentarse**, y un `fetch` a Flow dentro de ella crearía
dos órdenes de pago para una sola reserva. La orden se crea después de que la
transacción confirmó, en una llamada aparte.

### Caminos que fallan

| Qué pasa | Qué hace el sistema |
|---|---|
| El cliente cierra el navegador en el checkout | El hold vence a los 15 min. `expireBookingHolds` lo pasa a `expired`, se recalcula `availability` y el cupo reaparece. No hubo cobro. |
| Vuelve y reintenta el pago | Mismo hold si sigue vivo, `attempt + 1`, `commerceOrder` nuevo. Si el hold ya venció, reserva desde cero. |
| Flow llama al webhook dos veces | La transición es idempotente dentro de una transacción: si ya está `paid`, es un no-op y responde 200. |
| Pagó pero el webhook nunca llegó | El hold vencería con el cobro hecho. Mitigación: `expireBookingHolds` consulta `getStatus` en Flow **antes** de expirar cualquier hold que tenga un `payments` en `created`. Si Flow dice que está pagado, confirma en vez de expirar. |
| El monto pagado no calza con `depositAmount` | No se confirma la reserva. Se marca el pago para revisión manual y se registra en `adminLog`. Nunca se acepta un monto que el servidor no calculó. |
| Cancela después de pagar | `markAttendance` con `cancelled` → se emite el crédito. |
| No se presenta | `markAttendance` con `no_show` → se emite el crédito. |

## 7. Piezas nuevas de servidor

| Nombre | Tipo | Qué hace |
|---|---|---|
| `createDepositPayment` | `onCall` | Crea la orden en Flow y devuelve la URL. Exige `request.auth`. |
| `flowConfirm` | `onRequest` | Webhook público. Verifica contra `getStatus` y confirma la reserva. |
| `flowReturn` | `onRequest` | Recibe el retorno del navegador y redirige. |
| `expireBookingHolds` | `onSchedule` cada 2 min | Vence los holds. Mismo intervalo que `staffAttendanceNudges`. |

`flowReturn` **tiene que ser una función**, no una página estática: Flow
devuelve al navegador **por POST**, y Firebase Hosting no puede recibir un
POST en un archivo HTML.

Módulo puro nuevo: **`functions/shared/deposits.js`** — cálculo del abono,
firma HMAC, cálculo del saldo y vencimientos. Sin I/O, testeable con
`node --test` sin emulador, igual que `availability.js`, `attendance.js` y
`clients.js`. La política vive ahí; `index.js` sólo hace I/O.

### URLs

- `urlConfirmation` → URL cruda de la función (`https://southamerica-east1-scissor-white.cloudfunctions.net/flowConfirm`). Nadie la ve.
- `urlReturn` → rewrite de Hosting a `/pago/retorno`, para que el cliente vea
  una URL del dominio. **`firebase.json` no tiene sección `rewrites` hoy**:
  hay que agregarla, y el rewrite a una función en `southamerica-east1` debe
  declarar la región explícitamente o Hosting busca en `us-central1`.

### Firma

HMAC-SHA256 de los parámetros ordenados alfabéticamente, con el módulo
`crypto` de Node. **Cero dependencias nuevas**: ningún SDK de terceros toca
el camino del dinero.

## 8. Cambios en piezas existentes

### `functions/shared/status.js` — y sus copias

Dos estados nuevos:

- `pending_payment` → **dentro** de `BLOCKING_STATUSES`. Ese solo hecho es
  todo el hold: `computeAvailability`, el `checkConflict()` del admin, la PWA
  y el widget ya consultan `isBlockingStatus()` y heredan el bloqueo sin que
  haya que tocarlos.
- `expired` → **fuera** de `BLOCKING_STATUSES`.

El criterio está **duplicado a propósito** en dos copias más, y las tres
cambian juntas o aparece una doble reserva en producción:

1. `functions/shared/status.js` (la fuente)
2. `public/admin/index.html` (`<script>` plano, no puede requerir el módulo)
3. `public/index.html` (misma razón)

### `functions/index.js` — `onBookingCreated`

**Este es el bug que el diseño introduce si no se ataja.** Hoy
`onBookingCreated` manda los correos y crea la ficha del cliente **al crear el
documento** — es decir, en el paso 4 del flujo, cuando el cliente todavía no
ha pagado. Tal cual está, mandaría "reserva confirmada" por un hold que quizás
se abandona en quince minutos.

Guarda: `if (b.status === 'pending_payment') return;`. El correo y la ficha se
disparan desde `flowConfirm`, cuando el pago está verificado.

### `functions/shared/attendance.js`

Transiciones nuevas: `pending_payment` → `pending` (pago confirmado),
`expired` (hold vencido) o `cancelled`. Y la emisión del crédito colgada de
`cancelled` y `no_show` cuando `depositStatus === 'paid'`.

### `functions/createBooking.js`

`buildBookingDoc()` escribe los campos de abono. Sigue sin hacer I/O: recibe
el servicio ya leído y calcula el 30% desde `service.price`. **El monto jamás
viene del payload** — invariante del proyecto.

`resolveCreateBooking()` rechaza con `unauthenticated` si el servicio exige
abono y no hay `uid`.

### `public/index.html` — widget

Monto y política antes de pedir datos · paso de inicio de sesión · redirección
a Flow · copia de `isBlockingStatus` actualizada. **No se reestructura nada**:
se sustituyen funciones, según la regla del proyecto.

### `public/admin/index.html` — panel

Copia de `isBlockingStatus` · el saldo del cliente visible en su ficha, con
fecha de vencimiento · los holds visibles en la agenda, distinguibles de una
reserva real · botón para descontar saldo al cobrar.

### `README.md`

El deploy manual pasa de **diecinueve a veintitrés** nombres de función.
`createBooking` ya quedó fuera de esa lista una vez y se congeló en silencio.

## 9. Seguridad

- **`flowConfirm` es público por necesidad** y no confía en nada de lo que
  recibe: toma el token, consulta `getStatus` y decide con esa respuesta.
  Verifica además que el `commerceOrder` corresponda a la reserva y que el
  monto sea exactamente `depositAmount`.
- **Responder 200 en menos de 15 segundos** es un requisito de Flow. El correo
  y el sync de `patients` no se hacen dentro del webhook.
- **Secretos con `defineSecret`**: `FLOW_API_KEY`, `FLOW_SECRET_KEY`,
  `FLOW_BASE_URL`. Nunca en `functions/.env` — ese archivo ya bloqueó un
  deploy en este proyecto.
- `payments` y `clientCredits`: escritura `false` para todos. Sólo Admin SDK.
- `createDepositPayment` exige `request.auth` y verifica que la reserva sea
  del `uid` que llama. Un cliente no puede crear una orden de pago sobre la
  reserva de otro.
- Ningún dato de tarjeta toca el sistema.

## 10. Impacto en el Dashboard

Dos decisiones explícitas, porque el `CLAUDE.md` advierte que estos filtros no
se "arreglen" sin leer el spec:

- **El abono no entra en `mRevenue`.** El servicio se cobra completo al
  atender; contar el abono además del precio inflaría el ingreso al doble en
  las asesorías. El abono se muestra aparte, como "recibido por adelantado".
- **Los `expired` no entran en `mFilterPeriod`.** Un hold vencido no es
  demanda real: nadie pidió esa hora en firme. Es distinto de un `no_show`,
  que sí es demanda real y por eso sí está incluido a propósito.

Métricas nuevas sugeridas, todas derivables de lo que ya se guarda: abonos
cobrados en el período, saldo total vigente (un pasivo: servicio que debes) y
saldo vencido en el período (ingreso que se consolidó).

## 11. Correos

- **Abono recibido** (nuevo): monto pagado, saldo pendiente a pagar en el
  local, y la política de saldo a favor en el cuerpo, no en letra chica.
- **Reserva confirmada** (existente): se dispara desde `flowConfirm`, no desde
  la creación del documento.
- **Saldo a favor emitido** (nuevo): se manda cuando se cancela o no se
  presenta. Dice el monto, **la fecha exacta de vencimiento** y cómo usarlo
  ("menciónalo al reservar" mientras no exista el spec 2).
- **Recordatorio a 24h** (existente): sin cambios. Con la política actual no
  necesita advertir nada sobre el abono, porque no hay nada que perder.

## 12. Pruebas

**Sin emulador** (`node --test`, sobre `shared/deposits.js`):

- Firma HMAC contra un vector conocido.
- Cálculo del abono: redondeo a peso entero, y el **mínimo de 350 CLP** que
  exige Flow (a 30% sólo se violaría con servicios bajo $1.167, pero la
  guarda va igual: el catálogo cambia).
- Cálculo del saldo: vencidos excluidos, consumidos restados, saldo nunca
  negativo.
- `expiresAt` a seis meses, incluido el borde de fin de mes.
- Transiciones nuevas, incluidas las inválidas.

**Con emulador** (`npm run test:e2e`):

- El hold bloquea el cupo; `getAvailability` no lo ofrece.
- El hold vence, `availability/{fecha}` se recalcula y el cupo reaparece.
- Webhook llamado dos veces = un solo pago, un solo correo.
- Un monto que no calza no confirma la reserva.
- `createBooking` sin sesión sobre un servicio con abono → `unauthenticated`.
- Un cliente no puede pagar la reserva de otro.

**Reglas** (`tests/rules`): nadie que no sea admin lee `payments`; un cliente
lee su `clientCredits/{uid}` y no el de otro; nadie escribe ninguna de las dos.

**Manual, irreemplazable**: un pago real en el **sandbox de Flow**. El webhook
llegando desde fuera no se simula.

## 13. Despliegue y puesta en marcha

Orden obligatorio, el mismo que usa este proyecto: **funciones → hosting →
reglas**.

Pasos manuales de Aldo, ninguno de los cuales puede hacer el código:

1. Cuenta Flow con credenciales de **sandbox** y de **producción** (son
   distintas).
2. Cargar los tres secretos.
3. Habilitar **Google Sign-In** y **enlace por correo** en Firebase Auth.
4. Poner `depositPct: 30` en `vis` y `vis-b`.
5. Probar el flujo completo en sandbox.
6. **Recién entonces** `depositsEnabled: true`.
7. Publicar el texto de políticas.
8. Preguntar al ejecutivo de Flow **si la comisión se devuelve** en caso de
   reverso. No afecta al código, pero define cuánto te cuesta cada abono.

## 14. Riesgos conocidos

- **Nadie pierde el abono.** Si en tres meses las asesorías se llenan de
  saldos a favor que nadie usa y de horas que se pierden igual, la palanca es
  la política, no el código: reponer una ventana de cancelación es cambiar un
  campo de `businessInfo` y el texto.
- **Un paso más en el embudo del servicio más caro**, sin forma de medir el
  abandono con la instrumentación actual.
- **Dependencia de un tercero en el camino de la reserva.** Con
  `depositsEnabled: false` todo vuelve al comportamiento actual en una
  escritura, sin desplegar.
- **El saldo es un pasivo real**: servicio que la barbería debe. A dos por
  semana es chico, pero crece solo y hay que mirarlo en el Dashboard.
- **Los códigos numéricos de estado de `getStatus`** aparecen inconsistentes
  entre páginas de la documentación pública de Flow. Se fijan contra la
  documentación oficial **al implementar**, nunca de memoria, y el test los
  cubre con la respuesta cruda guardada en `payments.rawStatus`.

## 15. Preguntas abiertas

Ninguna bloquea el plan de implementación:

1. ¿El saldo a favor sirve para cualquier servicio, o sólo para asesorías? El
   spec asume **cualquier servicio**.
2. ¿El saldo se puede transferir a otra persona? El spec asume **que no**.
3. ¿Se avisa al cliente antes de que su saldo venza? El spec **no** lo
   incluye; es un correo programado fácil de sumar después.
