// seed/data.js — fuente única de los datos iniciales (extraídos del index.html v20).
'use strict';

const services = [
  { id:'vis',     name:'Asesoría con VISAGISMO',                                cat:'a', dur:120, price:55000, tag:'Premium', ts:'s', status:'active', desc:'Análisis de rostro y estilo de vida. Incluye corte, perfilado de cejas, masaje, lavado capilar y cortesía a elección.', photo:'' },
  { id:'vis-b',   name:'Asesoría con VISAGISMO + Barba simple',                 cat:'a', dur:120, price:65000, tag:'Premium', ts:'s', status:'active', desc:'Visagismo aplicado a corte y barba según perfil facial, mentón y nariz.', photo:'' },
  { id:'adulto',  name:'Corte de cabello adulto',                              cat:'c', dur:45,  price:18000, tag:'',        ts:'',  status:'active', desc:'Corte + perfilado de ceja + lavado con masaje capilar + asesoría exprés. Cortesía incluida.', photo:'' },
  { id:'nino',    name:'Corte de cabello niño (2-10 años)',                     cat:'c', dur:45,  price:16000, tag:'',        ts:'',  status:'active', desc:'Corte especializado para niños.', photo:'' },
  { id:'lavado-p',name:'Corte de cabello + lavado premium',                     cat:'c', dur:50,  price:21000, tag:'',        ts:'',  status:'active', desc:'Lavado Reuzel: shampoo, exfoliación capilar y acondicionador.', photo:'' },
  { id:'tj-b',    name:'Corte con tijeras + barba simple',                      cat:'c', dur:70,  price:35000, tag:'',        ts:'',  status:'active', desc:'Corte con tijera y textura + perfilado de barba.', photo:'' },
  { id:'tijeras', name:'Corte con tijeras (longitud media/larga)',              cat:'c', dur:60,  price:25000, tag:'',        ts:'',  status:'active', desc:'Mullet, moicano, mod cut, shaggy y warrior cut. Incluye lavado, masaje capilar, perfilado de cejas y cortesía.', photo:'' },
  { id:'cb',      name:'Corte de cabello + barba simple',                       cat:'c', dur:60,  price:23000, tag:'',        ts:'',  status:'active', desc:'Combo clásico corte + barba.', photo:'' },
  { id:'tj-bt',   name:'Corte con tijeras + perfilado de barba con toallas caliente', cat:'c', dur:90, price:40000, tag:'',  ts:'',  status:'active', desc:'Corte tijeras + perfilado premium con toallas calientes.', photo:'' },
  { id:'cb-tc',   name:'Corte de cabello + barba toallas calientes',            cat:'c', dur:75,  price:30000, tag:'',        ts:'',  status:'active', desc:'Corte + perfilado premium con toallas calientes.', photo:'' },
  { id:'uc-m',    name:'Undercut mujer',                                        cat:'c', dur:35,  price:8000,  tag:'',        ts:'',  status:'active', desc:'Degradado de nuca y rapados con diseño.', photo:'' },
];

// retiredServices — documentos que salían del catálogo v20 (2026-07-28) pero
// que NUNCA se borran de Firestore: bookings.svcId, el conteo Club SW y
// "Servicios más demandados" siguen apuntando a estos ids. Quedan con
// status:'inactive' para que refreshCatalog()/DS los excluyan del sitio y del
// widget sin destruir el historial. Dos grupos:
//   - 9 servicios retirados del catálogo (promo/fm/mu/mub/ras + toda la
//     categoría "Barba": bs/btc/rbs/rbtc).
//   - 6 ids renombrados (el servicio sigue existiendo, pero bajo un id nuevo:
//     lp→lavado-p, tj→tijeras, tjb→tj-b, tjbt→tj-bt, cbtc→cb-tc, ucm→uc-m).
const retiredServices = [
  { id:'promo', name:'Promo Mayo — Corte',              cat:'c', dur:45,  price:14000, tag:'',        ts:'',  status:'inactive', desc:'Corte + lavado con masaje craneal + cortesía a elección.', photo:'' },
  { id:'fm',    name:'Mantención Fade + Lavado',        cat:'c', dur:30,  price:12000, tag:'',        ts:'',  status:'inactive', desc:'Solo lados. Máx. 2 semanas desde último corte.', photo:'' },
  { id:'mu',    name:'Mullet y derivados',              cat:'c', dur:60,  price:23000, tag:'',        ts:'',  status:'inactive', desc:'Estilo que combina largos y cortos con precisión.', photo:'' },
  { id:'mub',   name:'Mullet + Barba',                  cat:'c', dur:70,  price:33000, tag:'',        ts:'',  status:'inactive', desc:'Mullet completo más perfilado de barba.', photo:'' },
  { id:'ras',   name:'Rasurado completo',               cat:'c', dur:30,  price:14000, tag:'',        ts:'',  status:'inactive', desc:'Rasurado con toallas.', photo:'' },
  { id:'bs',    name:'Perfilado barba simple',          cat:'b', dur:30,  price:13000, tag:'',        ts:'',  status:'inactive', desc:'Recorte y definición.', photo:'' },
  { id:'btc',   name:'Perfilado barba toallas',         cat:'b', dur:40,  price:23000, tag:'',        ts:'',  status:'inactive', desc:'Toallas + afeitado.', photo:'' },
  { id:'rbs',   name:'Rasurado + barba simple',         cat:'b', dur:45,  price:15000, tag:'',        ts:'',  status:'inactive', desc:'Rasurado + perfilado.', photo:'' },
  { id:'rbtc',  name:'Rasurado + barba toalla',         cat:'b', dur:60,  price:20000, tag:'',        ts:'',  status:'inactive', desc:'Rasurado + toallas + perfilado.', photo:'' },
  { id:'lp',    name:'Corte + Lavado Premium',          cat:'c', dur:50,  price:21000, tag:'',        ts:'',  status:'inactive', desc:'Corte + lavado Reuzel.', photo:'' },
  { id:'tj',    name:'Corte con tijeras',               cat:'c', dur:75,  price:25000, tag:'',        ts:'',  status:'inactive', desc:'Corte trabajado con tijeras.', photo:'' },
  { id:'tjb',   name:'Tijeras + Barba simple',          cat:'c', dur:70,  price:35000, tag:'',        ts:'',  status:'inactive', desc:'Corte tijeras + perfilado.', photo:'' },
  { id:'tjbt',  name:'Tijeras + Barba toalla',          cat:'c', dur:90,  price:40000, tag:'',        ts:'',  status:'inactive', desc:'Corte tijeras + perfilado premium.', photo:'' },
  { id:'cbtc',  name:'Corte + Barba toallas calientes', cat:'c', dur:75,  price:30000, tag:'',        ts:'',  status:'inactive', desc:'Corte + perfilado premium.', photo:'' },
  { id:'ucm',   name:'Undercut mujer',                  cat:'c', dur:35,  price:8000,  tag:'',        ts:'',  status:'inactive', desc:'Degradado de nuca.', photo:'' },
];

// schedule indexado por Date.getDay(): 0=Dom (null=cerrado) … 6=Sáb.
const staff = [
  { id:'victoria', name:'Victoria', role:'Barbera Senior · Visagismo', days:'Lun — Sáb', bio:'4 años de experiencia, especializada en asesoría con visagismo.', status:'active', photo:'/assets/barbero-victoria.jpg',
    schedule:[null,{open:true,start:'10:00',end:'20:00'},{open:true,start:'10:00',end:'20:00'},{open:true,start:'10:00',end:'20:00'},{open:true,start:'10:00',end:'20:00'},{open:true,start:'10:00',end:'20:00'},{open:true,start:'10:00',end:'17:00'}] },
  { id:'esteban', name:'Esteban', role:'Barbero', days:'Lun — Vie', bio:'', status:'inactive', photo:'',
    schedule:[null,{open:true,start:'10:00',end:'20:00'},{open:true,start:'10:00',end:'20:00'},{open:true,start:'10:00',end:'20:00'},{open:true,start:'10:00',end:'20:00'},{open:true,start:'10:00',end:'20:00'},{open:false}] },
  { id:'ariel', name:'Ariel', role:'Barbero', days:'Lun — Vie', bio:'', status:'inactive', photo:'',
    schedule:[null,{open:true,start:'10:00',end:'20:00'},{open:true,start:'10:00',end:'20:00'},{open:true,start:'10:00',end:'20:00'},{open:true,start:'10:00',end:'20:00'},{open:true,start:'10:00',end:'20:00'},{open:false}] },
];

const businessInfo = {
  name:'Scissor White - SW Studio',
  addr:'Cochrane 635, Of. 303, Torre B, Concepción',
  phone:'+56 9 8251 4114',
  ig:'@scissorwhite.cl',
  slogan:'Más que cortes, creamos identidad',
  desc:'En SCISSOR WHITE STUDIO el servicio se vive con intención.',
  lat:-36.8270, lng:-73.0444,
};

module.exports = { services, retiredServices, staff, businessInfo };
