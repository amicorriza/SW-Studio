const test = require('node:test');
const assert = require('node:assert');
const I = require('../../public/js/insights.js');
// La simulación de precio se INYECTA en el contexto: insights.js no importa
// metrics.js (son dos <script> sueltos sin bundler), así que quien llama es
// el que decide con qué calcularla. Acá se inyecta la real, así el test
// también cubre la integración entre los dos módulos.
const M = require('../../public/js/metrics.js');

// Contexto mínimo "sano": nada dispara ninguna regla.
function ctx(over) {
  return Object.assign({
    medidas: 30,
    attendance: { total: 40, atendidas: 38, noShow: 2, canceladas: 0, asistenciaPct: 0.95, noShowPct: 0.05 },
    coverage: { medidas: 40, total: 40, pct: 1 },
    realTime: [{ key: 'corte', label: 'Corte adulto', n: 30, nManual: 0, planMin: 45, medianMin: 45, price: 18000, deviationPct: 0, ingresoHoraReal: 24000, ingresoHoraPlan: 24000 }],
    occupancy: { atendidos: 500, disponibles: 800, pct: 0.62, estimados: 0, sinHorario: [] },
    heatmap: [{ dow: 1, hour: 10, ocupados: 40, disponibles: 60, pct: 0.66 }],
    priceSim: M.mPriceSim,
  }, over);
}
const tipos = (cards) => cards.map(c => c.tipo);
const find = (cards, regla) => cards.find(c => c.regla === regla);

// ── escalera de confianza (PDF §6) ──

test('confidenceOf en los bordes exactos de cada tramo', () => {
  assert.strictEqual(I.confidenceOf(0), 'recolectando');
  assert.strictEqual(I.confidenceOf(9), 'recolectando');
  assert.strictEqual(I.confidenceOf(10), 'preliminar');
  assert.strictEqual(I.confidenceOf(19), 'preliminar');
  assert.strictEqual(I.confidenceOf(20), 'suficiente');
  assert.strictEqual(I.confidenceOf(29), 'suficiente');
  assert.strictEqual(I.confidenceOf(30), 'alta');
  assert.strictEqual(I.confidenceOf(500), 'alta');
});

// Lo más importante del módulo: bajo 10 atenciones medidas el panel MUESTRA
// datos pero no opina. Sin esto recomendaría sobre ruido, que es el peor
// resultado posible para alguien que va a decidir precios con esto.
test('bajo 10 atenciones medidas no devuelve NINGUNA tarjeta', () => {
  for (const n of [0, 1, 5, 9]) {
    const cards = I.evaluateInsights(ctx({
      medidas: n,
      attendance: { total: n, atendidas: 0, noShow: n, asistenciaPct: 0, noShowPct: 1, canceladas: 0 },
      realTime: [{ key: 'c', label: 'C', n: n, nManual: 0, planMin: 45, medianMin: 90, price: 18000, deviationPct: 1, ingresoHoraReal: 12000, ingresoHoraPlan: 24000 }],
      occupancy: { atendidos: 1, disponibles: 800, pct: 0.001, estimados: 0, sinHorario: [] },
    }));
    assert.deepStrictEqual(cards, [], `con ${n} medidas no debería opinar`);
  }
});

// ── reglas ──

test('regla 1: sobretiempo con mediana >10% del plan', () => {
  const cards = I.evaluateInsights(ctx({
    realTime: [{ key: 'corte', label: 'Corte adulto', n: 32, nManual: 0, planMin: 45, medianMin: 53, price: 18000, deviationPct: 8 / 45, ingresoHoraReal: 20377, ingresoHoraPlan: 24000 }],
  }));
  const c = find(cards, 'sobretiempo');
  assert.ok(c, JSON.stringify(tipos(cards)));
  assert.strictEqual(c.tipo, 'prioridad');
  assert.match(c.titulo, /Corte adulto/);
  assert.match(c.dato, /53/);
  assert.ok(c.opciones.length >= 1 && c.opciones.length <= 2, 'máximo dos opciones (PDF §8)');
});

test('regla 1 no dispara con desviación bajo el umbral', () => {
  const cards = I.evaluateInsights(ctx({
    realTime: [{ key: 'c', label: 'C', n: 32, nManual: 0, planMin: 45, medianMin: 47, price: 18000, deviationPct: 2 / 45, ingresoHoraReal: 23000, ingresoHoraPlan: 24000 }],
  }));
  assert.strictEqual(find(cards, 'sobretiempo'), undefined);
});

// PDF §6: 10-19 alerta desviaciones "sin precio recomendado".
test('con 10-19 medidas alerta el sobretiempo pero NO sugiere precio', () => {
  const cards = I.evaluateInsights(ctx({
    medidas: 15,
    realTime: [{ key: 'c', label: 'Corte', n: 15, nManual: 0, planMin: 45, medianMin: 60, price: 18000, deviationPct: 1 / 3, ingresoHoraReal: 18000, ingresoHoraPlan: 24000 }],
  }));
  const c = find(cards, 'sobretiempo');
  assert.ok(c, 'debe alertar');
  assert.strictEqual(c.confianza, 'preliminar');
  assert.strictEqual(c.precio, null, 'no debe traer simulación de precio');
  assert.ok(!/\$/.test(c.opciones.join(' ')), 'ninguna opción menciona un precio: ' + c.opciones.join(' | '));
});

test('con 20+ medidas el sobretiempo sí trae el rango de precio', () => {
  const cards = I.evaluateInsights(ctx({
    medidas: 32,
    realTime: [{ key: 'c', label: 'Corte', n: 32, nManual: 0, planMin: 45, medianMin: 53, price: 18000, deviationPct: 8 / 45, ingresoHoraReal: 20377, ingresoHoraPlan: 24000 }],
  }));
  const c = find(cards, 'sobretiempo');
  assert.ok(c.precio, 'debe traer simulación');
  assert.ok(c.precio.rango[0] > 0 && c.precio.rango[1] > c.precio.rango[0]);
});

test('regla 4: no-show sobre 8%', () => {
  const cards = I.evaluateInsights(ctx({
    attendance: { total: 40, atendidas: 34, noShow: 6, canceladas: 0, asistenciaPct: 34 / 40, noShowPct: 6 / 40 },
  }));
  const c = find(cards, 'no_show_alto');
  assert.ok(c);
  assert.strictEqual(c.tipo, 'prioridad');
  assert.match(c.dato, /15/, 'el 15% debe aparecer en el dato');
});

test('regla 6: franja con ocupación bajo 45%', () => {
  const cards = I.evaluateInsights(ctx({
    heatmap: [
      { dow: 2, hour: 10, ocupados: 30, disponibles: 120, pct: 0.25 },
      { dow: 1, hour: 15, ocupados: 100, disponibles: 120, pct: 0.83 },
    ],
  }));
  const c = find(cards, 'hora_debil');
  assert.ok(c);
  assert.strictEqual(c.tipo, 'oportunidad');
  assert.match(c.dato, /[Mm]artes/, 'nombra el día: ' + c.dato);
  assert.match(c.dato, /10:00/);
});

test('regla 6 ignora franjas con muy poca disponibilidad medida', () => {
  const cards = I.evaluateInsights(ctx({
    heatmap: [{ dow: 2, hour: 10, ocupados: 0, disponibles: 30, pct: 0 }],
  }));
  assert.strictEqual(find(cards, 'hora_debil'), undefined, 'media hora suelta no es una franja débil');
});

test('regla 9: servicio con ingreso/hora bajo el objetivo', () => {
  const cards = I.evaluateInsights(ctx({
    attendance: { total: 40, atendidas: 40, noShow: 0, canceladas: 0, asistenciaPct: 1, noShowPct: 0 },
    realTime: [{ key: 'barba', label: 'Barba', n: 25, nManual: 0, planMin: 30, medianMin: 45, price: 9000, deviationPct: 0.5, ingresoHoraReal: 12000, ingresoHoraPlan: 18000 }],
  }));
  assert.ok(find(cards, 'sobretiempo') || find(cards, 'bajo_ingreso_hora'), 'alguna de las dos debe salir');
});

test('regla 14: asistencia sana produce la tarjeta positiva', () => {
  const cards = I.evaluateInsights(ctx());
  const c = find(cards, 'asistencia_sana');
  assert.ok(c, JSON.stringify(cards));
  assert.strictEqual(c.tipo, 'positivo');
  assert.deepStrictEqual(c.opciones, [], 'un reconocimiento no pide acciones');
});

// ── forma de la salida ──

test('nunca devuelve más de una tarjeta por tipo', () => {
  const cards = I.evaluateInsights(ctx({
    attendance: { total: 40, atendidas: 30, noShow: 10, canceladas: 0, asistenciaPct: 0.75, noShowPct: 0.25 },
    realTime: [
      { key: 'a', label: 'A', n: 30, nManual: 0, planMin: 45, medianMin: 80, price: 18000, deviationPct: 0.77, ingresoHoraReal: 13500, ingresoHoraPlan: 24000 },
      { key: 'b', label: 'B', n: 30, nManual: 0, planMin: 30, medianMin: 60, price: 9000, deviationPct: 1, ingresoHoraReal: 9000, ingresoHoraPlan: 18000 },
    ],
    heatmap: [
      { dow: 2, hour: 10, ocupados: 0, disponibles: 120, pct: 0 },
      { dow: 3, hour: 11, ocupados: 10, disponibles: 120, pct: 0.08 },
    ],
  }));
  const t = tipos(cards);
  assert.strictEqual(new Set(t).size, t.length, 'tipos repetidos: ' + t.join(','));
  assert.ok(cards.length <= 3, 'máximo 3 tarjetas (PDF §6)');
});

// PDF §8: pérdida directa de dinero primero, después desviaciones de tiempo.
test('el no-show gana la prioridad sobre el sobretiempo', () => {
  const cards = I.evaluateInsights(ctx({
    attendance: { total: 40, atendidas: 30, noShow: 10, canceladas: 0, asistenciaPct: 0.75, noShowPct: 0.25 },
    realTime: [{ key: 'a', label: 'A', n: 30, nManual: 0, planMin: 45, medianMin: 80, price: 18000, deviationPct: 0.77, ingresoHoraReal: 13500, ingresoHoraPlan: 24000 }],
  }));
  const prio = cards.find(c => c.tipo === 'prioridad');
  assert.strictEqual(prio.regla, 'no_show_alto', 'ganó ' + prio.regla);
});

test('las tarjetas salen ordenadas prioridad -> oportunidad -> positivo', () => {
  const cards = I.evaluateInsights(ctx({
    attendance: { total: 40, atendidas: 30, noShow: 10, canceladas: 0, asistenciaPct: 0.75, noShowPct: 0.25 },
    heatmap: [{ dow: 2, hour: 10, ocupados: 0, disponibles: 120, pct: 0 }],
  }));
  const orden = { prioridad: 0, oportunidad: 1, positivo: 2 };
  const idx = cards.map(c => orden[c.tipo]);
  assert.deepStrictEqual(idx, idx.slice().sort((a, b) => a - b), JSON.stringify(tipos(cards)));
});

test('toda tarjeta trae el dato que la sustenta y su nivel de confianza', () => {
  I.evaluateInsights(ctx({
    attendance: { total: 40, atendidas: 30, noShow: 10, canceladas: 0, asistenciaPct: 0.75, noShowPct: 0.25 },
  })).forEach((c) => {
    assert.ok(c.titulo && c.titulo.length, 'sin título');
    assert.ok(c.dato && c.dato.length, 'sin dato: ' + c.regla);
    assert.ok(I.CONFIDENCE_LEVELS.indexOf(c.confianza) !== -1, 'confianza inválida: ' + c.confianza);
    assert.ok(Array.isArray(c.opciones) && c.opciones.length <= 2, 'más de dos opciones: ' + c.regla);
  });
});

test('contexto vacío o incompleto no lanza', () => {
  assert.doesNotThrow(() => I.evaluateInsights(null));
  assert.doesNotThrow(() => I.evaluateInsights({}));
  assert.doesNotThrow(() => I.evaluateInsights({ medidas: 50 }));
  assert.deepStrictEqual(I.evaluateInsights(null), []);
});

// ═══════════════ P3: las 8 reglas restantes del §7 ═══════════════
// Contexto "sano" ampliado: nada dispara nada, ni siquiera comparando.
function ctx2(over) {
  const svc = { key: 'corte', label: 'Corte adulto', n: 30, nManual: 0, planMin: 45,
                medianMin: 45, price: 18000, p25Min: 43, p75Min: 47, spread: 0.09,
                deviationPct: 0, ingresoHoraReal: 24000, ingresoHoraPlan: 24000 };
  return ctx(Object.assign({
    realTime: [svc],
    byService: [{ key: 'corte', label: 'Corte adulto', citas: 30, ingreso: 100000, pct: 0.30 }],
    lateStarts: { medidas: 30, tarde: 1, pct: 0.03, medianaAtrasoMin: 10 },
    weeklyOccupancy: [{ weekStart: '2026-08-17', pct: 0.6 }, { weekStart: '2026-08-24', pct: 0.62 },
                      { weekStart: '2026-08-31', pct: 0.61 }],
    prev: {
      medidas: 30,
      attendance: { total: 40, atendidas: 38, noShow: 2, canceladas: 0, asistenciaPct: 0.95, noShowPct: 0.05 },
      realTime: [Object.assign({}, svc)],
      occupancy: { pct: 0.62 },
      kpis: { ingresos: 500000, ticket: 16000 },
    },
    kpis: { ingresos: 500000, ticket: 16000, citas: 40 },
  }, over));
}

// ── 2. capacidad escondida ──
test('regla 2: el servicio termina consistentemente antes del plan', () => {
  const c = find(I.evaluateInsights(ctx2({
    realTime: [{ key: 'c', label: 'Corte', n: 30, nManual: 0, planMin: 60, medianMin: 50,
                 price: 18000, p25Min: 48, p75Min: 52, spread: 0.08, deviationPct: -1 / 6,
                 ingresoHoraReal: 21600, ingresoHoraPlan: 18000 }],
  })), 'capacidad_escondida');
  assert.ok(c, 'debe disparar');
  assert.strictEqual(c.tipo, 'oportunidad');
  assert.match(c.dato, /50/);
});

test('regla 2 no dispara con menos de 20 medidas', () => {
  assert.strictEqual(find(I.evaluateInsights(ctx2({
    medidas: 15,
    realTime: [{ key: 'c', label: 'Corte', n: 15, nManual: 0, planMin: 60, medianMin: 50,
                 price: 18000, p25Min: 48, p75Min: 52, spread: 0.08, deviationPct: -1 / 6,
                 ingresoHoraReal: 21600, ingresoHoraPlan: 18000 }],
  })), 'capacidad_escondida'), undefined);
});

// ── 4b. no-show que sube vs el período anterior ──
test('regla 4b: el no-show sube más de 3 puntos aunque siga bajo el 8%', () => {
  const c = find(I.evaluateInsights(ctx2({
    attendance: { total: 40, atendidas: 37, noShow: 3, canceladas: 0, asistenciaPct: 37 / 40, noShowPct: 0.075 },
    prev: Object.assign({}, ctx2().prev, {
      attendance: { total: 40, atendidas: 40, noShow: 0, canceladas: 0, asistenciaPct: 1, noShowPct: 0.01 },
    }),
  })), 'no_show_alto');
  assert.ok(c, 'debe disparar por la subida');
  assert.match(c.dato, /pp|punto/i, c.dato);
});

test('regla 4b no dispara si la subida es menor a 3 puntos', () => {
  assert.strictEqual(find(I.evaluateInsights(ctx2({
    attendance: { total: 40, atendidas: 38, noShow: 2, canceladas: 0, asistenciaPct: 0.95, noShowPct: 0.05 },
    prev: Object.assign({}, ctx2().prev, {
      attendance: { total: 40, atendidas: 39, noShow: 1, canceladas: 0, asistenciaPct: 0.975, noShowPct: 0.03 },
    }),
  })), 'no_show_alto'), undefined);
});

// ── 5. confirmó y no llegó ──
test('regla 5: tres o más confirmados que no llegaron', () => {
  const c = find(I.evaluateInsights(ctx2({
    attendance: { total: 40, atendidas: 37, noShow: 3, noShowConfirmados: 3, canceladas: 0,
                  asistenciaPct: 37 / 40, noShowPct: 0.075 },
  })), 'confirmo_no_llego');
  assert.ok(c);
  assert.strictEqual(c.tipo, 'prioridad');
  assert.match(c.dato, /3/);
});

test('regla 5 no dispara con dos', () => {
  assert.strictEqual(find(I.evaluateInsights(ctx2({
    attendance: { total: 40, atendidas: 38, noShow: 2, noShowConfirmados: 2, canceladas: 0,
                  asistenciaPct: 0.95, noShowPct: 0.05 },
  })), 'confirmo_no_llego'), undefined);
});

// ── 7. agenda casi llena ──
test('regla 7: ocupación sobre 85% tres semanas seguidas', () => {
  const c = find(I.evaluateInsights(ctx2({
    weeklyOccupancy: [{ weekStart: 'a', pct: 0.88 }, { weekStart: 'b', pct: 0.9 }, { weekStart: 'c', pct: 0.87 }],
  })), 'agenda_llena');
  assert.ok(c);
  assert.strictEqual(c.tipo, 'oportunidad');
});

test('regla 7 no dispara si una de las tres semanas bajó', () => {
  assert.strictEqual(find(I.evaluateInsights(ctx2({
    weeklyOccupancy: [{ weekStart: 'a', pct: 0.88 }, { weekStart: 'b', pct: 0.7 }, { weekStart: 'c', pct: 0.87 }],
  })), 'agenda_llena'), undefined);
});

test('regla 7 no dispara con menos de 3 semanas medidas', () => {
  assert.strictEqual(find(I.evaluateInsights(ctx2({
    weeklyOccupancy: [{ weekStart: 'a', pct: 0.9 }, { weekStart: 'b', pct: 0.9 }],
  })), 'agenda_llena'), undefined);
});

// ── 8. servicio líder ──
test('regla 8: un servicio concentra más del 35% del ingreso', () => {
  const c = find(I.evaluateInsights(ctx2({
    byService: [{ key: 'corte', label: 'Corte adulto', citas: 30, ingreso: 460000, pct: 0.46 }],
  })), 'servicio_lider');
  assert.ok(c);
  assert.strictEqual(c.tipo, 'positivo');
  assert.match(c.dato, /46/);
});

test('regla 8 no dispara bajo el 35%', () => {
  assert.strictEqual(find(I.evaluateInsights(ctx2({
    byService: [{ key: 'c', label: 'C', citas: 10, ingreso: 100, pct: 0.34 }],
  })), 'servicio_lider'), undefined);
});

// ── 10. mejora operacional ──
test('regla 10: el tiempo real mejoró más de 5% sin bajar el ticket', () => {
  const c = find(I.evaluateInsights(ctx2({
    realTime: [Object.assign({}, ctx2().realTime[0], { medianMin: 50 })],
    prev: Object.assign({}, ctx2().prev, {
      realTime: [Object.assign({}, ctx2().realTime[0], { medianMin: 60 })],
      kpis: { ingresos: 500000, ticket: 16000 },
    }),
    kpis: { ingresos: 500000, ticket: 16000, citas: 40 },
  })), 'mejora_operacional');
  assert.ok(c, 'debe reconocer la mejora');
  assert.strictEqual(c.tipo, 'positivo');
});

test('regla 10 NO celebra si el ticket bajó junto con el tiempo', () => {
  assert.strictEqual(find(I.evaluateInsights(ctx2({
    realTime: [Object.assign({}, ctx2().realTime[0], { medianMin: 50 })],
    prev: Object.assign({}, ctx2().prev, {
      realTime: [Object.assign({}, ctx2().realTime[0], { medianMin: 60 })],
      kpis: { ingresos: 500000, ticket: 20000 },
    }),
    kpis: { ingresos: 400000, ticket: 14000, citas: 40 },
  })), 'mejora_operacional'), undefined, 'atender más rápido cobrando menos no es una mejora');
});

// ── 11. inicio tardío ──
test('regla 11: más del 20% de las atenciones empieza tarde', () => {
  const c = find(I.evaluateInsights(ctx2({
    lateStarts: { medidas: 30, tarde: 9, pct: 0.3, medianaAtrasoMin: 12 },
  })), 'inicio_tardio');
  assert.ok(c);
  assert.strictEqual(c.tipo, 'prioridad');
  assert.match(c.dato, /12/);
});

test('regla 11 no dispara con 20% justo', () => {
  assert.strictEqual(find(I.evaluateInsights(ctx2({
    lateStarts: { medidas: 30, tarde: 6, pct: 0.2, medianaAtrasoMin: 12 },
  })), 'inicio_tardio'), undefined);
});

test('regla 11 no dispara sin muestra suficiente de inicios medidos', () => {
  assert.strictEqual(find(I.evaluateInsights(ctx2({
    lateStarts: { medidas: 5, tarde: 4, pct: 0.8, medianaAtrasoMin: 20 },
  })), 'inicio_tardio'), undefined);
});

// ── 12. alta variabilidad ──
test('regla 12: duraciones muy dispersas para el mismo servicio', () => {
  const c = find(I.evaluateInsights(ctx2({
    realTime: [Object.assign({}, ctx2().realTime[0], { spread: 0.55, p25Min: 30, p75Min: 75, medianMin: 50 })],
  })), 'alta_variabilidad');
  assert.ok(c);
  assert.strictEqual(c.tipo, 'oportunidad');
  assert.match(c.dato, /30/);
  assert.match(c.dato, /75/);
});

test('regla 12 no dispara con dispersión normal', () => {
  assert.strictEqual(find(I.evaluateInsights(ctx2()), 'alta_variabilidad'), undefined);
});

// ── 13. ventas bajan con ocupación similar ──
test('regla 13: las ventas caen 15% con la misma ocupación', () => {
  const c = find(I.evaluateInsights(ctx2({
    kpis: { ingresos: 400000, ticket: 13000, citas: 40 },
    prev: Object.assign({}, ctx2().prev, { kpis: { ingresos: 500000, ticket: 16000 }, occupancy: { pct: 0.62 } }),
    occupancy: { atendidos: 500, disponibles: 800, pct: 0.63, estimados: 0, sinHorario: [] },
  })), 'ventas_bajan');
  assert.ok(c, 'debe disparar');
  assert.strictEqual(c.tipo, 'prioridad');
});

// Sin este guardarraíl la regla dispararía cuando las ventas bajan PORQUE
// hubo menos trabajo, que no es el hallazgo que busca.
test('regla 13 NO dispara si la ocupación también cayó', () => {
  assert.strictEqual(find(I.evaluateInsights(ctx2({
    kpis: { ingresos: 400000, ticket: 13000, citas: 40 },
    prev: Object.assign({}, ctx2().prev, { kpis: { ingresos: 500000, ticket: 16000 }, occupancy: { pct: 0.62 } }),
    occupancy: { atendidos: 300, disponibles: 800, pct: 0.38, estimados: 0, sinHorario: [] },
  })), 'ventas_bajan'), undefined);
});

// ── comparaciones sin período anterior ──
test('ninguna regla comparativa dispara sin período anterior', () => {
  const cards = I.evaluateInsights(ctx2({
    prev: null,
    kpis: { ingresos: 100, ticket: 100, citas: 40 },
    realTime: [Object.assign({}, ctx2().realTime[0], { medianMin: 20 })],
  }));
  ['mejora_operacional', 'ventas_bajan'].forEach((r) => {
    assert.strictEqual(find(cards, r), undefined, r + ' no debería disparar sin base de comparación');
  });
});

// ── la forma de la salida no cambia con 13 reglas ──
test('con todas las reglas disparando siguen saliendo máximo 3 tarjetas', () => {
  const cards = I.evaluateInsights(ctx2({
    attendance: { total: 40, atendidas: 25, noShow: 15, noShowConfirmados: 8, canceladas: 3,
                  asistenciaPct: 0.62, noShowPct: 0.38 },
    realTime: [Object.assign({}, ctx2().realTime[0], { medianMin: 90, deviationPct: 1, spread: 0.9, ingresoHoraReal: 9000 })],
    lateStarts: { medidas: 30, tarde: 20, pct: 0.66, medianaAtrasoMin: 18 },
    weeklyOccupancy: [{ weekStart: 'a', pct: 0.9 }, { weekStart: 'b', pct: 0.92 }, { weekStart: 'c', pct: 0.91 }],
    byService: [{ key: 'c', label: 'C', citas: 30, ingreso: 900000, pct: 0.9 }],
    kpis: { ingresos: 100000, ticket: 5000, citas: 40 },
  }));
  assert.ok(cards.length <= 3, 'salieron ' + cards.length);
  const t = cards.map((c) => c.tipo);
  assert.strictEqual(new Set(t).size, t.length, 'tipos repetidos: ' + t.join(','));
});

// PDF §8: la pérdida directa de dinero va primero.
test('entre prioridades gana el no-show sobre el inicio tardío y el sobretiempo', () => {
  const cards = I.evaluateInsights(ctx2({
    attendance: { total: 40, atendidas: 25, noShow: 15, noShowConfirmados: 8, canceladas: 0,
                  asistenciaPct: 0.62, noShowPct: 0.38 },
    lateStarts: { medidas: 30, tarde: 20, pct: 0.66, medianaAtrasoMin: 18 },
    realTime: [Object.assign({}, ctx2().realTime[0], { medianMin: 90, deviationPct: 1 })],
  }));
  assert.strictEqual(cards.find((c) => c.tipo === 'prioridad').regla, 'no_show_alto');
});

// Si alguien inserta una regla al medio del arreglo, cambia qué ve el usuario
// sin que nadie lo note. Este test es el que protege esa jerarquía.
test('el orden declarado de REGLAS es la jerarquía del PDF §8', () => {
  assert.deepStrictEqual(I.REGLA_ORDEN, [
    'no_show_alto', 'confirmo_no_llego', 'ventas_bajan',
    'sobretiempo', 'inicio_tardio',
    'hora_debil', 'agenda_llena', 'capacidad_escondida', 'alta_variabilidad', 'bajo_ingreso_hora',
    // Entre las positivas gana la noticia sobre la línea de base: la
    // asistencia sana dispara casi todas las semanas y, si fuera primera,
    // taparía para siempre a las otras dos.
    'mejora_operacional', 'servicio_lider', 'asistencia_sana',
  ]);
});

test('toda regla nueva respeta el tope de dos opciones y trae confianza', () => {
  const cards = I.evaluateInsights(ctx2({
    attendance: { total: 40, atendidas: 25, noShow: 15, noShowConfirmados: 8, canceladas: 0,
                  asistenciaPct: 0.62, noShowPct: 0.38 },
    weeklyOccupancy: [{ weekStart: 'a', pct: 0.9 }, { weekStart: 'b', pct: 0.92 }, { weekStart: 'c', pct: 0.91 }],
    byService: [{ key: 'c', label: 'C', citas: 30, ingreso: 900000, pct: 0.9 }],
  }));
  assert.ok(cards.length >= 2, JSON.stringify(cards.map((c) => c.regla)));
  cards.forEach((c) => {
    assert.ok(c.opciones.length <= 2, c.regla + ' trae ' + c.opciones.length + ' opciones');
    assert.ok(I.CONFIDENCE_LEVELS.indexOf(c.confianza) !== -1, c.regla);
    assert.ok(c.dato && c.dato.length, c.regla + ' sin dato');
  });
});
