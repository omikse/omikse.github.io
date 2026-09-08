# Fretboard Lab

An interactive guitar fretboard trainer that starts from what a note physically *is* and
works up to scales, keys and improvisation. One HTML file, no build step, no dependencies,
no network calls. Open it and it works.

**Live:** https://omikse.github.io/fretboard/

---

## The seven views

### Learn
The default view, and the one meant for someone who has never read a fretboard diagram.
The neck sits in the middle; everything else is arranged around it.

- **Click any fret** — it sounds, and it loads into slot **A**. Your previous note slides
  into slot **B**, so you are always comparing your last two notes.
- **The wave panel** draws both notes across the same slice of time (5–40 ms). Play a note,
  then the same note twelve frets up, and B has visibly twice as many humps. That is the
  whole idea of an octave, shown rather than asserted.
- **Quick interval buttons** put B an octave, fifth, fourth, major third or one fret above A.
  The readout names the interval, gives the frequency ratio, and matches it to the nearest
  simple fraction (3:2 for a fifth, 45:32 for a tritone) with a note on why simple fractions
  sound settled and awkward ones do not.
- **Timbre**: *Guitar string* draws the real harmonic stack of a plucked string; *Pure tone*
  gives a clean sine, which makes "twice as fast" unmistakable. *Overlay the real signal*
  traces the actual audio leaving your speakers, aligned on a rising zero crossing so it
  holds still.
- **The harmonics panel** shows that one string is never doing one thing: it vibrates in
  halves and thirds at the same time, and those extra speeds land on the octave, the fifth,
  the next octave. The intervals were found inside a string, not invented.
- **The capo is a physical object.** It parks by the nut. Drag it onto any fret and it snaps
  there, mutes everything behind it, plays the note it lands on, and tells you what your
  open strings have become. Arrow keys move it if you would rather not drag.
- **Left panel** names the current scale, spells it correctly for the key, gives its formula
  and character, and lists every root position on every string.

### Guessing game
Four drills, all scored, with per-note accuracy kept in `localStorage`:

| Mode | What it asks |
|---|---|
| Name the note | A fret lights up — pick its name from the twelve |
| Find the note | You get a note and a string — click the right fret |
| Find every octave | One position is shown — click every other place that note lives |
| Find the interval | A reference note and an interval — click the target, any string |
| Hear the interval | Two notes play, low then high — name the distance by ear |

The ear mode is the one the diagrams cannot teach. Pick how many intervals are
in play (three, seven or all twelve); after you answer it shows where the two notes
were on the neck, so the sound and the shape arrive together. Accuracy per interval
is tracked in its own panel.

Filter by string, cap the fret range, restrict to naturals, and optionally run a clock.
The accuracy bars show which note names you are actually slow on, which is more useful than
the score.

### Chords
Every shape here was found by searching, not typed in from a chord book. For each
four-fret window it enumerates one note per string and keeps the combinations that
contain every note the chord needs — then throws out anything a hand cannot hold:
more than four fingers, more than a four-fret stretch, a barre crossing a string
meant to ring open, an open string buried between fretted ones up the neck. What
survives is scored on fullness, open strings, finger count, stretch and whether
the root is in the bass, then spread across the neck so you get a choice of
positions instead of six versions of first position.

It returns what it should: `x32010` for C, `x32000` for Cmaj7, `x3434x` for Cm7♭5,
the E-shape barre at the eighth fret. Because it is a search, it works in drop D,
open G, DADGAD, bass and ukulele with no extra data. Diagrams follow the printed
convention — low string on the left, root dots in orange, barres as bars, position
number beside the top fret. Click one to strum it; the selected shape appears on a
full neck with its notes named.

### Jam
A backing track that loops, with a scale drawn over the whole neck. Pick a key and
a progression — I–V–vi–IV, ii–V–I, I–vi–IV–V, a twelve-bar blues, or three minor
ones — set a tempo, and play over it.

The part that teaches: while a chord is sounding, the scale notes that belong to
*that* chord get a blue ring. Landing on those is the difference between noodling
over a progression and playing with it, and the ring makes it something you can
see coming.

The accompaniment picks its shapes with the chord search, weighted to stay near
the previous shape without playing an awkward one, so I–V–vi–IV in A comes out
`x02220 · 022100 · 244222 · xx0232` — what a guitarist would actually play.
Scheduling runs about three quarters of a second ahead of the audio clock, so the
loop keeps time regardless of what the page is doing. There is a count-in, and a
metronome with tap tempo and 2/3/4/6 beats to the bar that shares the same clock,
so you can run either or both.

### Pentatonics
All five boxes for minor and major pentatonic, each labelled with the CAGED shape it belongs
to. Show one box, or the whole neck. Optional blue note. "Ghost the other positions" reveals
where each box overlaps its neighbours — the overlap is the door between them, and that is
the thing worth practising.

Box shapes are a standard-tuning idea. In DADGAD or open G the notes stay correct but the
box buttons switch off, with a note explaining why.

### Circle of fifths
A clickable circle. Selecting a key gives its signature and which sharps or flats, the seven
diatonic chords with Roman numerals, the relative minor, and the ii–V–I, I–V–vi–IV and
12-bar blues in that key. I, IV and V are highlighted on the circle itself. One button sends
the key to the neck.

### Theory
Reference, generated for whichever key you select rather than written out for C: the twelve
notes, intervals with a song you would recognise for each, the major scale as the ruler,
diatonic harmony, chord formulas, the modes, and a section on the neck's own logic — the
G-to-B string shift, octave shapes, anchor frets, CAGED in a paragraph.

---

## Global settings

Kept in `localStorage`, applied to every view:

- **Tuning** — standard, drop D, half step down, open G, open D, DADGAD, 4-string bass, ukulele
- **Frets** — 12 to 24
- **Accidentals** — sharps, flats, or auto (follows the key)
- **Left-handed** — mirrors the neck; the nut, fret wires and capo all flip with it
- **Sound** — on/off
- **Theme** — light and dark
- **Share** — copies a link that encodes the view, root, scale, capo, labels,
  chord, tuning, fret count, accidentals and handedness, so you can send someone
  a setup rather than a list of instructions

---

## How the code is arranged

One file, `index.html`, about 100 KB: inline CSS, one inline script, no imports.

### Music model
Notes are pitch classes 0–11. A scale is a list of semitone offsets from the root
(`[0,2,4,5,7,9,11]` is major). `spellScale()` gives correct letter names for seven-note
scales, so F major spells B♭ rather than A♯ and E Dorian spells C♯ — one letter per degree,
never used twice.

### Audio
Everything routes through one master gain into an `AnalyserNode`, so the live-signal overlay
can read whatever is actually sounding.

- `pluck(midi)` — Karplus-Strong: a burst of noise in a delay line the length of one period,
  low-passed and averaged each pass. Sounds like a plucked string because it is built the
  same way one behaves.
- `toneOn(id, freq)` / `toneOff(id)` — sustained sine voices for the pure-tone mode.

The context is created on the first note, not on load, so autoplay policy is satisfied.

### Chord search
`findVoicings(root, quality, maxFret, allowInversions)` returns scored, playable
shapes; `fingersFor()` works out finger count and whether a barre is possible;
`pickNear()` chooses between them for smooth movement through a progression. All
three are shared by the Chords view, the circle's progression player and Jam.

### `Fretboard` class
Builds a CSS-grid neck, one instance per view.

```js
const fb = new Fretboard('fb-play', {
  clickable: true,
  capo: true,                       // adds the draggable capo
  canPlay: (s, f) => f >= PL.capo,  // veto clicks behind the capo
  capoGet: () => PL.capo,
  onCapo: f => { /* dropped on fret f */ },
  onCapoPreview: f => { /* dragging over fret f */ },
  fretsFn: () => someRange          // per-instance fret count
});

fb.clear().set(string, fret, cssClass, label).paint(contextRoot);
fb.setCapo(5);
fb.onCell = (string, fret) => {};
```

Fret widths follow the real geometry (each fret is 2^(1/12) closer than the last), clamped so
the high frets stay clickable. Borders use `border-inline-end`, so left-handed mode is one
`direction: rtl` and everything — nut, fret wires, capo — lands on the correct side.

The capo is a real positioned element rather than a styled cell, which is what makes it
draggable: pointer events (mouse and touch alike) move it freely, and on release
`fretAtX()` finds the fret whose rect contains the pointer and snaps to it.

### Learn view state
```js
const PL = {
  timbre:'string'|'sine', win:20, live:false, hold:false, keep:true, ghost:true,
  A:{s,f,midi}|null, B:{s,f,midi}|null,
  root:'A', scale:'minPent', labels:'name'|'pitch'|'deg'|'none',
  capo:0, sweeping:false
};
```
`setSlot()` → `renderPlay()` → repaints the neck, both slot cards, the ratio line, the wave
and the harmonics.

---

## Running it

Double-clicking the file works — there are no modules and no fetches. To serve it anyway:

```bash
python -m http.server 8000
```

Audio needs a user gesture before it will start, in every browser. Clicking a fret counts.

---

## A practice order that works

1. Learn view. Drag the capo. Play a note, then the same note twelve frets up, and watch
   the wave double. Read the four notes under the neck.
2. Game → *Name the note*, naturals only, low E and A strings, frets to 12. Get to 95%.
3. Game → *Find every octave*. This is the drill that stops you counting frets.
4. All six strings, naturals, then unlock the sharps and flats.
5. Pentatonics → box 1 only, in all twelve keys, saying each note name out loud.
6. Join two boxes, then three, pivoting on the notes they share.
7. Improvise for one minute and name every note you land on. Slow, ugly, and the fastest
   thing on this list.

---

## Known limits

- Pentatonic box shapes assume standard tuning; other tunings show correct notes but no boxes.
- The five boxes are drawn for six-string instruments. Bass and ukulele tunings work
  everywhere else.
- Practice stats are per browser origin — the copy on the site and a local copy keep
  separate histories.

## Ideas not built yet

- A practice timer that logs what you drilled and for how long
- Drum patterns under the Jam loop instead of bass and strum alone
- Recording a phrase and hearing it back transposed to every key
- Chord shapes for extensions past the thirteenth
