/*
 * public/js/metrics.js -- funciones puras del Dashboard de métricas de negocio.
 *
 * <script> CLÁSICO sin bundler (NO type="module"): se carga en
 * public/admin/index.html antes del IIFE inline y expone window.SWMetrics.
 * El mismo archivo es require()-able por Node (node --test) -- ver el export
 * dual al final. NO toca el DOM, NO habla con Firestore, NO importa nada: el
 * invariante "public/js/data.js es la única capa de datos" se mantiene.
 *
 * Toda función que necesita "hoy" o una zona la recibe como argumento
 * explícito (today / tz) -- nada de `new Date()` suelto dentro de las
 * agregaciones -- para que los tests sean deterministas sin importar el TZ
 * del runner. La zona del negocio gobierna, nunca la del navegador.
 */
;(function (root) {
  'use strict';

  // Copia parcial de DEFAULT_TZ (functions/shared/timezone.js), mismo motivo
  // que la copia en public/admin/index.html: <script> plano, sin bundler.
  var DEFAULT_TZ = 'America/Santiago';
  var YMD_RE = /^\d{4}-\d{2}-\d{2}$/;

  function pad2(n) { return n < 10 ? '0' + n : '' + n; }

  // 'YYYY-MM-DD' desde las partes UTC de un Date. Los Date de este módulo son
  // siempre UTC-mediodía, así que getUTC* evita que el TZ del runner corra el día.
  function ymd(d) {
    if (!(d instanceof Date) || isNaN(d.getTime())) return null;
    return d.getUTCFullYear() + '-' + pad2(d.getUTCMonth() + 1) + '-' + pad2(d.getUTCDate());
  }

  // Suma n días a una clave 'YYYY-MM-DD' operando a UTC-mediodía (DST nunca
  // mueve el día). Devuelve 'YYYY-MM-DD'.
  function addDaysYMD(key, n) {
    var y = +key.slice(0, 4), m = +key.slice(5, 7), d = +key.slice(8, 10);
    var dt = new Date(Date.UTC(y, m - 1, d, 12));
    dt.setUTCDate(dt.getUTCDate() + n);
    return ymd(dt);
  }

  // Suma delta meses a una clave 'YYYY-MM'. Devuelve 'YYYY-MM'.
  function ymAdd(ym, delta) {
    var y = +String(ym).slice(0, 4), m = +String(ym).slice(5, 7);
    var idx = y * 12 + (m - 1) + delta;
    var ny = Math.floor(idx / 12), nm = (idx % 12) + 1;
    return ny + '-' + pad2(nm);
  }

  // Reserva -> Date UTC-mediodía del día de `b.date`, o null si no parsea.
  // Recorta a los primeros 10 chars ANTES de parsear: el camino de escritura
  // directa del admin guarda `date` como 'YYYY-MM-DDTHH:mm:00.000Z' -- hora de
  // pared local mal etiquetada Z, no un instante real; `new Date()` del string
  // entero correría las reservas de la tarde un día atrás. Nunca lanza.
  function parseBookingDate(b) {
    try {
      var raw = (b && b.date != null) ? String(b.date) : '';
      var key = raw.slice(0, 10);
      if (!YMD_RE.test(key)) return null;
      var y = +key.slice(0, 4), m = +key.slice(5, 7), day = +key.slice(8, 10);
      var d = new Date(Date.UTC(y, m - 1, day, 12));
      if (d.getUTCFullYear() !== y || d.getUTCMonth() !== m - 1 || d.getUTCDate() !== day) return null;
      return d;
    } catch (e) {
      return null;
    }
  }

  // Día calendario ('YYYY-MM-DD') de un instante visto desde `tz`. null si el
  // instante no es válido. Nunca lanza.
  function dayKeyInZone(instant, tz) {
    try {
      if (!(instant instanceof Date) || isNaN(instant.getTime())) return null;
      return new Intl.DateTimeFormat('en-CA', {
        timeZone: tz || DEFAULT_TZ, year: 'numeric', month: '2-digit', day: '2-digit'
      }).format(instant);
    } catch (e) {
      return null;
    }
  }

  // 'YYYY-MM-DD' de hoy en la zona del negocio. `now` inyectable para tests.
  function bizToday(tz, now) {
    return dayKeyInZone(now instanceof Date ? now : new Date(), tz || DEFAULT_TZ);
  }

  // Límites de un mes 'YYYY-MM' como strings comparables lexicográficamente
  // contra `b.date` (que ya es 'YYYY-MM-DD').
  function monthBounds(ym) {
    var s = String(ym);
    var y = +s.slice(0, 4), m = +s.slice(5, 7);
    var last = new Date(Date.UTC(y, m, 0)).getUTCDate();
    return { from: s.slice(0, 7) + '-01', to: s.slice(0, 7) + '-' + pad2(last), ym: s.slice(0, 7) };
  }

  // Rango libre. Invierte si viene al revés; {from:'',to:''} si alguno no es
  // una fecha 'YYYY-MM-DD' -- los llamadores guardan ese caso.
  function rangeBounds(fromISO, toISO) {
    var a = String(fromISO || '').slice(0, 10);
    var b = String(toISO || '').slice(0, 10);
    if (!YMD_RE.test(a) || !YMD_RE.test(b)) return { from: '', to: '' };
    return a <= b ? { from: a, to: b } : { from: b, to: a };
  }

  // Semana LUNES a DOMINGO, `n` semanas antes de la semana de `todayYMD`.
  // n=0 -> la semana en curso. `to` siempre es `from` + 6 días.
  function weekStartsBack(n, todayYMD) {
    var dow = new Date(todayYMD + 'T12:00:00Z').getUTCDay(); // 0=Dom .. 6=Sáb
    var sinceMon = (dow + 6) % 7;
    var curMon = addDaysYMD(todayYMD, -sinceMon);
    var from = addDaysYMD(curMon, -7 * n);
    return { from: from, to: addDaysYMD(from, 6) };
  }

  function normEmail(e) { return String(e == null ? '' : e).trim().toLowerCase(); }

  // { emailNorm: 'YYYY-MM-DD' } con la PRIMERA reserva histórica de cada
  // cliente sobre TODO el arreglo. Sin email -> no entra. Si `date` no parsea
  // pero hay `createdAt`, usa el día de `createdAt` en la zona. Nunca lanza.
  function firstBookingByEmail(bookings, opts) {
    var tz = (opts && opts.tz) || DEFAULT_TZ;
    var out = {};
    (bookings || []).forEach(function (b) {
      try {
        var email = normEmail(b && b.email);
        if (!email) return;
        var d = parseBookingDate(b);
        var key = d ? ymd(d) : null;
        if (!key && b && b.createdAt) key = dayKeyInZone(new Date(b.createdAt), tz);
        if (!key || !YMD_RE.test(key)) return;
        if (out[email] == null || key < out[email]) out[email] = key;
      } catch (e) { /* aislar la reserva que no parsea */ }
    });
    return out;
  }

  // Reservas del período aplicando Realizado/Agendado y excluyendo 'declined'.
  // 'confirmed' y 'pending' se tratan igual. Aísla por reserva las que no parsean.
  function mFilterPeriod(bookings, opts) {
    var o = opts || {};
    var from = o.from, to = o.to, mode = o.mode, today = o.today;
    var out = [];
    (bookings || []).forEach(function (b) {
      try {
        if (b && b.status === 'declined') return;
        var d = parseBookingDate(b);
        if (!d) return;
        var dk = ymd(d);
        if (from && dk < from) return;
        if (to && dk > to) return;
        // Realizado: estrictamente antes de hoy en la zona del negocio.
        if (mode === 'realizado' && today && dk >= today) return;
        out.push(b);
      } catch (e) { /* aislar */ }
    });
    return out;
  }

  function sumPrice(bookings) {
    var t = 0;
    (bookings || []).forEach(function (b) { t += (b && +b.price) || 0; });
    return t;
  }

  // Δ relativo. null si no hay base de comparación (previo null o 0) -> nunca NaN/Infinity.
  function rel(cur, prev) {
    if (prev == null || prev === 0) return null;
    return (cur - prev) / prev;
  }

  // Split nuevo/recurrente sobre CLIENTES ÚNICOS (email normalizado), no
  // reservas. Sin email -> cubeta "sin dato". `firstSeen[email] >= periodFrom`
  // (inclusivo) -> nuevo. Sin histórico conocido -> se cuenta como nuevo.
  function clientSplit(bookings, firstSeen, periodFrom) {
    var seen = {}, nuevos = 0, recurrentes = 0, sinEmail = 0;
    (bookings || []).forEach(function (b) {
      var email = normEmail(b && b.email);
      if (!email) { sinEmail++; return; }
      if (seen[email]) return;
      seen[email] = true;
      var fs = firstSeen && firstSeen[email];
      if (fs != null && periodFrom != null && fs < periodFrom) recurrentes++;
      else nuevos++;
    });
    return { nuevos: nuevos, recurrentes: recurrentes, sinEmail: sinEmail, activos: nuevos + recurrentes };
  }

  function mKpis(periodBookings, prevBookings, ctx) {
    var c = ctx || {};
    var firstSeen = c.firstSeen || {};
    var pb = periodBookings || [];
    var prev = prevBookings || [];

    var ingresos = sumPrice(pb);
    var citas = pb.length;
    var ticket = citas ? Math.round(ingresos / citas) : 0;
    var cur = clientSplit(pb, firstSeen, c.periodFrom);
    var base = cur.nuevos + cur.recurrentes;
    var nuevosPct = base ? cur.nuevos / base : null;
    var recurrentesPct = base ? cur.recurrentes / base : null;

    var hasPrev = prev.length > 0;
    var pIngresos = sumPrice(prev);
    var pCitas = prev.length;
    var pTicket = pCitas ? Math.round(pIngresos / pCitas) : 0;
    var pSplit = clientSplit(prev, firstSeen, c.prevFrom);
    var pBase = pSplit.nuevos + pSplit.recurrentes;
    var pRecPct = pBase ? pSplit.recurrentes / pBase : null;

    var deltas = {
      ingresos: hasPrev ? rel(ingresos, pIngresos) : null,
      citas: hasPrev ? rel(citas, pCitas) : null,
      ticket: hasPrev ? rel(ticket, pTicket) : null,
      nuevos: hasPrev ? rel(cur.nuevos, pSplit.nuevos) : null,
      // % recurrentes se compara como DIFERENCIA DE PUNTOS, no fracción.
      recurrentesPct: (hasPrev && recurrentesPct != null && pRecPct != null)
        ? (recurrentesPct - pRecPct) : null
    };

    return {
      ingresos: ingresos, citas: citas, ticket: ticket,
      nuevos: cur.nuevos, recurrentes: cur.recurrentes, activos: cur.activos,
      nuevosPct: nuevosPct, recurrentesPct: recurrentesPct, sinEmail: cur.sinEmail,
      deltas: deltas
    };
  }

  // Serie mensual de ventana FIJA (no depende del selector de período),
  // terminando en el mes de `today`. Respeta el modo Realizado/Agendado.
  function mMonthlySeries(bookings, opts) {
    var o = opts || {};
    var months = o.months || 12;
    var endYm = String(o.today).slice(0, 7);
    var out = [];
    for (var i = months - 1; i >= 0; i--) {
      var ym = ymAdd(endYm, -i);
      var mb = monthBounds(ym);
      var slice = mFilterPeriod(bookings, { from: mb.from, to: mb.to, mode: o.mode, today: o.today });
      out.push({ ym: ym, ingresos: sumPrice(slice), citas: slice.length });
    }
    return out;
  }

  // Serie semanal FIJA: `weeks` semanas completas + la semana en curso
  // (marcada `current`). Lunes a domingo.
  function mWeeklySeries(bookings, opts) {
    var o = opts || {};
    var weeks = o.weeks || 12;
    var out = [];
    for (var i = weeks; i >= 0; i--) {
      var wk = weekStartsBack(i, o.today);
      var slice = mFilterPeriod(bookings, { from: wk.from, to: wk.to, mode: o.mode, today: o.today });
      out.push({ weekStart: wk.from, ingresos: sumPrice(slice), citas: slice.length, current: i === 0 });
    }
    return out;
  }

  // Desglose por servicio o categoría. `periodBookings` ya viene acotado por
  // mFilterPeriod, así que acá solo agrega (y por defensa salta 'declined').
  // ingresoHora agrega solo filas con dur>0; null si ninguna la tiene.
  function mByService(periodBookings, opts) {
    var groupBy = (opts && opts.groupBy) || 'svc';
    var groups = {};
    var totalIngreso = 0;
    (periodBookings || []).forEach(function (b) {
      if (!b || b.status === 'declined') return;
      var price = (+b.price) || 0;
      var dur = (+b.dur) || 0;
      var key, label;
      if (groupBy === 'cat') {
        key = (b.svcCat != null && b.svcCat !== '') ? String(b.svcCat) : 'sin';
        label = key;
      } else {
        key = (b.svcId != null && b.svcId !== '') ? String(b.svcId)
          : (b.svcName != null && b.svcName !== '') ? String(b.svcName) : 'sin-servicio';
        label = (b.svcName != null && b.svcName !== '') ? String(b.svcName) : '(sin nombre)';
      }
      var grp = groups[key] || (groups[key] = { key: key, label: label, citas: 0, ingreso: 0, durHrs: 0, ingresoConDur: 0 });
      grp.citas++;
      grp.ingreso += price;
      totalIngreso += price;
      if (dur > 0) { grp.durHrs += dur / 60; grp.ingresoConDur += price; }
    });
    return Object.keys(groups).map(function (k) {
      var grp = groups[k];
      return {
        key: grp.key, label: grp.label, citas: grp.citas, ingreso: grp.ingreso,
        pct: totalIngreso ? grp.ingreso / totalIngreso : 0,
        ingresoHora: grp.durHrs > 0 ? grp.ingresoConDur / grp.durHrs : null
      };
    }).sort(function (a, b) { return b.ingreso - a.ingreso; });
  }

  function barberAgg(bookings) {
    var by = {};
    (bookings || []).forEach(function (b) {
      if (!b || b.status === 'declined') return;
      var id = (b.barberId != null && b.barberId !== '') ? String(b.barberId) : 'unknown';
      var grp = by[id] || (by[id] = { barberId: id, name: b.barberName || '?', total: 0, revenue: 0, svcs: {} });
      grp.total++;
      grp.revenue += (+b.price) || 0;
      if (b.svcName) grp.svcs[b.svcName] = (grp.svcs[b.svcName] || 0) + 1;
    });
    return by;
  }

  // Misma forma que hoy arma renderStats para .a-bstat, más deltas vs previo.
  function mByBarber(periodBookings, prevBookings) {
    var cur = barberAgg(periodBookings);
    var prev = barberAgg(prevBookings);
    return Object.keys(cur).map(function (id) {
      var c = cur[id], p = prev[id];
      return {
        barberId: c.barberId, name: c.name, total: c.total, revenue: c.revenue, svcs: c.svcs,
        deltaCitas: p ? rel(c.total, p.total) : null,
        deltaIngreso: p ? rel(c.revenue, p.revenue) : null
      };
    }).sort(function (a, b) { return b.total - a.total; });
  }

  // Serie FIJA de `months` meses: clientes únicos nuevos vs recurrentes por
  // mes + total de reservas sin email en la ventana.
  function mNewVsReturning(bookings, opts) {
    var o = opts || {};
    var months = o.months || 6;
    var endYm = String(o.today).slice(0, 7);
    var firstSeen = o.firstSeen || {};
    var windowFrom = monthBounds(ymAdd(endYm, -(months - 1))).from;
    var windowTo = monthBounds(endYm).to;

    var sinEmail = 0;
    (bookings || []).forEach(function (b) {
      if (!b || b.status === 'declined') return;
      var d = parseBookingDate(b);
      if (!d) return;
      var dk = ymd(d);
      if (dk < windowFrom || dk > windowTo) return;
      if (!normEmail(b.email)) sinEmail++;
    });

    var series = [];
    for (var i = months - 1; i >= 0; i--) {
      var ym = ymAdd(endYm, -i);
      var mb = monthBounds(ym);
      var slice = mFilterPeriod(bookings, { from: mb.from, to: mb.to, mode: 'agendado', today: o.today });
      var split = clientSplit(slice, firstSeen, mb.from);
      series.push({ ym: ym, nuevos: split.nuevos, recurrentes: split.recurrentes });
    }
    return { series: series, sinEmail: sinEmail };
  }

  var EXPORT_HEADER = ['Mes', 'Citas', 'Ingresos CLP', 'Ticket promedio CLP',
    'Clientes únicos', 'Clientes nuevos', 'Clientes recurrentes', 'Sin email'];

  // Filas para el CSV: header + `months` filas (más viejo primero). Números
  // enteros planos (sin $, sin separador de miles) para que la planilla sume.
  function mMonthlyExportRows(bookings, opts) {
    var o = opts || {};
    var months = o.months || 12;
    var endYm = String(o.today).slice(0, 7);
    var firstSeen = o.firstSeen || {};
    var rows = [EXPORT_HEADER.slice()];
    for (var i = months - 1; i >= 0; i--) {
      var ym = ymAdd(endYm, -i);
      var mb = monthBounds(ym);
      var slice = mFilterPeriod(bookings, { from: mb.from, to: mb.to, mode: o.mode, today: o.today });
      var ingresos = sumPrice(slice);
      var citas = slice.length;
      var ticket = citas ? Math.round(ingresos / citas) : 0;
      var split = clientSplit(slice, firstSeen, mb.from);
      rows.push([ym, citas, ingresos, ticket, split.activos, split.nuevos, split.recurrentes, split.sinEmail]);
    }
    return rows;
  }

  // Array de arrays -> texto CSV. Entrecomilla y escapa si la celda tiene
  // comillas, comas, saltos de línea o punto y coma. Filas unidas con CRLF.
  // El llamador antepone el BOM ('﻿') para Excel/es-CL.
  function toCSV(rows) {
    return (rows || []).map(function (r) {
      return (r || []).map(function (cell) {
        var s = String(cell == null ? '' : cell);
        return /[",\r\n;]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
      }).join(',');
    }).join('\r\n');
  }

  // series = [{ label, value, current? }] -> string <svg> (sin DOM). `opts.fmt`
  // formatea los valores (lo pasa el admin: fmtCLP o String). Estilo flat,
  // colores del admin. Serie vacía / toda-null -> <svg> con "Sin datos".
  function svgLine(series, opts) {
    var o = opts || {};
    var fmt = typeof o.fmt === 'function' ? o.fmt : String;
    var W = 640, H = 200, padL = 8, padR = 8, padT = 12, padB = 20;
    var pts = (series || []).filter(function (p) {
      return p && typeof p.value === 'number' && isFinite(p.value);
    });
    var open = '<svg viewBox="0 0 ' + W + ' ' + H + '" preserveAspectRatio="none" ' +
      'xmlns="http://www.w3.org/2000/svg" class="a-dash-svg">';
    if (!pts.length) {
      return open + '<text x="' + (W / 2) + '" y="' + (H / 2) +
        '" text-anchor="middle" fill="#999" font-size="13">Sin datos</text></svg>';
    }
    var maxV = Math.max.apply(null, pts.map(function (p) { return p.value; }));
    if (!(maxV > 0)) maxV = 1;
    var innerW = W - padL - padR, innerH = H - padT - padB;
    var n = pts.length;
    var xAt = function (i) { return padL + (n === 1 ? innerW / 2 : innerW * i / (n - 1)); };
    var yAt = function (v) { return padT + innerH - innerH * (v / maxV); };
    var coords = pts.map(function (p, i) { return xAt(i).toFixed(1) + ',' + yAt(p.value).toFixed(1); });

    var grid = '';
    for (var gi = 0; gi <= 2; gi++) {
      var gv = maxV * gi / 2;
      var gy = yAt(gv).toFixed(1);
      grid += '<line x1="' + padL + '" y1="' + gy + '" x2="' + (W - padR) + '" y2="' + gy +
        '" stroke="#DEDEDE" stroke-width="1"/>' +
        '<text x="' + (W - padR) + '" y="' + (gy - 2) + '" text-anchor="end" fill="#999" font-size="9">' +
        esc(fmt(Math.round(gv))) + '</text>';
    }
    var baseY = (padT + innerH).toFixed(1);
    var area = 'M' + xAt(0).toFixed(1) + ',' + baseY + ' L' + coords.join(' L') +
      ' L' + xAt(n - 1).toFixed(1) + ',' + baseY + ' Z';
    var last = pts[n - 1];
    var marker = '<circle cx="' + xAt(n - 1).toFixed(1) + '" cy="' + yAt(last.value).toFixed(1) + '" r="3.5" ' +
      (last.current ? 'fill="#fff" stroke="#0A0A0A" stroke-width="1.5"' : 'fill="#0A0A0A"') + '/>';
    var hit = pts.map(function (p, i) {
      return '<circle cx="' + xAt(i).toFixed(1) + '" cy="' + yAt(p.value).toFixed(1) +
        '" r="8" fill="transparent"><title>' + esc(String(p.label == null ? '' : p.label)) +
        ': ' + esc(fmt(p.value)) + '</title></circle>';
    }).join('');
    var xl = '<text x="' + padL + '" y="' + (H - 6) + '" fill="#999" font-size="9">' +
      esc(String(pts[0].label == null ? '' : pts[0].label)) + '</text>' +
      '<text x="' + (W - padR) + '" y="' + (H - 6) + '" text-anchor="end" fill="#999" font-size="9">' +
      esc(String(last.label == null ? '' : last.label)) + '</text>';

    return open + grid +
      '<path d="' + area + '" fill="rgba(10,10,10,.06)" stroke="none"/>' +
      '<polyline points="' + coords.join(' ') + '" fill="none" stroke="#0A0A0A" stroke-width="1.5"/>' +
      marker + hit + xl + '</svg>';
  }

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  var api = {
    DEFAULT_TZ: DEFAULT_TZ,
    pad2: pad2, ymd: ymd, addDaysYMD: addDaysYMD, ymAdd: ymAdd,
    parseBookingDate: parseBookingDate, dayKeyInZone: dayKeyInZone, bizToday: bizToday,
    monthBounds: monthBounds, rangeBounds: rangeBounds, weekStartsBack: weekStartsBack,
    firstBookingByEmail: firstBookingByEmail, mFilterPeriod: mFilterPeriod, mKpis: mKpis,
    mMonthlySeries: mMonthlySeries, mWeeklySeries: mWeeklySeries, mByService: mByService,
    mByBarber: mByBarber, mNewVsReturning: mNewVsReturning, mMonthlyExportRows: mMonthlyExportRows,
    svgLine: svgLine, toCSV: toCSV
  };

  if (typeof module === 'object' && module.exports) module.exports = api; // node --test
  else root.SWMetrics = api;                                              // admin browser
})(typeof globalThis !== 'undefined' ? globalThis : this);
