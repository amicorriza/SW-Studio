# Scissor White — Motor de recomendaciones semanales (completo)

- **Fecha:** 2026-09-07
- **Origen:** `Reporte_KPI_Scissor_White.pdf`, **Fase 4**. Es el tercero y último de la serie;
  P1 (medición) y P2 (dashboard) están implementados y probados contra el emulador.
- **Rama:** continúa `feature/medicion-atencion-real`.
- **Etapa:** B/C. Siguen vigentes: no migrar a framework, no reescribir los HTML monolíticos,
  no tocar reseñas de Google, no cambiar el diseño visual, no desplegar a producción.

## Qué falta

`public/js/insights.js` ya tiene la escalera de confianza completa (§6) y 5 de las 14 reglas
del §7: **1** sobretiempo, **4** no-show alto, **6** hora débil, **9** bajo ingreso/hora,
**14** buena asistencia. Este proyecto agrega las 8 que faltan y la comparación contra el
período anterior, que hoy no existe en el contexto del motor.

### La regla 3 no se implementa como tarjeta aparte

§7 lista "precio equivalente" como recomendación separada, pero el ejemplo concreto del §8
la muestra **dentro** de la tarjeta de sobretiempo: *"Opciones: mantener $18.000 y trabajar el
tiempo / mantener 53 min y simular $20.000-$22.000"*. Se respeta esa presentación, que ya está
implementada. Una tarjeta aparte solo para el precio competiría por el mismo cupo de
"oportunidad" contra la hora débil, y separaría el número de su causa.

## Las 8 reglas nuevas

Umbrales literales del §7. `n` es la cantidad de atenciones medidas del servicio; `medidas`,
las del período completo.

| # | Regla | Dispara cuando | Tipo |
|---|---|---|---|
| 2 | Capacidad escondida | mediana real **<10% bajo** el plan, `n ≥ 20` | oportunidad |
| 5 | Confirmó y no llegó | **≥3** no-show que **habían confirmado** | prioridad |
| 7 | Agenda casi llena | ocupación **>85%** en las **3** últimas semanas | oportunidad |
| 8 | Servicio líder | un servicio concentra **>35%** del ingreso | positivo |
| 10 | Mejora operacional | mediana real **mejora >5%** vs. período anterior sin bajar el ticket | positivo |
| 11 | Inicio tardío | inicio real **>8 min** tarde en **>20%** de las atenciones | prioridad |
| 12 | Alta variabilidad | dispersión de duraciones **alta** (ver abajo), `n ≥ 20` | oportunidad |
| 13 | Ventas bajan con ocupación similar | ventas **−15%** o peor, con ocupación **±5 pp** | prioridad |

Y la **segunda rama de la regla 4**: el no-show también dispara si **sube más de 3 puntos**
respecto del período anterior, aunque esté bajo el 8%.

### Definiciones que el PDF deja abiertas

- **"Confirmados que no asistieron"** (5): una reserva con `status: 'no_show'` **y**
  `respondedAt` presente. `respondedAt` lo escribe el flujo de recordatorio al confirmar o
  declinar; si hubiera declinado, su estado sería `declined`, no `no_show`. Así que
  `no_show` + `respondedAt` significa exactamente "confirmó y no vino".
- **"Dispersión muy alta"** (12): rango intercuartílico ÷ mediana **> 0,40**. Se usa el IQR y
  no la desviación estándar por la misma razón por la que todo el tiempo real es mediana:
  resiste los extremos, que en una barbería son casos puntuales y no la señal.
- **"Inicio real tarde"** (11): `startedAt` comparado con la hora agendada, ambos en la zona
  del negocio. Solo cuentan las atenciones que **sí empezaron**; una que nunca se inició no es
  un inicio tardío, es otra cosa.
- **"Ocupación similar"** (13): diferencia de ±5 puntos porcentuales entre el período y el
  anterior. Sin ese guardarraíl la regla dispararía cuando las ventas bajan **porque** hubo
  menos trabajo, que no es el hallazgo que la regla busca.

## Arquitectura

Sin backend nuevo, sin consultas nuevas, sin dependencias. Todo sigue calculándose en el
navegador sobre `BK`, `D.staff` y `SB`.

### `public/js/metrics.js` — tres agregaciones nuevas

| Función | Devuelve |
|---|---|
| `mLateStarts(periodBookings, {tz})` | `{medidas, tarde, pct, medianaAtrasoMin}` — atenciones iniciadas con más de 8 min de atraso |
| `mWeeklyOccupancy(bookings, staff, blocks, {weeks, today})` | `[{weekStart, pct}]` para las últimas N semanas completas |
| `mAttendance` (ampliada) | suma `noShowConfirmados` |
| `mRealTime` (ampliada) | suma `p25Min`, `p75Min`, `spread` (IQR ÷ mediana) |

`mLateStarts` compara la hora de pared: `startedAt` formateado en la zona del negocio contra
`b.time`. Si `startedAt` cae en otro día calendario que la cita (una atención que cruzó la
medianoche, o un dato corrupto), la reserva se ignora en vez de reportar un atraso de horas.

### `public/js/insights.js`

Mismo módulo, mismo patrón. El contexto se amplía con `prev` (las mismas agregaciones del
período anterior), `lateStarts`, `weeklyOccupancy` y `byService`.

**El orden del arreglo `REGLAS` sigue siendo la jerarquía del §8** — pérdida de dinero,
desviación de tiempo, ocupación, precio, señales positivas — y sigue emitiéndose **una sola
tarjeta por tipo**. Agregar 8 reglas no cambia que se muestren como máximo 3.

Toda regla que compare contra el período anterior devuelve `null` si no hay período anterior
con datos: una comparación contra cero no es una señal, es un artefacto.

### `public/admin/index.html`

`renderDash()` calcula las agregaciones del período anterior —que ya calcula parcialmente para
los Δ— y las pasa al motor. La ventana de 3 semanas para la regla 7 usa `weekStartsBack`, que
ya existe.

Sin cambios visuales: las tarjetas nuevas usan el mismo `dashInsightCard`.

## Pruebas

**Unitarias** (`tests/unit/insights.test.js` y `metrics.test.js`): cada regla nueva con un caso
que dispara y uno que no, en el borde exacto del umbral; que ninguna regla que compara contra
el período anterior dispare sin período anterior; que sigan saliendo como máximo 3 tarjetas con
las 13 reglas activas a la vez; y que la jerarquía del §8 se respete cuando compiten varias del
mismo tipo.

Para las agregaciones: `mLateStarts` con una atención iniciada en otro día calendario (se
ignora) y con `startedAt` ausente; `mWeeklyOccupancy` sin horarios; el IQR con muestras chicas.

**End-to-end**: `tests/e2e/navegador.mjs` verifica que con los datos sembrados sigan
apareciendo recomendaciones coherentes y nunca más de 3.

## Riesgos

- **Demasiadas reglas compitiendo.** Con 13 activas, la que se muestra depende del orden. Por
  eso el orden es explícito y está testeado: si mañana alguien agrega una regla al medio del
  arreglo, cambia qué ve el usuario sin que nadie lo note. El test de jerarquía es el que
  protege eso.
- **Reglas que se pisan.** Sobretiempo (1) y alta variabilidad (12) pueden dispararse juntas
  sobre el mismo servicio; como son tipos distintos, se verían las dos y podría leerse como
  dos problemas cuando es uno. Se acepta: los datos que muestran son distintos y el usuario
  decide.
- **Nada de esto sirve sin uso real.** Con la barbería recién empezando a marcar, casi todas
  las reglas quedarán bajo la muestra mínima. Es lo correcto, pero conviene no esperar
  fuegos artificiales las primeras semanas.
