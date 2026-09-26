// El Once del cierre es un INGRESO aparte (efectivo por regalos): resumenMes lo informa
// en `once` sin cambiar `efectivo` (que lo sigue incluyendo, por compatibilidad).
const {test}=require('node:test');
const assert=require('node:assert/strict');
const C=require('../cierre-cuentas.js');

test('resumenMes informa el Once del mes por separado',()=>{
  const [a,b]=C.turnos('2026-09-08');
  const dia={cierres:[
    {turno:a,total_turno:500000,mp:200000,efectivo:292000,once_monto:8000},
    {turno:b,total_turno:300000,mp:100000,efectivo:185000,once_monto:15000},
  ]};
  const r=C.resumenMes({'2026-09-08':dia,'2026-09-09':{cierres:[{turno:a,total_turno:100000,mp:0,efectivo:100000,once_monto:0}]}},'2026-09-08','2026-09-09');
  assert.equal(r.once,23000);
  assert.equal(r.efectivo,600000); // total − MP: sigue incluyendo el Once
  assert.equal(r.efectivo-r.once,577000); // efectivo sin Once
});
test('sin cierres el Once da cero',()=>{
  assert.equal(C.resumenMes({},'2026-09-01','2026-09-03').once,0);
});
