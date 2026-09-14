/* ============================================================
   spotify.js — repertuar z playlisty gracza
   ------------------------------------------------------------
   Spotify mowi, CZEGO sluchasz. Dzwieku nie daje i nie moze dac:
   pole `preview_url` jest u nich oznaczone jako wycofane i czesto
   puste, a regulamin zabrania robic z tych urywkow osobnej uslugi.
   Pelne odtwarzanie idzie przez Web Playback SDK, ktory wymaga
   konta Premium u kazdego grajacego.

   Dlatego z playlisty bierzemy tylko tytuly i wykonawcow, a potem
   szukamy tych samych utworow w katalogu Apple — stamtad leci
   probka. Czesc nagran sie nie znajdzie; pokazujemy wprost ktore,
   zamiast po cichu skracac playliste.

   Logowanie: Authorization Code z PKCE. Dziala bez serwera i bez
   sekretu, wiec nadaje sie na strone statyczna.
   ============================================================ */
(function(){
  'use strict';

  var KLIENT  = 'cbb494e292c4450d815bc47b6fe2582d';
  var ZAKRES  = 'playlist-read-private playlist-read-collaborative user-top-read user-library-read';
  var KLUCZ   = 'jtm.sp';
  var WERYF   = 'jtm.sp.weryfikator';
  var ODSTEP  = 1300;    // ms miedzy zapytaniami do Apple
  var LIMIT   = 120;     // ile utworow z playlisty bierzemy pod uwage

  var $ = function(id){ return document.getElementById(id); };
  var el = function(t,k,tx){ var e=document.createElement(t); if(k) e.className=k; if(tx!=null) e.textContent=tx; return e; };

  function pam(k, v){
    try{
      if(v===undefined){ var x = localStorage.getItem(k); return x ? JSON.parse(x) : null; }
      if(v===null) localStorage.removeItem(k); else localStorage.setItem(k, JSON.stringify(v));
    }catch(e){ return null; }
  }

  /* Adres powrotu musi zgadzac sie CO DO ZNAKU z wpisanym w panelu Spotify.
     Na stronie mozna wyladowac na dwa sposoby: przez /jakamelodia/ albo przez
     /jakamelodia/index.html (tak linkuje karta na stronie glownej). Goly
     location.pathname zwrocilby wtedy dwa rozne adresy i Spotify odrzucilby
     ten z nazwa pliku. Dlatego obcinamy nazwe pliku i pilnujemy ukosnika. */
  function adresPowrotu(){
    var p = location.pathname;
    if(/\/[^\/]*\.[^\/]*$/.test(p)) p = p.replace(/[^\/]*$/, '');  // /a/index.html -> /a/
    if(p.charAt(p.length - 1) !== '/') p += '/';                    // /a -> /a/
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
  function wyzwanie(weryfikator){
    return crypto.subtle.digest('SHA-256', new TextEncoder().encode(weryfikator)).then(base64url);
  }

  /* ---- logowanie ------------------------------------------------------ */
  function zaloguj(){
    var weryfikator = losowyCiag(96);
    pam(WERYF, weryfikator);
    return wyzwanie(weryfikator).then(function(ch){
      var q = new URLSearchParams({
        client_id: KLIENT,
        response_type: 'code',
        redirect_uri: adresPowrotu(),
        code_challenge_method: 'S256',
        code_challenge: ch,
        scope: ZAKRES
      });
      location.href = 'https://accounts.spotify.com/authorize?' + q.toString();
    });
  }

  function wyloguj(){
    pam(KLUCZ, null);
    rysujPanel();
  }

  function zapiszToken(j){
    pam(KLUCZ, {
      token: j.access_token,
      odswiez: j.refresh_token || (pam(KLUCZ)||{}).odswiez,
      wazneDo: Date.now() + (j.expires_in || 3600)*1000 - 60000
    });
  }

  /* powrot z ekranu zgody — wymiana kodu na token */
  function obsluzPowrot(){
    var q = new URLSearchParams(location.search);
    var blad = q.get('error');
    if(blad){
      history.replaceState({}, '', location.pathname);
      return Promise.resolve({blad: blad});
    }
    var kod = q.get('code');
    if(!kod) return Promise.resolve(false);
    var weryfikator = pam(WERYF);
    if(!weryfikator) return Promise.resolve(false);
    var body = new URLSearchParams({
      grant_type: 'authorization_code',
      code: kod,
      redirect_uri: adresPowrotu(),
      client_id: KLIENT,
      code_verifier: weryfikator
    });
    return fetch('https://accounts.spotify.com/api/token', {
      method:'POST', headers:{'Content-Type':'application/x-www-form-urlencoded'}, body: body
    }).then(function(r){ return r.json(); }).then(function(j){
      pam(WERYF, null);
      if(j.access_token){ zapiszToken(j); }
      /* sprzatamy adres, zeby kod nie zostal w historii */
      history.replaceState({}, '', location.pathname);
      return !!j.access_token;
    }).catch(function(e){ console.error('[spotify]', e); return false; });
  }

  function token(){
    var z = pam(KLUCZ);
    if(!z) return Promise.reject(new Error('niezalogowany'));
    if(Date.now() < z.wazneDo) return Promise.resolve(z.token);
    if(!z.odswiez){ pam(KLUCZ, null); return Promise.reject(new Error('token wygasl')); }
    var body = new URLSearchParams({grant_type:'refresh_token', refresh_token:z.odswiez, client_id:KLIENT});
    return fetch('https://accounts.spotify.com/api/token', {
      method:'POST', headers:{'Content-Type':'application/x-www-form-urlencoded'}, body: body
    }).then(function(r){ return r.json(); }).then(function(j){
      if(!j.access_token){ pam(KLUCZ, null); throw new Error('nie udalo sie odswiezyc'); }
      zapiszToken(j); return j.access_token;
    });
  }
  function zalogowany(){ return !!pam(KLUCZ); }

  function api(sciezka){
    return token().then(function(t){
      return fetch('https://api.spotify.com/v1' + sciezka, {headers:{Authorization:'Bearer '+t}});
    }).then(function(r){
      if(r.status === 401){ pam(KLUCZ, null); throw new Error('Sesja wygasła — zaloguj się ponownie.'); }
      if(r.status === 403) throw new Error('Spotify odmówił dostępu. W trybie deweloperskim konto musi być dodane w User Management.');
      if(!r.ok) throw new Error('Spotify HTTP ' + r.status);
      return r.json();
    });
  }

  /* ---- zrodla utworow ------------------------------------------------- */
  function playlisty(){
    return api('/me/playlists?limit=50').then(function(j){
      return (j.items||[]).filter(Boolean).map(function(p){
        return {id:p.id, nazwa:p.name, ile:(p.tracks||{}).total||0, typ:'playlist'};
      });
    });
  }
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
  function utwory(zrodlo){
    if(zrodlo.typ === 'top')      return zebrane('/me/top/tracks?limit=50&time_range=medium_term', null);
    if(zrodlo.typ === 'zapisane') return zebrane('/me/tracks?limit=50', 'track');
    return zebrane('/playlists/' + zrodlo.id + '/tracks?limit=50', 'track');
  }

  /* ---- budowanie repertuaru ------------------------------------------- */
  var trwa = false;
  function zbuduj(zrodlo){
    if(trwa) return;
    trwa = true;
    $('sp-wynik').classList.add('hide');
    $('sp-postep').classList.remove('hide');
    $('sp-licznik').textContent = 'pobieram listę…';

    utwory(zrodlo).then(function(lista){
      if(!lista.length) throw new Error('Ta lista jest pusta.');
      var znalezione = [], brak = [], widziane = {}, i = 0;

      function krok(){
        if(i >= lista.length) return koniec();
        $('sp-licznik').textContent = (i+1) + ' z ' + lista.length;
        $('sp-pasek').style.width = (100*i/lista.length).toFixed(1) + '%';
        $('sp-teraz').textContent = lista[i].a + ' — ' + lista[i].t;
        window.ITunes.dopasuj(lista[i].t, lista[i].a).then(function(u){
          if(!u) brak.push(lista[i].a + ' — ' + lista[i].t);
          else if(!widziane[u.id]){ widziane[u.id] = 1; znalezione.push(u); }
        }).catch(function(){ brak.push(lista[i].a + ' — ' + lista[i].t); })
          .then(function(){ i++; setTimeout(krok, ODSTEP); });
      }

      function koniec(){
        trwa = false;
        $('sp-postep').classList.add('hide');
        $('sp-wynik').classList.remove('hide');
        if(znalezione.length < 6){
          $('sp-tresc').className = 'komunikat blad';
          $('sp-tresc').textContent = 'Udało się dopasować tylko ' + znalezione.length +
            ' melodii — za mało do gry. Spróbuj innej playlisty.';
          return;
        }
        window.Moje.zapisz(zrodlo.nazwa, znalezione);
        var t = 'Gotowe — ' + znalezione.length + ' melodii z „' + zrodlo.nazwa + '".';
        if(brak.length) t += ' Nie znalazłem w katalogu Apple ' + brak.length + ': ' + brak.slice(0,5).join('; ') + (brak.length>5 ? '…' : '');
        $('sp-tresc').className = 'komunikat';
        $('sp-tresc').textContent = t;
        if(window.odswiezMenu) window.odswiezMenu('moje');
      }
      krok();
    }).catch(function(e){
      trwa = false;
      $('sp-postep').classList.add('hide');
      $('sp-wynik').classList.remove('hide');
      $('sp-tresc').className = 'komunikat blad';
      $('sp-tresc').textContent = e.message || 'Nie udało się pobrać listy.';
    });
  }

  /* ---- panel ---------------------------------------------------------- */
  function rysujPanel(){
    var box = $('sp-zrodla');
    $('sp-zaloguj').classList.toggle('hide', zalogowany());
    $('sp-wyloguj').classList.toggle('hide', !zalogowany());
    box.innerHTML = '';
    if(!zalogowany()) return;

    [{typ:'top', nazwa:'Twoje najczęściej słuchane', ile:50},
     {typ:'zapisane', nazwa:'Polubione utwory', ile:0}].forEach(function(z){ box.appendChild(wiersz(z)); });

    playlisty().then(function(ps){
      ps.forEach(function(p){ box.appendChild(wiersz(p)); });
      if(!ps.length) box.appendChild(el('p','komunikat','Nie widzę żadnych playlist na tym koncie.'));
    }).catch(function(e){
      box.appendChild(el('p','komunikat blad', e.message));
    });
  }
  function wiersz(z){
    var b = el('button','sp-zrodlo');
    b.appendChild(el('span','sp-nazwa', z.nazwa));
    if(z.ile) b.appendChild(el('span','sp-ile', z.ile + ' utworów'));
    b.onclick = function(){ zbuduj(z); };
    return b;
  }

  function podepnij(){
    $('sp-otworz').onclick = function(){
      var p = $('panel-spotify');
      p.classList.toggle('hide');
      if(!p.classList.contains('hide')) rysujPanel();
    };
    $('sp-zaloguj').onclick = zaloguj;
    $('sp-wyloguj').onclick = wyloguj;

    obsluzPowrot().then(function(wynik){
      if(!wynik) return;
      $('panel-spotify').classList.remove('hide');
      if(wynik.blad){
        $('sp-wynik').classList.remove('hide');
        $('sp-tresc').className = 'komunikat blad';
        $('sp-tresc').textContent = wynik.blad === 'access_denied'
          ? 'Logowanie zostalo przerwane.'
          : ('Spotify odmowil: ' + wynik.blad + '. Adres powrotu, ktory wysylamy, to ' +
             adresPowrotu() + ' — musi byc wpisany w panelu aplikacji co do znaku.');
      }
      rysujPanel();
    });
  }

  window.Spotify2 = { zaloguj:zaloguj, wyloguj:wyloguj, zalogowany:zalogowany, podepnij:podepnij };
})();
