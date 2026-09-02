# Scissor White — Dashboard de métricas de negocio

- **Fecha:** 2026-09-02
- **Proyecto:** Scissor White / SW Studio (barbería, Concepción, Chile)
- **Etapa:** B/C — confirmado con el usuario el 2026-09-01 que el proyecto avanzó de las etapas 0/A ([[scissor_white_stage_b_c_transition]]). De la lista PROHIBIDO del CLAUDE.md siguen vigentes: no migrar a framework, no reescribir los HTML monolíticos (sustituir funciones, no reestructurar), no tocar el módulo de reseñas de Google, no desplegar a producción.
- **Origen:** el usuario (dueño del negocio) pidió que el Dashboard y la pestaña Estadísticas dejen de mostrar solo totales históricos y pasen a explicar el comportamiento del negocio: ingresos por mes y por semana, desglose por tipo de servicio, clientes nuevos vs. recurrentes, y tasa de no presentación.

## Resumen

Fusionar el panel **Dashboard** y la pestaña **Estadísticas** del admin en un **único Dashboard** orientado a métricas de negocio, calculado **exclusivamente con datos que ya existen** en la colección `bookings`. Sin cambios de backend: ninguna Cloud Function nueva, ninguna consulta nueva a Firestore, ningún cambio en `firestore.rules` / `storage.rules`, ningún cambio en el flujo de reservas.

La **tasa de no-show y de cancelación quedan explícitamente fuera de alcance** y pasan a ser el proyecto inmediatamente siguiente: requieren registrar asistencia (estado `attended` / `no_show`) y que "cancelar" deje de hacer `deleteDoc`. Decisión del usuario: entregar primero el dashboard de reporting con datos actuales (rápido, sin riesgo, sin chocar con el PR #1 de recordatorios que sigue abierto y ya modifica el ciclo de estados), y abordar el no-show como trabajo propio después.

## Contexto (estado actual, verificado en el código)

### Lo que hay hoy

- **`renderDash()`** (`public/admin/index.html` ~1729): 4 tarjetas — reservas totales (histórico), servicios activos, personal activo, precio promedio **del catálogo** (no de las reservas) — más una tabla "Actividad reciente" alimentada por `D.log`.
- **`renderStats()`** (`public/admin/index.html` ~2633): 4 tarjetas — reservas totales, ingresos totales (`Σ b.price` sobre **todas** las reservas, sin filtro de fecha ni estado), ticket promedio, servicios distintos — más "servicios más demandados" (barras CSS, `Σ` histórico) y "reservas por barbero" (tarjetas `.a-bstat`, histórico).
- **Ninguna de las dos vistas tiene noción de tiempo.** Todo es acumulado desde siempre.
- La navegación: botón `.an-item[data-p="stats"]` (~940) y panel `#adm-p-stats` (~1074). `admPnl()` (~1705) mapea `stats` → `renderStats()`. `renderAll()` (~1685) y `renderBookingsViews()` (~1701) llaman a `renderStats()` y `renderDash()`.
- `D.log` / `log()` (~1672): escribe en memoria (`D.log.unshift(...)`), **nunca se persiste** (`saveAdmin()` solo guarda services, staff y businessInfo; `adminLog` en Firestore solo lo escribe la Cloud Function `onBookingCreated` ante fallos de email/sync, nunca el panel). Se borra en cada recarga.

### Datos disponibles para las métricas

- El admin ya tiene **toda la colección `bookings` cargada y suscrita en tiempo real** vía `subscribeBookings()` (`public/js/data.js` ~101): `onSnapshot(collection(db,'bookings'))` sin query ni límite. El callback `renderBookingsViews()` repinta Dashboard/Agenda/Lista en cada cambio. El array vive en `BK` (`getBk()` ~1750). **Todas las agregaciones de este spec se calculan sobre `BK` en el navegador** — no hace falta I/O nuevo.
- Forma de cada reserva (`buildBookingDoc`, `functions/createBooking.js` ~70): `code`, `name`, `email`, `phone`, `svcId`, `svcName`, `svcCat`, `price` (resuelto en el servidor desde `services`, es el **precio de catálogo** al momento de reservar), `dur`, `barberId`, `barberName`, `date` (`YYYY-MM-DD`), `time` (`HH:mm`), `club` (`guest`/`member`), `status`, `emailStatus`, `tz` (IANA del negocio), `src`, `createdAt` (ISO del servidor).
- **`status`**: hoy `buildBookingDoc` escribe `'pending'` fijo y nada lo cambia. El PR #1 (recordatorios, `feature/recordatorio-citas`, abierto contra main, **no mergeado**) agrega las transiciones `pending → confirmed / declined` en `functions/shared/status.js`. Este spec **no depende** de que ese PR esté mergeado, pero su código de agregación debe tolerar reservas con `status` `'confirmed'` o `'declined'` si aparecen.
- **Identidad de cliente = email normalizado** `(email || '').trim().toLowerCase()` — es la clave que usa `onBookingCreated` para el upsert de `patients` (`functions/index.js` ~44, ~93) y `countClubVisits` (`functions/patients.js` ~29). Este spec usa la misma clave, calculada directo sobre `BK` (no necesita la colección `patients`).
- **Datos sucios son un caso real**: el camino de escritura directa del admin **no pasa por `isValidBookingPayload()`** (CLAUDE.md; brecha conocida y sin cerrar). Puede haber reservas con `date` / `time` malformado, sin `email`, sin `svcCat`, con `price` 0. El trabajo de recordatorios ya se topó con esto ([[scissor_white_recordatorio_citas]], bug #1: un `date` malformado tiraba abajo el lote entero). Toda función de agregación debe aislar la reserva que no parsea, no propagar la excepción.
- **Zona horaria**: el invariante del CLAUDE.md es "la zona horaria del negocio gobierna, nunca la del navegador". El admin hoy lo respeta en la lógica de solape (`checkConflict` en minutos-desde-medianoche) pero **no** en la navegación de fecha de la Agenda (`bkDate = new Date()`, hora del navegador). Este spec introduce el cálculo correcto de "hoy" y de los límites de mes/semana en la TZ del negocio.

## Decisiones tomadas con el usuario

1. **Ubicación:** fusionar todo en **Dashboard**; **eliminar** la pestaña *Estadísticas* (botón de nav + panel).
2. **Prioridades:** (a) salud mensual del negocio, (b) servicios y precios, (c) retención — clientes nuevos vs. recurrentes. El desglose por barbero se conserva (ya existe, es barato) pero no es foco.
3. **No-show / cancelaciones:** fuera de alcance. Proyecto siguiente.
4. **Ingresos:** dos modos con interruptor en el panel — **Realizado** (por defecto) y **Agendado**.
5. **Precio:** el precio de catálogo guardado en la reserva es un proxy válido del ingreso (el usuario confirma que cobra el precio de catálogo salvo excepciones menores; descuentos/propinas no se registran hoy en ninguna parte).
6. **Selector de período:** presets — *Este mes* (default) / *Mes pasado* / *Últimos 3 meses* / *Este año* / *Rango libre* — más checkbox "comparar vs período anterior".
7. **Gráficos:** SVG dibujado a mano para las dos líneas de tendencia (12 meses, 12 semanas); barras HTML/CSS para el resto. **Sin librerías externas** (Chart.js y similares descartados: dependencia nueva en el admin de producción + estilo visual que no calza).
8. **Reglas de cálculo** (a/b/c): confirmadas tal cual — ver "Definiciones" abajo.
9. **Actividad reciente:** eliminarla del Dashboard.
10. **Exportar:** sí — botón que baja un CSV de la tabla mensual.

## Definiciones de cálculo

### a) "Realizado" vs. "Agendado"

- **Realizado**: reservas cuyo `date` es **anterior a hoy** en la TZ del negocio. Se asumen atendidas (no hay registro de asistencia). **Sobreestima**: incluye los no-show que no sabemos que lo fueron. Se declara en un pie de nota visible.
- **Agendado**: todas las reservas del período, sin importar la fecha.
- El **período "Este mes"** muestra el realizado-hasta-hoy como número principal y el agendado-restante en tono tenue (solo en la fila de KPIs).
- Si una reserva tiene `status === 'declined'` (posible tras el PR #1), se excluye de ambos modos. Si el estado no existe, no cambia nada.

### b) "Nuevo" vs. "Recurrente"

- Clave de cliente: email normalizado. Reservas **sin email** → cubeta "sin dato": no entran en el %, ni en el gráfico de retención; se muestran como nota ("sin email: N").
- Para el período seleccionado: se toma el conjunto de emails únicos con al menos una reserva en el período. Para cada uno se busca su **primera reserva histórica** en todo `BK` (por `date`; si `date` no parsea, se usa `createdAt`).
  - Primera reserva **dentro del período** → cliente **nuevo**.
  - Primera reserva **anterior al inicio del período** → cliente **recurrente**.
- **KPI "Clientes nuevos"**: cantidad de emails únicos nuevos en el período + su % sobre (nuevos + recurrentes).
- **KPI "% recurrentes"**: recurrentes ÷ (nuevos + recurrentes), sobre **clientes únicos**, no reservas.

### c) "Semana"

- Semana **lunes a domingo**. El gráfico semanal muestra las **últimas 12 semanas completas** más la semana en curso (marcada distinto). Los límites se calculan en la TZ del negocio.

### d) Comparación "vs período anterior"

- El período anterior es el inmediatamente contiguo del mismo largo: *Este mes* → mes pasado; *Últimos 3 meses* → los 3 previos; *Rango libre* de N días → los N días previos; *Este año* → año pasado (a la fecha equivalente, para no comparar un año completo contra uno en curso).
- Δ se muestra como porcentaje (`(actual − previo) / previo`), salvo "% recurrentes" que se muestra como diferencia de puntos.
- **Período previo con 0 reservas / divisor 0**: se muestra "—" o "sin base de comparación", nunca `NaN` / `Infinity`.

## Arquitectura

Todo en `public/admin/index.html`, sin reestructurar el archivo. Se agrega un bloque coherente de código nuevo y se reescribe `renderDash()`; se elimina `renderStats()`.

### Helpers de fecha (TZ del negocio)

- `bizToday()` → `YYYY-MM-DD` de hoy en `D.businessInfo.tz` (fallback a la TZ por defecto del proyecto si falta), vía `Intl.DateTimeFormat('en-CA', { timeZone: tz })`.
- `monthBounds(anchorYYYYMM)`, `rangeBounds(fromISO, toISO)`, `weekStartsBack(n)` → devuelven `{ from, to }` como strings `YYYY-MM-DD` (comparación lexicográfica directa contra `b.date`, que ya es `YYYY-MM-DD`).
- `parseBookingDate(b)` → `Date` UTC-noon del `b.date`, o `null` si no parsea. Nunca lanza.

### Funciones puras de agregación

Reciben arrays y objetos de config, devuelven objetos planos, **no tocan el DOM**, aíslan por reserva las que no parsean:

- `mFilterPeriod(bookings, {from, to, mode})` → reservas del período, aplicando Realizado/Agendado y excluyendo `declined`.
- `mKpis(periodBookings, prevBookings)` → `{ ingresos, citas, ticket, nuevos, nuevosPct, recurrentesPct, deltas }`.
- `mMonthlySeries(bookings, {months: 12, metric, mode})` → `[{ ym, ingresos, citas }]` para la línea mensual.
- `mWeeklySeries(bookings, {weeks: 12, metric, mode})` → `[{ weekStart, ingresos, citas }]`.
- `mByService(periodBookings, {groupBy: 'svc' | 'cat'})` → `[{ key, label, citas, ingreso, pct, ingresoHora }]` ordenado por ingreso desc. `ingresoHora = dur > 0 ? price / (dur/60) : null`.
- `mByBarber(periodBookings, prevBookings)` → reusa la forma que hoy arma `renderStats` para `.a-bstat`, más `deltaCitas` / `deltaIngreso`.
- `mNewVsReturning(bookings, {months: 6})` → `[{ ym, nuevos, recurrentes }]` (clientes únicos por mes) + `{ sinEmail }`.
- `mMonthlyExportRows(bookings, {months: 12})` → filas para el CSV.

### Render

- `svgLine(series, opts)` (~120 líneas): dado `[{x, y}]` dibuja un `<svg viewBox>` con polilínea, área tenue bajo la curva, 2–3 líneas de grilla, marca en el punto final, etiquetas de extremos. `title` en los puntos para hover. Estilo flat, colores del admin (`#161616` línea, gris grilla).
Estado de los controles (variables de módulo, no persistido). Dos ámbitos:

- **Global** (afecta KPIs, tendencias y desgloses): `dashMode` (Realizado/Agendado).
- **Solo período** (afecta KPIs y los desgloses por servicio/barbero/retención, **no** las tendencias): `dashPeriod` (preset), `dashFrom`/`dashTo` (rango libre), `dashCompare` (comparar sí/no).
- **Local a su sección**: `dashTrendMetric` (Ingresos/Citas, solo las dos líneas de tendencia), `dashSvcGroup` (Servicio/Categoría, solo la sección Por servicio).

Las tendencias (12 meses / 12 semanas) y la retención (6 meses) tienen ventana **fija**: no se mueven con el selector de período; sí respetan `dashMode`.

- `renderDash()` reescrita: lee ese estado, llama a las funciones de agregación y pinta:
  1. **Barra de período** — `<select>` de presets + inputs `type="date"` (ocultos salvo "Rango libre") + checkbox comparar + toggle Realizado/Agendado. Listeners actualizan las variables de módulo y re-llaman `renderDash()`. Estado **no** se persiste.
  2. **Fila de KPIs** — 5 tarjetas `.a-sc`: Ingresos, Citas, Ticket promedio, Clientes nuevos, % recurrentes. Cada una con su Δ (verde/rojo/neutro) cuando "comparar" está activo.
  3. **Tendencia — últimos 12 meses** (`svgLine`) + toggle *Ingresos / Citas* y respeta Realizado/Agendado. Fija: no depende del selector de período.
  4. **Por semana — últimas 12 semanas + actual** (`svgLine`, misma mecánica).
  5. **Por servicio** — tabla + barras CSS (`.a-bar-row` reusada): Servicio · Citas · Ingreso · % del total · Ingreso/hora. Toggle *Servicio / Categoría* (usa `svcCat` + mapa `CN`). Acotado al período.
  6. **Por barbero** — tarjetas `.a-bstat` reusadas, acotadas al período, con Δ vs período anterior.
  7. **Retención** — barras CSS apiladas (nuevos vs. recurrentes por mes, últimos 6) + "clientes activos en el período: N" + nota "sin email: N".
  8. **Exportar** — botón `a-btn a-btn-g` "⬇ Exportar CSV"; arma el CSV en memoria (`mMonthlyExportRows`) y dispara la descarga con un `Blob` + `<a download>` (mismo patrón que "Exportar Excel" de Clientes).
  9. **Pie de nota** visible: *"Ingresos estimados con precio de catálogo. 'Realizado' asume que toda cita pasada ocurrió — aún no se registra asistencia."*

### Eliminaciones

- Botón `.an-item[data-p="stats"]` y panel `#adm-p-stats` (con sus hijos `#a-stats-s`, `#a-top-svcs`, `#a-barber-stats`).
- Función `renderStats()` y sus llamadas en `renderAll()`, `renderBookingsViews()`, `admPnl()` (incluida la entrada `stats` del mapa de títulos `T` y el `if(p==='stats')`).
- Tabla "Actividad reciente" del Dashboard: `#a-log`, su `<table>` contenedora en `#adm-p-dashboard`, y el bloque de `renderDash()` que la pinta. **`log()` y `D.log` se conservan** (los usan otros paneles); solo se deja de renderizar en Dashboard.
- Contenedor viejo `#a-stats-d` del Dashboard (lo reemplaza la nueva estructura).

### CSS

Reusar `.a-sc`, `.a-bar-row` / `.a-bar-track` / `.a-bar-fill`, `.a-bstat*`, `.a-tw`, `.a-sh` / `.a-st`. Agregar pocas clases nuevas acotadas: barra de período, contenedor SVG responsivo, barras apiladas de retención, indicador Δ. Sin rediseño, sin cambiar tokens de color ni tipografía.

## Qué NO se toca

Flujo de reservas, `createBooking`, `buildBookingDoc`, `status` / `functions/shared/status.js`, cualquier Cloud Function, `firestore.rules`, `storage.rules`, el módulo de reseñas de Google, el widget público (`public/index.html`), `public/js/data.js`, los demás paneles del admin (Agenda, Clientes, Servicios, Personal, Horarios, Info, Imágenes), el diseño visual. **Nada se despliega**: va a staging y despliega Aldo.

## Pruebas

- **Unitarias** (Node `--test`, estilo `functions/test/`): las funciones puras de agregación con fixtures.
  - Límites de mes y de semana (lunes/domingo), incluyendo cruces de año.
  - TZ del negocio distinta de UTC / del runner.
  - Reserva sin `email` → cubeta "sin dato"; no rompe %.
  - `dur` 0 → `ingresoHora` null, no división.
  - `date` / `time` malformado → reserva ignorada, no propaga excepción.
  - Período con 0 reservas; período previo con 0 reservas → Δ sin `NaN` / `Infinity`.
  - Nuevo vs. recurrente: cliente con 1ª reserva en el borde exacto del período; cliente con varias reservas en el mismo período cuenta una vez.
  - Realizado vs. Agendado alrededor de `bizToday()`.
  - `status: 'declined'` excluido de ambos modos.
- **Ubicación de los tests** (a definir en el plan): el código es del admin (browser), no de Functions. Opciones: (1) extraer las funciones puras a `public/js/metrics.js` cargable por Node y por el admin; (2) `test/metrics.test.js` que evalúe el bloque de funciones. El plan elige una que no viole "no reestructurar" (preferencia: un `<script src>` plano nuevo, chico y sin bundler, como ya hace `public/js/data.js`).
- **Manual en navegador**: contra el emulador con reservas sembradas en varios meses (incluyendo pasadas, futuras, sin email, con `dur` 0). Verificar cada sección, el selector de período, el toggle Realizado/Agendado, la comparación, y el CSV. Intentar clic-a-clic con la extensión de Chrome (el proyecto de recordatorios no pudo).

## Riesgos y deuda

- **"Realizado" sobrestima** sin datos de no-show. Mitigación: pie de nota. Se corrige en el proyecto siguiente (registro de asistencia).
- **`BK` crece sin límite** y se reagrega todo en cada snapshot de la suscripción. Hoy irrelevante (cientos–miles de docs); a mediano plazo pedirá agregación incremental o consultas acotadas por rango. Se anota como deuda, no se resuelve acá.
- **Quitar la pestaña *Estadísticas*** puede confundir a quien la tuviera de referencia o memorizada (`...#... ` o hábito). Decisión explícita del usuario.
- **Colisión con PR #1**: si el PR de recordatorios se mergea mientras este trabajo está en vuelo, hay que rebasar. El único punto de contacto es `status` `'confirmed'`/`'declined'`, ya contemplado en las agregaciones.
- **Precio como proxy de ingreso**: si en algún momento se registran descuentos/propinas/precios de socio, estos números quedan cortos. Fuera de alcance; conversación aparte.

## Fuera de alcance / seguimiento inmediato

Proyecto siguiente ("registro de asistencia y no-show"):
- Estados `attended` / `no_show` en `functions/shared/status.js`.
- Botón "no vino" / "asistió" en las citas pasadas de la Agenda (con default: pasada sin marcar = asistida).
- `deleteBooking()` deja de hacer `deleteDoc`; cancelar archiva (`status: 'cancelled'` o equivalente) para que la tasa de cancelación sea medible.
- El Dashboard suma dos KPIs (tasa de no-show, tasa de cancelación) y una serie temporal — el andamiaje de agregación por período de este spec ya lo soporta.
