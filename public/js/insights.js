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
    noShowSubePP: 0.03,       // ...o sube >3 puntos vs el período anterior
    confirmoNoLlego: 3,       // >=3 confirmados que no asistieron
    horaDebil: 0.45,          // ocupación <45% en una franja
    agendaLlena: 0.85,        // ocupación >85% sostenida
    agendaLlenaSemanas: 3,    // ...durante 3 semanas
    servicioLider: 0.35,      // un servicio concentra >35% del ingreso
    bajoIngresoHora: 0.80,    // $/h real <80% del objetivo
    mejoraTiempo: 0.05,       // el tiempo real mejora >5%
    inicioTardioPct: 0.20,    // >20% de las atenciones empieza tarde
    variabilidad: 0.40,       // IQR / mediana > 0,40
    ventasBajan: -0.15,       // ventas -15% o peor
    ocupacionSimilarPP: 0.05, // ...con la ocupación dentro de ±5 puntos
    asistenciaSana: 0.92,     // asistencia >=92%
  };

  // Muestra mínima de inicios medidos para hablar de atrasos: con cinco
  // atenciones, dos tardías ya dan 40% y eso no es una tendencia.
  var MIN_INICIOS_MEDIDOS = 10;

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

  // §7.4 -- No-show alto, por nivel O por subida. La segunda rama importa:
  // pasar de 1% a 5% es una señal aunque siga bajo el umbral absoluto.
  function reglaNoShow(c) {
    var a = c.attendance;
    if (!a || a.noShowPct == null) return null;
    var prevPct = c.prev && c.prev.attendance ? c.prev.attendance.noShowPct : null;
    var subida = prevPct == null ? null : a.noShowPct - prevPct;
    var porNivel = a.noShowPct > TH.noShow;
    var porSubida = subida != null && subida > TH.noShowSubePP;
    if (!porNivel && !porSubida) return null;

    var dato = 'No-show: ' + pct(a.noShowPct) + ' (' + a.noShow + ' de ' + (a.atendidas + a.noShow) + ' citas medidas)';
    if (porSubida) dato += ' · subió ' + Math.round(subida * 100) + ' pp vs el período anterior';

    return card('no_show_alto', 'prioridad',
      porSubida && !porNivel ? 'Las inasistencias aumentaron' : 'Las inasistencias están altas',
      dato, confidenceOf(c.medidas),
      ['Reforzar el recordatorio o pedir confirmación más cerca de la hora',
       'Evaluar un anticipo para los horarios más demandados']);
  }

  // §7.5 -- Confirmó y no llegó. Es peor que un no-show cualquiera: el
  // recordatorio funcionó, el cliente respondió, y aun así no vino. Apunta a
  // la política y al intervalo del recordatorio, no al recordatorio en sí.
  function reglaConfirmoNoLlego(c) {
    var a = c.attendance;
    var n = (a && a.noShowConfirmados) || 0;
    if (n < TH.confirmoNoLlego) return null;
    return card('confirmo_no_llego', 'prioridad',
      'Hay clientes que confirman y después no llegan',
      n + ' ' + (n === 1 ? 'cita confirmada' : 'citas confirmadas') + ' terminaron en inasistencia',
      confidenceOf(c.medidas),
      ['Acercar el recordatorio a la hora de la cita',
       'Revisar la política para quien confirma y no asiste']);
  }

  // §7.13 -- Se vendió menos atendiendo lo mismo. El guardarraíl de ocupación
  // es lo que la hace útil: sin él dispararía cuando las ventas bajan porque
  // hubo menos trabajo, que es otra conversación.
  function reglaVentasBajan(c) {
    if (!c.prev || !c.prev.kpis || !c.kpis) return null;
    var ant = Number(c.prev.kpis.ingresos) || 0;
    if (!ant) return null;
    var delta = ((Number(c.kpis.ingresos) || 0) - ant) / ant;
    if (delta > TH.ventasBajan) return null;

    var ocu = c.occupancy && c.occupancy.pct;
    var ocuAnt = c.prev.occupancy && c.prev.occupancy.pct;
    if (ocu == null || ocuAnt == null) return null;
    if (Math.abs(ocu - ocuAnt) > TH.ocupacionSimilarPP) return null;

    return card('ventas_bajan', 'prioridad',
      'Se atendió casi lo mismo, pero se vendió menos',
      'Ventas ' + Math.round(delta * 100) + '% con la ocupación en ' + pct(ocu) +
        ' (antes ' + pct(ocuAnt) + ')',
      confidenceOf(c.medidas),
      ['Revisar el ticket promedio y la mezcla de servicios',
       'Revisar descuentos y servicios de menor valor']);
  }

  // §7.11 -- Inicio tardío. El cliente llegó; la atención empezó tarde igual.
  function reglaInicioTardio(c) {
    var l = c.lateStarts;
    if (!l || l.pct == null || l.medidas < MIN_INICIOS_MEDIDOS) return null;
    if (l.pct <= TH.inicioTardioPct) return null;
    return card('inicio_tardio', 'prioridad',
      'Varias atenciones empiezan tarde',
      pct(l.pct) + ' de las atenciones (' + l.tarde + ' de ' + l.medidas + ') empezó con ' +
        min(l.medianaAtrasoMin) + ' de atraso o más',
      confidenceOf(l.medidas),
      ['Sumar un margen entre citas (buffer)',
       'Revisar la transición entre una atención y la siguiente']);
  }

  // §7.2 -- Capacidad escondida: el servicio termina antes de lo programado
  // de forma consistente. El slot está comprando tiempo que no se usa.
  function reglaCapacidadEscondida(c) {
    var mejor = null;
    (c.realTime || []).forEach(function (r) {
      if (r.n < MIN_PARA_PRECIO) return;
      if (r.deviationPct == null || r.deviationPct >= TH.capacidadOculta) return;
      if (!mejor || r.deviationPct < mejor.deviationPct) mejor = r;
    });
    if (!mejor) return null;
    return card('capacidad_escondida', 'oportunidad',
      cap(mejor.label) + ' termina antes de lo programado',
      'Programado: ' + min(mejor.planMin) + ' · Mediana real: ' + min(mejor.medianMin) +
        ' · ' + mejor.n + ' atenciones medidas',
      confidenceOf(mejor.n),
      ['Reducir el bloque 5 min y volver a medir',
       'Dejar el bloque y usar el margen como buffer'],
      { servicio: mejor.key });
  }

  // §7.7 -- Agenda casi llena, sostenida. Una semana llena es una buena
  // semana; tres seguidas es un techo.
  function reglaAgendaLlena(c) {
    var w = c.weeklyOccupancy || [];
    if (w.length < TH.agendaLlenaSemanas) return null;
    var ultimas = w.slice(-TH.agendaLlenaSemanas);
    if (!ultimas.every(function (x) { return x.pct != null && x.pct > TH.agendaLlena; })) return null;
    var prom = ultimas.reduce(function (a, x) { return a + x.pct; }, 0) / ultimas.length;
    return card('agenda_llena', 'oportunidad',
      'La agenda se mantiene cerca de su capacidad',
      'Ocupación sobre ' + pct(TH.agendaLlena) + ' las últimas ' + ultimas.length +
        ' semanas (promedio ' + pct(prom) + ')',
      confidenceOf(c.medidas),
      ['Evaluar extender el horario o sumar un profesional',
       'Evaluar el precio de los horarios más pedidos']);
  }

  // §7.12 -- Alta variabilidad. El mismo servicio dura cosas muy distintas:
  // o hay dos servicios metidos en uno, o el proceso no está estandarizado.
  function reglaAltaVariabilidad(c) {
    var peor = null;
    (c.realTime || []).forEach(function (r) {
      if (r.n < MIN_PARA_PRECIO) return;
      if (!Number.isFinite(r.spread) || r.spread <= TH.variabilidad) return;
      if (!peor || r.spread > peor.spread) peor = r;
    });
    if (!peor) return null;
    return card('alta_variabilidad', 'oportunidad',
      cap(peor.label) + ' tiene duraciones muy distintas entre sí',
      'La mitad central va de ' + min(peor.p25Min) + ' a ' + min(peor.p75Min) +
        ', con mediana ' + min(peor.medianMin),
      confidenceOf(peor.n),
      ['Separarlo en dos servicios según complejidad',
       'Estandarizar el procedimiento y volver a medir'],
      { servicio: peor.key });
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

  // §7.10 -- Mejora operacional. Solo se celebra si el ticket NO bajó:
  // atender más rápido cobrando menos no es una mejora, es otra cosa.
  function reglaMejoraOperacional(c) {
    if (!c.prev || !c.prev.realTime || !c.kpis || !c.prev.kpis) return null;
    var antes = {};
    (c.prev.realTime || []).forEach(function (r) { antes[r.key] = r; });

    var mejor = null;
    (c.realTime || []).forEach(function (r) {
      var a = antes[r.key];
      if (!a || !a.medianMin || !r.medianMin) return;
      var mejora = (a.medianMin - r.medianMin) / a.medianMin;
      if (mejora <= TH.mejoraTiempo) return;
      if (!mejor || mejora > mejor._mejora) { mejor = r; mejor._mejora = mejora; mejor._antes = a.medianMin; }
    });
    if (!mejor) return null;

    var ticket = Number(c.kpis.ticket) || 0;
    var ticketAntes = Number(c.prev.kpis.ticket) || 0;
    if (ticketAntes && ticket < ticketAntes) return null;

    return card('mejora_operacional', 'positivo',
      cap(mejor.label) + ' mejoró su tiempo',
      'De ' + min(mejor._antes) + ' a ' + min(mejor.medianMin) +
        ' de mediana, sin bajar el ticket promedio',
      confidenceOf(mejor.n), []);
  }

  // §7.8 -- Servicio líder. Es un reconocimiento, pero con una advertencia:
  // lo que sostiene el negocio es lo que no conviene descontar a ciegas.
  function reglaServicioLider(c) {
    var lider = null;
    (c.byService || []).forEach(function (s) {
      if (s.pct == null || s.pct <= TH.servicioLider) return;
      if (!lider || s.pct > lider.pct) lider = s;
    });
    if (!lider) return null;
    return card('servicio_lider', 'positivo',
      cap(lider.label) + ' sostiene el negocio',
      'Representa ' + pct(lider.pct) + ' de los ingresos del período',
      confidenceOf(c.medidas),
      ['Proteger sus cupos y evitar descuentos indiscriminados'],
      { servicio: lider.key });
  }

  // El orden ES la jerarquía de §8: pérdida directa de dinero, desviación de
  // tiempo, ocupación, precio/productividad, y al final las señales
  // positivas. Como se emite UNA tarjeta por tipo, este orden decide qué ve
  // el usuario cuando compiten varias: insertar una regla al medio cambia el
  // panel sin que nadie lo note, y por eso hay un test que lo fija.
  var REGLAS = [
    // — pérdida directa de dinero —
    reglaNoShow,
    reglaConfirmoNoLlego,
    reglaVentasBajan,
    // — desviación de tiempo —
    reglaSobretiempo,
    reglaInicioTardio,
    // — ocupación —
    reglaHoraDebil,
    reglaAgendaLlena,
    reglaCapacidadEscondida,
    reglaAltaVariabilidad,
    // — precio / productividad —
    reglaBajoIngresoHora,
    // — señales positivas —
    // Dentro de este grupo gana la NOTICIA sobre la línea de base. La
    // asistencia sana es el estado normal de una barbería que funciona: si
    // fuera primera, taparía para siempre a las otras dos, porque dispara
    // casi todas las semanas. Su propia acción sugerida en §7.14 es "no
    // cambiar nada", que es justo la menos útil de mostrar.
    reglaMejoraOperacional,
    reglaServicioLider,
    reglaAsistenciaSana,
  ];

  // Espejo del orden de arriba, para que un test pueda fijarlo sin depender
  // de los nombres de las funciones.
  var REGLA_ORDEN = [
    'no_show_alto', 'confirmo_no_llego', 'ventas_bajan',
    'sobretiempo', 'inicio_tardio',
    'hora_debil', 'agenda_llena', 'capacidad_escondida', 'alta_variabilidad', 'bajo_ingreso_hora',
    'mejora_operacional', 'servicio_lider', 'asistencia_sana',
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
    REGLA_ORDEN: REGLA_ORDEN,
    MIN_INICIOS_MEDIDOS: MIN_INICIOS_MEDIDOS,
    confidenceOf: confidenceOf,
    evaluateInsights: evaluateInsights,
  };

  if (typeof module === 'object' && module.exports) module.exports = api; // node --test
  else root.SWInsights = api;                                            // admin browser
})(typeof globalThis !== 'undefined' ? globalThis : this);
