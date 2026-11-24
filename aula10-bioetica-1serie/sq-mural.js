/* Servidor de Quizzes — versão GitHub. Biblioteca comum ao portal e ao painel.
   Murais: servidores MQTT públicos (sem conta), usados por WebSocket.
   Tudo o que passa por eles vai cifrado (AES-GCM). O endereço usado no mural é um embaralhamento
   do código da sala: quem opera ou escuta o mural não descobre o código nem lê nada.
   Com o sala.json publicado, o que o estudante manda só o painel abre, e o que o painel manda vai assinado. */
(function(){
'use strict';
var MURAIS_PADRAO=['wss://broker.emqx.io:8084/mqtt','wss://broker.hivemq.com:8884/mqtt','wss://test.mosquitto.org:8081/mqtt'];
var te=new TextEncoder(),td=new TextDecoder();

function b64(u){var s='';for(var i=0;i<u.length;i+=8192)s+=String.fromCharCode.apply(null,u.subarray(i,i+8192));return btoa(s)}
function deb64(s){var b=atob(s),u=new Uint8Array(b.length);for(var i=0;i<b.length;i++)u[i]=b.charCodeAt(i);return u}
function aleatorio(n){return Array.from(crypto.getRandomValues(new Uint8Array(n))).map(function(x){return('0'+x.toString(16)).slice(-2)}).join('')}

/* um mural (cliente MQTT 3.1.1 mínimo, QoS 0) */
function Mural(url,aoMudar){
  var self=this;this.url=url;this.ok=false;this.subs={};this.ws=null;this.espera=3000;this.pid=1;this.aoMudar=aoMudar||function(){};
  function str(s){var b=Array.from(te.encode(s));return[b.length>>8,b.length&255].concat(b)}
  this.env=function(tipo,corpo){
    if(!self.ws||self.ws.readyState!==1)return false;
    var l=corpo.length,rl=[];do{var x=l%128;l=Math.floor(l/128);if(l>0)x|=128;rl.push(x)}while(l>0);
    var p=new Uint8Array(1+rl.length+corpo.length);p[0]=tipo;p.set(rl,1);p.set(corpo,1+rl.length);self.ws.send(p);return true;
  };
  this.abrir=function(){
    var ws;try{ws=new WebSocket(url,['mqtt'])}catch(e){return}
    self.ws=ws;ws.binaryType='arraybuffer';var buf=new Uint8Array(0),ping;
    ws.onopen=function(){self.env(0x10,[0,4,77,81,84,84,4,2,0,60].concat(str('sqg-'+aleatorio(6))))};
    ws.onmessage=function(ev){
      var d=new Uint8Array(ev.data),n=new Uint8Array(buf.length+d.length);n.set(buf);n.set(d,buf.length);buf=n;
      for(;;){
        if(buf.length<2)return;var mult=1,len=0,i=1,b;
        do{if(i>=buf.length)return;b=buf[i++];len+=(b&127)*mult;mult*=128}while(b&128);
        if(buf.length<i+len)return;
        var tipo=buf[0]>>4,fl=buf[0]&15,c=buf.subarray(i,i+len);buf=buf.slice(i+len);
        if(tipo===2){if(c[1]===0){self.ok=true;self.espera=3000;Object.keys(self.subs).forEach(function(t){self.sub(t)});ping=setInterval(function(){self.env(0xC0,[])},40000);self.aoMudar()}}
        else if(tipo===3){var tl=(c[0]<<8)|c[1],t=td.decode(c.subarray(2,2+tl)),p=2+tl;if((fl>>1)&3)p+=2;var cb=self.subs[t];if(cb)cb(td.decode(c.subarray(p)))}
      }
    };
    ws.onclose=function(){clearInterval(ping);var era=self.ok;self.ok=false;if(era)self.aoMudar();setTimeout(self.abrir,self.espera);self.espera=Math.min(self.espera*2,30000)};
    ws.onerror=function(){};
  };
  this.sub=function(t){if(!self.ok)return;var id=(self.pid++&0xffff)||1;self.env(0x82,[id>>8,id&255].concat(str(t),[0]))};
  this.assinar=function(t,cb){self.subs[t]=cb;self.sub(t)};
  this.publicar=function(t,txt,reter){if(!self.ok)return false;return self.env(reter?0x31:0x30,str(t).concat(Array.from(te.encode(txt))))};
}

/* ---------- chaves do professor (curva P-256) ----------
   enc: par para receber (só o painel abre o que o estudante manda);
   ass: par para assinar (o estudante confere que a mensagem veio mesmo do painel).
   Guardadas como {d,x,y} em base64url; a parte pública (x,y) vai no arquivo sala.json do repositório. */
var P256={name:'ECDH',namedCurve:'P-256'},S256={name:'ECDSA',namedCurve:'P-256'},ASS={name:'ECDSA',hash:'SHA-256'};
function b64u(u){return b64(u).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'')}
function deb64u(s){s=String(s).replace(/-/g,'+').replace(/_/g,'/');while(s.length%4)s+='=';return deb64(s)}
function hex(buf){return Array.from(new Uint8Array(buf)).map(function(x){return('0'+x.toString(16)).slice(-2)}).join('')}
function resumo(txt){return crypto.subtle.digest('SHA-256',te.encode(txt))}
function junta(){var n=0,i;for(i=0;i<arguments.length;i++)n+=arguments[i].length;var o=new Uint8Array(n),p=0;for(i=0;i<arguments.length;i++){o.set(arguments[i],p);p+=arguments[i].length}return o}
function ponto(k){return junta([4],deb64u(k.x),deb64u(k.y))}
function jwk(k){return{kty:'EC',crv:'P-256',x:k.x,y:k.y,d:k.d,ext:true}}
function parValido(k){return!!k&&[k.d,k.x,k.y].every(function(v){return typeof v==='string'&&/^[A-Za-z0-9_-]{43}$/.test(v)})}
function chavesValidas(c){return!!c&&parValido(c.enc)&&parValido(c.ass)}
function gerarChaves(){
  function uma(alg,usos){return crypto.subtle.generateKey(alg,true,usos).then(function(p){return crypto.subtle.exportKey('jwk',p.privateKey)}).then(function(j){return{d:j.d,x:j.x,y:j.y}})}
  return Promise.all([uma(P256,['deriveBits']),uma(S256,['sign'])]).then(function(r){return{enc:r[0],ass:r[1]}});
}
/* conteúdo do sala.json: só a parte pública */
function publicaDe(c){return{v:2,enc:b64u(ponto(c.enc)),ass:b64u(ponto(c.ass))}}
/* texto para levar o painel a outro computador: as duas chaves, em seis partes */
function exportarChaves(c){return[c.enc.d,c.enc.x,c.enc.y,c.ass.d,c.ass.x,c.ass.y].join('.')}
function importarChaves(t){var p=String(t||'').trim().split('.');if(p.length!==6)return null;var c={enc:{d:p[0],x:p[1],y:p[2]},ass:{d:p[3],x:p[4],y:p[5]}};return chavesValidas(c)?c:null}
function segredo(priv,pub){return crypto.subtle.deriveBits({name:'ECDH',public:pub},priv,256).then(function(b){return crypto.subtle.digest('SHA-256',b)}).then(function(h){return crypto.subtle.importKey('raw',h,'AES-GCM',false,['encrypt','decrypt'])})}
function fechar(chave,obj){var iv=crypto.getRandomValues(new Uint8Array(12));return crypto.subtle.encrypt({name:'AES-GCM',iv:iv},chave,te.encode(JSON.stringify(obj))).then(function(ct){return junta(iv,new Uint8Array(ct))})}
function abrir(chave,u){return crypto.subtle.decrypt({name:'AES-GCM',iv:u.subarray(0,12)},chave,u.subarray(12)).then(function(p){return JSON.parse(td.decode(p))})}

/* uma sala: vários murais ao mesmo tempo, mensagens cifradas, sem duplicatas.
   preparo (opcional): promessa de {professor:chaves} no painel, {publica:conteúdo do sala.json} no portal, ou null.
   Três formatos de mensagem, pela primeira letra:
     S = do professor: cifrada com a chave da sala e ASSINADA (o endereço entra na assinatura);
     E = do estudante: cifrada para a chave pública do professor (só o painel abre);
     G = do estudante sem sala.json publicado: cifrada só com a chave da sala (sem proteção entre colegas). */
function Sala(codigo,murais,aoMudar,preparo){
  var self=this;this.codigo=codigo;this.chave=null;this.pre='';this.murais=[];this.vistos={};this.ordemVistos=[];
  this.prof=null;this.pub=null;
  this.estrito=false; /* painel: recusa o formato G (ligue quando o sala.json publicado for o deste painel) */
  var efemera=null,derivadas={},nDeriv=0;
  var pronta=Promise.all([resumo('sqz-gh-v2:'+codigo),resumo('sqz-gh-v2-topico:'+codigo),preparo||null]).then(function(r){
    self.pre=hex(r[1]).slice(0,32); /* o endereço no mural não revela o código nem a chave */
    var p=[crypto.subtle.importKey('raw',r[0],'AES-GCM',false,['encrypt','decrypt']).then(function(k){self.chave=k})],c=r[2];
    if(c&&c.professor){
      if(!chavesValidas(c.professor))throw new Error('chaves do professor inválidas');
      p.push(Promise.all([crypto.subtle.importKey('jwk',jwk(c.professor.enc),P256,false,['deriveBits']),crypto.subtle.importKey('jwk',jwk(c.professor.ass),S256,false,['sign'])]).then(function(k){self.prof={enc:k[0],ass:k[1]}}));
    }else if(c&&c.publica){
      p.push(Promise.all([crypto.subtle.importKey('raw',deb64u(c.publica.enc),P256,false,[]),crypto.subtle.importKey('raw',deb64u(c.publica.ass),S256,false,['verify'])]).then(function(k){self.pub={enc:k[0],ass:k[1]}}));
    }
    return Promise.all(p);
  });
  this.pronta=pronta;
  this.murais=(murais&&murais.length?murais:MURAIS_PADRAO).map(function(u){var m=new Mural(u,function(){aoMudar&&aoMudar(self.conectados())});m.abrir();return m});
  this.conectados=function(){return self.murais.filter(function(m){return m.ok}).length};
  this.topico=function(s){return 'sqz/gh2/'+self.pre+'/'+s};
  /* canal particular de um estudante, sem mostrar a identidade dele no endereço */
  this.subDe=function(cid){return resumo('sqz-gh-v2-p:'+codigo+':'+cid).then(function(h){return'p/'+hex(h).slice(0,24)})};
  function assinado(t,c){return junta(te.encode(t),[0],c)}
  function empacotar(t,obj){
    if(self.prof)return fechar(self.chave,obj).then(function(c){return crypto.subtle.sign(ASS,self.prof.ass,assinado(t,c)).then(function(s){return'S'+b64(junta(new Uint8Array(s),c))})});
    if(self.pub){
      if(!efemera)efemera=crypto.subtle.generateKey(P256,false,['deriveBits']).then(function(par){return Promise.all([crypto.subtle.exportKey('raw',par.publicKey),segredo(par.privateKey,self.pub.enc)])}).then(function(r){return{pub:new Uint8Array(r[0]),chave:r[1]}});
      return efemera.then(function(e){return fechar(e.chave,obj).then(function(c){return'E'+b64(junta(e.pub,c))})});
    }
    return fechar(self.chave,obj).then(function(c){return'G'+b64(c)});
  }
  function desempacotar(t,txt){
    txt=txt.trim();var tipo=txt.charAt(0),u=deb64(txt.slice(1));
    if(tipo==='S'){
      if(u.length<64+12+16)throw 0;var c=u.subarray(64);
      if(!self.pub)return abrir(self.chave,c);
      return crypto.subtle.verify(ASS,self.pub.ass,u.subarray(0,64),assinado(t,c)).then(function(ok){if(!ok)throw 0;return abrir(self.chave,c)});
    }
    if(tipo==='E'){
      if(!self.prof||u.length<65+12+16)throw 0;
      var ke=b64(u.subarray(0,65)),d=derivadas[ke];
      if(!d){if(++nDeriv>3000){derivadas={};nDeriv=1}
        d=derivadas[ke]=crypto.subtle.importKey('raw',u.subarray(0,65),P256,false,[]).then(function(pb){return segredo(self.prof.enc,pb)})}
      return d.then(function(k){return abrir(k,u.subarray(65))});
    }
    if(tipo==='G'){
      if(self.pub||(self.prof&&self.estrito))throw 0;
      return abrir(self.chave,u);
    }
    throw 0;
  }
  /* envia por todos os murais; devolve quantos aceitaram */
  this.enviar=function(sub,obj,reter){
    return pronta.then(function(){obj.mid=obj.mid||aleatorio(8);var t=self.topico(sub);
      return empacotar(t,obj).then(function(txt){var n=0;self.murais.forEach(function(m){if(m.publicar(t,txt,reter))n++});return n})});
  };
  /* recebe de todos os murais, ignorando a mesma mensagem chegando por outro mural */
  this.ouvir=function(sub,cb){
    pronta.then(function(){var t=self.topico(sub);
      self.murais.forEach(function(m){m.assinar(t,function(txt){
        Promise.resolve().then(function(){return desempacotar(t,txt)}).then(function(o){
          if(o.mid){if(self.vistos[o.mid])return;self.vistos[o.mid]=1;self.ordemVistos.push(o.mid);if(self.ordemVistos.length>5000)delete self.vistos[self.ordemVistos.shift()]}
          cb(o);
        }).catch(function(){});
      })});
    }).catch(function(){});
  };
}

/* código de sala fixo, tirado do endereço da pasta: o link simples da pasta já funciona, sem #s=... */
function salaPadrao(){var d=(location.host+location.pathname.replace(/[^\/]*$/,'')).toLowerCase(),h1=0x811c9dc5,h2=0x1b873593;
  for(var i=0;i<d.length;i++){var c=d.charCodeAt(i);h1=Math.imul(h1^c,16777619)>>>0;h2=Math.imul(h2^c,2246822519)>>>0;h2=(h2<<13|h2>>>19)>>>0}
  return'sq'+('0000000'+h1.toString(16)).slice(-8)+('0000000'+h2.toString(16)).slice(-8)}
/* árvore de arquivos do repositório (tenta o ramo padrão, depois main e master) */
function arvore(repo){var refs=['HEAD','main','master'];return(function t(i){if(i>=refs.length)return Promise.reject(404);
  return fetch('https://api.github.com/repos/'+repo+'/git/trees/'+refs[i]+'?recursive=1',{cache:'no-cache'}).then(function(r){if(r.status===403||r.status===429)throw r.status;if(!r.ok)return t(i+1);return r.json()})})(0)}
window.SQMural={Sala:Sala,aleatorio:aleatorio,MURAIS_PADRAO:MURAIS_PADRAO,salaPadrao:salaPadrao,arvore:arvore,
  gerarChaves:gerarChaves,chavesValidas:chavesValidas,publicaDe:publicaDe,exportarChaves:exportarChaves,importarChaves:importarChaves};
})();
