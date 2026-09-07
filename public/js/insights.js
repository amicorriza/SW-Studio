/*
 * public/js/insights.js -- motor de recomendaciones del Dashboard.
 *
 * Mismo patrón que public/js/metrics.js: <script> CLÁSICO sin bundler, que
 * expone window.SWInsights en el navegador y es require()-able por Node para
 * los tests (export dual al final). NO toca el DOM, NO habla con Firestore,
 * NO importa nada. Recibe las agregaciones ya calculadas por metrics.js y
 * solo decide qué decir.
 *
 * Implementa el set de recomendaciones del Reporte de KPI (§7) con la
 * jerarquía de §8 y, sobre todo, la escalera de muestra mínima de §6.
 *
 * REGLA DE ORO (§6): máximo 3 tarjetas -- una prioridad, una oportunidad y un
 * reconocimiento positivo. Cada una con el dato que la origina, su nivel de
 * confianza y a lo sumo dos opciones concretas.
 *
 * NADA de lo que devuelve este módulo modifica configuración. §9 es
 * explícito: "nunca cambiar precio o duración de forma automática". Las
 * opciones son texto para que decida una persona.
 */
;(function (root) {
  'use strict';

  // ── Escalera de confianza (PDF §6) ──
  // Es la parte que protege al usuario. Sin ella el panel opinaría sobre
  // ruido: con 4 atenciones medidas, una sola que se alargó mueve la mediana
  // lo suficiente como para "recomendar" subir un precio.
  var CONFIDENCE_LEVELS = ['recolectando', 'preliminar', 'suficiente', 'alta'];
  var MIN_PARA_OPINAR = 10;   // bajo esto no se muestra ninguna tarjeta
  var MIN_PARA_PRECIO = 20;   // bajo esto se alertan desviaciones, sin precio

  function confidenceOf(n) {
    var v = Number(n) || 0;
    if (v < MIN_PARA_OPINAR) return 'recolectando';
    if (v < MIN_PARA_PRECIO) return 'preliminar';
    if (v < 30) return 'suficiente';
    return 'alta';
  }

  // ── Umbrales de las reglas (§7). Literales del documento. ──
  var TH = {
    sobretiempo: 0.10,        // mediana real >10% sobre el plan
    capacidadOculta: -0.10,   // mediana real <10% bajo el plan
    noShow: 0.08,             // no-show >8%
    horaDebil: 0.45,          // ocupación <45% en una franja
    bajoIngresoHora: 0.80,    // $/h real <80% del objetivo
    asistenciaSana: 0.92,     // asistencia >=92%
  };

  // Una franja necesita disponibilidad suficiente para que su porcentaje
  // signifique algo: media hora suelta no es "una hora débil".
  var MIN_DISPONIBLE_FRANJA = 60;

  var DIAS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];

  function pct(v) { return Math.round((Number(v) || 0) * 100) + '%'; }
  function clp(v) { return '$' + Math.round(Number(v) || 0).toLocaleString('es-CL'); }
  function min(v) { return Math.round(Number(v) || 0) + ' min'; }
  function cap(s) { return s ? s.charAt(0).toUpperCase() + s.slice(1) : s; }

  function card(regla, tipo, titulo, dato, confianza, opciones, extra) {
    var c = {
      regla: regla, tipo: tipo, titulo: titulo, dato: dato,
      confianza: confianza, opciones: (opciones || []).slice(0, 2), precio: null,
    };
    if (extra) Object.keys(extra).forEach(function (k) { c[k] = extra[k]; });
    return c;
  }

  // ── Reglas ──
  // Cada una recibe el contexto y devuelve una tarjeta o null. El orden del
  // arreglo ES la jerarquía de §8: pérdida directa de dinero, después
  // desviaciones de tiempo, después ocupación, después precio, y al final las
  // señales positivas.

  // §7.4 -- No-show alto.
  function reglaNoShow(c) {
    var a = c.attendance;
    if (!a || a.noShowPct == null || a.noShowPct <= TH.noShow) return null;
    return card('no_show_alto', 'prioridad',
      'Las inasistencias están altas',
      'No-show: ' + pct(a.noShowPct) + ' (' + a.noShow + ' de ' + (a.atendidas + a.noShow) + ' citas medidas)',
      confidenceOf(c.medidas),
      ['Reforzar el recordatorio o pedir confirmación más cerca de la hora',
       'Evaluar un anticipo para los horarios más demandados']);
  }

  // §7.1 -- Sobretiempo. La simulación de precio solo se adjunta con muestra
  // suficiente; bajo eso la tarjeta alerta el tiempo y nada más.
  function reglaSobretiempo(c) {
    var peor = null;
    (c.realTime || []).forEach(function (r) {
      if (r.deviationPct == null || r.deviationPct <= TH.sobretiempo) return;
      if (!peor || r.deviationPct > peor.deviationPct) peor = r;
    });
    if (!peor) return null;

    var conf = confidenceOf(peor.n);
    var puedePrecio = peor.n >= MIN_PARA_PRECIO;
    var sim = puedePrecio && c.priceSim ? c.priceSim(peor) : null;

    var opciones = ['Mantener el precio y trabajar el tiempo del servicio',
                    'Ampliar el bloque a ' + min(peor.medianMin) + ' y medir otra vez'];
    if (sim) {
      opciones = ['Mantener ' + clp(peor.price) + ' y trabajar el tiempo',
                  'Mantener ' + min(peor.medianMin) + ' y evaluar ' + clp(sim.rango[0]) + '-' + clp(sim.rango[1])];
    }

    return card('sobretiempo', 'prioridad',
      cap(peor.label) + ' está tomando más tiempo del planificado',
      'Programado: ' + min(peor.planMin) + ' · Mediana real: ' + min(peor.medianMin) +
        ' · ' + peor.n + ' atenciones medidas',
      conf, opciones, { precio: sim, servicio: peor.key });
  }

  // §7.6 -- Hora débil. Se elige la franja de peor ocupación con
  // disponibilidad suficiente para que el porcentaje signifique algo.
  function reglaHoraDebil(c) {
    var peor = null;
    (c.heatmap || []).forEach(function (h) {
      if (h.pct == null || h.disponibles < MIN_DISPONIBLE_FRANJA) return;
      if (h.pct >= TH.horaDebil) return;
      if (!peor || h.pct < peor.pct) peor = h;
    });
    if (!peor) return null;
    var hh = (peor.hour < 10 ? '0' : '') + peor.hour + ':00';
    return card('hora_debil', 'oportunidad',
      'Hay una franja con baja ocupación',
      cap(DIAS[peor.dow] || '') + ' ' + hh + ': ocupación ' + pct(peor.pct),
      confidenceOf(c.medidas),
      ['Promoción puntual en ese bloque', 'Reducir la apertura de esa franja']);
  }

  // §7.9 -- Bajo ingreso por hora real contra el objetivo implícito.
  function reglaBajoIngresoHora(c) {
    var peor = null;
    (c.realTime || []).forEach(function (r) {
      if (!r.ingresoHoraReal || !r.ingresoHoraPlan) return;
      var ratio = r.ingresoHoraReal / r.ingresoHoraPlan;
      if (ratio >= TH.bajoIngresoHora) return;
      if (!peor || ratio < peor._ratio) { peor = r; peor._ratio = ratio; }
    });
    if (!peor) return null;
    return card('bajo_ingreso_hora', 'oportunidad',
      cap(peor.label) + ' consume más tiempo del que genera',
      clp(peor.ingresoHoraReal) + '/hora real contra ' + clp(peor.ingresoHoraPlan) + '/hora esperada',
      confidenceOf(peor.n),
      ['Revisar el alcance del servicio', 'Revisar su duración o su precio'],
      { servicio: peor.key });
  }

  // §7.14 -- Reconocimiento. No pide ninguna acción a propósito: es la
  // tarjeta que confirma que algo está funcionando.
  function reglaAsistenciaSana(c) {
    var a = c.attendance;
    if (!a || a.asistenciaPct == null || a.asistenciaPct < TH.asistenciaSana) return null;
    return card('asistencia_sana', 'positivo',
      'Tus clientes están asistiendo',
      'Asistencia real: ' + pct(a.asistenciaPct) + ' sobre ' + (a.atendidas + a.noShow) + ' citas medidas',
      confidenceOf(c.medidas), []);
  }

  // El orden ES la jerarquía de §8.
  var REGLAS = [
    reglaNoShow,            // pérdida directa de dinero
    reglaSobretiempo,       // desviación de tiempo
    reglaHoraDebil,         // ocupación
    reglaBajoIngresoHora,   // precio / productividad
    reglaAsistenciaSana,    // señal positiva
  ];

  var ORDEN_TIPO = { prioridad: 0, oportunidad: 1, positivo: 2 };

  // Devuelve como máximo una tarjeta por tipo, ordenadas por jerarquía.
  // Con menos de MIN_PARA_OPINAR atenciones medidas devuelve [] -- el panel
  // sigue mostrando los datos, pero no opina sobre ellos.
  function evaluateInsights(context) {
    if (!context) return [];
    var c = context;
    if ((Number(c.medidas) || 0) < MIN_PARA_OPINAR) return [];

    var elegidas = {};
    REGLAS.forEach(function (regla) {
      try {
        var t = regla(c);
        if (!t) return;
        if (elegidas[t.tipo]) return; // la primera gana: el arreglo ya está en orden de jerarquía
        elegidas[t.tipo] = t;
      } catch (e) { /* una regla rota no puede tumbar el panel entero */ }
    });

    return Object.keys(elegidas).map(function (k) { return elegidas[k]; })
      .sort(function (a, b) { return ORDEN_TIPO[a.tipo] - ORDEN_TIPO[b.tipo]; });
  }

  var api = {
    CONFIDENCE_LEVELS: CONFIDENCE_LEVELS,
    MIN_PARA_OPINAR: MIN_PARA_OPINAR,
    MIN_PARA_PRECIO: MIN_PARA_PRECIO,
    TH: TH,
    confidenceOf: confidenceOf,
    evaluateInsights: evaluateInsights,
  };

  if (typeof module === 'object' && module.exports) module.exports = api; // node --test
  else root.SWInsights = api;                                            // admin browser
})(typeof globalThis !== 'undefined' ? globalThis : this);
