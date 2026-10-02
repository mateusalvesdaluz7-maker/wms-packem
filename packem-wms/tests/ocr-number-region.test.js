const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');

const app=fs.readFileSync(path.join(__dirname,'..','wms-app.js'),'utf8');
const begin=app.indexOf(' function ocrFindNumberRegions(source){');
const end=app.indexOf(' function ocrScene(source){',begin);
assert.ok(begin>=0&&end>begin);
const detector=app.slice(begin,end);

function locate(draw){
 const width=220,height=320,data=new Uint8ClampedArray(width*height*4);
 data.fill(255);
 function dark(x,y,w,h){for(let yy=y;yy<y+h;yy++)for(let xx=x;xx<x+w;xx++){const p=(yy*width+xx)*4;data[p]=data[p+1]=data[p+2]=0;}}
 draw(dark);
 const context={source:{width,height},document:{createElement:()=>({width:0,height:0,getContext:()=>({drawImage(){},getImageData:()=>({data})})})}};
 vm.createContext(context);
 vm.runInContext(detector+'result=ocrFindNumberRegions(source);',context);
 return context.result;
}

test('encontra a faixa vertical de dez dígitos mesmo com código de barras próximo',()=>{
 const regions=locate(dark=>{
  for(let i=0;i<10;i++)dark(25,30+i*22,12,16);
  for(let i=0;i<60;i++)dark(48+i*2,260,1,45);
 });
 assert.equal(regions.length,2);
 assert.equal(regions[0].deg,90);
 assert.ok(regions[0].rect.x<25&&regions[0].rect.x+regions[0].rect.w>37);
 assert.ok(regions[0].rect.y<=30&&regions[0].rect.y+regions[0].rect.h>=244);
});

test('não confunde barras finas com uma faixa de números',()=>{
 const regions=locate(dark=>{for(let i=0;i<60;i++)dark(20+i*3,100,1,90);});
 assert.equal(regions.length,0);
});
