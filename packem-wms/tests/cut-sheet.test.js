const test=require('node:test');
const assert=require('node:assert/strict');
const cut=require('../cut-sheet-core.js');
const catalog=require('../cut-catalog.json').items;

test('interpreta número com vírgula ou ponto decimal sem multiplicar por mil',()=>{
  assert.equal(cut.num('1,808'),1.808);
  assert.equal(cut.num('1.808'),1.808);
  assert.equal(cut.num('0,080'),0.08);
});

test('extrai AP, lote, quantidade, OPs e materiais da composição',()=>{
  const pages=[
    'CLIENTE: CARGILL DATA DE ENTREGA DO KIT:\n50\nFITEC: AP 1184 (00) QTDE PEÇAS:\nLOTE: 78.09/26\nOP:04681501001\nOP:04681501002',
    'FITEC: AP 1184 (00)\nCLIENTE:CARGILL\nCOR / TECIDO:BRANCO PP\nOPERAÇÃO COMPOSIÇÃO QTDE PESO (kg) MATÉRIA PRIMA\nCORPO 1 1,26 X 3,60 0,708 TB 156G X 360 CM BR\nALÇA 4 1,04 0,116 ALÇA 1000 KGF 28 G CARIJÓ VERDE\nFUNDO 1 0,97 X 0,97 0,132 TP 140 G X 97 CM BR\nLINER C/SOLDA 1 2,55 X 1,80 0,338 LINER 180 CM X 0,080 MM TRANSPARENTE 100% VIRGEM\nPESO TEÓRICO 1,486'
  ];
  const s=cut.extract(pages);
  assert.equal(s.ap,'1184');assert.equal(s.client,'CARGILL');assert.equal(s.quantity,50);
  assert.deepEqual(s.operations,['04681501001','04681501002']);
  assert.equal(s.rows.length,4);assert.equal(s.rows[1].piecesPerBag,4);
  assert.equal(s.rows[1].lengthPerPiece,1.04);
  assert.equal(cut.groups(s).length,4);
});

test('mantém quantidade e materiais quando a ficha não informa números de OP',()=>{
  const pages=[
    'CLIENTE: CARGILL\n50\nFITEC: AP 1184 (00) QTDE PEÇAS:\nLOTE: 78.09/26',
    'FITEC: AP 1184 (00)\nOPERAÇÃO COMPOSIÇÃO QTDE PESO (kg) MATÉRIA PRIMA\nFUNDO 1 0,97 X 0,97 0,132 TP 140 G X 97 CM BR\nPESO TEÓRICO 0,132'
  ];
  const sheet=cut.extract(pages);
  assert.equal(sheet.quantity,50);
  assert.equal(sheet.rows.length,1);
  assert.equal(sheet.rows[0].op,'');
});

test('regra confirmada usa 0303550015 para TP 140 x 97',()=>{
  const r=cut.recommend({description:'TP 140 G X 97 CM BR'},catalog,'PP');
  assert.equal(r.code,'0303550015');assert.equal(r.confirmed,true);
});

test('AP 1184 distingue código existente de medida incompatível no topo',()=>{
  const material=catalog.find(x=>x.code==='0303480120');
  assert.ok(material);
  assert.match(material.description,/65CM/);
  const result=cut.score('TBL 48 + 12 G X 97 CM BR',material.description,'PP');
  assert.ok(result.score<0);
  assert.ok(result.why.some(reason=>/Largura|medida/.test(reason)));
});

test('liner transparente 100% virgem não escolhe leitoso nem soldado',()=>{
  const r=cut.recommend({description:'LINER 180 CM X 0,080 MM TRANSPARENTE 100% VIRGEM'},catalog,'PP');
  assert.equal(r.candidates[0].code,'0303440085');
  assert.ok(r.candidates.every(x=>!(/LEITOSO|C\/SOLDA|CORTADO|SOLDADO/i).test(x.description)));
});

test('alça carijó verde não aceita branca ou alça pronta cortada',()=>{
  const source='ALÇA 1000 KGF 28 G CARIJÓ VERDE';
  assert.ok(cut.score(source,'ALCA PP 1000KGF 70MM BRANCA','PP').score<0);
  assert.ok(cut.score(source,'ALCA C.1000KGF 104CM AU.24CM AC.28CM CARIJO VERDE','PP').score<0);
  assert.ok(cut.score(source,'ALCA PP 1000KGF 70MM CARIJO VERDE','PP').score>0);
});

test('siglas BR, CMA, CVD e CAM preservam a cor da ficha',()=>{
  assert.equal(cut.properties('ALÇA 1000 BR').color,'BR');
  assert.equal(cut.properties('ALÇA 1000 CMA').color,'CMA');
  assert.equal(cut.properties('ALÇA 1000 CVD').color,'CVD');
  assert.equal(cut.properties('ALÇA 1000 CAM').color,'CAM');
  assert.ok(cut.score('ALÇA 1000 CVD','ALCA PP 1000KGF 70MM CARIJO AMARELA','PP').score<0);
});

test('não mistura laminado plano e tubular',()=>{
  assert.ok(cut.score('TBL 48 + 12 G X 97 CM BR','TEC.PLANO PP LAM.48+12G 97CM BRANCO','PP').score<0);
});

test('identifica SAIA e CADARÇO SAIA como itens distintos na AP 208',()=>{
  const sheet=cut.extract([
    'FITEC: AP 208 (07) QTDE PEÇAS: 5000\nLOTE: 117.10/26',
    'OPERAÇÃO COMPOSIÇÃO QTDE MEDIDAS PESO (kg) MATÉRIA PRIMA\nSAIA 1 4,02 X 0,97 0,235 TPL 48 + 12 G X 97 CM BR\nCADARÇO SAIA 1 1,40 0,006 CADARÇO 14 MM 4 G BR\nPESO TEÓRICO 1,500'
  ]);
  assert.deepEqual(sheet.rows.map(row=>row.label),['SAIA','CADARÇO SAIA']);
  assert.deepEqual(sheet.rows.map(row=>row.stepKey),['saia','cadarco_saia']);
});

test('lê QTDE (UN) pelo número da operação mesmo quando está na linha anterior',()=>{
  const page='ITEM DESCRIÇÃO NOMINAL QTDE (UN) OPERAÇÃO\nP Largura m 3,96 5000 OP:04690601001\nComprimento m 1,04\nP 20000\nALÇA Alça Costurada m 0,28 OP:04690601002\nCADARÇO P 5000\nLargura m 0,14\nSAIA P OP:04690601007';
  assert.deepEqual(cut.operationQuantitiesFromPage(page),{
    '04690601001':5000,'04690601002':20000,'04690601007':5000
  });
});

test('AP 1184 calcula o consumo pela geometria e massa linear, sem somar pesos arredondados',()=>{
  const s=cut.extract([
    'CLIENTE: CARGILL\n50\nFITEC: AP 1184 (00) QTDE PEÇAS:\nLOTE: 78.09/26',
    'OPERAÇÃO COMPOSIÇÃO QTDE MEDIDAS PESO (kg) MATÉRIA PRIMA\nVÁLVULA FUNDO 1 0,75 X 0,65 0,059 TBL 48 + 12 G X 65 CM BR\nCADARÇO VÁLVULA FUNDO 1 1,20 0,005 CADARÇO 14 MM 4 G BR\nCADARÇO FLAP 1 1,60 0,006 CADARÇO 14 MM 4 G BR\nVÁLVULA TOPO 1 0,51 X 0,65 0,040 TBL 48 + 12 G X 65 CM BR\nCADARÇO VÁLVULA TOPO 1 1,40 0,006 CADARÇO 14 MM 4 G BR\nTOPO 1 0,97 X 0,97 0,040 TBL 48 + 12 G X 97 CM BR\nPESO TEÓRICO 1,486'
  ]);
  const g=cut.groups(s),tube=g.find(x=>x.description.includes('65 CM')),cord=g.find(x=>x.family==='cadarco'),top=g.find(x=>x.description.includes('97 CM'));
  assert.ok(Math.abs(tube.weightPerBag-.09828)<1e-10);
  assert.ok(Math.abs(tube.weightPerBag*50-4.914)<1e-10);
  assert.ok(Math.abs(cord.metresPerBag*50-210)<1e-10);
  assert.ok(Math.abs(cord.weightPerBag*50-.84)<1e-10);
  assert.equal(tube.discrepancy,false);
  assert.equal(top.discrepancy,true); // O58 da planilha repete a fórmula da válvula topo.
});

test('AP 1184 preserva a largura precisa do Excel quando ela está disponível',()=>{
  const s=cut.extract([
    'FITEC AP 1184 (00)\nOPERAÇÃO COMPOSIÇÃO QTDE MEDIDAS PESO (kg) MATÉRIA PRIMA\nVÁLVULA FUNDO 1 0.75 X 0.65332 0.058798800000000005 TBL 48 + 12 G X 65 CM BR\nVÁLVULA TOPO 1 0.51 X 0.64832 0.039677184000000004 TBL 48 + 12 G X 65 CM BR\nPESO TEÓRICO 1.4863871013333334'
  ]);
  const g=cut.groups(s)[0];
  assert.equal(s.rows.length,2);
  assert.ok(Math.abs(g.weightPerBag-.098475984)<1e-12);
  assert.ok(Math.abs(g.weightPerBag*50-4.9237992)<1e-10);
});
