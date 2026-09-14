/* ============================================================
   moje.js — wlasny repertuar
   ------------------------------------------------------------
   Gracz wkleja liste piosenek, a my szukamy kazdej w katalogu
   Apple i budujemy z tego pakiet zapisany w przegladarce.

   Dlaczego wklejanie, a nie zalogowanie sie do Spotify: Spotify
   oznaczylo pole z trzydziestosekundowa probka jako wycofane,
   a regulamin zabrania robic z tych urywkow osobnej uslugi.
   Audio i tak musialoby przyjsc od Apple — Spotify moglby jedynie
   podpowiedziec, czego gracz slucha. To wymaga wlasnej aplikacji
   w panelu Spotify i jest opisane w README jako krok drugi.
   ============================================================ */
(function(){
  'use strict';

  var KLUCZ  = 'jtm.mojpakiet';
  var ODSTEP = 1300;          // ms miedzy zapytaniami — API nie lubi natarczywych
  var LIMIT  = 80;            // gorna granica jednego wklejenia
  var MIN    = 6;             // ponizej tego nie ma z czego robic podpowiedzi

  var $ = function(id){ return document.getElementById(id); };
  function mem(k, v){
    try{
      if(v===undefined){ var x = localStorage.getItem(k); return x ? JSON.parse(x) : null; }
      if(v===null) localStorage.removeItem(k); else localStorage.setItem(k, JSON.stringify(v));
    }catch(e){ return null; }
  }

  /* ---- czyszczenie wklejonego tekstu ---- */
  function linie(tekst){
    return tekst.split(/\r?\n/)
      .map(function(l){
        return l.replace(/\t+/g, ' - ')          // kolumny z arkusza
                .replace(/^\s*\d+[.)]?\s+/, '')  // numeracja listy
                .replace(/^["']|["']$/g, '')
                .replace(/\s+/g, ' ')
                .trim();
      })
      .filter(function(l){ return l.length > 2 && l.charAt(0) !== '#'; })
      .slice(0, LIMIT);
  }

  var ZLE = /\b(live|karaoke|cover|instrumental|tribute|remix)\b|\(live/i;

  function szukaj(fraza){
    var url = 'https://itunes.apple.com/search?term=' + encodeURIComponent(fraza) +
              '&entity=song&limit=6&country=PL';
    return fetch(url).then(function(r){
      if(!r.ok) throw new Error('HTTP '+r.status);
      return r.json();
    }).then(function(j){
      var kand = (j.results||[]).filter(function(x){ return x.previewUrl && !ZLE.test(x.trackName); });
      if(!kand.length) return null;
      var x = kand[0];
      return { id:x.trackId, t:x.trackName, a:x.artistName };
    });
  }

  /* ---- import: jedno zapytanie na raz, z pokazaniem postepu ---- */
  var trwa = false;

  function importuj(tekst){
    if(trwa) return;
    var lista = linie(tekst);
    if(!lista.length){ pokazBlad('Nie widzę tu żadnych tytułów.'); return; }

    trwa = true;
    $('imp-start').disabled = true;
    $('imp-wynik').classList.add('hide');
    $('imp-postep').classList.remove('hide');

    var znalezione = [], nieznane = [], widziane = {};
    var i = 0;

    function krok(){
      if(i >= lista.length) return zakoncz();
      $('imp-licznik').textContent = (i+1) + ' z ' + lista.length;
      $('imp-pasek').style.width = (100*i/lista.length).toFixed(1) + '%';
      $('imp-teraz').textContent = lista[i];
      szukaj(lista[i]).then(function(t){
        if(!t) nieznane.push(lista[i]);
        else if(widziane[t.id]) { /* ten sam utwor dwa razy — pomijamy */ }
        else { widziane[t.id] = 1; znalezione.push(t); }
      }).catch(function(){
        nieznane.push(lista[i]);
      }).then(function(){
        i++;
        setTimeout(krok, ODSTEP);
      });
    }

    function zakoncz(){
      trwa = false;
      $('imp-start').disabled = false;
      $('imp-postep').classList.add('hide');
      $('imp-wynik').classList.remove('hide');

      if(znalezione.length < MIN){
        pokazBlad('Udało się dopasować tylko ' + znalezione.length + ' melodii, a do gry trzeba ich co najmniej ' + MIN + '.');
        return;
      }
      var pakiet = {
        id: 'moje',
        name: 'Mój repertuar',
        desc: znalezione.length + ' melodii wybranych przez Ciebie.',
        songs: znalezione
      };
      mem(KLUCZ, pakiet);
      wepnij();
      odswiezPrzyciskUsun();

      var txt = 'Gotowe — ' + znalezione.length + ' melodii w Twoim repertuarze.';
      if(nieznane.length) txt += ' Nie udało się dopasować ' + nieznane.length + ': ' + nieznane.slice(0,6).join('; ') + (nieznane.length>6 ? '…' : '');
      $('imp-tresc').textContent = txt;
      $('imp-tresc').className = 'komunikat';
      if(window.odswiezPakiety) window.odswiezPakiety('moje');
    }

    krok();
  }

  function pokazBlad(t){
    $('imp-wynik').classList.remove('hide');
    $('imp-tresc').textContent = t;
    $('imp-tresc').className = 'komunikat blad';
  }

  /* ---- wpiecie zapisanego pakietu do listy ---- */
  function wepnij(){
    var zapis = mem(KLUCZ);
    window.PACKS = (window.PACKS || []).filter(function(p){ return p.id !== 'moje'; });
    if(zapis && zapis.songs && zapis.songs.length) window.PACKS.push(zapis);
    return !!zapis;
  }

  function usun(){
    mem(KLUCZ, null);
    wepnij();
    $('imp-wynik').classList.remove('hide');
    $('imp-tresc').textContent = 'Twój repertuar został usunięty.';
    $('imp-tresc').className = 'komunikat';
    odswiezPrzyciskUsun();
    if(window.odswiezPakiety) window.odswiezPakiety();
  }

  function odswiezPrzyciskUsun(){
    $('imp-usun').classList.toggle('hide', !mem(KLUCZ));
  }

  function podepnijUI(){
    $('imp-otworz').onclick = function(){
      var panel = $('panel-import');
      panel.classList.toggle('hide');
      if(!panel.classList.contains('hide')) $('imp-tekst').focus();
    };
    $('imp-start').onclick = function(){ importuj($('imp-tekst').value); };
    $('imp-usun').onclick = usun;
    odswiezPrzyciskUsun();
  }

  wepnij();
  if(document.readyState === 'loading') document.addEventListener('DOMContentLoaded', podepnijUI);
  else podepnijUI();

  window.Moje = { importuj: importuj, wepnij: wepnij, usun: usun };
})();
