// functions/shared/license.js
//
// Interruptor de suspensión del servicio por falta de pago (spec
// 2026-10-05-suspension-servicio-design.md). La fuente es license/main, que
// NINGÚN cliente puede escribir (firestore.rules: write false) -- ni siquiera
// el admin del salón. Va aparte de businessInfo a propósito: saveAdmin()
// reescribe businessInfo/main entero y borraría la marca al primer guardado.
//
// Regla única en todas las capas: ausente o desconocido = ACTIVO. Así
// desplegar esto no cambia nada hasta que Aldo cree el documento, y un typo
// en la consola no apaga producción.
//
// Copia deliberada en public/js/data.js (normalizeLicense): el navegador no
// puede importar este archivo. Cualquier cambio va en las dos.
'use strict';

const LICENSE_STATUSES = ['active', 'warning', 'suspended'];
const FECHA_RE = /^\d{4}-\d{2}-\d{2}$/;

function normalizeLicense(data) {
  const d = data && typeof data === 'object' ? data : {};
  return {
    status: LICENSE_STATUSES.indexOf(d.status) !== -1 ? d.status : 'active',
    message: typeof d.message === 'string' ? d.message : '',
    suspendAt: typeof d.suspendAt === 'string' && FECHA_RE.test(d.suspendAt) ? d.suspendAt : '',
  };
}

function isSuspended(lic) {
  return !!lic && lic.status === 'suspended';
}

module.exports = { LICENSE_STATUSES, normalizeLicense, isSuspended };
