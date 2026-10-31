# Scissor White — Servicios por profesional

- **Fecha:** 2026-10-31
- **Alcance:** `functions/shared/staffServices.js` (nuevo), `functions/createBooking.js`, `functions/index.js` (`adminSaveBooking`), `public/js/booking-widget.js`, `public/home.html`, `public/admin/index.html`.
- **Sin cambios en:** `firestore.rules`, `public/js/data.js`, `mirrorStaffPublic`. No requiere migración.

## Objetivo

No todos los barberos prestan todos los servicios. La administradora define en la ficha de cada uno qué presta, y al elegir un servicio solo aparecen quienes pueden darlo, tanto en la web como en la Agenda del panel. Un cliente no puede reservar con alguien no calificado.

## Modelo

`staff/{id}.serviceIds`, opcional:

| Valor | Significado |
|---|---|
| ausente o `null` | Presta **todos**, incluidos los que se agreguen después |
| lista | Presta **solo** esos |
| `[]` | No presta ninguno (no aparece para reservar) |

Ausente = todos porque es el estado de toda ficha existente: desplegar no cambia nada hasta que el negocio configure una lista. Un servicio nuevo no entra solo a una lista: la falla segura es que no se ofrezca, no que lo tome alguien no calificado.

No se guarda "todos" como lista completa: quedaría desactualizada con el primer servicio nuevo.

## Dónde se hace cumplir

`canPerformService()` en `functions/shared/staffServices.js` es la fuente. El widget y el panel tienen copias deliberadas (son `<script>` plano, sin bundler). Esas copias solo evitan ofrecer lo que no corresponde; lo que impide reservar está en el servidor.

- **`createBooking`:** rechaza a un profesional que no presta el servicio con `failed-precondition` y `details.reason = 'barber-not-qualified'`. Se revisa antes que el horario, porque es el motivo real. El camino `'any'` solo considera a quienes lo prestan.
- **`adminSaveBooking`:** mismo rechazo para un cruce **nuevo**. Una cita que ya tenía ese cruce se puede seguir editando (`canAssignBooking`): si a un barbero le quitan un servicio con citas agendadas, bloquearlas las dejaría imposibles de reprogramar.

## Widget

- Al elegir servicio, el paso 2 muestra solo a quienes lo prestan; si queda uno, se preselecciona.
- Cambiar de servicio suelta al barbero si ya no califica, y siempre suelta una preselección automática, porque fue para el servicio anterior. Una elección del cliente que sigue siendo válida se respeta.
- Cambiar de servicio limpia la hora elegida: la duración cambió.
- Un servicio que nadie presta no se ofrece en el paso 1.
- Si el servidor rechaza por `barber-not-qualified` (la lista cambió con el widget abierto), se recarga el catálogo y se vuelve al paso 2 con el motivo, no con el error genérico de conexión.
- Falla abierto: sin catálogo o sin lista, se ofrece todo.

## Panel

- **Ficha de Personal:** "Todos, incluidos los que se agreguen después" o checklist por categoría. Al desmarcar "Todos" se parte con todo marcado, porque lo normal es quitar pocos. Sin nada marcado se advierte que no aparecerá para reservar.
- **Tarjeta:** resume "Todos los servicios" o "Presta N de M servicios".
- **Modal de cita:** el select de barberos se filtra por servicio. Una cita existente conserva a su profesional aunque ya no preste el servicio, con un aviso.
- **Servicios retirados:** no se listan en la ficha, pero su asignación se conserva por si se reactivan.

### Avisos para que nada falle en silencio

- Servicio activo que nadie presta: marca "Sin profesional" en la tabla de Servicios, porque desaparece de la web.
- Servicio nuevo con profesionales de lista propia: el alta nombra a quienes no lo recibieron.
- Quitarle a alguien un servicio con citas futuras: se avisa cuántas son. Las citas no se tocan.

## Decisiones

- **Sin excepción manual en el panel.** No hay un "sobrecupo" para saltarse la calificación. Para una excepción puntual se asigna el servicio en la ficha.
- **El filtro es por servicio, no al revés.** Elegir barbero no filtra servicios: el orden del widget y del modal es servicio y después barbero.
- **El barbero no ve ni edita su lista en la PWA.** La configura la administradora.

## Pruebas

- `functions/test/staffServices.test.js` y `functions/test/createBooking.test.js`: reglas puras.
- `tests/browser/servicios-por-barbero.mjs`: lo que pintan widget y panel.
- `tests/e2e/callables.mjs`: cadena real contra el emulador (lista → espejo → rechazo de los callables).

## Despliegue

`createBooking`, `adminSaveBooking` y hosting, en cualquier orden. Sin listas configuradas el comportamiento es idéntico al actual. Si el espejo llegara a estar desactualizado, el widget ofrecería de más y el servidor rechazaría igual.
