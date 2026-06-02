// public/js/data.js — capa de datos sobre Firestore. Expone window.SWData.
//
// STUB / PENDIENTE DE IMPLEMENTAR — ver el plan, Task 4.2:
//   docs/superpowers/plans/2026-06-02-scissor-white-firebase-migration.md
//
// Estas funciones reemplazan los 6 puntos de localStorage del index.html.
// Las firmas son las definitivas; el cuerpo se completa al ejecutar el plan.
import { db } from './firebase-init.js';

async function loadAdmin()        { throw new Error('SWData.loadAdmin no implementado (Task 4.2)'); }
async function saveAdmin(D)       { throw new Error('SWData.saveAdmin no implementado (Task 4.2)'); }
async function getBookings()      { throw new Error('SWData.getBookings no implementado (Task 4.2)'); }
async function saveBookings(arr)  { throw new Error('SWData.saveBookings no implementado (Task 4.2)'); }
async function createBooking(obj) { throw new Error('SWData.createBooking no implementado (Task 4.2)'); }

window.SWData = { loadAdmin, saveAdmin, getBookings, saveBookings, createBooking };
export { loadAdmin, saveAdmin, getBookings, saveBookings, createBooking };
