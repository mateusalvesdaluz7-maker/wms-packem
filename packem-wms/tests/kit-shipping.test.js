const test=require('node:test');
const assert=require('node:assert/strict');
const schedule=require('../kit-shipping-core.js');

test('liga a data da coluna vertical a cada lote, inclusive a primeira linha do dia',()=>{
  const item=(str,x,y,rotated=false)=>({str,transform:rotated?[0,6,-6,0,x,y]:[6,0,0,6,x,y]});
  const items=[
    item('LOTE',211,559),
    item('28/09/26 segunda-feira',139,455,true),
    item('29/09/26 terça-feira',139,336,true),
    item('30/09/26 quarta-feira',139,239,true),
    item('01/10/26 quinta-feira',139,150,true),
    item('02/10/26 sexta-feira',139,48,true),
    item('04.09/26',205,490),
    item('78.09/26',205,408),
    item('98.09/26',205,299),
    item('111.10/26',205,148),
    item('30.10/26',205,107)
  ];
  const result=schedule.parsePage(items,[580,574,566,554,417,307,225,129,20],1);
  assert.deepEqual(result.entries.map(x=>[x.lot,x.date]),[
    ['04.09/26','2026-09-28'],
    ['78.09/26','2026-09-29'],
    ['98.09/26','2026-09-30'],
    ['111.10/26','2026-10-01'],
    ['30.10/26','2026-10-02']
  ]);
  assert.equal(result.unmatched,0);
});

test('recusa data inválida e não cria data para lote fora da programação',()=>{
  assert.equal(schedule.dateISO('31/09/26'), '');
  const result=schedule.summarize([{entries:[{lot:'111.10/26',date:'2026-10-01'}],lots:1,dates:1,unmatched:0}]);
  assert.deepEqual(result.byLot['111.10/26'],['2026-10-01']);
  assert.equal(result.byLot['117.10/26'],undefined);
});
