/* ============================================================
   audio.js — odtwarzanie urywkow i dzwieki studia
   ------------------------------------------------------------
   Probki lecimy przez Web Audio, a nie przez <audio>, z dwoch
   powodow: source.start(kiedy, 0, ile) urywa dzwiek co do probki
   (a wiec "1 sekunda" to naprawde 1 sekunda), oraz dostajemy
   AnalyserNode, ktory napedza korektor graficzny na scenie.
   Apple oddaje probki z naglowkiem CORS, wiec decodeAudioData
   dziala bez posrednikow.
   ============================================================ */
(function(){
  'use strict';
  var ctx = null, master = null, analyser = null, gramTeraz = null;
  var bufory = {};                    // url -> AudioBuffer
  var FADE = 0.06;                    // wyciszenie na koncu urywka

  /* kontekst tworzymy dopiero przy pierwszym kliknieciu — inaczej
     przegladarki mobilne i tak go uspia */
  function silnik(){
    if(!ctx){
      var AC = window.AudioContext || window.webkitAudioContext;
      if(!AC) return null;
      try{ ctx = new AC(); }catch(e){ return null; }
      master = ctx.createGain(); master.gain.value = 1;
      analyser = ctx.createAnalyser();
      analyser.fftSize = 256; analyser.smoothingTimeConstant = 0.75;
      master.connect(analyser); analyser.connect(ctx.destination);
    }
    if(ctx.state === 'suspended') ctx.resume();
    return ctx;
  }

  function wczytaj(url){
    if(bufory[url]) return Promise.resolve(bufory[url]);
    var c = silnik(); if(!c) return Promise.reject(new Error('brak Web Audio'));
    return fetch(url).then(function(r){
      if(!r.ok) throw new Error('probka HTTP '+r.status);
      return r.arrayBuffer();
    }).then(function(ab){
      return new Promise(function(res, rej){
        c.decodeAudioData(ab, function(b){ bufory[url]=b; res(b); }, rej);
      });
    });
  }

  function stop(){
    if(gramTeraz){
      try{ gramTeraz.g.gain.cancelScheduledValues(ctx.currentTime);
           gramTeraz.g.gain.setTargetAtTime(0, ctx.currentTime, 0.015);
           gramTeraz.src.stop(ctx.currentTime + 0.1); }catch(e){}
      gramTeraz = null;
    }
  }

  /* graj(url, sekundy, odKtorej) -> Promise spelniana gdy urywek dobiegnie konca */
  function graj(url, sekundy, od){
    od = od || 0;
    return wczytaj(url).then(function(buf){
      stop();
      var c = silnik();
      var dl = Math.min(sekundy, Math.max(0.2, buf.duration - od));
      var src = c.createBufferSource(); src.buffer = buf;
      var g = c.createGain();
      var t = c.currentTime + 0.02;
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(1, t + 0.015);          // bez trzasku na wejsciu
      g.gain.setValueAtTime(1, t + dl - FADE);
      g.gain.linearRampToValueAtTime(0, t + dl);             // i bez trzasku na wyjsciu
      src.connect(g).connect(master);
      src.start(t, od, dl);
      src.stop(t + dl + 0.02);
      gramTeraz = {src:src, g:g};
      return new Promise(function(res){
        src.onended = function(){ if(gramTeraz && gramTeraz.src===src) gramTeraz=null; res(); };
      });
    });
  }

  function gra(){ return !!gramTeraz; }

  /* poziomy do korektora — 0..1 */
  var dane = null;
  function poziomy(){
    if(!analyser) return null;
    if(!dane) dane = new Uint8Array(analyser.frequencyBinCount);
    analyser.getByteFrequencyData(dane);
    return dane;
  }

  /* ============================================================
     dzwieki studia
     ------------------------------------------------------------
     Wszystko skladane z oscylatorow tutaj, na miejscu. W katalogu
     nie ma ani jednego pliku dzwiekowego i nie moze byc: sygnal
     teleturnieju jest cudzym nagraniem. To sa wlasne motywy w tej
     samej konwencji — blaszany zespol i talerz perkusyjny.

     Przelacznik dotyczy tylko tych dzwiekow. Melodie do zgadywania
     graja zawsze, bo bez nich nie ma gry.
     ============================================================ */
  var stingi = true;
  function stingiWl(v){ if(v!==undefined) stingi = !!v; return stingi; }

  var szum = null;
  function bufSzumu(c){
    if(szum && szum.sampleRate===c.sampleRate) return szum;
    var n = Math.floor(c.sampleRate*1.2);
    var b = c.createBuffer(1,n,c.sampleRate), d = b.getChannelData(0);
    for(var i=0;i<n;i++) d[i] = Math.random()*2-1;
    szum = b; return b;
  }
  function nutaHz(m){ return 440*Math.pow(2,(m-69)/12); }

  /* blaszana szarza: dwie pily lekko rozstrojone, filtr otwiera sie z uderzeniem */
  function blacha(freq, kiedy, dlug, glos){
    var c = silnik(); if(!c) return;
    var t = c.currentTime + kiedy;
    var g = c.createGain(), f = c.createBiquadFilter();
    f.type='lowpass'; f.Q.value = 6;
    f.frequency.setValueAtTime(420, t);
    f.frequency.linearRampToValueAtTime(Math.min(5200, freq*7), t+0.05);
    f.frequency.exponentialRampToValueAtTime(Math.max(600, freq*2), t+dlug);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(glos, t+0.025);
    g.gain.setValueAtTime(glos*0.85, t+dlug*0.6);
    g.gain.exponentialRampToValueAtTime(0.0001, t+dlug);
    [-7, 7].forEach(function(cent){
      var o = c.createOscillator();
      o.type='sawtooth';
      o.frequency.value = freq * Math.pow(2, cent/1200);
      o.connect(f); o.start(t); o.stop(t+dlug+0.05);
    });
    f.connect(g).connect(master);
  }
  function akord(freqs, kiedy, dlug, glos){
    freqs.forEach(function(f){ blacha(f, kiedy, dlug, glos/Math.sqrt(freqs.length)); });
  }
  /* nisko pod spodem, zeby akord mial na czym stac */
  function bas(freq, kiedy, dlug, glos){
    var c = silnik(); if(!c) return;
    var t = c.currentTime + kiedy;
    var o = c.createOscillator(), g = c.createGain();
    o.type='triangle'; o.frequency.value = freq;
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(glos, t+0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t+dlug);
    o.connect(g).connect(master); o.start(t); o.stop(t+dlug+0.05);
  }
  /* talerz — szum przez gorna polke, dlugi zjazd */
  function talerz(kiedy, glos, dlug){
    var c = silnik(); if(!c) return;
    dlug = dlug || 1.1;
    var t = c.currentTime + kiedy;
    var s = c.createBufferSource(); s.buffer = bufSzumu(c);
    var hp = c.createBiquadFilter(); hp.type='highpass'; hp.frequency.value = 5200;
    var g = c.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(glos, t+0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t+dlug);
    s.connect(hp).connect(g).connect(master);
    s.start(t); s.stop(t+dlug+0.05);
  }
  /* narastajacy szum przed uderzeniem */
  function nalot(kiedy, dlug, glos){
    var c = silnik(); if(!c) return;
    var t = c.currentTime + kiedy;
    var s = c.createBufferSource(); s.buffer = bufSzumu(c);
    var bp = c.createBiquadFilter(); bp.type='bandpass'; bp.Q.value = 1.4;
    bp.frequency.setValueAtTime(700, t);
    bp.frequency.exponentialRampToValueAtTime(7000, t+dlug);
    var g = c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(glos, t+dlug);
    g.gain.linearRampToValueAtTime(0, t+dlug+0.05);
    s.connect(bp).connect(g).connect(master);
    s.start(t); s.stop(t+dlug+0.1);
  }

  /* ---- wlasciwe sygnaly (wlasne motywy, C-dur) ---- */

  /* czolowka: nalot, wbiegajaca po trojdzwieku blacha i trzymany akord */
  function intro(){
    if(!stingi) return;
    var c = silnik(); if(!c) return;
    nalot(0, 0.34, 0.11);
    talerz(0.34, 0.13, 1.5);
    bas(nutaHz(36), 0.34, 1.9, 0.20);
    bas(nutaHz(43), 0.34, 1.9, 0.10);
    [67, 72, 76, 79].forEach(function(m, i){
      blacha(nutaHz(m), 0.34 + i*0.115, 0.14, 0.20);
    });
    akord([nutaHz(72), nutaHz(76), nutaHz(79), nutaHz(84)], 0.83, 1.25, 0.30);
    talerz(0.83, 0.16, 1.5);
  }

  /* trafienie: trzy nuty w gore i akord na koniec */
  function fanfara(){
    if(!stingi) return;
    if(!silnik()) return;
    [76, 79, 84].forEach(function(m, i){ blacha(nutaHz(m), i*0.075, 0.12, 0.20); });
    akord([nutaHz(84), nutaHz(88), nutaHz(91)], 0.225, 0.55, 0.24);
    talerz(0.225, 0.09, 0.7);
    bas(nutaHz(48), 0.225, 0.6, 0.16);
  }

  /* pudlo: dwutonowy klakson w dol */
  function buczek(){
    if(!stingi) return;
    var c = silnik(); if(!c) return;
    [0, 0.16].forEach(function(op, i){
      var t = c.currentTime + op;
      var g = c.createGain(), f = c.createBiquadFilter();
      f.type='lowpass'; f.frequency.value = 1100;
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(0.17, t+0.02);
      g.gain.setValueAtTime(0.15, t+0.11);
      g.gain.exponentialRampToValueAtTime(0.0001, t+0.19);
      [0, 11].forEach(function(cent){
        var o = c.createOscillator();
        o.type='sawtooth';
        o.frequency.value = nutaHz(i ? 44 : 47) * Math.pow(2, cent/1200);
        o.connect(f); o.start(t); o.stop(t+0.24);
      });
      f.connect(g).connect(master);
    });
  }

  /* werbel przed odslonieciem odpowiedzi */
  function werbel(){
    if(!stingi) return;
    var c = silnik(); if(!c) return;
    for(var i=0;i<16;i++){
      var t = c.currentTime + i*0.042;
      var s = c.createBufferSource(); s.buffer = bufSzumu(c);
      var bp = c.createBiquadFilter(); bp.type='bandpass'; bp.frequency.value=1900; bp.Q.value=0.8;
      var g = c.createGain();
      g.gain.setValueAtTime(0.045 + i*0.007, t);
      g.gain.exponentialRampToValueAtTime(0.0001, t+0.055);
      s.connect(bp).connect(g).connect(master); s.start(t); s.stop(t+0.07);
    }
    talerz(16*0.042, 0.1, 0.8);
  }

  /* koniec rundy: dluzsza wersja czolowki */
  function final(){
    if(!stingi) return;
    if(!silnik()) return;
    bas(nutaHz(36), 0, 2.4, 0.20);
    [72, 76, 79, 84].forEach(function(m, i){ blacha(nutaHz(m), i*0.1, 0.13, 0.20); });
    akord([nutaHz(77), nutaHz(81), nutaHz(84)], 0.42, 0.38, 0.22);
    akord([nutaHz(79), nutaHz(83), nutaHz(86)], 0.80, 0.38, 0.22);
    akord([nutaHz(72), nutaHz(76), nutaHz(79), nutaHz(84)], 1.16, 1.5, 0.30);
    talerz(1.16, 0.17, 1.8);
  }

  /* ---- motyw menu ----------------------------------------------------
     Wlasna, zapetlona przygrywka pod menu glownym. Osiem taktow: chodzacy
     bas, akordy na slabych czesciach taktu i prosty motyw na wierzchu.
     Gra ciszej niz sygnaly, zeby nie zagluszala rozmowy przy komputerze. -- */
  var motywDo = null;
  var TAKT = 0.46;                    // dlugosc cwiercnuty

  function motywPrzebieg(){
    var c = silnik(); if(!c) return 8*TAKT;
    var basy    = [36, 36, 43, 43, 33, 33, 41, 41];          // C  C  G  G  A  A  F  F
    var akordy  = [[60,64,67], [60,64,67], [62,67,71], [62,67,71],
                   [57,60,64], [57,60,64], [59,65,68], [59,65,68]];
    var melodia = [72, 74, 76, 79, 76, 74, 72, 71];
    for(var i=0;i<8;i++){
      var t = i*TAKT;
      bas(nutaHz(basy[i]), t, TAKT*0.9, 0.13);
      if(i % 2 === 1) akord(akordy[i].map(nutaHz), t + TAKT*0.5, TAKT*0.45, 0.07);
      blacha(nutaHz(melodia[i]), t + TAKT*0.25, TAKT*0.55, 0.075);
      if(i % 4 === 0) talerz(t, 0.035, 0.32);
    }
    return 8*TAKT;
  }
  function motywStart(){
    motywStop();
    if(!stingi) return;
    var dl = motywPrzebieg();
    motywDo = setTimeout(motywStart, dl*1000);
  }
  function motywStop(){
    if(motywDo){ clearTimeout(motywDo); motywDo = null; }
  }
  function motywGra(){ return !!motywDo; }

  /* tykniecie */
  function tik(mocne){
    if(!stingi) return;
    var c = silnik(); if(!c) return;
    var t = c.currentTime;
    var o = c.createOscillator(), g = c.createGain(), f = c.createBiquadFilter();
    o.type='square';
    o.frequency.setValueAtTime(mocne?1600:1050, t);
    o.frequency.exponentialRampToValueAtTime(mocne?760:560, t+0.03);
    f.type='bandpass'; f.frequency.value = mocne?1500:1000; f.Q.value=1.2;
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(mocne?0.26:0.14, t+0.002);
    g.gain.exponentialRampToValueAtTime(0.0001, t+0.05);
    o.connect(f).connect(g).connect(master); o.start(t); o.stop(t+0.08);
  }
  window.Audio2 = {
    silnik: silnik, wczytaj: wczytaj, graj: graj, stop: stop, gra: gra, poziomy: poziomy,
    intro: intro, fanfara: fanfara, motywStart: motywStart, motywStop: motywStop, motywGra: motywGra, buczek: buczek, werbel: werbel, final: final, tik: tik,
    stingiWl: stingiWl
  };
})();
