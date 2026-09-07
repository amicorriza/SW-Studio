# Dashboard KPI (simple + detalle) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development o superpowers:executing-plans. Steps usan checkbox (`- [ ]`).

**Goal:** Dos niveles de lectura en el Dashboard —una vista simple de 5 KPI para el uso diario y una vista en detalle para entender el porqué— alimentados por la asistencia real que P1 empezó a capturar.

**Architecture:** Todo en el navegador, sobre `BK` / `D.staff` / `SB`, que el admin ya tiene cargados. Agregaciones puras nuevas en `public/js/metrics.js` y un módulo nuevo `public/js/insights.js` con la escalera de confianza. `renderDash()` se divide en `renderDashSimple()` y `renderDashDetalle()`. Cero backend, cero consultas nuevas, cero dependencias.

**Tech Stack:** `<script>` clásico sin bundler con export dual (`module.exports` / `window.SWMetrics`), `node:test`, Playwright para el test de navegador.

**Spec:** `docs/superpowers/specs/2026-09-06-dashboard-kpi-simple-detalle-design.md`

## Global Constraints

- **Sin frameworks, sin bundler, sin dependencias nuevas.** Sustituir funciones, no reestructurar los HTML.
- **Cero I/O nuevo:** ninguna Cloud Function, ninguna consulta a Firestore, ningún cambio en reglas o índices.
- **Toda función de agregación es pura**, recibe `today`/`tz` explícitos (nunca `new Date()` suelto) y **aísla por reserva** las que no parsean.
- **Mediana, nunca promedio**, para todo tiempo real (PDF §2).
- **Nada divide por cero:** sin muestra → `null`, nunca `NaN` ni `Infinity`.
- **El panel nunca aplica un cambio de precio o duración** (PDF §9). Solo sugiere rangos.
- Comentarios y textos en español, tuteo. Sin rediseño visual. Nada se despliega a producción.

---

### Task 1: Asistencia, cobertura e ingreso real

**Files:** Modify `public/js/metrics.js`, `tests/unit/metrics.test.js`

**Produces:** `median(nums)`, `mFilterPeriodAll(bookings, opts)`, `mAttendance(allPeriod)`, `mAttendanceCoverage(periodBookings)`, `mRevenue(periodBookings)`.

- [ ] **Step 1: tests que fallan** — `median` par/impar/vacía; `mFilterPeriodAll` conserva `cancelled` y `declined` que `mFilterPeriod` descarta; `mAttendance` con período sin marcas (todo a `sinMarcar`, porcentajes `null`, sin `NaN`); `mAttendanceCoverage` 0/parcial/total; `mRevenue` excluye `no_show` pero `mFilterPeriod` lo conserva.
- [ ] **Step 2:** `npm test` → FAIL (`median is not a function`).
- [ ] **Step 3: implementar.** Extraer un `inPeriod(b, opts)` interno con el filtro de fecha que hoy vive dentro de `mFilterPeriod`, y usarlo en las dos. `mAttendance` cuenta por estado: `completed`→atendidas, `no_show`→noShow, `cancelled`→canceladas, `declined`→declinadas, resto→sinMarcar. Porcentajes sobre `atendidas + noShow` (las que tienen marca real), `null` si esa base es 0.
- [ ] **Step 4:** `npm test` → PASS, sin regresiones en los 53 existentes.
- [ ] **Step 5:** commit `feat(metrics): asistencia real, cobertura e ingreso sin no-show`.

---

### Task 2: Tiempo real por servicio y simulación de precio

**Files:** Modify `public/js/metrics.js`, `tests/unit/metrics.test.js`

**Produces:** `mRealTime(periodBookings, {groupBy})` → `[{key, label, n, nManual, planMin, medianMin, deviationPct, ingresoHoraReal, ingresoHoraPlan}]` ordenado por `n` desc; `mPriceSim(row)` → `{objetivoHora, equivalente, rango:[lo,hi]}` o `null`.

- [ ] **Step 1: tests que fallan** — mediana sobre `actualDur` (no promedio: fixture con un valor atípico grande que movería el promedio y no la mediana); `deviationPct` = `(medianMin − planMin) / planMin`; `planMin` 0 → `deviationPct` null; `ingresoHoraReal` null si `medianMin` es 0; `nManual` cuenta los `durSource:'manual'` pero **no los excluye** de la mediana; servicio sin ninguna atención cerrada → no aparece; `mPriceSim` con `n < 20` → `null`; el rango se redondea a la centena más cercana y `lo < equivalente < hi`.
- [ ] **Step 2:** `npm test` → FAIL.
- [ ] **Step 3: implementar.** Solo entran reservas `status === 'completed'` con `actualDur` finito y > 0. `objetivoHora = price / (dur/60)`; `equivalente = objetivoHora × medianMin / 60`; `rango = [redondear(equivalente × 0.95), redondear(equivalente × 1.06)]` a la centena, que es la forma del ejemplo del PDF ($21.200 → "$20.000-$22.000").
- [ ] **Step 4:** `npm test` → PASS.
- [ ] **Step 5:** commit `feat(metrics): mediana de tiempo real, desviación y precio equivalente`.

---

### Task 3: Ocupación y mapa de horas

**Files:** Modify `public/js/metrics.js`, `tests/unit/metrics.test.js`

**Produces:** `mOccupancy(periodBookings, staff, blocks, {from, to})` → `{atendidos, disponibles, pct, estimados, sinHorario:[ids]}`; `mHeatmap(periodBookings, staff, blocks, {from, to})` → `[{dow, hour, ocupados, disponibles, pct}]`.

Minutos disponibles: por cada día del rango y cada barbero `status==='active'`, `schedule[dow]` con `open:true` aporta `(end − start)` menos la colación (`break`) y menos los `scheduleBlocks` de ese día y barbero. Minutos ocupados: `actualDur` si existe y es > 0, si no `dur`; los que usan `dur` suman a `estimados`.

- [ ] **Step 1: tests que fallan** — rango de un día con un barbero de 10:00-20:00 y colación 13:00-14:00 → 540 disponibles; una cita de 45 min → `pct` 45/540; barbero sin `schedule` → entra en `sinHorario` y no aporta disponibilidad; día con `open:false` → 0; bloqueo que cubre todo el día → disponibles 0 y `pct` **null**, nunca `Infinity`; barbero `inactive` ignorado; heatmap sin reservas devuelve la grilla con `ocupados:0` y no revienta.
- [ ] **Step 2:** `npm test` → FAIL.
- [ ] **Step 3: implementar.** Recorrer días con `addDaysYMD`; `dow` con `new Date(key+'T12:00:00Z').getUTCDay()` (mediodía UTC, igual que el resto del módulo, para que el DST no corra el día). Reusar el criterio de minutos-desde-medianoche.
- [ ] **Step 4:** `npm test` → PASS.
- [ ] **Step 5:** commit `feat(metrics): ocupación efectiva y mapa de horas débiles`.

---

### Task 4: Motor de recomendaciones (subconjunto + escalera de confianza)

**Files:** Create `public/js/insights.js`, `tests/unit/insights.test.js`

**Produces:** `CONFIDENCE_LEVELS`, `confidenceOf(n)` → `'recolectando'|'preliminar'|'suficiente'|'alta'`, `evaluateInsights(ctx)` → `[{tipo, titulo, dato, confianza, opciones, detalle}]`, máximo una por tipo.

`ctx = { attendance, coverage, realTime, occupancy, heatmap, kpis, medidas }`.

- [ ] **Step 1: tests que fallan** — `confidenceOf` en los bordes exactos 0/9/10/19/20/29/30; con `medidas < 10` **no devuelve ninguna tarjeta**; con `medidas` entre 10 y 19 alerta sobretiempo pero **no** sugiere precio; con `medidas >= 20` sí; orden de prioridad de §8 (no-show gana sobre desviación de tiempo, que gana sobre ocupación); nunca más de una tarjeta por tipo; contexto vacío no lanza.
- [ ] **Step 2:** `npm test` → FAIL (módulo inexistente).
- [ ] **Step 3: implementar** las 5 reglas del spec (§7 del PDF: 1, 4, 6, 9, 14) con sus umbrales literales. Mismo IIFE y export dual que `metrics.js`.
- [ ] **Step 4:** `npm test` → PASS.
- [ ] **Step 5:** commit `feat(insights): motor de recomendaciones con escalera de confianza`.

---

### Task 5: Las dos vistas en el panel

**Files:** Modify `public/admin/index.html`, `tests/browser/dashboard.mjs`

- [ ] **Step 1: implementar.** `<script src="/js/insights.js">` junto al de metrics. Variable `dashView` (`'simple'` por defecto, no persistida) y toggle `.a-vtoggle` en la barra de período. `renderDash()` carga los datos una vez y delega en `renderDashSimple()` / `renderDashDetalle()`.
  - **Simple:** 5 KPI (Ventas · Reservas · Asistencia real · No-show · Ticket) · tendencia 12 semanas · tarjeta de prioridad · tarjeta de oportunidad · pie de cobertura.
  - **Detalle:** lo actual + tiempo plan vs real (barras agrupadas) + desglose extendido + asistencia y confirmación + mapa de ocupación.
  - Pie de nota dinámico según `mAttendanceCoverage`: con 0% dice que los ingresos asumen que toda cita pasada ocurrió; con cobertura parcial dice qué porcentaje está medido.
- [ ] **Step 2: extender `tests/browser/dashboard.mjs`** — el fixture suma citas `completed` con `actualDur`, `no_show` y `cancelled`. Casos: la vista simple arranca por defecto y tiene exactamente 5 KPI; el toggle cambia a detalle y aparecen las secciones nuevas; con cobertura 0 no se pinta ninguna recomendación; con datos suficientes aparece al menos una; el pie refleja la cobertura; sin errores JS.
- [ ] **Step 3:** `node tests/browser/dashboard.mjs` → todo verde, y revisar la captura a ojo.
- [ ] **Step 4:** `npm test && cd functions && node --test && node tests/browser/barbero.mjs && node tests/browser/admin-asistencia.mjs` → sin regresiones.
- [ ] **Step 5:** commit `feat(admin): Dashboard con vista simple y vista en detalle`.

---

### Task 6: Documentación

- [ ] Actualizar `CLAUDE.md` (`public/js/insights.js` en el mapa de archivos, las dos vistas) y `README.md` (qué responde cada vista, y que las recomendaciones aparecen recién con 10+ atenciones medidas). Commit.
