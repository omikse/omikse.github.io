/* ============================================================
   game.js — logika teleturnieju
   ------------------------------------------------------------
   Trzy tryby: melodia dnia, gra bez konca i runda na siedem
   utworow. Kazda runda to jeden utwor i szesc podejsc; po
   kazdym pudle albo pasie odslania sie dluzszy urywek.
   ============================================================ */
(function(){
  'use strict';

  var DLUGOSCI = [1, 2, 4, 7, 11, 16];      // sekundy urywka w kolejnych podejsciach
  var PROB     = DLUGOSCI.length;
  var RUNDA_N  = 7;                          // ile utworow w rundzie
  var PELNA    = 30;                         // dlugosc calej probki

  var $  = function(id){ return document.getElementById(id); };
  var el = function(t, k, tx){ var e=document.createElement(t); if(k) e.className=k; if(tx!=null) e.textContent=tx; return e; };

  /* ---- pamiec przegladarki, zawsze w try/catch ---- */
  var mem = {
    get: function(k, d){ try{ var v=localStorage.getItem('jtm.'+k); return v==null?d:JSON.parse(v); }catch(e){ return d; } },
    set: function(k, v){ try{ localStorage.setItem('jtm.'+k, JSON.stringify(v)); }catch(e){} }
  };

  /* ---- porownywanie tytulow: bez wielkosci liter, bez ogonkow, bez znakow ---- */
  function norm(s){
    return (s||'').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'')
                  .replace(/\u0142/g,'l').replace(/[^a-z0-9]/g,'');
  }
  function pasuje(wpis, utwor){
    var w = norm(wpis);
    if(!w) return false;
    if(w === norm(utwor.t)) return true;
    return (utwor.alt||[]).some(function(a){ return norm(a)===w; });
  }

  /* ---- stan ---- */
  var S = {
    pakiet:null, pula:[], tryb:'dzienna',
    utwor:null, proba:0, odpowiedzi:[], koniec:false, wygrana:false,
    rundaNr:0, rundaPkt:0, rundaLog:[],
    data:null, zajete:false
  };

  function dzisiaj(){
    var q = new URLSearchParams(location.search).get('date');
    if(q && /^\d{4}-\d{2}-\d{2}$/.test(q)) return q;
    var d = new Date();
    return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');
  }
  /* FNV-1a — krotki, stabilny, ten sam wynik wszedzie */
  function hasz(s){
    var h = 2166136261;
    for(var i=0;i<s.length;i++){ h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
    return h >>> 0;
  }

  /* ---- ekrany ---- */
  function pokaz(id){
    ['ekran-start','ekran-gra','ekran-wynik','ekran-podium'].forEach(function(e){
      $(e).classList.toggle('hide', e!==id);
    });
  }

  /* ============================================================
     ekran startowy — wybor pakietu i trybu
     ============================================================ */
  var wybranyPakiet = mem.get('pakiet', 'polskie');

  function rysujPakiety(wybierz){
    if(wybierz) wybranyPakiet = wybierz;
    /* wlasny repertuar mogl wlasnie zniknac — nie zostawiajmy wskazania w prozni */
    if(!window.PACKS.some(function(p){ return p.id === wybranyPakiet; }))
      wybranyPakiet = window.PACKS[0].id;
    mem.set('pakiet', wybranyPakiet);
    var box = $('pakiety'); box.innerHTML = '';
    window.PACKS.forEach(function(p){
      var b = el('button', 'pakiet' + (p.id===wybranyPakiet ? ' wybrany' : ''));
      b.appendChild(el('span','pakiet-nazwa', p.name));
      b.appendChild(el('span','pakiet-opis', p.desc));
      b.appendChild(el('span','pakiet-ile', p.songs.length + ' melodii'));
      b.onclick = function(){ wybranyPakiet = p.id; mem.set('pakiet', p.id); rysujPakiety(); };
      box.appendChild(b);
    });
  }

  function pakietPoId(id){
    return window.PACKS.filter(function(p){ return p.id===id; })[0] || window.PACKS[0];
  }

  /* pobranie adresow probek — jedyny moment, w ktorym gra potrzebuje sieci */
  function przygotuj(){
    var p = pakietPoId(wybranyPakiet);
    if(S.pakiet && S.pakiet.id===p.id && S.pula.length) return Promise.resolve();
    $('ladowanie').classList.remove('hide');
    $('blad').classList.add('hide');
    return window.ITunes.rozwiaz(p.songs).then(function(r){
      if(!r.ok.length) throw new Error('pusty pakiet');
      S.pakiet = p; S.pula = r.ok;
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
    window.Audio2.silnik();                 // kontekst musi powstac w gescie uzytkownika
    window.Audio2.intro();                  // czolowka leci w trakcie pobierania listy
    przygotuj().then(function(){
      S.tryb = tryb;
      S.rundaNr = 0; S.rundaPkt = 0; S.rundaLog = [];
      if(tryb==='dzienna'){
        S.data = dzisiaj();
        var zapis = mem.get('dzienna.'+S.pakiet.id+'.'+S.data, null);
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
  var ostatnie = [];                         // zeby to samo nie wracalo od razu

  function losowy(){
    var wolne = S.pula.filter(function(u){ return ostatnie.indexOf(u.id)<0; });
    if(!wolne.length){ ostatnie = []; wolne = S.pula; }
    var u = wolne[Math.floor(Math.random()*wolne.length)];
    ostatnie.push(u.id);
    if(ostatnie.length > Math.min(40, Math.floor(S.pula.length*0.6))) ostatnie.shift();
    return u;
  }

  /* numer dnia od 1970 — liczony w UTC, wiec ten sam w kazdej strefie */
  function numerDnia(iso){
    var p = iso.split('-');
    return Math.floor(Date.UTC(+p[0], +p[1]-1, +p[2]) / 86400000);
  }
  /* maly powtarzalny generator, potrzebny wylacznie do tasowania */
  function mulberry(a){
    return function(){
      a = a + 0x6D2B79F5 | 0;
      var t = Math.imul(a ^ a>>>15, 1 | a);
      t = t + Math.imul(t ^ t>>>7, 61 | t) ^ t;
      return ((t ^ t>>>14) >>> 0) / 4294967296;
    };
  }
  /* Utwor dnia: samo haszowanie daty potrafi wrocic do tej samej piosenki
     po trzech dniach, a innej nie pokazac nigdy. Zamiast tego tasujemy caly
     pakiet raz na obieg — kazda melodia wypada dokladnie raz, zanim
     ktorakolwiek sie powtorzy, a kolejny obieg ma inna kolejnosc. */
  function utworDnia(){
    var n = S.pula.length;
    var dzien = numerDnia(S.data);
    var obieg = Math.floor(dzien / n);
    var miejsce = ((dzien % n) + n) % n;
    var idx = []; for(var i=0;i<n;i++) idx.push(i);
    var rnd = mulberry(hasz(S.pakiet.id + ':' + obieg));
    for(var j=n-1;j>0;j--){
      var k = Math.floor(rnd()*(j+1));
      var t = idx[j]; idx[j] = idx[k]; idx[k] = t;
    }
    return S.pula[ idx[miejsce] ];
  }

  function nowaRunda(){
    if(S.tryb==='dzienna'){
      S.utwor = utworDnia();
    } else {
      S.utwor = losowy();
    }
    S.proba = 0; S.odpowiedzi = []; S.koniec = false; S.wygrana = false;
    window.Audio2.stop();
    /* podgrzewamy bufor, zeby pierwszy przycisk zagral natychmiast */
    window.Audio2.wczytaj(S.utwor.preview).catch(function(){});
  }

  function wczytajZapis(z){
    S.proba = z.proba; S.odpowiedzi = z.odpowiedzi || [];
    S.koniec = true; S.wygrana = z.wygrana;
    pokaz('ekran-gra'); rysujGre();
    odsloniecie(true);
  }

  /* ============================================================
     rysowanie ekranu gry
     ============================================================ */
  function rysujGre(){
    /* zarowki podejsc */
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
    /* pasek odslonietego czasu */
    var ile = DLUGOSCI[Math.min(S.proba, PROB-1)];
    $('pasek-odkryty').style.width = (100*ile/PELNA).toFixed(1)+'%';
    $('dl-opis').textContent = S.koniec ? 'cała próbka' : ile + (ile===1?' sekunda':(ile<5?' sekundy':' sekund'));

    /* lista dotychczasowych odpowiedzi */
    var l = $('lista'); l.innerHTML = '';
    S.odpowiedzi.forEach(function(o){
      var w = el('div','wpis wpis-'+o.typ);
      w.appendChild(el('span','wpis-ikona', o.typ==='dobrze'?'\u2713':(o.typ==='pas'?'\u2192':'\u2717')));
      w.appendChild(el('span','wpis-tekst', o.typ==='pas' ? 'pominięte podejście' : o.tekst));
      l.appendChild(w);
    });

    /* licznik rundy / serii */
    var info = '';
    if(S.tryb==='runda')    info = 'Utwór ' + (S.rundaNr+1) + ' z ' + RUNDA_N + '  \u00b7  ' + S.rundaPkt + ' pkt';
    if(S.tryb==='bezkonca') info = 'Seria: ' + (mem.get('seria',0)) + '  \u00b7  rekord: ' + mem.get('rekord',0);
    if(S.tryb==='dzienna')  info = 'Melodia dnia \u00b7 ' + S.data;
    $('info-tryb').textContent = info;
    $('nazwa-pakietu').textContent = S.pakiet.name;

    /* Nazwa przycisku ma mowic, co sie stanie po nacisnieciu. Kolejne
       podejscie odslania dluzszy urywek; przy ostatnim nie ma juz czego
       odslaniac, wiec jest to po prostu poddanie sie. */
    var ostatnia = S.proba >= PROB-1;
    $('btn-pas').textContent = ostatnia ? 'Poddaję się' : ('Dłuższy urywek · ' + DLUGOSCI[S.proba+1] + ' s');
    $('btn-pas').title = ostatnia
      ? 'Kończy rundę i pokazuje odpowiedź'
      : 'Pomija to podejście i odsłania dłuższy fragment';
    $('odp').value = '';
    $('odp').disabled = S.koniec;
    $('btn-pas').disabled = S.koniec;
    $('podpowiedzi').innerHTML = '';
  }

  /* ============================================================
     odtwarzanie urywka
     ============================================================ */
  function zagraj(){
    if(!S.utwor) return;
    var sek = S.koniec ? PELNA : DLUGOSCI[Math.min(S.proba, PROB-1)];
    $('btn-graj').classList.add('gra');
    /* wskaznik biegnie po pasku razem z dzwiekiem.
       Przestawienie robimy synchronicznie z wymuszonym przeliczeniem ukladu,
       a nie w requestAnimationFrame — ten stoi, kiedy karta jest w tle. */
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

  /* ============================================================
     podpowiedzi do wpisywania (lista tytulow z pakietu)
     ============================================================ */
  function rysujPodpowiedzi(){
    var box = $('podpowiedzi'); box.innerHTML = '';
    var w = norm($('odp').value);
    if(!w){ return; }
    var trafione = S.pula.filter(function(u){
      return norm(u.t).indexOf(w) >= 0 || norm(u.a).indexOf(w) >= 0;
    }).slice(0, 8);
    trafione.forEach(function(u){
      var b = el('button','podp');
      b.appendChild(el('span','podp-t', u.t));
      b.appendChild(el('span','podp-a', u.a));
      b.onmousedown = function(ev){ ev.preventDefault(); sprawdz(u.t); };
      box.appendChild(b);
    });
  }

  /* ============================================================
     odpowiedz i pas
     ============================================================ */
  function sprawdz(tekst){
    if(S.koniec || S.zajete) return;
    tekst = (tekst||'').trim();
    if(!tekst) return;
    if(pasuje(tekst, S.utwor)){
      S.odpowiedzi.push({typ:'dobrze', tekst:S.utwor.t});
      S.wygrana = true; S.koniec = true;
      window.Audio2.fanfara();
      zapiszWynik();
      rysujGre();
      setTimeout(function(){ odsloniecie(false); }, 700);
    } else {
      S.odpowiedzi.push({typ:'zle', tekst:tekst});
      window.Audio2.buczek();
      dalejAlboKoniec();
    }
  }

  function pas(){
    if(S.koniec || S.zajete) return;
    S.odpowiedzi.push({typ:'pas', tekst:'pas'});
    window.Audio2.tik(false);
    dalejAlboKoniec();
  }

  function dalejAlboKoniec(){
    S.proba++;
    if(S.proba >= PROB){
      S.koniec = true; S.wygrana = false;
      zapiszWynik();
      rysujGre();
      setTimeout(function(){ odsloniecie(false); }, 600);
    } else {
      rysujGre();
      zagraj();
    }
  }

  /* ============================================================
     zapisywanie wynikow
     ============================================================ */
  function punkty(){ return S.wygrana ? (PROB - S.proba) : 0; }   // 6 pkt za pierwsze podejscie, 1 za szoste

  function zapiszWynik(){
    if(S.tryb==='dzienna'){
      mem.set('dzienna.'+S.pakiet.id+'.'+S.data,
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

  /* ============================================================
     odsloniecie odpowiedzi
     ============================================================ */
  function odsloniecie(cicho){
    if(!cicho) window.Audio2.werbel();
    pokaz('ekran-wynik');
    $('w-okladka').src = S.utwor.art || '';
    $('w-okladka').alt = S.utwor.t;
    $('w-tytul').textContent  = S.utwor.t;
    $('w-wykonawca').textContent = S.utwor.a;
    $('w-werdykt').textContent = S.wygrana
      ? ['Brawo! Za pierwszym razem!','Świetnie — dwa podejścia.','Dobrze, trzecie podejście.',
         'Jest! Czwarte podejście.','Udało się za piątym razem.','W ostatniej chwili!'][S.proba]
      : 'Niestety. To było to.';
    $('w-werdykt').className = 'werdykt ' + (S.wygrana ? 'werdykt-tak' : 'werdykt-nie');

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
      var s = el('button','zloty duzy','Skopiuj wynik');
      s.onclick = function(){ udostepnij(s); };
      stopka.appendChild(s);
      var e = el('button','srebrny','Graj bez końca');
      e.onclick = function(){ start('bezkonca'); };
      stopka.appendChild(e);
    }
    var m = el('button','srebrny','Menu');
    m.onclick = doMenu;
    stopka.appendChild(m);
  }

  /* siatka do wklejenia znajomym */
  function kratka(){
    var s = '';
    for(var i=0;i<PROB;i++){
      var o = S.odpowiedzi[i];
      s += !o ? '\u2b1b' : (o.typ==='dobrze' ? '\ud83d\udfe9' : (o.typ==='pas' ? '\ud83d\udfe8' : '\ud83d\udfe5'));
    }
    return s;
  }
  function udostepnij(btn){
    var naglowek = 'Jaka to melodia? \u2014 ' + S.pakiet.name + '\n' + S.data + '  ' +
                   (S.wygrana ? (S.proba+1)+'/'+PROB : 'X/'+PROB);
    var txt = naglowek + '\n' + kratka() + '\n' + location.origin + location.pathname;
    var pokazOk = function(){ var t=btn.textContent; btn.textContent='Skopiowano!'; setTimeout(function(){ btn.textContent=t; },1600); };
    if(navigator.clipboard && navigator.clipboard.writeText){
      navigator.clipboard.writeText(txt).then(pokazOk, function(){ window.prompt('Skopiuj wynik:', txt); });
    } else {
      window.prompt('Skopiuj wynik:', txt);
    }
  }

  /* ============================================================
     podium na koniec rundy
     ============================================================ */
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

  function doMenu(){
    window.Audio2.stop();
    pokaz('ekran-start');
    rysujPakiety();
  }

  /* ============================================================
     korektor graficzny — slupki chodza od prawdziwego dzwieku
     ============================================================ */
  function korektor(){
    var c = $('korektor');
    if(!c) return;
    var g = c.getContext('2d'), N = 28;
    function klatka(){
      var szer = c.clientWidth, wys = c.clientHeight;
      if(c.width !== szer || c.height !== wys){ c.width = szer; c.height = wys; }
      g.clearRect(0,0,c.width,c.height);
      var d = window.Audio2.poziomy();
      var w = c.width / N;
      for(var i=0;i<N;i++){
        var v = d ? d[Math.floor(i*(d.length*0.6)/N)]/255 : 0;
        if(!window.Audio2.gra()) v *= 0.12;                 // w ciszy tylko delikatny oddech
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
    rysujPakiety();
    korektor();

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
      if(dzwiek) window.Audio2.tik(true);
    };

    $('tryb-dzienna').onclick  = function(){ start('dzienna'); };
    $('tryb-bezkonca').onclick = function(){ start('bezkonca'); };
    $('tryb-runda').onclick    = function(){ start('runda'); };

    /* moje.js przebudowuje liste pakietow po imporcie */
    window.odswiezPakiety = rysujPakiety;

    $('btn-graj').onclick = zagraj;
    $('btn-pas').onclick  = pas;
    $('btn-menu').onclick = doMenu;
    $('w-graj').onclick   = function(){ window.Audio2.graj(S.utwor.preview, PELNA).catch(function(){}); };
    $('p-menu').onclick   = doMenu;
    $('p-jeszcze').onclick= function(){ start('runda'); };
    $('blad-ponow').onclick = function(){ S.pakiet=null; S.pula=[]; start(S.tryb); };

    var odp = $('odp');
    odp.addEventListener('input', rysujPodpowiedzi);
    odp.addEventListener('keydown', function(e){
      if(e.key==='Enter'){ e.preventDefault(); sprawdz(odp.value); }
      if(e.key==='Escape'){ $('podpowiedzi').innerHTML=''; }
    });
    odp.addEventListener('blur', function(){ setTimeout(function(){ $('podpowiedzi').innerHTML=''; }, 120); });
    $('btn-zgadnij').onclick = function(){ sprawdz(odp.value); };

    /* spacja gra urywek, gdy nie piszemy */
    document.addEventListener('keydown', function(e){
      if(e.code==='Space' && document.activeElement !== odp && !$('ekran-gra').classList.contains('hide')){
        e.preventDefault(); zagraj();
      }
    });
  }

  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
