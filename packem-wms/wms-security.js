(function (global) {
  'use strict';
  var PREFIX = 'pbkdf2', ITERATIONS = 210000;
  function hex(bytes){return Array.prototype.map.call(bytes,function(b){return b.toString(16).padStart(2,'0');}).join('');}
  function bytes(value){var out=new Uint8Array(value.length/2);for(var i=0;i<out.length;i++)out[i]=parseInt(value.substr(i*2,2),16);return out;}
  function equal(a,b){if(a.length!==b.length)return false;var d=0;for(var i=0;i<a.length;i++)d|=a.charCodeAt(i)^b.charCodeAt(i);return d===0;}
  async function derive(password,salt,iterations){var enc=new TextEncoder(),key=await crypto.subtle.importKey('raw',enc.encode(String(password)),'PBKDF2',false,['deriveBits']),bits=await crypto.subtle.deriveBits({name:'PBKDF2',salt:salt,iterations:iterations,hash:'SHA-256'},key,256);return hex(new Uint8Array(bits));}
  function isProtected(value){return String(value||'').indexOf(PREFIX+'$')===0;}
  async function protect(password){if(isProtected(password))return String(password);if(!global.crypto||!crypto.subtle)throw new Error('Protecao de senha indisponivel');var salt=crypto.getRandomValues(new Uint8Array(16)),hash=await derive(password,salt,ITERATIONS);return [PREFIX,ITERATIONS,hex(salt),hash].join('$');}
  async function verify(stored,password){stored=String(stored||'');if(!isProtected(stored))return equal(stored,String(password||''));var p=stored.split('$'),it=Number(p[1]);if(p.length!==4||!it||it<100000)return false;return equal(await derive(password,bytes(p[2]),it),p[3]);}
  global.WMSSecurity={protect:protect,verify:verify,isProtected:isProtected};
})(window);
