/* Servidor de Quizzes — captura automática.
   Inserido em cada quiz pelo servidor. Não altera o funcionamento do quiz:
   apenas espelha para o painel do professor o que o quiz salva no navegador,
   o nome/turma digitados e se a página está aberta. */
(function () {
  'use strict';
  if (window.ServidorQuiz) return;

  var QUIZ = '';
  try { QUIZ = decodeURIComponent(location.pathname.replace(/^\/quiz\//, '')); } catch (e) { QUIZ = location.pathname; }
  var ISOLAR = false;
  try { ISOLAR = /[?&]isolar=1/.test(document.currentScript.src); } catch (e) {}
  // aberto pelo portal (GitHub + WebRTC): conversa com a página de fora
  var CFG = window.__SQ || null, PORTAL = !!(CFG && CFG.modo === 'portal');
  if (PORTAL) { QUIZ = String(CFG.quiz || 'quiz'); ISOLAR = !!CFG.isolar; }
  var proto = window.Storage && Storage.prototype;
  if (!proto) return;
  var origSet = proto.setItem, origGet = proto.getItem, origRem = proto.removeItem, origClear = proto.clear, origKey = proto.key;
  var descLen = Object.getOwnPropertyDescriptor(proto, 'length');
  var LS = null, SS = null;
  try { LS = window.localStorage; } catch (e) {}
  try { SS = window.sessionStorage; } catch (e) {}

  function rnd() {
    var a = new Uint8Array(12), s = '';
    try { crypto.getRandomValues(a); } catch (e) { for (var i = 0; i < 12; i++) a[i] = Math.random() * 256 | 0; }
    for (var j = 0; j < a.length; j++) s += ('0' + a[j].toString(16)).slice(-2);
    return s;
  }
  function lsGet(k) { try { return LS ? origGet.call(LS, k) : null; } catch (e) { return null; } }
  function lsSet(k, v) { try { if (LS) origSet.call(LS, k, v); } catch (e) {} }
  function brutas(st) { var l = [], n = 0; try { n = descLen.get.call(st); } catch (e) {} for (var i = 0; i < n; i++) { var k = origKey.call(st, i); if (k != null) l.push(k); } return l; }

  var CID = lsGet('__sq_cid');
  if (!CID || !/^[a-zA-Z0-9_-]{6,64}$/.test(CID)) { CID = rnd(); lsSet('__sq_cid', CID); }

  // chaves que pertencem a este quiz (vários quizzes dividem o mesmo navegador)
  var KEYS_ID = '__sq_keys:' + QUIZ;
  var minhas = {};
  try { (JSON.parse(lsGet(KEYS_ID) || '[]') || []).forEach(function (k) { minhas[k] = 1; }); } catch (e) {}
  function lembrar(k) { if (!minhas[k]) { minhas[k] = 1; lsSet(KEYS_ID, JSON.stringify(Object.keys(minhas).slice(-200))); } }

  // ---------------------------------------------------------------- separação por quiz
  // Cada quiz enxerga só o que ele mesmo salvou, como se estivesse sozinho no navegador.
  var P = '__sqq:' + QUIZ + ':';
  var PRL = null, PRS = null; // versões separadas por quiz (Proxy), quando ativas
  function un(st) { return st && st === PRL ? LS : st && st === PRS ? SS : st; }
  function ehArea(st) { st = un(st); return st && (st === LS || st === SS); }
  function px(st, k) { st = un(st); k = String(k); return ISOLAR && ehArea(st) && k.indexOf('__sq') !== 0 ? P + k : k; }
  function proprias(st) { return brutas(un(st)).filter(function (k) { return k.indexOf(P) === 0; }).map(function (k) { return k.slice(P.length); }); }
  if (ISOLAR && LS) {
    // progresso salvo antes da separação: traz para o espaço deste quiz
    try { for (var mk in minhas) { if (origGet.call(LS, P + mk) == null) { var mv = origGet.call(LS, mk); if (mv != null) origSet.call(LS, P + mk, mv); } } } catch (e) {}
  }

  // ---------------------------------------------------------------- envio
  var URL_ENV = '/__sq/api/enviar';
  var fila = [], pend = {}, timer = null;

  function post(lista, beacon) {
    if (!lista.length) return;
    if (PORTAL) { try { parent.postMessage({ sq: 'api', corpo: lista }, '*'); } catch (e) {} return; }
    var corpo = JSON.stringify(lista);
    if (beacon && navigator.sendBeacon) {
      try { if (navigator.sendBeacon(URL_ENV, new Blob([corpo], { type: 'application/json' }))) return; } catch (e) {}
    }
    try {
      fetch(URL_ENV, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: corpo, keepalive: corpo.length < 60000 })
        .catch(function () { reenviar(lista); });
    } catch (e) {}
  }
  var reenvio = [];
  function reenviar(l) { reenvio = reenvio.concat(l).slice(-200); setTimeout(function () { var r = reenvio; reenvio = []; post(r); }, 4000); }

  function descarregar(beacon) {
    timer = null;
    var itens = [];
    for (var k in pend) itens.push(pend[k]);
    pend = {};
    var lista = fila; fila = [];
    if (itens.length) lista.unshift({ cid: CID, quiz: QUIZ, tipo: 'storage', itens: itens });
    post(lista, beacon);
  }
  function agendar(ms) { if (!timer) timer = setTimeout(descarregar, ms == null ? 400 : ms); }
  function enfileirar(obj) { obj.cid = CID; obj.quiz = QUIZ; fila.push(obj); agendar(); }

  function area(st) { return un(st) === SS ? 'session' : 'local'; }
  function espelhar(st, k, v) {
    if (!ehArea(st) || String(k).indexOf('__sq') === 0) return;
    var a = area(st);
    if (a === 'local' && v !== null && !ISOLAR) lembrar(k);
    pend[a + '\u0000' + k] = { a: a, k: String(k), v: v === null ? null : String(v) };
    agendar();
  }

  proto.setItem = function (k, v) {
    var r = origSet.call(un(this), px(this, k), v);
    try { espelhar(this, k, v); } catch (e) {}
    return r;
  };
  proto.getItem = function (k) { return origGet.call(un(this), px(this, k)); };
  proto.removeItem = function (k) {
    var r = origRem.call(un(this), px(this, k));
    try { espelhar(this, k, null); } catch (e) {}
    return r;
  };
  proto.clear = function () {
    if (!ehArea(this)) return origClear.call(this);
    var st = un(this);
    if (ISOLAR) {
      proprias(st).forEach(function (k) { origRem.call(st, P + k); });
    } else {
      var guarda = {};
      brutas(st).forEach(function (k) { if (k.indexOf('__sq') === 0) guarda[k] = origGet.call(st, k); });
      origClear.call(st);
      for (var g in guarda) origSet.call(st, g, guarda[g]);
    }
    try { pend[area(st) + '\u0000*'] = { a: area(st), k: '*', v: null }; agendar(); } catch (e) {}
  };
  if (ISOLAR) {
    proto.key = function (i) { if (!ehArea(this)) return origKey.call(un(this), i); var l = proprias(this); return i >= 0 && i < l.length ? l[i] : null; };
    try {
      Object.defineProperty(proto, 'length', { configurable: true, enumerable: true,
        get: function () { return ehArea(this) ? proprias(this).length : descLen.get.call(un(this)); } });
    } catch (e) {}
    // acesso direto (localStorage.chave, Object.keys(localStorage)) também fica separado
    [['localStorage', LS], ['sessionStorage', SS]].forEach(function (par) {
      var nome = par[0], real = par[1];
      if (!real || !window.Proxy) return;
      var pr = new Proxy(real, {
        get: function (t, p) {
          if (typeof p !== 'string' || p in proto) { var v = Reflect.get(t, p, t); return typeof v === 'function' ? v.bind(t) : v; }
          var v2 = origGet.call(t, px(t, p)); return v2 === null ? undefined : v2;
        },
        set: function (t, p, v) { if (typeof p !== 'string') return false; t.setItem(p, v); return true; },
        has: function (t, p) { return typeof p === 'string' && (p in proto || origGet.call(t, px(t, p)) !== null); },
        deleteProperty: function (t, p) { t.removeItem(p); return true; },
        ownKeys: function (t) { return proprias(t); },
        getOwnPropertyDescriptor: function (t, p) {
          var v = typeof p === 'string' ? origGet.call(t, px(t, p)) : null;
          return v === null ? undefined : { value: v, writable: true, enumerable: true, configurable: true };
        }
      });
      try { Object.defineProperty(window, nome, { configurable: true, enumerable: true, get: function () { return pr; } }); if (real === LS) PRL = pr; else PRS = pr; } catch (e) {}
    });
    // aviso entre abas: cada quiz só recebe os avisos dele, com o nome original da chave
    window.addEventListener('storage', function (e) {
      try {
        if (!ehArea(e.storageArea) || e.key === null) return;
        if (e.key.indexOf(P) === 0) { Object.defineProperty(e, 'key', { value: e.key.slice(P.length) }); }
        else { e.stopImmediatePropagation(); }
      } catch (x) {}
    }, true);
  }

  // ao abrir: avisa e envia o progresso já salvo (estudante que voltou à atividade)
  enfileirar({ tipo: 'abriu' });
  try {
    if (ISOLAR) { proprias(LS).forEach(function (k) { pend['local\u0000' + k] = { a: 'local', k: k, v: origGet.call(LS, P + k) }; }); }
    else { for (var k in minhas) { var v = lsGet(k); if (v != null) pend['local\u0000' + k] = { a: 'local', k: k, v: v }; } }
  } catch (e) {}
  agendar(50);

  // ---------------------------------------------------------------- nome e turma digitados
  var reNome = /(^|[^a-z])(nome|name|aluno|estudante|student)/i, reTurma = /(turma|classe|s[ée]rie|sala|class\b)/i;
  function rotulo(el) {
    var t = [el.id, el.name, el.placeholder, el.getAttribute('aria-label') || ''];
    try { if (el.labels && el.labels[0]) t.push(el.labels[0].textContent); } catch (e) {}
    try { var p = el.closest('label'); if (p) t.push(p.textContent); } catch (e) {}
    try { var prev = el.previousElementSibling; if (prev && /^(LABEL|SPAN|B|STRONG|P|DIV)$/.test(prev.tagName)) t.push(prev.textContent.slice(0, 60)); } catch (e) {}
    return t.join(' ');
  }
  var ultimoCampo = {}, campoTimer = {};
  function verCampo(ev) {
    var el = ev.target;
    if (!el || !el.tagName) return;
    var tag = el.tagName;
    if (tag !== 'INPUT' && tag !== 'SELECT') return;
    var tipo = (el.type || '').toLowerCase();
    if (tipo === 'password' || tipo === 'hidden' || tipo === 'checkbox' || tipo === 'radio') return;
    var r = rotulo(el), campo = null;
    if (reTurma.test(r)) campo = 'turma'; else if (reNome.test(r)) campo = 'nome';
    if (!campo) return;
    var val = String(el.value || '').trim();
    if (tag === 'SELECT' && el.selectedIndex >= 0 && el.options[el.selectedIndex]) val = el.options[el.selectedIndex].text.trim() || val;
    if (!val || val === ultimoCampo[campo]) return;
    clearTimeout(campoTimer[campo]);
    campoTimer[campo] = setTimeout(function () { ultimoCampo[campo] = val; enfileirar({ tipo: 'campo', campo: campo, valor: val }); }, 900);
  }
  document.addEventListener('change', verCampo, true);
  document.addEventListener('input', verCampo, true);

  // ---------------------------------------------------------------- respostas escritas: digitou ou colou?
  // Para cada campo de resposta (caixa de texto), conta o que foi digitado tecla a
  // tecla e o que entrou colado (inclusive tentativas que o quiz bloqueou).
  var escritas = [], escTimer = {};
  function ehResposta(el) {
    if (!el || !el.tagName) return false;
    if (el.isContentEditable) return true;
    if (el.tagName === 'TEXTAREA') return true;
    if (el.tagName !== 'INPUT') return false;
    var t = (el.type || 'text').toLowerCase();
    if (t !== 'text' && t !== 'search') return false;
    var r = rotulo(el);
    return !(reNome.test(r) || reTurma.test(r));
  }
  function textoDe(el) { return el.isContentEditable ? (el.innerText || '') : String(el.value || ''); }
  function perguntaDe(el) {
    var t = '';
    try { if (el.labels && el.labels[0]) t = el.labels[0].innerText; } catch (e) {}
    if (!t) t = el.getAttribute('aria-label') || '';
    var p = el.parentElement, n = 0;
    while (!t && p && n < 5) {
      var c = p.cloneNode(true);
      [].forEach.call(c.querySelectorAll('textarea,input,button,select,script,style'), function (x) { x.remove(); });
      var tx = (c.innerText || c.textContent || '').replace(/\s+/g, ' ').trim();
      if (tx.length > 3) t = tx;
      p = p.parentElement; n++;
    }
    if (!t) t = el.placeholder || el.name || el.id || 'resposta escrita';
    t = t.replace(/\s+/g, ' ').trim();
    return t.length > 140 ? t.slice(0, 137) + '…' : t;
  }
  function registro(el) {
    var i = escritas.indexOf(el);
    if (i < 0) { escritas.push(el); i = escritas.length - 1; el.__sqReg = { digitado: 0, colado: 0, colagens: 0, bloqueadas: 0 }; }
    el.__sqIdx = i;
    return el.__sqReg;
  }
  function enviarEscrita(el) {
    clearTimeout(escTimer[el.__sqIdx]);
    escTimer[el.__sqIdx] = setTimeout(function () {
      var r = el.__sqReg, txt = textoDe(el);
      enfileirar({ tipo: 'escrita', dados: {
        campo: String(el.__sqIdx + 1) + ':' + (el.name || el.id || ''), pergunta: perguntaDe(el),
        digitado: r.digitado, colado: r.colado, colagens: r.colagens, bloqueadas: r.bloqueadas, tamanho: txt.trim().length } });
    }, 1500);
  }
  document.addEventListener('paste', function (ev) {
    var el = ev.target && ev.target.closest ? ev.target.closest('textarea,input,[contenteditable],[contenteditable=""]') : ev.target;
    if (!ehResposta(el)) return;
    var r = registro(el), n = 0;
    try { n = (ev.clipboardData && ev.clipboardData.getData('text') || '').length; } catch (e) {}
    setTimeout(function () { // descobre se o quiz bloqueou a colagem
      if (ev.defaultPrevented) r.bloqueadas++; else { r.colagens++; r.colado += n; }
      enviarEscrita(el);
    }, 0);
  }, true);
  document.addEventListener('drop', function (ev) {
    var el = ev.target;
    if (!ehResposta(el)) return;
    var r = registro(el), n = 0;
    try { n = (ev.dataTransfer && ev.dataTransfer.getData('text') || '').length; } catch (e) {}
    setTimeout(function () { if (ev.defaultPrevented) r.bloqueadas++; else { r.colagens++; r.colado += n; } enviarEscrita(el); }, 0);
  }, true);
  document.addEventListener('input', function (ev) {
    var el = ev.target;
    if (!ehResposta(el)) return;
    var r = registro(el), tipo = ev.inputType || '';
    if (tipo === 'insertFromPaste' || tipo === 'insertFromDrop' || tipo === 'insertFromPasteAsQuotation') { enviarEscrita(el); return; }
    var n = ev.data ? ev.data.length : 1;
    // bloco grande de uma vez (área de transferência do teclado do celular): conta como colado
    if (tipo === 'insertText' && n >= 25 && !ev.isComposing) { r.colagens++; r.colado += n; enviarEscrita(el); return; }
    if (tipo === 'insertReplacementText') { enviarEscrita(el); return; } // correção automática
    if (tipo.indexOf('insert') === 0) r.digitado += tipo === 'insertCompositionText' ? 1 : n;
    enviarEscrita(el);
  }, true);

  // ---------------------------------------------------------------- presença
  var visivel = true;
  function vis() {
    var agora = document.visibilityState !== 'hidden';
    if (agora === visivel) return;
    visivel = agora;
    enfileirar({ tipo: 'visibilidade', valor: agora ? 'visivel' : 'oculta' });
    if (!agora) descarregar(true);
  }
  document.addEventListener('visibilitychange', vis);
  window.addEventListener('pagehide', function () { descarregar(true); });

  // ---------------------------------------------------------------- mensagens do professor
  function mostrarMensagem(texto) {
    function montar() {
      var host = document.createElement('div');
      host.setAttribute('data-servidor-quiz', '');
      host.style.cssText = 'position:fixed;inset:0;z-index:2147483647;display:flex;align-items:flex-start;justify-content:center;padding:16px;pointer-events:none';
      var raiz = host.attachShadow ? host.attachShadow({ mode: 'closed' }) : host;
      raiz.innerHTML =
        '<style>:host{all:initial}' +
        '.c{pointer-events:auto;max-width:500px;width:100%;margin-top:7vh;border-radius:26px;padding:20px 22px 18px;color:#1F2A2F;' +
        'font:16px/1.5 "Segoe UI Variable Text","Segoe UI",system-ui,-apple-system,Roboto,sans-serif;' +
        'background:rgba(246,249,249,.72);-webkit-backdrop-filter:blur(28px) saturate(160%);backdrop-filter:blur(28px) saturate(160%);' +
        'border:1px solid rgba(255,255,255,.75);box-shadow:inset 0 1px 0 rgba(255,255,255,.9),0 18px 50px rgba(30,42,47,.28);animation:e .28s cubic-bezier(.2,.8,.2,1)}' +
        '@keyframes e{from{transform:translateY(-14px) scale(.98);opacity:0}}@media (prefers-reduced-motion:reduce){.c{animation:none}}' +
        '.t{font-size:13.5px;font-weight:600;color:#52626A;margin-bottom:6px}' +
        '.m{white-space:pre-wrap;word-wrap:break-word;font-size:17px}.b{display:flex;justify-content:flex-end;margin-top:14px}' +
        'button{font:inherit;font-weight:600;background:#2E4853;color:#F4F7F7;border:0;border-radius:999px;padding:9px 26px;cursor:pointer}' +
        'button:focus-visible{outline:2px solid #2E4853;outline-offset:2px}' +
        '@media (prefers-color-scheme:dark){.c{color:#EDF1F0;background:rgba(36,47,52,.72);border-color:rgba(255,255,255,.12);box-shadow:inset 0 1px 0 rgba(255,255,255,.1),0 18px 50px rgba(0,0,0,.5)}' +
        '.t{color:#B3BFC2}button{background:#D8E3E6;color:#1C2427}}</style>' +
        '<div class="c" role="alertdialog" aria-label="Mensagem do professor"><div class="t">Mensagem do professor</div><div class="m"></div><div class="b"><button type="button">Entendi</button></div></div>';
      raiz.querySelector('.m').textContent = texto;
      raiz.querySelector('button').addEventListener('click', function () { host.remove(); });
      (document.body || document.documentElement).appendChild(host);
    }
    if (document.body) montar(); else document.addEventListener('DOMContentLoaded', montar);
  }

  var vistas = {};
  function receber(m) {
    if (!m) return;
    if (m.tipo === 'aovivo') { // estado do quiz ao vivo
      try { window.dispatchEvent(new CustomEvent('sq-aovivo', { detail: m.dados })); } catch (e) {}
      return;
    }
    if (m.texto && !vistas[m.id || m.texto + m.hora]) { vistas[m.id || m.texto + m.hora] = 1; mostrarMensagem(m.texto); }
  }
  var QS = 'cid=' + encodeURIComponent(CID) + '&quiz=' + encodeURIComponent(QUIZ);

  // Modo consulta contínua (acesso pela internet, onde a conexão aberta não é mantida)
  var seq = -1, esperando = false;
  function esperar() {
    if (esperando) return; esperando = true;
    fetch('/__sq/api/espera?' + QS + '&desde=' + seq, { cache: 'no-store' })
      .then(function (r) { return r.json(); })
      .then(function (d) { seq = d.seq; (d.msgs || []).forEach(receber); esperando = false; setTimeout(esperar, 300); })
      .catch(function () { esperando = false; setTimeout(esperar, 5000); });
  }

  function conectarCanal() {
    if (PORTAL) {
      window.addEventListener('message', function (ev) {
        if (ev.source !== parent || !ev.data || ev.data.sq !== 'msg') return;
        receber(ev.data.m);
      });
      return;
    }
    // por serviços intermediários a conexão contínua pode ser cortada: usa consulta
    var h = location.hostname, direto = h === 'localhost' || /^[0-9.]+$/.test(h) || h.indexOf(':') > -1 || /^\[/.test(h);
    var internet = !direto;
    if (internet || !window.EventSource) { esperar(); return; }
    var es, abriu = false, falhas = 0;
    try { es = new EventSource('/__sq/api/canal?' + QS); } catch (e) { esperar(); return; }
    es.onopen = function () { abriu = true; falhas = 0; };
    es.onerror = function () { if (!abriu && ++falhas >= 2) { es.close(); esperar(); } };
    es.onmessage = function (ev) { try { receber(JSON.parse(ev.data)); } catch (e) {} };
  }
  conectarCanal();

  // ---------------------------------------------------------------- API opcional para quizzes novos
  // ServidorQuiz.identificar({nome:'Ana Souza', turma:'2ª A'})
  // ServidorQuiz.enviar('resposta', {questao: 3, escolhida: 'B', correta: true})
  // ServidorQuiz.enviar('alerta', {motivo: 'trocou de aba'})
  // ServidorQuiz.enviar('conclusao', {nota: 24})
  window.ServidorQuiz = {
    ativo: true,
    identificar: function (dados) { if (dados && typeof dados === 'object') enfileirar({ tipo: 'ident', dados: dados }); },
    enviar: function (tipo, dados, urgente) {
      if (!tipo) return;
      fila.push({ cid: CID, quiz: QUIZ, tipo: String(tipo), dados: dados === undefined ? null : dados });
      if (urgente) { clearTimeout(timer); timer = null; descarregar(); } else agendar();
    }
  };
})();
