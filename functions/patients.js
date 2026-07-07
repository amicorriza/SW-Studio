// functions/patients.js — lógica pura de upsert de clientes y conteo Club SW.
// Sin dependencias de Firebase Admin: fácil de testear, se usa desde index.js.
'use strict';

function buildPatientUpsert(existingPatient, booking) {
  const visit = {
    code: booking.code, date: booking.date || booking.createdAt || '',
    svcId: booking.svcId || '', svcName: booking.svcName || '',
    price: booking.price || 0, barberName: booking.barberName || '',
    club: booking.club || 'guest',
  };
  if (!existingPatient) {
    return {
      name: booking.name || 'Sin nombre', email: booking.email, phone: booking.phone || '',
      notes: '', club: booking.club || 'guest', visits: [visit],
      createdAt: booking.createdAt || new Date().toISOString(),
    };
  }
  const visits = existingPatient.visits || [];
  const already = visits.some(v => v.code === booking.code);
  return {
    ...existingPatient,
    club: booking.club === 'member' ? 'member' : existingPatient.club,
    visits: already ? visits : [...visits, visit],
  };
}

function countClubVisits(bookings, email) {
  const key = (email || '').toLowerCase();
  const visitCount = (bookings || []).filter(
    b => (b.email || '').toLowerCase() === key && b.club === 'member'
  ).length;
  let benefitReached = '';
  if (visitCount === 10) benefitReached = 'premium';
  if (visitCount === 20) benefitReached = 'asesoria';
  return { visitCount, benefitReached };
}

module.exports = { buildPatientUpsert, countClubVisits };
