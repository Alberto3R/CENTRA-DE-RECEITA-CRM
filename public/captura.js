/*
 * Central de Receita — captura de origem do lead.
 *
 * Cole na landing, uma vez: <script src="https://SEU-CRM/captura.js" defer></script>
 *
 * 1. Guarda o PRIMEIRO toque (utm_*, fbclid, ad_id, URL de entrada) por 90 dias,
 *    mesmo que o visitante navegue para outra página antes de preencher.
 * 2. Todo POST com corpo JSON para /api/leads/ da Central de Receita sai com
 *    esses campos (+ cookies _fbp/_fbc), sem mexer no código do formulário.
 *    Campos que o formulário já manda nunca são sobrescritos.
 * 3. Expõe window.CentralReceita.dados() para quem monta o envio na mão.
 */
(function () {
  if (window.CentralReceita) return;
  var KEY = 'cr_atribuicao';
  var TTL = 90 * 864e5;
  var CAMPOS = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term', 'fbclid', 'ad_id'];

  function ler() {
    try {
      var v = JSON.parse(localStorage.getItem(KEY) || 'null');
      if (v && Date.now() - v.ts < TTL) return v;
    } catch (e) {}
    return null;
  }

  function gravar(v) {
    try { localStorage.setItem(KEY, JSON.stringify(v)); } catch (e) {}
  }

  function cookie(n) {
    var m = document.cookie.match(new RegExp('(?:^|; )' + n + '=([^;]*)'));
    return m ? decodeURIComponent(m[1]) : null;
  }

  // Primeiro toque: só grava se ainda não há um válido E a URL atual tem origem.
  var q = new URLSearchParams(location.search);
  var atual = {};
  var tem = false;
  CAMPOS.forEach(function (k) {
    var v = q.get(k);
    if (v) { atual[k] = v; tem = true; }
  });
  var salvo = ler();
  if (!salvo && tem) {
    atual.landing_url = location.href;
    atual.ts = Date.now();
    gravar(atual);
    salvo = atual;
  }

  function dados() {
    var d = {};
    var s = ler() || {};
    CAMPOS.forEach(function (k) { if (s[k]) d[k] = s[k]; });
    d.landing_url = s.landing_url || location.href;
    var fbp = cookie('_fbp');
    var fbc = cookie('_fbc') || (s.fbclid ? 'fb.1.' + s.ts + '.' + s.fbclid : null);
    if (fbp) d.fbp = fbp;
    if (fbc) d.fbc = fbc;
    return d;
  }

  function mesclar(obj) {
    var d = dados();
    for (var k in d) if (obj[k] == null || obj[k] === '') obj[k] = d[k];
    return obj;
  }

  // fetch: só toca em requisições para /api/leads/ com corpo JSON (objeto).
  if (window.fetch) {
    var original = window.fetch;
    window.fetch = function (input, init) {
      try {
        var url = typeof input === 'string' ? input : (input && input.url) || '';
        if (url.indexOf('/api/leads/') !== -1 && init && typeof init.body === 'string') {
          var corpo = JSON.parse(init.body);
          if (corpo && typeof corpo === 'object' && !Array.isArray(corpo)) {
            init = Object.assign({}, init, { body: JSON.stringify(mesclar(corpo)) });
          }
        }
      } catch (e) {}
      return original.call(this, input, init);
    };
  }

  window.CentralReceita = { dados: dados, mesclar: mesclar };
})();
