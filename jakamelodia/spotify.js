/* ============================================================
   spotify.js — repertuar z playlist gracza
   ------------------------------------------------------------
   Po zalogowaniu playlisty gracza pojawiaja sie w kolumnie
   "Repertuar" obok gatunkow z katalogu — bez zadnych okien
   i dodatkowych krokow. Wybranie playlisty po raz pierwszy
   buduje z niej repertuar (to chwile trwa, widac postep),
   kazde kolejne wejscie jest juz natychmiastowe.

   Spotify mowi, CZEGO sluchasz. Dzwieku nie daje i nie moze dac:
   pole `preview_url` jest u nich oznaczone jako wycofane i czesto
   puste, a regulamin zabrania robic z tych urywkow osobnej uslugi.
   Pelne odtwarzanie idzie przez Web Playback SDK, ktory wymaga
   konta Premium u kazdego grajacego.

   Dlatego z playlisty bierzemy tytuly i wykonawcow, a probki
   szukamy w katalogu Apple. Czego nie da sie dopasowac, mowimy
   wprost, zamiast po cichu skracac playliste.

   Logowanie: Authorization Code z PKCE — bez serwera i bez
   sekretu, wiec nadaje sie na strone statyczna.
   ============================================================ */
(function(){
  'use strict';

  var KLIENT = 'cbb494e292c4450d815bc47b6fe2582d';
  var ZAKRES = 'playlist-read-private playlist-read-collaborative user-top-read user-library-read';
  var TOKEN  = 'jtm.sp';
  var WERYF  = 'jtm.sp.weryfikator';
  var SPIS   = 'jtm.sp.spis';
  var REP    = 'jtm.sp.rep.';
  var ODSTEP = 1300;   // ms miedzy zapytaniami do Apple
  var LIMIT  = 120;    // ile utworow z jednej playlisty bierzemy

  function pam(k, v){
    try{
      if(v===undefined){ var x = localStorage.getItem(k); return x ? JSON.parse(x) : null; }
      if(v===null) localStorage.removeItem(k); else localStorage.setItem(k, JSON.stringify(v));
    }catch(e){ return null; }
  }

  /* Adres powrotu musi zgadzac sie CO DO ZNAKU z wpisanym w panelu Spotify.
     Na strone mozna wejsc przez /jakamelodia/ albo /jakamelodia/index.html
     (tak linkuje karta na stronie glownej); goly location.pathname dalby
     dwa rozne adresy i Spotify odrzucilby ten z nazwa pliku. */
  function adresPowrotu(){
    var p = location.pathname;
    if(/\/[^\/]*\.[^\/]*$/.test(p)) p = p.replace(/[^\/]*$/, '');
    if(p.charAt(p.length - 1) !== '/') p += '/';
    return location.origin + p;
  }

  /* ---- PKCE ---------------------------------------------------------- */
  function base64url(buf){
    var s = btoa(String.fromCharCode.apply(null, new Uint8Array(buf)));
    return s.replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
  }
  function losowyCiag(n){
    var a = new Uint8Array(n);
    crypto.getRandomValues(a);
    return base64url(a.buffer).slice(0, n);
  }
  function wyzwanie(w){
    return crypto.subtle.digest('SHA-256', new TextEncoder().encode(w)).then(base64url);
  }

  function zaloguj(){
    var w = losowyCiag(96);
    pam(WERYF, w);
    return wyzwanie(w).then(function(ch){
      location.href = 'https://accounts.spotify.com/authorize?' + new URLSearchParams({
        client_id: KLIENT, response_type: 'code', redirect_uri: adresPowrotu(),
        code_challenge_method: 'S256', code_challenge: ch, scope: ZAKRES
      }).toString();
    });
  }

  function wyloguj(){
    var spis = pam(SPIS) || [];
    spis.forEach(function(p){ pam(REP + p.id, null); });
    pam(SPIS, null); pam(TOKEN, null);
    if(window.odswiezMenu) window.odswiezMenu();
  }

  function zapiszToken(j){
    pam(TOKEN, {
      token: j.access_token,
      odswiez: j.refresh_token || (pam(TOKEN)||{}).odswiez,
      wazneDo: Date.now() + (j.expires_in || 3600)*1000 - 60000
    });
  }

  /* powrot z ekranu zgody */
  function obsluzPowrot(){
    var q = new URLSearchParams(location.search);
    var blad = q.get('error');
    if(blad){ history.replaceState({}, '', location.pathname); return Promise.resolve({blad: blad}); }
    var kod = q.get('code');
    if(!kod) return Promise.resolve(false);
    var w = pam(WERYF);
    if(!w) return Promise.resolve(false);
    return fetch('https://accounts.spotify.com/api/token', {
      method:'POST', headers:{'Content-Type':'application/x-www-form-urlencoded'},
      body: new URLSearchParams({
        grant_type:'authorization_code', code:kod, redirect_uri:adresPowrotu(),
        client_id:KLIENT, code_verifier:w
      })
    }).then(function(r){ return r.json(); }).then(function(j){
      pam(WERYF, null);
      if(j.access_token) zapiszToken(j);
      history.replaceState({}, '', location.pathname);
      return j.access_token ? {ok:true} : {blad: j.error_description || j.error || 'nieznany blad'};
    }).catch(function(e){ console.error('[spotify]', e); return {blad:'brak polaczenia'}; });
  }

  function token(){
    var z = pam(TOKEN);
    if(!z) return Promise.reject(new Error('niezalogowany'));
    if(Date.now() < z.wazneDo) return Promise.resolve(z.token);
    if(!z.odswiez){ pam(TOKEN, null); return Promise.reject(new Error('sesja wygasla')); }
    return fetch('https://accounts.spotify.com/api/token', {
      method:'POST', headers:{'Content-Type':'application/x-www-form-urlencoded'},
      body: new URLSearchParams({grant_type:'refresh_token', refresh_token:z.odswiez, client_id:KLIENT})
    }).then(function(r){ return r.json(); }).then(function(j){
      if(!j.access_token){ pam(TOKEN, null); throw new Error('sesja wygasla'); }
      zapiszToken(j); return j.access_token;
    });
  }
  function zalogowany(){ return !!pam(TOKEN); }

  function api(sciezka){
    return token().then(function(t){
      return fetch('https://api.spotify.com/v1' + sciezka, {headers:{Authorization:'Bearer '+t}});
    }).then(function(r){
      if(r.status === 401){ pam(TOKEN, null); throw new Error('Sesja wygasła — zaloguj się jeszcze raz.'); }
      if(r.status === 403) throw new Error('Spotify odmówił dostępu. W trybie deweloperskim konto musi być dopisane w User Management.');
      if(!r.ok) throw new Error('Spotify HTTP ' + r.status);
      return r.json();
    });
  }

  /* ---- spis playlist -------------------------------------------------- */
  function spisZPamieci(){ return pam(SPIS) || []; }

  function pobierzSpis(){
    if(!zalogowany()) return Promise.resolve([]);
    return api('/me/playlists?limit=50').then(function(j){
      var spis = [{id:'top', nazwa:'Najczęściej słuchane', ile:50, typ:'top'},
                  {id:'zapisane', nazwa:'Polubione utwory', ile:0, typ:'zapisane'}];
      (j.items||[]).filter(Boolean).forEach(function(p){
        spis.push({id:p.id, nazwa:p.name, ile:(p.tracks||{}).total||0, typ:'playlist'});
      });
      pam(SPIS, spis);
      return spis;
    });
  }

  /* ---- pobieranie utworow --------------------------------------------- */
  function zebrane(sciezka, klucz){
    var out = [];
    function strona(s){
      return api(s).then(function(j){
        (j.items||[]).forEach(function(it){
          var t = klucz ? it[klucz] : it;
          if(t && t.name && t.artists && t.artists.length) out.push({t:t.name, a:t.artists[0].name});
        });
        if(j.next && out.length < LIMIT) return strona(j.next.replace('https://api.spotify.com/v1',''));
      });
    }
    return strona(sciezka).then(function(){ return out.slice(0, LIMIT); });
  }
  function utwory(z){
    if(z.typ === 'top')      return zebrane('/me/top/tracks?limit=50&time_range=medium_term', null);
    if(z.typ === 'zapisane') return zebrane('/me/tracks?limit=50', 'track');
    return zebrane('/playlists/' + z.id + '/tracks?limit=50', 'track');
  }

  /* ---- gotowy repertuar ------------------------------------------------ */
  function repertuar(id){ var r = pam(REP + id); return r ? r.songs : null; }
  function nazwaZrodla(id){
    var r = pam(REP + id);
    if(r && r.nazwa) return r.nazwa;
    var s = spisZPamieci().filter(function(p){ return p.id === id; })[0];
    return s ? s.nazwa : 'Playlista';
  }

  /* buduj(zrodlo, postep) -> Promise({ok, brak:[...]})
     postep(i, ile, opis) wola sie przy kazdym utworze */
  var trwa = false;
  function buduj(zrodlo, postep){
    if(trwa) return Promise.reject(new Error('trwa juz budowanie'));
    trwa = true;
    return utwory(zrodlo).then(function(lista){
      if(!lista.length) throw new Error('Ta lista jest pusta.');
      var znalezione = [], brak = [], widziane = {};
      return new Promise(function(koniec, blad){
        var i = 0;
        (function krok(){
          if(i >= lista.length){
            pam(REP + zrodlo.id, {nazwa: zrodlo.nazwa, songs: znalezione, ts: Date.now()});
            return koniec({ok: znalezione.length, brak: brak});
          }
          if(postep) postep(i+1, lista.length, lista[i].a + ' — ' + lista[i].t);
          window.ITunes.dopasuj(lista[i].t, lista[i].a).then(function(u){
            if(!u) brak.push(lista[i].a + ' — ' + lista[i].t);
            else if(!widziane[u.id]){ widziane[u.id] = 1; znalezione.push(u); }
          }).catch(function(){ brak.push(lista[i].a + ' — ' + lista[i].t); })
            .then(function(){ i++; setTimeout(krok, ODSTEP); });
        })();
      });
    }).then(function(w){ trwa = false; return w; },
            function(e){ trwa = false; throw e; });
  }

  window.Spotify2 = {
    zaloguj: zaloguj, wyloguj: wyloguj, zalogowany: zalogowany,
    obsluzPowrot: obsluzPowrot, pobierzSpis: pobierzSpis, spis: spisZPamieci,
    repertuar: repertuar, nazwaZrodla: nazwaZrodla, buduj: buduj,
    adresPowrotu: adresPowrotu
  };
})();
