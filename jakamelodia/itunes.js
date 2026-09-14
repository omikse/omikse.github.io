/* ============================================================
   itunes.js — trackId  ->  adres 30-sekundowej probki
   ------------------------------------------------------------
   Adresy probek w sklepie Apple zmieniaja sie co jakis czas,
   wiec nie zapisujemy ich w repozytorium. Tutaj zamieniamy
   stale trackId na swiezy adres i trzymamy wynik w localStorage
   przez tydzien, zeby nie meczyc API przy kazdym wejsciu.
   ============================================================ */
(function(){
  'use strict';
  var NS    = 'jtm.trk.';
  var TTL   = 7*24*60*60*1000;        // tydzien
  var CHUNK = 70;                      // ile id na jedno zapytanie
  var KRAJ  = 'PL';

  function zCache(id){
    try{
      var v = localStorage.getItem(NS+id); if(!v) return null;
      var o = JSON.parse(v);
      if(!o || !o.p || Date.now()-o.ts > TTL) return null;
      return o;
    }catch(e){ return null; }
  }
  function doCache(id, o){
    try{ localStorage.setItem(NS+id, JSON.stringify({p:o.p, art:o.art, ts:Date.now()})); }catch(e){}
  }

  /* wieksza okladka — Apple oddaje 100x100, ale zgadza sie na wiecej */
  function okladka(url){ return url ? url.replace(/\/\d+x\d+bb\./, '/600x600bb.') : ''; }

  function pobierz(ids){
    var url = 'https://itunes.apple.com/lookup?id='+ids.join(',')+'&country='+KRAJ;
    return fetch(url).then(function(r){
      if(!r.ok) throw new Error('iTunes HTTP '+r.status);
      return r.json();
    });
  }

  /* rozwiaz(songs) -> Promise({ok:[...], martwe:[...]})
     ok     — utwory wzbogacone o .preview i .art
     martwe — te, ktorych Apple juz nie ma (do poprawienia w songs.js) */
  /* rozwiaz(songs) -> Promise({ok:[...], martwe:[...]})
     ok     — utwory wzbogacone o .preview i .art, W KOLEJNOSCI Z songs.js
              (wazne: losowanie utworu dnia indeksuje po tej kolejnosci)
     martwe — te, ktorych Apple juz nie ma (do poprawienia w songs.js) */
  function rozwiaz(songs){
    var gotowe = {}, brakujace = [];
    songs.forEach(function(s){
      var c = zCache(s.id);
      if(c) gotowe[s.id] = {p:c.p, art:c.art};
      else  brakujace.push(s);
    });

    var partie = [];
    for(var i=0;i<brakujace.length;i+=CHUNK) partie.push(brakujace.slice(i,i+CHUNK));

    return partie.reduce(function(lancuch, partia){
      return lancuch.then(function(){
        return pobierz(partia.map(function(s){ return s.id; })).then(function(j){
          (j.results||[]).forEach(function(x){
            if(x.wrapperType==='track' && x.previewUrl){
              var d = {p:x.previewUrl, art:okladka(x.artworkUrl100)};
              gotowe[x.trackId] = d; doCache(x.trackId, d);
            }
          });
        });
      });
    }, Promise.resolve()).then(function(){
      var ok = [], martwe = [];
      songs.forEach(function(s){
        var d = gotowe[s.id];
        if(d) ok.push(Object.assign({}, s, {preview:d.p, art:d.art}));
        else  martwe.push(s);
      });
      if(martwe.length) console.warn('[jakamelodia] brak probki dla:', martwe.map(function(s){return s.id+' '+s.t;}));
      return {ok:ok, martwe:martwe};
    });
  }

  window.ITunes = { rozwiaz: rozwiaz };
})();
