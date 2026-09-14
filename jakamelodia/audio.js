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

  /* ---- dzwieki studia: wszystko syntezowane, zero plikow ---- */
  var szum = null;
  function bufSzumu(c){
    if(szum && szum.sampleRate===c.sampleRate) return szum;
    var n = Math.floor(c.sampleRate*0.5);
    var b = c.createBuffer(1,n,c.sampleRate), d = b.getChannelData(0);
    for(var i=0;i<n;i++) d[i] = Math.random()*2-1;
    szum = b; return b;
  }
  function nuta(freq, kiedy, dlug, glos, typ){
    var c = silnik(); if(!c) return;
    var t = c.currentTime + kiedy;
    var o = c.createOscillator(), g = c.createGain();
    o.type = typ || 'square'; o.frequency.setValueAtTime(freq, t);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(glos, t+0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t+dlug);
    o.connect(g).connect(master); o.start(t); o.stop(t+dlug+0.05);
  }
  /* wzlot na trafienie */
  function fanfara(){
    [0,1,2,3].forEach(function(i){
      nuta([523.25,659.25,783.99,1046.5][i], i*0.085, 0.42, 0.17, 'square');
      nuta([261.63,329.63,392.00,523.25][i], i*0.085, 0.42, 0.09, 'triangle');
    });
  }
  /* opadajacy buczek na pomylke */
  function buczek(){
    var c = silnik(); if(!c) return;
    var t = c.currentTime;
    var o = c.createOscillator(), g = c.createGain();
    o.type='sawtooth';
    o.frequency.setValueAtTime(220, t);
    o.frequency.exponentialRampToValueAtTime(90, t+0.38);
    g.gain.setValueAtTime(0.16, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t+0.42);
    o.connect(g).connect(master); o.start(t); o.stop(t+0.46);
  }
  /* werbel na odsloniecie odpowiedzi */
  function werbel(){
    var c = silnik(); if(!c) return;
    for(var i=0;i<14;i++){
      var t = c.currentTime + i*0.045;
      var s = c.createBufferSource(); s.buffer = bufSzumu(c);
      var bp = c.createBiquadFilter(); bp.type='bandpass'; bp.frequency.value=1800; bp.Q.value=0.8;
      var g = c.createGain();
      g.gain.setValueAtTime(0.05 + i*0.006, t);
      g.gain.exponentialRampToValueAtTime(0.0001, t+0.06);
      s.connect(bp).connect(g).connect(master); s.start(t); s.stop(t+0.08);
    }
  }
  /* tykniecie zegara w rundzie */
  function tik(mocne){
    var c = silnik(); if(!c) return;
    var t = c.currentTime;
    var o = c.createOscillator(), g = c.createGain(), f = c.createBiquadFilter();
    o.type='square';
    o.frequency.setValueAtTime(mocne?1600:1050, t);
    o.frequency.exponentialRampToValueAtTime(mocne?760:560, t+0.03);
    f.type='bandpass'; f.frequency.value = mocne?1500:1000; f.Q.value=1.2;
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(mocne?0.3:0.16, t+0.002);
    g.gain.exponentialRampToValueAtTime(0.0001, t+0.05);
    o.connect(f).connect(g).connect(master); o.start(t); o.stop(t+0.08);
  }

  window.Audio2 = {
    silnik: silnik, wczytaj: wczytaj, graj: graj, stop: stop, gra: gra,
    poziomy: poziomy, fanfara: fanfara, buczek: buczek, werbel: werbel, tik: tik
  };
})();
