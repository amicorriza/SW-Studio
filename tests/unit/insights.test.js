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
