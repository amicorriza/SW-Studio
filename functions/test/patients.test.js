const test = require('node:test');
const assert = require('node:assert');
const { buildPatientUpsert, countClubVisits } = require('../patients.js');

const booking = {
  code:'SW-AB12345', name:'Juan Pérez', email:'Juan@Mail.com', phone:'+56912345678',
  svcId:'lp', svcName:'Corte + Lavado Premium', price:21000, barberName:'Felipe',
  club:'member', createdAt:'2026-06-10T00:00:00.000Z',
};

test('buildPatientUpsert crea un cliente nuevo si no existe', () => {
  const p = buildPatientUpsert(null, booking);
  assert.strictEqual(p.name, 'Juan Pérez');
  assert.strictEqual(p.email, 'Juan@Mail.com');
  assert.strictEqual(p.club, 'member');
  assert.strictEqual(p.visits.length, 1);
  assert.strictEqual(p.visits[0].code, 'SW-AB12345');
});

test('buildPatientUpsert agrega una visita a un cliente existente', () => {
  const existing = { id:'pat_1', name:'Juan Pérez', email:'juan@mail.com', phone:'', notes:'', club:'guest', visits:[{code:'SW-OLD01'}], createdAt:'2026-01-01T00:00:00.000Z' };
  const p = buildPatientUpsert(existing, booking);
  assert.strictEqual(p.visits.length, 2);
  assert.strictEqual(p.club, 'member'); // sube a member porque esta reserva es club:member
});

test('buildPatientUpsert no duplica una visita ya registrada (mismo code)', () => {
  const existing = { id:'pat_1', name:'Juan Pérez', email:'juan@mail.com', phone:'', notes:'', club:'member', visits:[{code:'SW-AB12345'}], createdAt:'2026-01-01T00:00:00.000Z' };
  const p = buildPatientUpsert(existing, booking);
  assert.strictEqual(p.visits.length, 1);
});

test('countClubVisits cuenta solo reservas club:member del email (case-insensitive)', () => {
  const bookings = [
    { email:'juan@mail.com', club:'member' },
    { email:'JUAN@MAIL.COM', club:'member' },
    { email:'juan@mail.com', club:'guest' },
    { email:'otro@mail.com', club:'member' },
  ];
  const { visitCount, benefitReached } = countClubVisits(bookings, 'juan@mail.com');
  assert.strictEqual(visitCount, 2);
  assert.strictEqual(benefitReached, '');
});

test('countClubVisits marca el beneficio al llegar a 10 y 20', () => {
  const tenBookings = Array.from({ length: 10 }, () => ({ email:'ana@mail.com', club:'member' }));
  assert.strictEqual(countClubVisits(tenBookings, 'ana@mail.com').benefitReached, 'premium');
  const twentyBookings = Array.from({ length: 20 }, () => ({ email:'ana@mail.com', club:'member' }));
  assert.strictEqual(countClubVisits(twentyBookings, 'ana@mail.com').benefitReached, 'asesoria');
});
