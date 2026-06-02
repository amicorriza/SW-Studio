// seed/data.js — fuente única de los datos iniciales (extraídos del index.html v15).
'use strict';

const services = [
  { id:'vis',   name:'Asesoría con Visagismo',         cat:'a', dur:120, price:55000, tag:'Premium', ts:'s', status:'active', desc:'Análisis facial + corte ideal.', photo:'' },
  { id:'vis-b', name:'Asesoría Visagismo + Barba',      cat:'a', dur:120, price:65000, tag:'Premium', ts:'s', status:'active', desc:'Asesoría completa en corte y barba.', photo:'' },
  { id:'promo', name:'Promo Mayo — Corte',              cat:'c', dur:45,  price:14000, tag:'Promo',   ts:'p', status:'active', desc:'Corte + lavado con masaje craneal.', photo:'' },
  { id:'nino',  name:'Corte Niño (2-10 años)',          cat:'c', dur:45,  price:16000, tag:'',        ts:'',  status:'active', desc:'Corte para niños.', photo:'' },
  { id:'lp',    name:'Corte + Lavado Premium',          cat:'c', dur:50,  price:21000, tag:'',        ts:'',  status:'active', desc:'Corte + lavado Reuzel.', photo:'' },
  { id:'fm',    name:'Mantención Fade + Lavado',        cat:'c', dur:30,  price:12000, tag:'',        ts:'',  status:'active', desc:'Solo lados.', photo:'' },
  { id:'mu',    name:'Mullet y derivados',              cat:'c', dur:60,  price:23000, tag:'',        ts:'',  status:'active', desc:'Combinación largos y cortos.', photo:'' },
  { id:'mub',   name:'Mullet + Barba',                  cat:'c', dur:70,  price:33000, tag:'',        ts:'',  status:'active', desc:'Mullet + perfilado de barba.', photo:'' },
  { id:'tj',    name:'Corte con tijeras',               cat:'c', dur:75,  price:25000, tag:'',        ts:'',  status:'active', desc:'Corte trabajado con tijeras.', photo:'' },
  { id:'cb',    name:'Corte + Barba simple',            cat:'c', dur:60,  price:23000, tag:'',        ts:'',  status:'active', desc:'Combo clásico.', photo:'' },
  { id:'cbtc',  name:'Corte + Barba toallas calientes', cat:'c', dur:75,  price:30000, tag:'',        ts:'',  status:'active', desc:'Corte + perfilado premium.', photo:'' },
  { id:'tjbt',  name:'Tijeras + Barba toalla',          cat:'c', dur:90,  price:40000, tag:'',        ts:'',  status:'active', desc:'Corte tijeras + perfilado premium.', photo:'' },
  { id:'tjb',   name:'Tijeras + Barba simple',          cat:'c', dur:70,  price:35000, tag:'',        ts:'',  status:'active', desc:'Corte tijeras + perfilado.', photo:'' },
  { id:'ucm',   name:'Undercut mujer',                  cat:'c', dur:35,  price:8000,  tag:'',        ts:'',  status:'active', desc:'Degradado de nuca.', photo:'' },
  { id:'ras',   name:'Rasurado completo',               cat:'c', dur:30,  price:14000, tag:'',        ts:'',  status:'active', desc:'Rasurado con toallas.', photo:'' },
  { id:'bs',    name:'Perfilado barba simple',          cat:'b', dur:30,  price:13000, tag:'',        ts:'',  status:'active', desc:'Recorte y definición.', photo:'' },
  { id:'btc',   name:'Perfilado barba toallas',         cat:'b', dur:40,  price:23000, tag:'',        ts:'',  status:'active', desc:'Toallas + afeitado.', photo:'' },
  { id:'rbs',   name:'Rasurado + barba simple',         cat:'b', dur:45,  price:15000, tag:'',        ts:'',  status:'active', desc:'Rasurado + perfilado.', photo:'' },
  { id:'rbtc',  name:'Rasurado + barba toalla',         cat:'b', dur:60,  price:20000, tag:'',        ts:'',  status:'active', desc:'Rasurado + toallas + perfilado.', photo:'' },
];

// schedule indexado por Date.getDay(): 0=Dom (null=cerrado) … 6=Sáb.
const staff = [
  { id:'victoria', name:'Victoria', role:'Barbera Senior · Visagismo', days:'Mar — Sáb', bio:'4 años de experiencia, especializada en asesoría con visagismo.', status:'active', photo:'',
    schedule:[null,{open:false},{open:true,start:'10:00',end:'20:00'},{open:true,start:'10:00',end:'20:00'},{open:true,start:'10:00',end:'20:00'},{open:true,start:'10:00',end:'20:00'},{open:true,start:'10:00',end:'17:00'}] },
  { id:'felipe', name:'Felipe', role:'Especialista en degradados', days:'Lun — Sáb', bio:'2 años perfeccionando degradados comprimidos con textura.', status:'active', photo:'',
    schedule:[null,{open:true,start:'10:00',end:'20:00'},{open:true,start:'10:00',end:'20:00'},{open:true,start:'10:00',end:'20:00'},{open:true,start:'10:00',end:'20:00'},{open:true,start:'10:00',end:'20:00'},{open:true,start:'10:00',end:'17:00'}] },
  { id:'esteban', name:'Esteban', role:'Barbero', days:'Lun — Vie', bio:'', status:'active', photo:'',
    schedule:[null,{open:true,start:'10:00',end:'20:00'},{open:true,start:'10:00',end:'20:00'},{open:true,start:'10:00',end:'20:00'},{open:true,start:'10:00',end:'20:00'},{open:true,start:'10:00',end:'20:00'},{open:false}] },
  { id:'ariel', name:'Ariel', role:'Barbero', days:'Lun — Vie', bio:'', status:'active', photo:'',
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

module.exports = { services, staff, businessInfo };
