# Scissor White — Dashboard KPI: vista simple y vista en detalle

- **Fecha:** 2026-09-06
- **Proyecto:** Scissor White / SW Studio (barbería, Concepción, Chile)
- **Etapa:** B/C. Sigue vigente de la lista PROHIBIDO del CLAUDE.md: no migrar a framework, no
  reescribir los HTML monolíticos (sustituir funciones, no reestructurar), no tocar el módulo
  de reseñas de Google, no cambiar el diseño visual, no desplegar a producción.
- **Origen:** `Reporte_KPI_Scissor_White.pdf` (Micorriza), **Fases 2 y 3**.
- **Es el segundo de tres.** P1 (medición de la atención real) está implementado en esta misma
  rama; P3 (motor de recomendaciones semanales) viene después.
- **Rama:** continúa `feature/medicion-atencion-real`.

## Qué cambia y por qué

P1 empezó a capturar `arrivedAt`, `startedAt`, `endedAt`, `actualDur`, `no_show` y `cancelled`.
Este proyecto es el que **convierte ese dato en decisiones**: los seis KPI que el reporte pide
y que hasta ahora eran imposibles.

El Dashboard actual (`renderDash()`, `public/admin/index.html`) tiene una sola vista con ocho
secciones. El PDF insiste en dos niveles de lectura (§1) y en que *"la operación diaria debe
partir siempre desde una vista simple"*. Se agrega ese nivel; no se tira nada de lo que hay.

## Decisiones de diseño (derivadas del PDF, no inventadas)

### Qué va en la vista simple

El PDF §9 es explícito: **no más de 5 KPI en la vista simple**. Y §4 relega al detalle,
nombrándolos uno por uno: ingreso por hora real y disponible, desviación por profesional y
servicio, confirmó-pero-no-asistió, horas y días con baja ocupación, **retención y rebooking**,
e ingresos perdidos por no-show.

Por lo tanto la vista simple es: **Ventas del período · Reservas · Asistencia real ·
No-show · Ticket promedio**, más un gráfico, una alerta y una sugerencia (§9, Fase 2).

Los seis KPI de la maqueta de la página 1 del PDF **no contradicen esto**: el pie de esa imagen
dice *"Referencia visual de la vista en detalle"*. Son los del detalle.

Consecuencia: **Clientes nuevos y % recurrentes salen de la fila principal** y pasan al detalle,
donde ya vive su gráfico de retención. No se pierde nada.

### La alerta y la sugerencia

La Fase 2 del PDF incluye *"una recomendación"*; el motor completo de 14 reglas es Fase 4 (P3).
Se crea ya `public/js/insights.js` con **la escalera de confianza completa** —que es la parte
que protege— y un subconjunto de 5 reglas. P3 agrega las 9 restantes y la tercera tarjeta.

Escalera de muestra (§6), obligatoria desde el primer día:

| Atenciones medidas | Comportamiento |
|---|---|
| 0-9 | Solo mostrar datos. **No sugerir nada.** |
| 10-19 | Alertar desviaciones, sin recomendar precio. |
| 20-29 | Recomendaciones prudentes. |
| 30+ | Confianza alta. |

Sin esto el panel opinaría sobre ruido, que es el peor resultado posible para alguien que va a
tomar decisiones de precio con esto.

### La migración de "Realizado" (la parte delicada)

Hoy `mFilterPeriod` con `mode:'realizado'` significa *"fecha anterior a hoy"*, y el pie de nota
dice que asume que toda cita pasada ocurrió. Cuando la barbería empiece a marcar asistencia,
los números **darían un salto inexplicable** si se cambiara el significado de golpe.

La solución no es cambiar el filtro, es separar dos conceptos que hoy son el mismo:

- **Reservas del período** (demanda): sigue siendo `mFilterPeriod`. Incluye `no_show` —una cita
  a la que el cliente no llegó sigue siendo demanda— y excluye `declined` y `cancelled`.
- **Ingresos del período**: excluye además `no_show`. Un cliente que no llegó no pagó.

Y se agrega `mAttendanceCoverage()`: qué porcentaje de las citas del período tiene marca real de
asistencia. El pie de nota deja de ser fijo y dice cuánto del número es **medido** y cuánto es
**inferido**. Con cobertura 0% el panel se comporta exactamente como hoy; a medida que sube, los
números se vuelven reales sin ningún salto.

### Ocupación

`minutos atendidos ÷ minutos disponibles` (§5). Los disponibles se derivan de
`staff[].schedule[dow]` (`{open, start, end, break}`, `dow` 0=domingo) menos las colaciones y
menos los `scheduleBlocks` del día. Ambos ya están cargados en el admin (`D.staff`, `SB`), así
que **no hace falta ninguna consulta nueva a Firestore** — igual que el dashboard actual.

Minutos atendidos usa `actualDur` cuando existe y `dur` cuando no, y el heatmap reporta aparte
cuántos son estimados.

### Mediana, no promedio

§2: *"La mediana del tiempo real debe ser el valor principal para recomendar cambios, porque
resiste mejor atenciones excepcionalmente largas o cortas que el promedio simple."* Todo el
tiempo real del panel es mediana. El promedio no aparece en ninguna parte.

Las atenciones cerradas a mano (`durSource: 'manual'`) **entran igual en la mediana**, pero se
reportan aparte: excluirlas silenciosamente sesgaría hacia las atenciones que el barbero cerró a
tiempo, que son justo las más cortas.

### Simulación de precio

`mPriceSim` calcula el precio equivalente (§5: `ingreso/hora objetivo × mediana real ÷ 60`) y
devuelve un **rango comercial redondeado**, nunca un valor exacto. §9 prohíbe explícitamente
cambiar precio o duración de forma automática; la tarjeta lo dice y no tiene ningún botón que
aplique nada.

## Arquitectura

Sin backend nuevo. Sin consultas nuevas. Todo se calcula en el navegador sobre `BK`, `D.staff` y
`SB`, que el admin ya tiene cargados y suscritos.

### `public/js/metrics.js` — funciones puras nuevas

Mismo IIFE, mismo export dual (`module.exports` / `window.SWMetrics`), cero DOM, cero Firestore.

| Función | Qué devuelve |
|---|---|
| `median(nums)` | mediana; `null` con lista vacía. Muestra par → promedio de los dos centrales. |
| `mFilterPeriodAll(bookings, opts)` | como `mFilterPeriod` pero **sin excluir por estado** — lo necesita la tasa de cancelación. Comparte el filtro de fecha vía un `inPeriod()` interno. |
| `mAttendance(allPeriodBookings)` | `{total, atendidas, noShow, canceladas, declinadas, sinMarcar, asistenciaPct, noShowPct, cancelPct}` |
| `mAttendanceCoverage(periodBookings)` | `{medidas, total, pct}` — citas con marca real de asistencia. |
| `mRevenue(periodBookings)` | ingreso excluyendo `no_show`. |
| `mRealTime(periodBookings, {groupBy})` | por servicio: `{key, label, n, nManual, planMin, medianMin, deviationPct, ingresoHoraReal}` |
| `mOccupancy(periodBookings, staff, blocks, {from, to})` | `{atendidos, disponibles, pct, estimados}` |
| `mHeatmap(periodBookings, staff, blocks, {from, to})` | `[{dow, hour, ocupados, disponibles, pct}]` |
| `mPriceSim(row)` | `{objetivoHora, equivalente, rango:[lo,hi]}` o `null` sin datos suficientes. |

### `public/js/insights.js` — módulo nuevo

Mismo patrón que `metrics.js`. `evaluateInsights(ctx)` → como máximo una tarjeta de cada tipo
(`prioridad`, `oportunidad`, `positivo`), ordenadas por el criterio de §8: pérdida de dinero →
desviación de tiempo → ocupación → precio → señales positivas.

Cada tarjeta: `{tipo, titulo, dato, confianza, opciones:[...], detalle}`. Reglas en P2 (§7 del
PDF, numeradas como allí): **1** sobretiempo, **4** no-show alto, **6** hora débil, **9** bajo
ingreso/hora, **14** buen nivel de asistencia.

### `public/admin/index.html`

Variable de módulo nueva `dashView` (`'simple' | 'detalle'`), **`'simple'` por defecto**, junto a
las que ya existen. `renderDash()` se divide en `renderDashSimple()` y `renderDashDetalle()`,
que comparten el bloque de carga de datos y la barra de período.

**Vista simple:** barra de período · 5 KPI · tendencia de ingresos (12 semanas, la que ya
existe) · tarjeta de prioridad · tarjeta de oportunidad · pie de nota de cobertura.

**Vista en detalle:** todo lo de hoy (tendencias 12m/12s, por servicio, por barbero, retención,
CSV) **más**: tiempo planificado vs. real por servicio (barras agrupadas), desglose extendido
(atenciones · ingreso · precio promedio · tiempo plan · mediana real · ingreso/hora),
asistencia y confirmación, y el mapa de ocupación por día y franja.

CSS: reusar `.a-sc`, `.a-bar-row`, `.a-bstat*`, `.a-vtoggle`, `.a-dash-*`. Clases nuevas
acotadas para las barras agrupadas, el heatmap y las tarjetas de insight. Sin rediseño.

## Qué NO se toca

`functions/`, `firestore.rules`, `firestore.indexes.json`, `public/js/data.js`,
`public/barbero/`, el widget público, el resto de los paneles del admin, el módulo de reseñas.
Nada se despliega a producción.

## Pruebas

**Unitarias** (`npm test`, `node:test`, fixtures con fechas fijas): `median` con muestra par e
impar y con lista vacía; `mAttendance` con período sin ninguna marca (todo a `sinMarcar`, sin
`NaN`); `mRealTime` con `actualDur` 0 y con `dur` 0 (sin división por cero); `mOccupancy` con un
barbero sin `schedule`, con día cerrado, y con un bloqueo que cubre el día entero (disponibles 0
→ `pct` null, no `Infinity`); `mHeatmap` sin reservas; `mPriceSim` bajo la muestra mínima →
`null`; `evaluateInsights` con 0, 9, 10, 20 y 30 atenciones medidas, verificando que **no
recomienda precio bajo 20** y que no devuelve nada bajo 10.

**Navegador** (`tests/browser/dashboard.mjs`, extendido): el toggle simple/detalle; que la vista
simple tenga exactamente 5 KPI; que el pie de nota refleje la cobertura; que con datos de P1
(citas `completed` con `actualDur`) aparezcan la mediana y la desviación; que con cobertura 0 el
panel no muestre ninguna recomendación.

## Riesgos

- **Datos reales en cero.** Hasta que la barbería use la PWA unas semanas, los KPI nuevos están
  vacíos. Es esperado, y `mAttendanceCoverage` existe para que se vea en el panel en vez de
  parecer un error.
- **`BK` completo en memoria.** Ya era deuda del dashboard anterior; el heatmap y la ocupación
  la agravan un poco (más recorridos por render). Sigue siendo irrelevante con cientos de
  reservas; se anota, no se resuelve acá.
- **Ocupación sensible a horarios mal configurados.** Un barbero activo sin `schedule` daría
  disponibilidad 0 y una ocupación absurda. Se trata como "sin horario configurado" y se
  excluye del cálculo, avisando en el panel.
