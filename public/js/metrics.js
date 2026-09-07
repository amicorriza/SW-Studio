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

  // Estados que no cuentan como demanda ni como ingreso: el cliente declinó
  // el recordatorio, o la cita se canceló desde el panel.
  //
  // 'no_show' NO está acá a propósito. Una cita a la que el cliente no llegó
  // sigue siendo una reserva, y es el numerador del KPI de no-show que la
  // medición de la atención real existe para habilitar; excluirla la volvería
  // incalculable. Que su `price` infle el ingreso es la misma sobreestimación
  // que ya hay hoy (toda cita pasada se asume atendida) -- se corrige en el
  // proyecto del dashboard, separando "reservas del período" de "ingresos del
  // período", que hoy son el mismo filtro.
  var EXCLUDED_STATUSES = ['declined', 'cancelled'];
  function isExcluded(status) { return EXCLUDED_STATUSES.indexOf(status) !== -1; }

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

  // ¿Cae esta reserva dentro del período? Solo fecha y modo -- el filtro por
  // estado lo decide cada llamador. Nunca lanza.
  function inPeriod(b, o) {
    try {
      var d = parseBookingDate(b);
      if (!d) return false;
      var dk = ymd(d);
      if (o.from && dk < o.from) return false;
      if (o.to && dk > o.to) return false;
      // Realizado: estrictamente antes de hoy en la zona del negocio.
      if (o.mode === 'realizado' && o.today && dk >= o.today) return false;
      return true;
    } catch (e) {
      return false;
    }
  }

  // Reservas del período aplicando Realizado/Agendado y excluyendo los
  // estados que no cuentan (ver EXCLUDED_STATUSES).
  // 'confirmed' y 'pending' se tratan igual. Aísla por reserva las que no parsean.
  function mFilterPeriod(bookings, opts) {
    var o = opts || {};
    var out = [];
    (bookings || []).forEach(function (b) {
      if (b && isExcluded(b.status)) return;
      if (inPeriod(b, o)) out.push(b);
    });
    return out;
  }

  // Igual que mFilterPeriod pero SIN excluir por estado. Lo necesita
  // mAttendance: la tasa de cancelación no se puede calcular sobre un
  // conjunto del que ya se sacaron las canceladas.
  function mFilterPeriodAll(bookings, opts) {
    var o = opts || {};
    var out = [];
    (bookings || []).forEach(function (b) {
      if (inPeriod(b, o)) out.push(b);
    });
    return out;
  }

  // Mediana. El PDF (§2) la exige como valor principal del tiempo real:
  // "resiste mejor atenciones excepcionalmente largas o cortas que el
  // promedio simple". null con muestra vacía -- nunca NaN.
  function median(nums) {
    var v = (nums || []).filter(function (n) { return Number.isFinite(n); }).slice()
      .sort(function (a, b) { return a - b; });
    if (!v.length) return null;
    var mid = Math.floor(v.length / 2);
    return v.length % 2 ? v[mid] : (v[mid - 1] + v[mid]) / 2;
  }

  // Reparto por estado del período COMPLETO (usa mFilterPeriodAll).
  //
  // Los porcentajes se calculan sobre las citas con marca real de asistencia
  // (atendidas + no llegó), no sobre el total: mientras nadie use la PWA la
  // base es 0 y devuelven null. Dividir por el total daría 0%, que se leería
  // como "no asiste nadie" en vez de "todavía no se mide".
  function mAttendance(allPeriodBookings) {
    var r = { total: 0, atendidas: 0, noShow: 0, canceladas: 0, declinadas: 0, sinMarcar: 0 };
    (allPeriodBookings || []).forEach(function (b) {
      r.total++;
      var s = b && b.status;
      if (s === 'completed') r.atendidas++;
      else if (s === 'no_show') r.noShow++;
      else if (s === 'cancelled') r.canceladas++;
      else if (s === 'declined') r.declinadas++;
      // 'arrived' e 'in_service' son atenciones en curso: todavía no son
      // asistencia cerrada, así que cuentan como sin marcar.
      else r.sinMarcar++;
    });
    var base = r.atendidas + r.noShow;
    r.asistenciaPct = base ? r.atendidas / base : null;
    r.noShowPct = base ? r.noShow / base : null;
    r.cancelPct = r.total ? r.canceladas / r.total : null;
    return r;
  }

  // Qué parte del período tiene asistencia realmente registrada. Es lo que
  // permite migrar sin salto: con cobertura 0 el panel se comporta como
  // antes de la medición, y el pie de nota dice cuánto es medido y cuánto
  // inferido.
  function mAttendanceCoverage(periodBookings) {
    var total = 0, medidas = 0;
    (periodBookings || []).forEach(function (b) {
      total++;
      if (b && (b.status === 'completed' || b.status === 'no_show')) medidas++;
    });
    return { medidas: medidas, total: total, pct: total ? medidas / total : 0 };
  }

  // Ingreso del período. Excluye no_show: el cliente no llegó, no pagó.
  // Las citas sin marcar SÍ suman -- es la misma sobreestimación que ya
  // existía, y mAttendanceCoverage la hace visible en vez de silenciosa.
  function mRevenue(periodBookings) {
    var t = 0;
    (periodBookings || []).forEach(function (b) {
      if (b && b.status === 'no_show') return;
      t += (b && +b.price) || 0;
    });
    return t;
  }

  // Tiempo REAL por servicio, contra lo planificado. Solo entran atenciones
  // efectivamente cerradas (`completed` con `actualDur` > 0): una cita sin
  // marcar no aporta información de duración, y meterla con su `dur`
  // planificado haría que la desviación tendiera a 0 por construcción --
  // justo la conclusión equivocada.
  function mRealTime(periodBookings, opts) {
    var groupBy = (opts && opts.groupBy) === 'cat' ? 'cat' : 'svc';
    var acc = {};
    (periodBookings || []).forEach(function (b) {
      try {
        if (!b || b.status !== 'completed') return;
        var real = +b.actualDur;
        if (!Number.isFinite(real) || real <= 0) return;
        var key = groupBy === 'cat' ? (b.svcCat || '') : (b.svcId || b.svcName || '');
        if (!acc[key]) {
          acc[key] = {
            key: key, label: groupBy === 'cat' ? (b.svcCat || '') : (b.svcName || b.svcId || ''),
            n: 0, nManual: 0, reales: [], planes: [], precios: [],
          };
        }
        var a = acc[key];
        a.n++;
        if (b.durSource === 'manual') a.nManual++;
        a.reales.push(real);
        a.planes.push((+b.dur) || 0);
        a.precios.push((+b.price) || 0);
      } catch (e) { /* aislar */ }
    });

    return Object.keys(acc).map(function (k) {
      var a = acc[k];
      var medianMin = median(a.reales);
      var planMin = median(a.planes);
      var price = median(a.precios);
      return {
        key: a.key, label: a.label, n: a.n, nManual: a.nManual,
        planMin: planMin, medianMin: medianMin, price: price,
        deviationPct: (planMin && medianMin != null) ? (medianMin - planMin) / planMin : null,
        ingresoHoraReal: medianMin ? price / (medianMin / 60) : null,
        ingresoHoraPlan: planMin ? price / (planMin / 60) : null,
      };
    }).sort(function (x, y) { return y.n - x.n; });
  }

  // Muestra mínima para hablar de precio (PDF §6: 20-29 "recomendaciones
  // prudentes"). Bajo eso el módulo devuelve null y la UI no muestra nada.
  var PRICE_SIM_MIN_N = 20;

  // Precio que preservaría la productividad implícita en la configuración
  // (PDF §5: ingreso/hora objetivo x mediana real / 60). Devuelve un RANGO
  // comercial redondeado, nunca un valor exacto: §9 prohíbe que el sistema
  // imponga un precio, y un número al peso se lee como una orden.
  function mPriceSim(row) {
    if (!row) return null;
    var n = +row.n, planMin = +row.planMin, medianMin = +row.medianMin, price = +row.price;
    if (!Number.isFinite(n) || n < PRICE_SIM_MIN_N) return null;
    if (!planMin || !medianMin || !price) return null;
    var objetivoHora = price / (planMin / 60);
    var equivalente = objetivoHora * (medianMin / 60);
    var cien = function (v) { return Math.round(v / 100) * 100; };
    return {
      objetivoHora: objetivoHora,
      equivalente: equivalente,
      rango: [cien(equivalente * 0.95), cien(equivalente * 1.06)],
    };
  }

  // ── Ocupación efectiva (PDF §5: minutos atendidos / minutos disponibles) ──
  //
  // Todo en minutos-desde-medianoche, igual que functions/shared/availability.js
  // y checkConflict() del admin: la comparación es zona-invariante por
  // construcción dentro del mismo día calendario.

  function toMin(hhmm) {
    var m = /^(\d{1,2}):(\d{2})/.exec(String(hhmm || ''));
    if (!m) return null;
    return (+m[1]) * 60 + (+m[2]);
  }

  // Día de semana (0=domingo) de una clave 'YYYY-MM-DD'. Mediodía UTC para
  // que ningún DST corra el día, igual que el resto del módulo.
  function dowOf(key) {
    var d = new Date(key + 'T12:00:00Z');
    return isNaN(d.getTime()) ? null : d.getUTCDay();
  }

  function eachDay(from, to, fn) {
    if (!YMD_RE.test(String(from || '')) || !YMD_RE.test(String(to || ''))) return;
    var key = from, guard = 0;
    while (key <= to && guard++ < 800) {
      fn(key);
      key = addDaysYMD(key, 1);
    }
  }

  // Tramos disponibles de un barbero en un día: su horario menos la colación
  // y menos los bloqueos puntuales. Devuelve [{start,end}] en minutos.
  function freeSpansFor(staffMember, dayKey, blocks) {
    var dow = dowOf(dayKey);
    var day = (dow != null && Array.isArray(staffMember.schedule)) ? staffMember.schedule[dow] : null;
    if (!day || !day.open) return [];
    var start = toMin(day.start), end = toMin(day.end);
    if (start == null || end == null || end <= start) return [];

    var cortes = [];
    if (day.break && day.break.start && day.break.end) {
      cortes.push([toMin(day.break.start), toMin(day.break.end)]);
    }
    (blocks || []).forEach(function (blk) {
      if (!blk || blk.barberId !== staffMember.id) return;
      if (String(blk.date || '').slice(0, 10) !== dayKey) return;
      cortes.push([toMin(blk.start), toMin(blk.end)]);
    });

    var spans = [{ start: start, end: end }];
    cortes.forEach(function (c) {
      if (c[0] == null || c[1] == null || c[1] <= c[0]) return;
      var next = [];
      spans.forEach(function (s) {
        if (c[1] <= s.start || c[0] >= s.end) { next.push(s); return; }
        if (c[0] > s.start) next.push({ start: s.start, end: Math.min(c[0], s.end) });
        if (c[1] < s.end) next.push({ start: Math.max(c[1], s.start), end: s.end });
      });
      spans = next;
    });
    return spans;
  }

  // Barberos activos con horario utilizable. Los activos SIN `schedule` se
  // devuelven aparte en vez de contarse con disponibilidad 0: si entraran al
  // cálculo darían una ocupación absurda (o una división por cero), y el
  // panel debe poder decir "a este le falta configurar el horario".
  function usableStaff(staff) {
    var ok = [], sinHorario = [];
    (staff || []).forEach(function (s) {
      if (!s || s.status !== 'active') return;
      if (!Array.isArray(s.schedule) || !s.schedule.length) { sinHorario.push(s.id); return; }
      ok.push(s);
    });
    return { ok: ok, sinHorario: sinHorario };
  }

  // Minutos que ocupó una reserva: los reales si se midieron, si no los
  // planificados (y en ese caso suman a `estimados`, que el panel reporta).
  function bookedMinutes(b) {
    var real = +b.actualDur;
    if (Number.isFinite(real) && real > 0) return { min: real, estimado: 0 };
    var plan = (+b.dur) || 0;
    return { min: plan, estimado: plan };
  }

  function mOccupancy(periodBookings, staff, blocks, opts) {
    var o = opts || {};
    var u = usableStaff(staff);
    var disponibles = 0;
    eachDay(o.from, o.to, function (dayKey) {
      u.ok.forEach(function (s) {
        freeSpansFor(s, dayKey, blocks).forEach(function (sp) { disponibles += sp.end - sp.start; });
      });
    });

    var atendidos = 0, estimados = 0;
    var activos = {};
    u.ok.forEach(function (s) { activos[s.id] = true; });
    (periodBookings || []).forEach(function (b) {
      try {
        if (!b || !activos[b.barberId]) return;
        if (b.status === 'no_show') return; // no ocupó el sillón
        var m = bookedMinutes(b);
        atendidos += m.min;
        estimados += m.estimado;
      } catch (e) { /* aislar */ }
    });

    return {
      atendidos: atendidos, disponibles: disponibles, estimados: estimados,
      sinHorario: u.sinHorario,
      pct: disponibles > 0 ? atendidos / disponibles : null,
    };
  }

  // Ocupación por día de semana y bloque horario -- las "horas débiles" del
  // PDF (§7 regla 6). Una celda por (dow, hora) con disponibilidad real.
  function mHeatmap(periodBookings, staff, blocks, opts) {
    var o = opts || {};
    var u = usableStaff(staff);
    var celdas = {};
    var key = function (dow, h) { return dow + '|' + h; };
    var touch = function (dow, h) {
      if (!celdas[key(dow, h)]) celdas[key(dow, h)] = { dow: dow, hour: h, ocupados: 0, disponibles: 0 };
      return celdas[key(dow, h)];
    };

    eachDay(o.from, o.to, function (dayKey) {
      var dow = dowOf(dayKey);
      if (dow == null) return;
      u.ok.forEach(function (s) {
        freeSpansFor(s, dayKey, blocks).forEach(function (sp) {
          for (var h = Math.floor(sp.start / 60); h < Math.ceil(sp.end / 60); h++) {
            var lo = Math.max(sp.start, h * 60), hi = Math.min(sp.end, (h + 1) * 60);
            if (hi > lo) touch(dow, h).disponibles += hi - lo;
          }
        });
      });
    });

    var activos = {};
    u.ok.forEach(function (s) { activos[s.id] = true; });
    (periodBookings || []).forEach(function (b) {
      try {
        if (!b || !activos[b.barberId] || b.status === 'no_show') return;
        var d = parseBookingDate(b);
        if (!d) return;
        var dow = dowOf(ymd(d));
        var start = toMin(b.time);
        if (dow == null || start == null) return;
        var mins = bookedMinutes(b).min;
        var end = start + mins;
        for (var h = Math.floor(start / 60); h < Math.ceil(end / 60); h++) {
          var lo = Math.max(start, h * 60), hi = Math.min(end, (h + 1) * 60);
          if (hi > lo && celdas[key(dow, h)]) celdas[key(dow, h)].ocupados += hi - lo;
        }
      } catch (e) { /* aislar */ }
    });

    return Object.keys(celdas).map(function (k) {
      var c = celdas[k];
      c.pct = c.disponibles > 0 ? c.ocupados / c.disponibles : null;
      return c;
    }).sort(function (a, b) { return a.dow - b.dow || a.hour - b.hour; });
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
  // mFilterPeriod, así que acá solo agrega (y por defensa salta los
  // estados excluidos).
  // ingresoHora agrega solo filas con dur>0; null si ninguna la tiene.
  function mByService(periodBookings, opts) {
    var groupBy = (opts && opts.groupBy) || 'svc';
    var groups = {};
    var totalIngreso = 0;
    (periodBookings || []).forEach(function (b) {
      if (!b || isExcluded(b.status)) return;
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
      if (!b || isExcluded(b.status)) return;
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
      if (!b || isExcluded(b.status)) return;
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
    mFilterPeriodAll: mFilterPeriodAll, median: median,
    mAttendance: mAttendance, mAttendanceCoverage: mAttendanceCoverage, mRevenue: mRevenue,
    mRealTime: mRealTime, mPriceSim: mPriceSim, PRICE_SIM_MIN_N: PRICE_SIM_MIN_N,
    mOccupancy: mOccupancy, mHeatmap: mHeatmap,
    mMonthlySeries: mMonthlySeries, mWeeklySeries: mWeeklySeries, mByService: mByService,
    mByBarber: mByBarber, mNewVsReturning: mNewVsReturning, mMonthlyExportRows: mMonthlyExportRows,
    svgLine: svgLine, toCSV: toCSV
  };

  if (typeof module === 'object' && module.exports) module.exports = api; // node --test
  else root.SWMetrics = api;                                              // admin browser
})(typeof globalThis !== 'undefined' ? globalThis : this);
