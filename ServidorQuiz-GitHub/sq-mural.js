/* Servidor de Quizzes — versão GitHub. Biblioteca comum ao portal e ao painel.
   Murais: servidores MQTT públicos (sem conta), usados por WebSocket.
   Tudo o que passa por eles vai cifrado (AES-GCM) com uma chave derivada do código da sala:
   quem opera o mural não consegue ler nada. */
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

/* uma sala: vários murais ao mesmo tempo, mensagens cifradas, sem duplicatas */
function Sala(codigo,murais,aoMudar){
  var self=this;this.codigo=codigo;this.chave=null;this.murais=[];this.vistos={};this.ordemVistos=[];
  var pronta=crypto.subtle.digest('SHA-256',te.encode('sqz-gh-v1:'+codigo)).then(function(h){return crypto.subtle.importKey('raw',h,'AES-GCM',false,['encrypt','decrypt'])}).then(function(k){self.chave=k});
  this.pronta=pronta;
  this.murais=(murais&&murais.length?murais:MURAIS_PADRAO).map(function(u){var m=new Mural(u,function(){aoMudar&&aoMudar(self.conectados())});m.abrir();return m});
  this.conectados=function(){return self.murais.filter(function(m){return m.ok}).length};
  this.topico=function(s){return 'sqz/gh1/'+codigo+'/'+s};
  this.cifrar=function(obj){var iv=crypto.getRandomValues(new Uint8Array(12));return crypto.subtle.encrypt({name:'AES-GCM',iv:iv},self.chave,te.encode(JSON.stringify(obj))).then(function(ct){var o=new Uint8Array(12+ct.byteLength);o.set(iv);o.set(new Uint8Array(ct),12);return b64(o)})};
  this.decifrar=function(txt){try{var r=deb64(txt.trim());return crypto.subtle.decrypt({name:'AES-GCM',iv:r.subarray(0,12)},self.chave,r.subarray(12)).then(function(p){return JSON.parse(td.decode(p))})}catch(e){return Promise.reject(e)}};
  /* envia por todos os murais; devolve quantos aceitaram */
  this.enviar=function(sub,obj,reter){
    return pronta.then(function(){obj.mid=obj.mid||aleatorio(8);return self.cifrar(obj)}).then(function(txt){
      var n=0;self.murais.forEach(function(m){if(m.publicar(self.topico(sub),txt,reter))n++});return n;
    });
  };
  /* recebe de todos os murais, ignorando a mesma mensagem chegando por outro mural */
  this.ouvir=function(sub,cb){
    self.murais.forEach(function(m){m.assinar(self.topico(sub),function(txt){
      pronta.then(function(){return self.decifrar(txt)}).then(function(o){
        if(o.mid){if(self.vistos[o.mid])return;self.vistos[o.mid]=1;self.ordemVistos.push(o.mid);if(self.ordemVistos.length>5000)delete self.vistos[self.ordemVistos.shift()]}
        cb(o);
      }).catch(function(){});
    })});
  };
}

window.SQMural={Sala:Sala,aleatorio:aleatorio,MURAIS_PADRAO:MURAIS_PADRAO};
})();
