/* ============================================================
   game.js — logika teleturnieju
   ------------------------------------------------------------
   Menu czyta sie od lewej do prawej: najpierw ilu graczy, potem
   z czego ma byc repertuar (gatunek, kraj, lata), a na koncu
   tryb gry. Repertuar nie jest juz gotowa lista — powstaje
   z filtrow nalozonych na plaski katalog w songs.js.

   Sama runda to jeden utwor i szesc podejsc; po kazdym pudle
   albo pominieciu odslania sie dluzszy urywek.
   ============================================================ */
(function(){
  'use strict';

  var DLUGOSCI = [1, 2, 4, 7, 11, 16];   // sekundy urywka w kolejnych podejsciach
  var PROB     = DLUGOSCI.length;
  var RUNDA_N  = 7;                       // ile utworow w rundzie
  var PELNA    = 30;                      // dlugosc calej probki
  var MIN_PULA = 6;                       // ponizej tego nie ma sensownych podpowiedzi
  var ROK_MIN  = 1940;
  var ROK_MAX  = new Date().getFullYear();

  var $  = function(id){ return document.getElementById(id); };
  var el = function(t, k, tx){ var e=document.createElement(t); if(k) e.className=k; if(tx!=null) e.textContent=tx; return e; };

  var mem = {
    get: function(k, d){ try{ var v=localStorage.getItem('jtm.'+k); return v==null?d:JSON.parse(v); }catch(e){ return d; } },
    set: function(k, v){ try{ localStorage.setItem('jtm.'+k, JSON.stringify(v)); }catch(e){} }
  };

  /* porownywanie tytulow: bez wielkosci liter, bez ogonkow, bez znakow */
  function norm(s){
    return (s||'').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g,'')
                  .replace(/ł/g,'l').replace(/[^a-z0-9]/g,'');
  }
  function pasuje(wpis, utwor){
    var w = norm(wpis);
    if(!w) return false;
    if(w === norm(utwor.t)) return true;
    return (utwor.alt||[]).some(function(a){ return norm(a)===w; });
  }

  /* ---- stan ---- */
  var S = {
    gracze: 'jeden',
    wybor: { gat:'wszystko', polska:false, od:ROK_MIN, do:ROK_MAX, sp:null },
    pula: [], gotowaDla: null,
    tryb: 'dzienna',
    utwor:null, proba:0, odpowiedzi:[], koniec:false, wygrana:false,
    rundaNr:0, rundaPkt:0, rundaLog:[], data:null
  };

  function dzisiaj(){
    var q = new URLSearchParams(location.search).get('date');
    if(q && /^\d{4}-\d{2}-\d{2}$/.test(q)) return q;
    var d = new Date();
    return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');
  }
  function hasz(s){
    var h = 2166136261;
    for(var i=0;i<s.length;i++){ h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
    return h >>> 0;
  }

  function pokaz(id){
    ['ekran-start','ekran-gra','ekran-wynik','ekran-podium','ekran-pokoj','ekran-tablica'].forEach(function(e){
      $(e).classList.toggle('hide', e!==id);
    });
  }

  /* ============================================================
     repertuar z filtrow
     ============================================================ */
  /* ta sama filtracja, ale dla wyboru podanego z zewnatrz (pokoj bierze wybor hosta) */
  function pulaDlaWyboru(w){
    return window.KATALOG.filter(function(s){
      if(w.gat !== 'wszystko' && s.g !== w.gat) return false;
      if(w.polska && s.k !== 'pl') return false;
      return s.r >= w.od && s.r <= w.do;
    });
  }
  function biezacyWybor(){
    return { gat:S.wybor.gat, polska:S.wybor.polska, od:S.wybor.od, do:S.wybor.do };
  }

  function pulaSurowa(){
    if(S.wybor.sp) return (window.Spotify2 && window.Spotify2.repertuar(S.wybor.sp)) || [];
    return window.KATALOG.filter(function(s){
      if(S.wybor.gat !== 'wszystko' && s.g !== S.wybor.gat) return false;
      if(S.wybor.polska && s.k !== 'pl') return false;
      return s.r >= S.wybor.od && s.r <= S.wybor.do;
    });
  }
  /* podpis wyboru — wchodzi w losowanie melodii dnia i w tekst do skopiowania,
     zeby ta sama melodia dnia wypadla kazdemu, kto ustawil to samo */
  function podpisWyboru(){
    if(S.wybor.sp) return 'sp:' + S.wybor.sp;
    return S.wybor.gat + '/' + (S.wybor.polska?'pl':'wsz') + '/' + S.wybor.od + '-' + S.wybor.do;
  }
  function nazwaWyboru(){
    if(S.wybor.sp) return window.Spotify2.nazwaZrodla(S.wybor.sp);
    var g = S.wybor.gat === 'wszystko' ? 'Wszystko'
          : (window.GATUNKI.filter(function(x){ return x.id===S.wybor.gat; })[0]||{}).name;
    var k = S.wybor.polska ? 'Polska' : 'Polska i świat';
    var l = (S.wybor.od <= ROK_MIN && S.wybor.do >= ROK_MAX) ? 'wszystkie lata' : (S.wybor.od + '–' + S.wybor.do);
    return g + ' · ' + k + ' · ' + l;
  }

  /* ============================================================
     menu — trzy kolumny od lewej do prawej
     ============================================================ */
  function wczytajWybor(){
    var z = mem.get('wybor', null);
    if(z && typeof z === 'object'){
      S.wybor.gat    = z.gat || 'wszystko';
      S.wybor.polska = !!z.polska;
      S.wybor.od   = Math.max(ROK_MIN, Math.min(ROK_MAX, z.od || ROK_MIN));
      S.wybor.do   = Math.max(S.wybor.od, Math.min(ROK_MAX, z.do || ROK_MAX));
      S.wybor.sp   = z.sp || null;
    }
    /* repertuar ze Spotify mogl zostac wyczyszczony razem z wylogowaniem */
    if(S.wybor.sp && !(window.Spotify2 && window.Spotify2.repertuar(S.wybor.sp))) S.wybor.sp = null;
  }
  function zapiszWybor(){ mem.set('wybor', S.wybor); }

  /* kolumna 1 — ilu graczy */
  function rysujGraczy(){
    var box = $('kol-gracze'); box.innerHTML = '';
    [['jeden','Jeden gracz','Grasz sam, przy swoim ekranie'],
     ['wielu','Wielu graczy','Wspólny pokój — wszyscy zgadują naraz']
    ].forEach(function(o){
      var b = el('button', 'wybierak' + (S.gracze===o[0] ? ' wybrany' : ''));
      b.appendChild(el('span','wybierak-nazwa', o[1]));
      b.appendChild(el('span','wybierak-opis', o[2]));
      b.onclick = function(){
        S.gracze = o[0];
        rysujGraczy();
        $('panel-pokoj').classList.toggle('hide', o[0] !== 'wielu');
        $('kol-tryby').classList.toggle('przygaszone', o[0] === 'wielu');
      };
      box.appendChild(b);
    });
    $('panel-pokoj').classList.toggle('hide', S.gracze !== 'wielu');
    $('kol-tryby').classList.toggle('przygaszone', S.gracze === 'wielu');
  }

  /* kolumna 2 — z czego repertuar */
  function rysujRepertuar(){
    var box = $('kol-gatunki'); box.innerHTML = '';
    var pozycje = [{id:'wszystko', name:'Wszystko', opis:'Cały katalog'}].concat(window.GATUNKI);
    pozycje.forEach(function(g){
      var b = el('button', 'gatunek' + (!S.wybor.sp && S.wybor.gat===g.id ? ' wybrany' : ''));
      b.appendChild(el('span','gatunek-nazwa', g.name));
      b.appendChild(el('span','gatunek-opis', g.opis));
      b.onclick = function(){ S.wybor.gat = g.id; S.wybor.sp = null; rysujRepertuar(); odswiez(); };
      box.appendChild(b);
    });

    rysujMoje();

    /* tylko polskie */
    $('tp-check').checked = S.wybor.polska;
    $('tp-prze').classList.toggle('wl', S.wybor.polska);

    $('lata-od').value = S.wybor.od;
    $('lata-do').value = S.wybor.do;
    rysujSuwak();
    /* przy cudzej playliscie filtry katalogu (polskie, lata) nie maja czego dotyczyc */
    $('blok-lata').classList.toggle('przygaszone', !!S.wybor.sp);
    $('blok-polska').classList.toggle('przygaszone', !!S.wybor.sp);
  }

  /* ---- "Moje" — playlista ze Spotify, jako jedna pozycja wygladem
     dopasowana do przyciskow gatunkow. Zwiniety to zwykly dropdown;
     pierwsze wejscie w playliste buduje z niej repertuar (kazdy tytul
     trzeba odszukac w katalogu Apple, po jednym co 1,3 s), kolejne sa
     natychmiastowe, bo wynik lezy w pamieci przegladarki. */
  function rysujMoje(){
    var sp = window.Spotify2;
    var sel = $('sel-moje');
    sel.innerHTML = '';
    sel.classList.toggle('wybrany', !!S.wybor.sp);
    $('moje-wyloguj').classList.toggle('hide', !sp.zalogowany());

    if(!sp.zalogowany()){
      sel.appendChild(el('option', null, 'Moje — zaloguj się przez Spotify'));
      sel.onchange = null;
      sel.onmousedown = function(e){ e.preventDefault(); sp.zaloguj(); };
      return;
    }
    sel.onmousedown = null;

    var spis = sp.spis();
    var pierwsza = el('option', null, 'Moje');
    pierwsza.value = ''; pierwsza.disabled = true;
    sel.appendChild(pierwsza);

    if(!spis.length){
      var czekaj = el('option', null, 'Pobieram playlisty…');
      czekaj.value = ''; czekaj.disabled = true;
      sel.appendChild(czekaj);
      sel.value = '';
      sel.onchange = null;
      return;
    }
    spis.forEach(function(p){
      var gotowy = sp.repertuar(p.id);
      var o = el('option', null,
        p.nazwa + ' — ' + (gotowy ? gotowy.length + ' gotowych' : (p.ile ? p.ile + ' utworów' : 'kliknij, żeby wczytać')));
      o.value = p.id;
      sel.appendChild(o);
    });
    sel.value = S.wybor.sp || '';
    sel.onchange = function(){
      var p = spis.filter(function(x){ return x.id === sel.value; })[0];
      if(p) wezPlayliste(p);
    };
  }

  function spKomunikat(tekst, czyBlad){
    var e = $('sp-blad');
    e.classList.remove('hide');
    e.className = 'komunikat' + (czyBlad ? ' blad' : '');
    e.textContent = tekst;
  }

  function wezPlayliste(p){
    var sp = window.Spotify2;
    if(sp.repertuar(p.id)){ S.wybor.sp = p.id; rysujRepertuar(); odswiez(); return; }
    $('sp-blad').classList.add('hide');
    $('sp-postep').classList.remove('hide');
    sp.buduj(p, function(i, ile, opis){
      $('sp-licznik').textContent = i + ' z ' + ile;
      $('sp-pasek').style.width = (100*i/ile).toFixed(1) + '%';
      $('sp-teraz').textContent = opis;
    }).then(function(w){
      $('sp-postep').classList.add('hide');
      if(w.ok < MIN_PULA){
        spKomunikat('Z tej playlisty dopasowałem tylko ' + w.ok + ' melodii — za mało do gry.', true);
        rysujMoje();
        return;
      }
      S.wybor.sp = p.id;
      rysujRepertuar(); odswiez();
      if(w.brak.length)
        spKomunikat('Nie znalazłem w katalogu Apple ' + w.brak.length + ': ' +
                    w.brak.slice(0,4).join('; ') + (w.brak.length > 4 ? '…' : ''), false);
    }).catch(function(e){
      $('sp-postep').classList.add('hide');
      spKomunikat(e.message || 'Nie udało się wczytać playlisty.', true);
    });
  }

  function odswiezSpis(){
    return window.Spotify2.pobierzSpis()
      .then(function(){ rysujMoje(); })
      .catch(function(e){ spKomunikat(e.message, true); });
  }

  function rysujSuwak(){
    var a = (S.wybor.od - ROK_MIN) / (ROK_MAX - ROK_MIN) * 100;
    var b = (S.wybor.do - ROK_MIN) / (ROK_MAX - ROK_MIN) * 100;
    $('lata-wybor').style.left  = a + '%';
    $('lata-wybor').style.width = (b - a) + '%';
    $('lata-etykieta').textContent = S.wybor.od + ' – ' + S.wybor.do;
  }

  /* kolumna 3 — tryb; odblokowana dopiero, gdy jest z czego grac */
  function odswiez(){
    S.gotowaDla = null;                       // wybor sie zmienil, trzeba pobrac na nowo
    var n = pulaSurowa().length;
    var dosc = n >= MIN_PULA;
    $('licznik-melodii').textContent = n === 0 ? 'brak melodii'
        : (n + (n===1 ? ' melodia' : (n<5 ? ' melodie' : ' melodii')));
    $('licznik-melodii').classList.toggle('za-malo', !dosc);
    $('za-waski').classList.toggle('hide', dosc);
    ['tryb-dzienna','tryb-bezkonca','tryb-runda'].forEach(function(id){ $(id).disabled = !dosc; });
    zapiszWybor();
  }

  function rysujMenu(preselect){
    if(preselect === 'moje') S.wybor.moje = true;
    rysujGraczy(); rysujRepertuar(); odswiez();
  }

  /* ============================================================
     pobranie adresow probek
     ============================================================ */
  function przygotuj(){
    var podpis = podpisWyboru();
    if(S.gotowaDla === podpis && S.pula.length) return Promise.resolve();
    var surowa = pulaSurowa();
    if(surowa.length < MIN_PULA) return Promise.reject(new Error('za waski wybor'));
    $('ladowanie').classList.remove('hide');
    $('blad').classList.add('hide');
    return window.ITunes.rozwiaz(surowa).then(function(r){
      if(r.ok.length < MIN_PULA) throw new Error('za malo probek');
      S.pula = r.ok; S.gotowaDla = podpis;
      $('ladowanie').classList.add('hide');
    }).catch(function(e){
      $('ladowanie').classList.add('hide');
      $('blad').classList.remove('hide');
      $('blad-tresc').textContent = 'Orkiestra nie dojechała. Sprawdź połączenie z internetem i spróbuj jeszcze raz.';
      console.error('[jakamelodia]', e);
      throw e;
    });
  }

  function start(tryb){
    window.Audio2.silnik();
    window.Audio2.motywStop();
    window.Audio2.intro();
    przygotuj().then(function(){
      S.tryb = tryb;
      S.rundaNr = 0; S.rundaPkt = 0; S.rundaLog = [];
      if(tryb==='dzienna'){
        S.data = dzisiaj();
        var zapis = mem.get('dzienna.' + podpisWyboru() + '.' + S.data, null);
        nowaRunda();
        if(zapis){ wczytajZapis(zapis); return; }
      } else {
        nowaRunda();
      }
      pokaz('ekran-gra');
      rysujGre();
    }).catch(function(){});
  }

  /* ============================================================
     wybor utworu
     ============================================================ */
  var ostatnie = [];

  function losowy(){
    var wolne = S.pula.filter(function(u){ return ostatnie.indexOf(u.id)<0; });
    if(!wolne.length){ ostatnie = []; wolne = S.pula; }
    var u = wolne[Math.floor(Math.random()*wolne.length)];
    ostatnie.push(u.id);
    if(ostatnie.length > Math.min(40, Math.floor(S.pula.length*0.6))) ostatnie.shift();
    return u;
  }

  function numerDnia(iso){
    var p = iso.split('-');
    return Math.floor(Date.UTC(+p[0], +p[1]-1, +p[2]) / 86400000);
  }
  function mulberry(a){
    return function(){
      a = a + 0x6D2B79F5 | 0;
      var t = Math.imul(a ^ a>>>15, 1 | a);
      t = t + Math.imul(t ^ t>>>7, 61 | t) ^ t;
      return ((t ^ t>>>14) >>> 0) / 4294967296;
    };
  }
  /* Samo haszowanie daty potrafi wrocic do tej samej piosenki po trzech
     dniach, a innej nie pokazac nigdy. Tasujemy wiec caly repertuar raz na
     obieg: kazda melodia wypada dokladnie raz, zanim ktorakolwiek sie
     powtorzy, a nastepny obieg ma inna kolejnosc. */
  function utworDnia(){
    var n = S.pula.length;
    var dzien = numerDnia(S.data);
    var obieg = Math.floor(dzien / n);
    var miejsce = ((dzien % n) + n) % n;
    var idx = []; for(var i=0;i<n;i++) idx.push(i);
    var rnd = mulberry(hasz(podpisWyboru() + ':' + obieg));
    for(var j=n-1;j>0;j--){
      var k = Math.floor(rnd()*(j+1));
      var t = idx[j]; idx[j] = idx[k]; idx[k] = t;
    }
    return S.pula[ idx[miejsce] ];
  }

  function nowaRunda(){
    S.utwor = (S.tryb==='dzienna') ? utworDnia() : losowy();
    S.proba = 0; S.odpowiedzi = []; S.koniec = false; S.wygrana = false;
    window.Audio2.stop();
    window.Audio2.wczytaj(S.utwor.preview).catch(function(){});
  }

  function wczytajZapis(z){
    S.proba = z.proba; S.odpowiedzi = z.odpowiedzi || [];
    S.koniec = true; S.wygrana = z.wygrana;
    pokaz('ekran-gra'); rysujGre();
    odsloniecie(true);
  }

  /* ============================================================
     ekran gry
     ============================================================ */
  function rysujGre(){
    var z = $('zarowki'); z.innerHTML = '';
    for(var i=0;i<PROB;i++){
      var o = S.odpowiedzi[i];
      var k = 'zar';
      if(o && o.typ==='dobrze') k += ' zar-dobrze';
      else if(o && o.typ==='zle') k += ' zar-zle';
      else if(o && o.typ==='pas') k += ' zar-pas';
      else if(i===S.proba && !S.koniec) k += ' zar-teraz';
      var e = el('span', k);
      e.appendChild(el('b', null, DLUGOSCI[i]+'s'));
      z.appendChild(e);
    }
    var ile = DLUGOSCI[Math.min(S.proba, PROB-1)];
    $('pasek-odkryty').style.width = (100*ile/PELNA).toFixed(1)+'%';
    $('dl-opis').textContent = S.koniec ? 'cała próbka' : ile + (ile===1?' sekunda':(ile<5?' sekundy':' sekund'));

    var l = $('lista'); l.innerHTML = '';
    S.odpowiedzi.forEach(function(o){
      var w = el('div','wpis wpis-'+o.typ);
      w.appendChild(el('span','wpis-ikona', o.typ==='dobrze'?'+':(o.typ==='pas'?'-':'x')));
      w.appendChild(el('span','wpis-tekst', o.typ==='pas' ? 'pominięte podejście' : o.tekst));
      l.appendChild(w);
    });

    var info = '';
    if(S.tryb==='pokoj')    info = 'Runda ' + (S.rundaNr+1) + ' z ' + (S.zRund||7) + '  ·  wszyscy zgadują naraz';
    if(S.tryb==='runda')    info = 'Utwór ' + (S.rundaNr+1) + ' z ' + RUNDA_N + '  ·  ' + S.rundaPkt + ' pkt';
    if(S.tryb==='bezkonca') info = 'Seria: ' + mem.get('seria',0) + '  ·  rekord: ' + mem.get('rekord',0);
    if(S.tryb==='dzienna')  info = 'Melodia dnia · ' + S.data;
    $('info-tryb').textContent = info;
    $('nazwa-pakietu').textContent = nazwaWyboru();

    /* Nazwa przycisku ma mowic, co sie stanie po nacisnieciu. Kolejne
       podejscie odslania dluzszy urywek; przy ostatnim nie ma juz czego
       odslaniac, wiec jest to po prostu poddanie sie. */
    /* w pokoju nie ma czego pomijac — urywek rosnie sam */
    $('btn-pas').classList.toggle('hide', S.tryb === 'pokoj');
    $('pasek-graczy').classList.toggle('hide', S.tryb !== 'pokoj');
    $('btn-menu').textContent = S.tryb === 'pokoj' ? 'Opuść pokój' : 'Menu';
    var ostatnia = S.proba >= PROB-1;
    $('btn-pas').textContent = ostatnia ? 'Poddaję się' : ('Dłuższy urywek · ' + DLUGOSCI[S.proba+1] + ' s');
    $('btn-pas').title = ostatnia ? 'Kończy rundę i pokazuje odpowiedź'
                                  : 'Pomija to podejście i odsłania dłuższy fragment';
    $('odp').value = '';
    $('odp').disabled = S.koniec;
    $('btn-pas').disabled = S.koniec;
    $('podpowiedzi').innerHTML = '';
  }

  function zagraj(){
    if(!S.utwor) return;
    var sek = S.koniec ? PELNA : DLUGOSCI[Math.min(S.proba, PROB-1)];
    $('btn-graj').classList.add('gra');
    /* przestawienie robimy synchronicznie z wymuszonym przeliczeniem ukladu,
       a nie w requestAnimationFrame — ten stoi, kiedy karta jest w tle */
    var w = $('wskaznik');
    w.style.transition = 'none';
    w.style.width = '0%';
    void w.offsetWidth;
    w.style.transition = 'width ' + sek + 's linear';
    w.style.width = (100*Math.min(sek,PELNA)/PELNA).toFixed(1)+'%';
    window.Audio2.graj(S.utwor.preview, sek).then(function(){
      $('btn-graj').classList.remove('gra');
    }).catch(function(e){
      $('btn-graj').classList.remove('gra');
      console.error('[jakamelodia] nie udalo sie zagrac', e);
    });
  }

  function rysujPodpowiedzi(){
    var box = $('podpowiedzi'); box.innerHTML = '';
    var w = norm($('odp').value);
    if(!w) return;
    S.pula.filter(function(u){
      return norm(u.t).indexOf(w) >= 0 || norm(u.a).indexOf(w) >= 0;
    }).slice(0, 8).forEach(function(u){
      var b = el('button','podp');
      b.appendChild(el('span','podp-t', u.t));
      b.appendChild(el('span','podp-a', u.a));
      b.onmousedown = function(ev){ ev.preventDefault(); sprawdz(u.t); };
      box.appendChild(b);
    });
  }

  function sprawdz(tekst){
    if(S.koniec) return;
    tekst = (tekst||'').trim();
    if(!tekst) return;
    /* W pokoju nikt nikogo nie blokuje: pudlo nie odslania dluzszego urywka,
       bo urywek rosnie wszystkim naraz po wspolnym zegarze. */
    if(S.tryb === 'pokoj'){
      if(pasuje(tekst, S.utwor)){
        S.odpowiedzi.push({typ:'dobrze', tekst:S.utwor.t});
        S.wygrana = true; S.koniec = true;
        window.Audio2.fanfara(); window.Audio2.stop();
        if(MULTI && MULTI.odp) MULTI.odp(S.proba);
      } else {
        S.odpowiedzi.push({typ:'zle', tekst:tekst});
        window.Audio2.buczek();
      }
      rysujGre();
      return;
    }
    if(pasuje(tekst, S.utwor)){
      S.odpowiedzi.push({typ:'dobrze', tekst:S.utwor.t});
      S.wygrana = true; S.koniec = true;
      window.Audio2.fanfara();
      zapiszWynik(); rysujGre();
      setTimeout(function(){ odsloniecie(false); }, 700);
    } else {
      S.odpowiedzi.push({typ:'zle', tekst:tekst});
      window.Audio2.buczek();
      dalejAlboKoniec();
    }
  }
  function pas(){
    if(S.koniec) return;
    S.odpowiedzi.push({typ:'pas', tekst:'pas'});
    window.Audio2.tik(false);
    dalejAlboKoniec();
  }
  function dalejAlboKoniec(){
    S.proba++;
    if(S.proba >= PROB){
      S.koniec = true; S.wygrana = false;
      zapiszWynik(); rysujGre();
      setTimeout(function(){ odsloniecie(false); }, 600);
    } else {
      rysujGre(); zagraj();
    }
  }

  /* ============================================================
     wyniki
     ============================================================ */
  function punkty(){ return S.wygrana ? (PROB - S.proba) : 0; }

  function zapiszWynik(){
    if(S.tryb==='dzienna'){
      mem.set('dzienna.' + podpisWyboru() + '.' + S.data,
              {proba:S.proba, odpowiedzi:S.odpowiedzi, wygrana:S.wygrana});
    }
    if(S.tryb==='bezkonca'){
      var s = S.wygrana ? mem.get('seria',0)+1 : 0;
      mem.set('seria', s);
      if(s > mem.get('rekord',0)) mem.set('rekord', s);
    }
    if(S.tryb==='runda'){
      S.rundaPkt += punkty();
      S.rundaLog.push({t:S.utwor.t, a:S.utwor.a, pkt:punkty(), wygrana:S.wygrana});
    }
  }

  function odsloniecie(cicho){
    if(!cicho) window.Audio2.werbel();
    pokaz('ekran-wynik');
    $('w-okladka').src = S.utwor.art || '';
    $('w-okladka').alt = S.utwor.t;
    $('w-tytul').textContent  = S.utwor.t;
    $('w-wykonawca').textContent = S.utwor.a + (S.utwor.r ? '  ·  ' + S.utwor.r : '');
    $('w-werdykt').textContent = S.wygrana
      ? ['Brawo! Za pierwszym razem!','Świetnie — dwa podejścia.','Dobrze, trzecie podejście.',
         'Jest! Czwarte podejście.','Udało się za piątym razem.','W ostatniej chwili!'][S.proba]
      : 'Niestety. To było to.';
    $('w-werdykt').className = 'werdykt ' + (S.wygrana ? 'werdykt-tak' : 'werdykt-nie');

    /* Dalej gra sie w lewo: przycisk, ktory prowadzi do nastepnej melodii,
       stoi pierwszy z brzegu, a Menu na koncu rzedu. */
    var stopka = $('w-przyciski'); stopka.innerHTML = '';
    if(S.tryb==='runda'){
      var ostatni = (S.rundaNr+1) >= RUNDA_N;
      var b = el('button','zloty duzy', ostatni ? 'Zobacz wynik' : 'Następny utwór');
      b.onclick = ostatni ? podium : function(){ S.rundaNr++; nowaRunda(); pokaz('ekran-gra'); rysujGre(); };
      stopka.appendChild(b);
    } else if(S.tryb==='bezkonca'){
      var n = el('button','zloty duzy','Następna melodia');
      n.onclick = function(){ nowaRunda(); pokaz('ekran-gra'); rysujGre(); };
      stopka.appendChild(n);
    } else {
      var d = el('button','zloty duzy','Graj dalej bez końca');
      d.onclick = function(){ start('bezkonca'); };
      stopka.appendChild(d);
      var s = el('button','srebrny','Skopiuj wynik');
      s.onclick = function(){ udostepnij(s); };
      stopka.appendChild(s);
    }
    var m = el('button','srebrny','Menu');
    m.onclick = doMenu;
    stopka.appendChild(m);
  }

  function kratka(){
    var s = '';
    for(var i=0;i<PROB;i++){
      var o = S.odpowiedzi[i];
      s += !o ? '.' : (o.typ==='dobrze' ? '+' : (o.typ==='pas' ? '-' : 'x'));
    }
    return s;
  }
  function udostepnij(btn){
    var txt = 'Jaka to melodia? — ' + nazwaWyboru() + '\n' +
              S.data + '  ' + (S.wygrana ? (S.proba+1)+'/'+PROB : 'X/'+PROB) + '\n' +
              kratka() + '\n' + location.origin + location.pathname;
    var ok = function(){ var t=btn.textContent; btn.textContent='Skopiowano!'; setTimeout(function(){ btn.textContent=t; },1600); };
    if(navigator.clipboard && navigator.clipboard.writeText)
      navigator.clipboard.writeText(txt).then(ok, function(){ window.prompt('Skopiuj wynik:', txt); });
    else window.prompt('Skopiuj wynik:', txt);
  }

  function podium(){
    pokaz('ekran-podium');
    var max = RUNDA_N * PROB;
    $('p-suma').textContent = S.rundaPkt;
    $('p-max').textContent = 'z ' + max + ' możliwych';
    var trafione = S.rundaLog.filter(function(x){ return x.wygrana; }).length;
    $('p-podsumowanie').textContent = 'Rozpoznane melodie: ' + trafione + ' z ' + RUNDA_N;
    var ocena = S.rundaPkt/max;
    $('p-ocena').textContent = ocena >= 0.8 ? 'Mistrz teleturnieju!'
                            : ocena >= 0.55 ? 'Bardzo dobrze!'
                            : ocena >= 0.3  ? 'Nieźle, ale orkiestra jeszcze zagra.'
                            : 'Następnym razem pójdzie lepiej.';
    var l = $('p-lista'); l.innerHTML = '';
    S.rundaLog.forEach(function(x, i){
      var w = el('div','p-wiersz');
      w.appendChild(el('span','p-nr', (i+1)+'.'));
      var t = el('span','p-tyt'); t.appendChild(el('b',null,x.t)); t.appendChild(el('i',null,x.a));
      w.appendChild(t);
      w.appendChild(el('span','p-pkt' + (x.wygrana?'':' p-zero'), x.pkt + ' pkt'));
      l.appendChild(w);
    });
    window.Audio2.final();
  }

  /* ---- obsluga rundy prowadzonej przez pokoj.js ---- */
  var MULTI = null;
  function ustawPule(lista){ S.pula = lista; }
  function startMulti(utwor, info){
    MULTI = info;
    S.tryb = 'pokoj'; S.utwor = utwor;
    S.proba = 0; S.odpowiedzi = []; S.koniec = false; S.wygrana = false;
    S.rundaNr = (info.rundaNr || 1) - 1; S.zRund = info.zRund || 7;
    window.Audio2.motywStop();
    pokaz('ekran-gra');
    rysujGre();
  }
  function oknoMulti(i){
    if(S.tryb !== 'pokoj') return;
    S.proba = i;
    rysujGre();
    if(!S.koniec) zagraj();
  }
  function koniecMulti(){
    if(S.tryb !== 'pokoj') return;
    S.koniec = true;
    window.Audio2.stop();
    rysujGre();
  }

  function doMenu(){
    window.Audio2.stop();
    pokaz('ekran-start');
    rysujMenu();
    window.Audio2.motywStart();
  }

  /* ============================================================
     korektor graficzny — slupki chodza od prawdziwego dzwieku
     ============================================================ */
  function korektor(){
    var c = $('korektor'); if(!c) return;
    var g = c.getContext('2d'), N = 28;
    function klatka(){
      var szer = c.clientWidth, wys = c.clientHeight;
      if(c.width !== szer || c.height !== wys){ c.width = szer; c.height = wys; }
      g.clearRect(0,0,c.width,c.height);
      var d = window.Audio2.poziomy();
      var w = c.width / N;
      for(var i=0;i<N;i++){
        var v = d ? d[Math.floor(i*(d.length*0.6)/N)]/255 : 0;
        if(!window.Audio2.gra()) v *= 0.12;
        var h = Math.max(2, v*c.height);
        var grad = g.createLinearGradient(0, c.height-h, 0, c.height);
        grad.addColorStop(0, '#ffe98a'); grad.addColorStop(0.5,'#ffc531'); grad.addColorStop(1,'#c8760a');
        g.fillStyle = grad;
        g.fillRect(i*w+1, c.height-h, w-2, h);
      }
      requestAnimationFrame(klatka);
    }
    requestAnimationFrame(klatka);
  }

  /* ============================================================
     start
     ============================================================ */
  function init(){
    wczytajWybor();
    rysujMenu();
    korektor();
    window.odswiezMenu = rysujMenu;

    /* dzwieki studia mozna wyciszyc — melodii do zgadywania to nie dotyczy */
    var dzwiek = mem.get('stingi', true);
    window.Audio2.stingiWl(dzwiek);
    function odswiezDzwiek(){
      $('btn-dzwiek').classList.toggle('wyl', !dzwiek);
      $('btn-dzwiek').setAttribute('aria-pressed', String(dzwiek));
      $('btn-dzwiek').title = dzwiek ? 'Dźwięki studia: włączone' : 'Dźwięki studia: wyłączone';
    }
    odswiezDzwiek();
    $('btn-dzwiek').onclick = function(){
      dzwiek = !dzwiek;
      mem.set('stingi', dzwiek);
      window.Audio2.stingiWl(dzwiek);
      odswiezDzwiek();
      if(dzwiek){ window.Audio2.tik(true); if(!$('ekran-start').classList.contains('hide')) window.Audio2.motywStart(); }
      else window.Audio2.motywStop();
    };

    /* Przegladarka nie pozwoli zagrac niczego, zanim gracz czegos nie dotknie,
       wiec motyw menu wchodzi przy pierwszym klknieciu gdziekolwiek. */
    var pierwszyGest = function(){
      window.Audio2.silnik();
      if(!$('ekran-start').classList.contains('hide')) window.Audio2.motywStart();
      document.removeEventListener('pointerdown', pierwszyGest);
      document.removeEventListener('keydown', pierwszyGest);
    };
    document.addEventListener('pointerdown', pierwszyGest);
    document.addEventListener('keydown', pierwszyGest);

    $('tryb-dzienna').onclick  = function(){ start('dzienna'); };
    $('tryb-bezkonca').onclick = function(){ start('bezkonca'); };
    $('tryb-runda').onclick    = function(){ start('runda'); };

    /* suwak lat — dwa uchwyty na wspolnym torze, pilnujemy, by sie nie minely */
    var od = $('lata-od'), doo = $('lata-do');
    [od, doo].forEach(function(inp){
      inp.min = ROK_MIN; inp.max = ROK_MAX;
      inp.addEventListener('input', function(){
        var a = +od.value, b = +doo.value;
        if(inp === od && a > b) { b = a; doo.value = b; }
        if(inp === doo && b < a) { a = b; od.value = a; }
        S.wybor.od = a; S.wybor.do = b; S.wybor.moje = false;
        rysujSuwak(); odswiez();
      });
      inp.addEventListener('change', rysujRepertuar);
    });

    $('btn-graj').onclick = zagraj;
    $('btn-pas').onclick  = pas;
    $('btn-menu').onclick = function(){
      if(S.tryb === 'pokoj' && window.Pokoj){ window.Pokoj.wyjdz(); return; }
      doMenu();
    };
    $('w-graj').onclick   = function(){ window.Audio2.graj(S.utwor.preview, PELNA).catch(function(){}); };
    $('p-menu').onclick   = doMenu;
    $('p-jeszcze').onclick= function(){ start('runda'); };
    $('blad-ponow').onclick = function(){ S.gotowaDla = null; start(S.tryb); };

    var odp = $('odp');
    odp.addEventListener('input', rysujPodpowiedzi);
    odp.addEventListener('keydown', function(e){
      if(e.key==='Enter'){ e.preventDefault(); sprawdz(odp.value); }
      if(e.key==='Escape'){ $('podpowiedzi').innerHTML=''; }
    });
    odp.addEventListener('blur', function(){ setTimeout(function(){ $('podpowiedzi').innerHTML=''; }, 120); });
    $('btn-zgadnij').onclick = function(){ sprawdz(odp.value); };

    document.addEventListener('keydown', function(e){
      if(e.code==='Space' && document.activeElement !== odp && !$('ekran-gra').classList.contains('hide')){
        e.preventDefault(); zagraj();
      }
    });

    if(window.Pokoj) window.Pokoj.podepnij();
    $('moje-wyloguj').onclick = function(){
      window.Spotify2.wyloguj();
      S.wybor.sp = null;
      rysujRepertuar(); odswiez();
    };
    $('tp-check').onchange = function(){
      S.wybor.polska = $('tp-check').checked;
      rysujRepertuar(); odswiez();
    };

    /* powrot z ekranu zgody Spotify */
    window.Spotify2.obsluzPowrot().then(function(w){
      if(!w) return;
      if(w.blad){
        spKomunikat('Spotify: ' + w.blad + '  (adres powrotu: ' + window.Spotify2.adresPowrotu() + ')', true);
        return;
      }
      odswiezSpis();
    });
    /* zalogowany z poprzedniej wizyty — odswiez spis w tle */
    if(window.Spotify2.zalogowany() && !window.Spotify2.spis().length) odswiezSpis();
  }

  window.Gra = {
    pokaz: pokaz, pulaDlaWyboru: pulaDlaWyboru, biezacyWybor: biezacyWybor,
    ustawPule: ustawPule, startMulti: startMulti, oknoMulti: oknoMulti, koniecMulti: koniecMulti,
    otworzPanelPokoju: function(){
      S.gracze = 'wielu'; rysujGraczy();
    }
  };

  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
