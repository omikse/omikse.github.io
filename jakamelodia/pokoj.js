/* ============================================================
   pokoj.js — gra w wielu graczy
   ------------------------------------------------------------
   Wszyscy sluchaja tego samego urywka w tej samej chwili i pisza
   rownoczesnie. Nikt nikogo nie blokuje: urywek rosnie sam,
   po zegarze, a punkty zaleza od tego, jak malo zdazyl odsloniec,
   zanim trafiles.

   Dzwiek nigdy nie idzie miedzy graczami. Kazdy pobiera te sama
   probke od Apple; przez siec leci wylacznie stan pokoju.

   Zegary: host zapisuje `start` w czasie serwera, a kazdy klient
   przelicza go na swoj zegar przez `.info/serverTimeOffset`.
   Dzieki temu nie ma znaczenia, ze komus spieszy sie zegarek.

   O punktach: liczy je host i nadpisuje co runde. Bez serwera nie
   da sie tego zrobic szczelnie — uparty gracz moze sklamac, kiedy
   trafil. To gra dla znajomych, nie turniej.
   ============================================================ */
(function(){
  'use strict';

  var SDK   = 'https://www.gstatic.com/firebasejs/10.12.2/';
  var RUND  = 7;                            // ile melodii na pokoj
  var OKNA  = [0, 5, 10, 15, 20, 25];       // sekunda rundy, w ktorej urywek rosnie
  var RUNDA_S   = 30;                       // dlugosc rundy
  var PRZERWA_S = 6;                        // tablica wynikow miedzy rundami
  var ROZBIEG   = 4000;                     // ms na pobranie i zdekodowanie probki

  var $ = function(id){ return document.getElementById(id); };
  var el = function(t,k,tx){ var e=document.createElement(t); if(k) e.className=k; if(tx!=null) e.textContent=tx; return e; };

  var F = null;                             // uchwyty Firebase
  var P = {                                 // stan pokoju u mnie
    kod:null, uid:null, host:false, imie:null,
    dane:null, offset:0, odpiecie:null, zegary:[], mojeOdp:null, weszlo:false
  };

  /* ---- polaczenie ---------------------------------------------------- */
  function polacz(){
    if(F) return Promise.resolve(F);
    return Promise.all([
      import(SDK+'firebase-app.js'),
      import(SDK+'firebase-auth.js'),
      import(SDK+'firebase-database.js')
    ]).then(function(m){
      var app  = m[0].initializeApp(window.FIREBASE_CONFIG);
      var auth = m[1].getAuth(app);
      return m[1].signInAnonymously(auth).then(function(c){
        var db = m[2].getDatabase(app);
        F = {
          db: db, uid: c.user.uid,
          ref: m[2].ref, set: m[2].set, get: m[2].get, update: m[2].update,
          onValue: m[2].onValue, off: m[2].off, remove: m[2].remove,
          onDisconnect: m[2].onDisconnect
        };
        P.uid = c.user.uid;
        /* roznica miedzy moim zegarem a serwerowym */
        m[2].onValue(m[2].ref(db, '.info/serverTimeOffset'), function(s){
          P.offset = s.val() || 0;
        });
        return F;
      });
    });
  }
  function teraz(){ return Date.now() + P.offset; }        // czas serwera
  function naMoj(tSerwera){ return tSerwera - P.offset; }  // czas serwera -> moj zegar

  function losowyKod(){
    var znaki = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';   // bez I, O, 0, 1 — zeby nie mylic przy dyktowaniu
    var k = '';
    for(var i=0;i<5;i++) k += znaki.charAt(Math.floor(Math.random()*znaki.length));
    return k;
  }

  /* ---- zakladanie i dolaczanie --------------------------------------- */
  function zaloz(imie, wybor){
    return polacz().then(function(){
      var kod = losowyKod();
      P.kod = kod; P.host = true; P.imie = imie;
      return F.set(F.ref(F.db, 'pokoje/'+kod), {
        host: P.uid,
        utworzony: teraz(),
        stan: 'lobby',
        wybor: wybor,
        gracze: (function(){ var g={}; g[P.uid] = {imie:imie, pkt:0}; return g; })()
      }).then(function(){ sluchaj(kod); return kod; });
    });
  }

  function dolacz(kod, imie){
    kod = (kod||'').toUpperCase().replace(/[^A-Z0-9]/g,'');
    return polacz().then(function(){
      return F.get(F.ref(F.db, 'pokoje/'+kod)).then(function(s){
        if(!s.exists()) throw new Error('Nie ma takiego pokoju.');
        var d = s.val();
        if(d.stan !== 'lobby') throw new Error('Ta gra już się zaczęła.');
        P.kod = kod; P.host = (d.host === P.uid); P.imie = imie;
        /* wlasny wpis — tylko to wolno mi zapisac w cudzym pokoju */
        return F.set(F.ref(F.db, 'pokoje/'+kod+'/gracze/'+P.uid+'/imie'), imie)
          .then(function(){ return F.set(F.ref(F.db, 'pokoje/'+kod+'/gracze/'+P.uid+'/pkt'), 0); })
          .then(function(){ sluchaj(kod); return kod; });
      });
    });
  }

  function wyjdz(){
    czyscZegary();
    if(P.odpiecie){ P.odpiecie(); P.odpiecie = null; }
    if(F && P.kod){
      if(P.host) F.remove(F.ref(F.db, 'pokoje/'+P.kod));                      // host gasi swiatlo
      else       F.remove(F.ref(F.db, 'pokoje/'+P.kod+'/gracze/'+P.uid));
    }
    P.kod = null; P.host = false; P.dane = null; P.weszlo = false;
    window.Audio2.stop();
    window.Gra.pokaz('ekran-start');
    window.Audio2.motywStart();
  }

  /* ---- nasluch ------------------------------------------------------- */
  function sluchaj(kod){
    var r = F.ref(F.db, 'pokoje/'+kod);
    P.odpiecie = F.onValue(r, function(s){
      if(!s.exists()){                       // host zamknal pokoj
        if(P.kod){ alertLobby('Pokój został zamknięty.'); wyjdz(); }
        return;
      }
      P.dane = s.val();
      reaguj(P.dane);
    });
  }

  function alertLobby(t){
    var b = $('pokoj-blad'); if(!b) return;
    b.textContent = t; b.classList.remove('hide');
    setTimeout(function(){ b.classList.add('hide'); }, 4000);
  }

  /* ---- reakcja na zmiane stanu --------------------------------------- */
  var ostatniaRunda = null, ostatniStan = null;

  function reaguj(d){
    if(d.stan === 'lobby'){
      ostatniaRunda = null;
      window.Gra.pokaz('ekran-pokoj');
      rysujLobby(d);
    }
    else if(d.stan === 'gra'){
      rysujPasekGraczy(d);
      var klucz = d.runda ? (d.runda.nr + ':' + d.runda.id) : null;
      if(klucz && klucz !== ostatniaRunda){
        ostatniaRunda = klucz;
        zacznijRunde(d);
      }
    }
    else if(d.stan === 'przerwa'){
      if(ostatniStan !== 'przerwa'){ czyscZegary(); window.Audio2.stop(); rysujTablice(d, false); }
      else rysujTablice(d, false);
    }
    else if(d.stan === 'koniec'){
      if(ostatniStan !== 'koniec'){ czyscZegary(); window.Audio2.stop(); rysujTablice(d, true); window.Audio2.final(); }
    }
    ostatniStan = d.stan;
    if(P.host) pilnujRundy(d);
  }

  /* ---- lobby --------------------------------------------------------- */
  function rysujLobby(d){
    $('pokoj-kod').textContent = P.kod;
    var link = location.origin + location.pathname + '?pokoj=' + P.kod;
    $('pokoj-link').value = link;
    var lista = $('pokoj-gracze'); lista.innerHTML = '';
    var g = d.gracze || {};
    Object.keys(g).forEach(function(uid){
      var w = el('div','pokoj-gracz');
      w.appendChild(el('span','pg-imie', g[uid].imie));
      if(uid === d.host) w.appendChild(el('span','pg-rola','gospodarz'));
      if(uid === P.uid) w.appendChild(el('span','pg-ty','to Ty'));
      lista.appendChild(w);
    });
    var ilu = Object.keys(g).length;
    $('pokoj-ilu').textContent = ilu === 1 ? 'Na razie tylko Ty' : (ilu + ' graczy w pokoju');
    $('pokoj-start').classList.toggle('hide', !P.host);
    $('pokoj-start').disabled = ilu < 2;
    $('pokoj-czekaj').classList.toggle('hide', P.host);
    $('pokoj-repertuar').textContent = opisWyboru(d.wybor);
  }

  function opisWyboru(w){
    if(!w) return '';
    var g = w.gat === 'wszystko' ? 'Wszystko'
          : (window.GATUNKI.filter(function(x){ return x.id===w.gat; })[0]||{}).name || w.gat;
    var k = w.polska ? 'Polska' : 'Polska i świat';
    return g + ' · ' + k + ' · ' + w.od + '–' + w.do;
  }

  /* ---- prowadzenie gry (tylko host) ---------------------------------- */
  function pulaPokoju(d){
    return window.Gra.pulaDlaWyboru(d.wybor);
  }

  function zacznijGre(){
    if(!P.host || !P.dane) return;
    var pula = pulaPokoju(P.dane);
    if(pula.length < RUND){ alertLobby('Za mało melodii dla siedmiu rund — zmień repertuar.'); return; }
    nastepnaRunda(1);
  }

  function nastepnaRunda(nr){
    var d = P.dane;
    var pula = pulaPokoju(d);
    var uzyte = (d.runda && d.runda.byly) ? String(d.runda.byly).split(',') : [];
    var wolne = pula.filter(function(s){ return uzyte.indexOf(String(s.id)) < 0; });
    if(!wolne.length) wolne = pula;
    var u = wolne[Math.floor(Math.random()*wolne.length)];
    uzyte.push(String(u.id));

    var start = teraz() + ROZBIEG;
    var g = d.gracze || {};
    var wpisy = {};
    Object.keys(g).forEach(function(uid){ wpisy['gracze/'+uid+'/odp'] = null; });   // czysta karta
    wpisy['stan']  = 'gra';
    wpisy['runda'] = { nr: nr, id: u.id, start: start, byly: uzyte.join(',') };
    F.update(F.ref(F.db, 'pokoje/'+P.kod), wpisy);
  }

  /* host zamyka runde, gdy wszyscy odpowiedzieli albo minal czas */
  var pilnowanie = null;
  function pilnujRundy(d){
    if(d.stan !== 'gra' || !d.runda) { if(pilnowanie){ clearTimeout(pilnowanie); pilnowanie=null; } return; }
    var g = d.gracze || {};
    var wszyscy = Object.keys(g).every(function(uid){ return g[uid].odp !== undefined && g[uid].odp !== null; });
    var doKonca = naMoj(d.runda.start) + RUNDA_S*1000 - Date.now();
    if(wszyscy || doKonca <= 0){ zamknijRunde(d); return; }
    if(!pilnowanie){
      pilnowanie = setTimeout(function(){ pilnowanie = null; if(P.dane) pilnujRundy(P.dane); }, Math.min(doKonca+200, 2000));
    }
  }

  function zamknijRunde(d){
    if(pilnowanie){ clearTimeout(pilnowanie); pilnowanie = null; }
    var g = d.gracze || {};
    var wpisy = {};
    Object.keys(g).forEach(function(uid){
      var o = g[uid].odp;
      var zdobyte = (typeof o === 'number' && o >= 0) ? (OKNA.length - o) : 0;
      wpisy['gracze/'+uid+'/pkt'] = (g[uid].pkt || 0) + zdobyte;
    });
    var ostatnia = d.runda.nr >= RUND;
    wpisy['stan'] = ostatnia ? 'koniec' : 'przerwa';
    F.update(F.ref(F.db, 'pokoje/'+P.kod), wpisy).then(function(){
      if(!ostatnia) setTimeout(function(){ if(P.host && P.dane && P.dane.stan==='przerwa') nastepnaRunda(d.runda.nr+1); }, PRZERWA_S*1000);
    });
  }

  /* ---- runda u gracza ------------------------------------------------ */
  function czyscZegary(){ P.zegary.forEach(clearTimeout); P.zegary = []; }

  function zacznijRunde(d){
    czyscZegary();
    P.mojeOdp = null;
    var utwor = window.KATALOG.filter(function(s){ return s.id === d.runda.id; })[0];
    if(!utwor){ console.error('[pokoj] nie znam utworu', d.runda.id); return; }

    window.ITunes.rozwiaz([utwor]).then(function(r){
      if(!r.ok.length) throw new Error('brak probki');
      var u = r.ok[0];
      window.Audio2.wczytaj(u.preview).catch(function(){});
      var doStartu = naMoj(d.runda.start) - Date.now();

      window.Gra.startMulti(u, {
        rundaNr: d.runda.nr, zRund: RUND,
        odp: function(okno){                      // trafilem
          P.mojeOdp = okno;
          F.set(F.ref(F.db, 'pokoje/'+P.kod+'/gracze/'+P.uid+'/odp'), okno);
        }
      });

      /* urywek rosnie sam, po wspolnym zegarze */
      OKNA.forEach(function(sek, i){
        P.zegary.push(setTimeout(function(){ window.Gra.oknoMulti(i); }, Math.max(0, doStartu + sek*1000)));
      });
      /* koniec rundy — kto nie trafil, oddaje puste */
      P.zegary.push(setTimeout(function(){
        window.Gra.koniecMulti();
        if(P.mojeOdp === null) F.set(F.ref(F.db, 'pokoje/'+P.kod+'/gracze/'+P.uid+'/odp'), -1);
      }, Math.max(0, doStartu + RUNDA_S*1000)));
    }).catch(function(e){ console.error('[pokoj]', e); });
  }

  /* pasek z graczami na ekranie gry */
  function rysujPasekGraczy(d){
    var box = $('pasek-graczy'); if(!box) return;
    box.innerHTML = '';
    var g = d.gracze || {};
    Object.keys(g).sort(function(a,b){ return (g[b].pkt||0)-(g[a].pkt||0); }).forEach(function(uid){
      var gotowy = g[uid].odp !== undefined && g[uid].odp !== null;
      var w = el('span','gracz-znacznik' + (gotowy ? ' gotowy' : '') + (uid===P.uid ? ' ja' : ''));
      w.appendChild(el('b', null, g[uid].imie));
      w.appendChild(el('i', null, (g[uid].pkt||0) + ' pkt'));
      box.appendChild(w);
    });
  }

  /* ---- tablica wynikow ------------------------------------------------ */
  function rysujTablice(d, koniec){
    window.Gra.pokaz('ekran-tablica');
    var g = d.gracze || {};
    var kolejnosc = Object.keys(g).sort(function(a,b){ return (g[b].pkt||0)-(g[a].pkt||0); });
    $('tab-tytul').textContent = koniec ? 'Koniec gry' : ('Po rundzie ' + (d.runda ? d.runda.nr : '') + ' z ' + RUND);
    var u = d.runda ? window.KATALOG.filter(function(s){ return s.id===d.runda.id; })[0] : null;
    $('tab-utwor').textContent = u ? ('To była: ' + u.t + ' — ' + u.a) : '';
    var l = $('tab-lista'); l.innerHTML = '';
    kolejnosc.forEach(function(uid, i){
      var w = el('div','p-wiersz' + (uid===P.uid ? ' ja' : ''));
      w.appendChild(el('span','p-nr', (i+1)+'.'));
      var t = el('span','p-tyt'); t.appendChild(el('b',null,g[uid].imie));
      var o = g[uid].odp;
      t.appendChild(el('i',null, (typeof o==='number' && o>=0) ? ('trafił przy ' + [1,2,4,7,11,16][o] + ' s') : 'nie trafił'));
      w.appendChild(t);
      w.appendChild(el('span','p-pkt', (g[uid].pkt||0) + ' pkt'));
      l.appendChild(w);
    });
    $('tab-czekaj').textContent = koniec ? '' : 'Następna melodia za chwilę…';
    $('tab-wyjdz').textContent = koniec ? 'Wróć do menu' : 'Opuść pokój';
  }

  /* ---- podpiecie UI --------------------------------------------------- */
  function imieZPola(){
    var i = ($('pokoj-imie').value || '').trim().slice(0,24);
    return i || 'Gracz';
  }

  function podepnij(){
    $('pokoj-zaloz').onclick = function(){
      var b = $('pokoj-zaloz'); b.disabled = true;
      zaloz(imieZPola(), window.Gra.biezacyWybor()).then(function(){ b.disabled = false; })
        .catch(function(e){ b.disabled = false; alertLobby('Nie udało się założyć pokoju.'); console.error(e); });
    };
    $('pokoj-dolacz').onclick = function(){
      var b = $('pokoj-dolacz'); b.disabled = true;
      dolacz($('pokoj-kod-wpis').value, imieZPola()).then(function(){ b.disabled = false; })
        .catch(function(e){ b.disabled = false; alertLobby(e.message || 'Nie udało się dołączyć.'); });
    };
    $('pokoj-start').onclick = zacznijGre;
    $('pokoj-wyjdz').onclick = wyjdz;
    $('tab-wyjdz').onclick = wyjdz;
    $('pokoj-kopiuj').onclick = function(){
      var p = $('pokoj-link'); p.select();
      if(navigator.clipboard) navigator.clipboard.writeText(p.value).catch(function(){});
      var b = $('pokoj-kopiuj'), t = b.textContent;
      b.textContent = 'Skopiowano!'; setTimeout(function(){ b.textContent = t; }, 1500);
    };
    /* wejscie z linku */
    var z = new URLSearchParams(location.search).get('pokoj');
    if(z){ $('pokoj-kod-wpis').value = z.toUpperCase(); window.Gra.otworzPanelPokoju(); }
  }

  window.Pokoj = { zaloz: zaloz, dolacz: dolacz, wyjdz: wyjdz, podepnij: podepnij,
                   stan: function(){ return P; } };
})();
