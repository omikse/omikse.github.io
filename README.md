# Fretboard Lab

An interactive guitar fretboard trainer that starts from what a note physically *is* and
works up to scales, keys and improvisation. One HTML file, no build step, no dependencies,
no network calls. Open it and it works.

**Live:** https://omikse.github.io/fretboard/

---

## What is in it

Every neck in the app is keyboard navigable: tab onto it and the arrow keys walk
string by string and fret by fret, Enter sounds the note, and each square announces
itself as "String 6, fret 5, A". There is a print stylesheet too, so a neck diagram
or a set of chord shapes prints without the controls around them.

### A guided session
The first card in Learn, and the answer to the question that actually stops people
practising: not "how does this work" but "what should I do today".

Pick ten, twenty or thirty minutes and it builds a session from what your stats say
you have and have not done — how much of the neck you have been asked about, how
your ear scores compare to your hands — then walks you through it. Each step sets up
the view it needs (it opens the tuner, sets the drill filters, starts the chord-change
drill, starts the jam loop) and a bar along the bottom keeps the clock, names what you
are doing and why, and moves on by itself.

A beginner with no history gets low strings only and ear training; someone who has
covered the neck gets all six strings and a pentatonic box instead. The last step is
always playing over something, because that is the point of the other four.

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
- **A tuner**, collapsed at the top, because an out-of-tune guitar teaches you the
  wrong notes. It listens through the microphone and works out the pitch with YIN —
  the cumulative mean normalised difference, taking the first dip under a threshold
  rather than the deepest one, which is what stops a tuner hearing a subharmonic and
  telling you an E is an E an octave down. It locks onto the nearest open string
  within 180 cents, so a badly flat low E reads as a flat low E and not as a sharp
  D♯. Nothing is recorded or sent anywhere. Reference tones are there if you would
  rather tune by ear.
- **Notation and tab.** Whatever you play appears on a staff and a tab stave side by
  side, so the dot on a string, the number on the tab and the blob on the staff stop
  being three separate things. Guitar music is written an octave above where it sounds
  — the little 8 under the clef — which is why the low E lands three ledger lines below
  the staff rather than off the page. It picks a bass clef for bass tunings and grows
  the gap between the staves so ledger lines never collide with the tab.
- **Left panel** names the current scale, spells it correctly for the key, gives its formula
  and character, and lists every root position on every string.

### Drills
Eight drills, all scored, with per-note accuracy kept in `localStorage`:

| Mode | What it asks |
|---|---|
| Name the note | A fret lights up — pick its name from the twelve |
| Find the note | You get a note and a string — click the right fret |
| Find every octave | One position is shown — click every other place that note lives |
| Find the interval | A reference note and an interval — click the target, any string |
| Hear the interval | Two notes play, low then high — name the distance by ear |
| Hear the chord | A chord is strummed — say what kind it is |
| Play it | You are given a note — play it on the guitar and the app listens |
| Read the note | One note on a staff — name it |

The two ear modes are what diagrams cannot teach. Pick how many intervals are
in play (three, seven or all twelve); after you answer it shows where the two notes
were on the neck, so the sound and the shape arrive together. Telling major from
minor is arguably the more useful skill for a beginner, so chord mode goes from
exactly that up to nine qualities including diminished, augmented, suspended and
the sevenths, strumming a real voicing at a random root and revealing the shape
afterwards. Accuracy is tracked per interval and per chord type in its own panel.

*Play it* is the one that involves the actual instrument. It names a note, listens
through the microphone, and moves on when it hears that pitch class in any octave —
so the loop runs screen to fretboard to string to ear rather than stopping at a
button. It shares the tuner's microphone through a reference-counted handle, and
whichever of the two you close last is the one that releases the device.

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

Twenty-one chord types are covered, from triads and suspensions up through the
sevenths to add9, 6/9, 7sus4, the ninths and the 7♯9 — three hundred and fifty-seven
root-and-quality combinations, every one of which returns something playable. Five-note
chords drop the fifth, which is the note a guitarist drops when the strings run out and
the only one whose absence does not change what the chord is.

It returns what it should: `x32010` for C, `133211` for F, `x32000` for Cmaj7,
`x3434x` for Cm7♭5, the E-shape barre at the eighth fret. Because it is a search,
it works in drop D, open G, DADGAD, bass and ukulele with no extra data — and it
knows a ukulele is reentrant, so it measures the bass note by pitch rather than by
string order and stops insisting on a root in the bass on an instrument that has no
bass register. Switch the tuning to ukulele and it gives you `0003`, `0232`, `2010`
and `2000` for C, G, F and Am. Diagrams follow the printed
convention — low string on the left, root dots in orange, barres as bars, position
number beside the top fret — and each dot carries the finger that plays it. Fingering
is derived, not stored: a barre takes the index, everything else is numbered by fret
and then by string, and a barre is only used when three strings share the lowest fret
or when there are more notes than free fingers. That last condition is what stops D
coming out as a barre chord. The results match the chord book — C is ring, middle,
index; D is index, middle, ring; F is index barre, middle, ring, little; Bm is the
barre at the second fret with the little finger on the D string. Click one to strum it; the selected shape appears on a
full neck with its notes named.

It runs backwards too. Put a shape you have stumbled onto on the second neck —
one fret per string, click again to mute — and it names it, using the same rule in
reverse: every note you are playing must belong to the chord, every note the chord
needs must be sounding, and the fifth is optional. `332010` comes back as C/G,
correctly spotted as an inversion, and `022000` as Em with a note that it could
equally be called G6/E, because it can.

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
so you can run either or both. The metronome can also ramp — add so many bpm every so
many bars up to a ceiling — which is how speed is actually built: from something clean
and slow, not from trying fast and missing.

### Rhythm
The gap most fretboard tools leave open. A strumming hand does not stop: it swings
down on every beat and up on every "and" for the whole bar, whether or not it
touches the strings. A pattern is not a sequence of movements to memorise, it is a
choice of which of those movements connect — so the eight boxes here are fixed,
labelled 1 & 2 & 3 & 4 & with their stroke direction, and only their state changes.

Click a box to cycle it through strike, muted chuck and miss. Seven presets are
there to start from, including the D · D U · U D U that sits under a thousand
songs, and each starts playing when you pick it. It strums a real voicing of
whatever chord you choose, with an optional click on the beat, and a playhead that
shows which of the eight you are on. Jam can borrow the pattern too, so the backing
track strums the way you do.

It also fingerpicks. Switching hands turns the eight boxes into string choices
instead of strokes, with five patterns to start from — arpeggios, an alternating
bass, a ballad figure. The patterns are written as positions within the chord
rather than absolute string numbers, so one pattern survives every chord change:
the alternating bass picks strings 6-4-5-3 on a G and becomes 4-2-3-1 on a D,
skipping the muted strings by itself, which is what a player's thumb does without
being told.

Underneath it is the drill that most beginners actually need: changing chords in
time. Pick a set — G C D, the four chords, every open chord, the sevenths — and it
keeps the bar going, shows what is coming next and counts the beats down to the
change. The change happens on the beat whether your fingers are ready or not,
which is the only way they ever get ready.

### Pentatonics
All five boxes for minor and major pentatonic, each labelled with the CAGED shape it belongs
to. Show one box, or the whole neck. Optional blue note. "Ghost the other positions" reveals
where each box overlaps its neighbours — the overlap is the door between them, and that is
the thing worth practising.

Shapes can be played back in the four sequences players actually drill them with —
straight, in pairs, in thirds, in fours — at three speeds, ascending then descending,
with each note lighting up as it sounds. The same sequences apply to any scale in the
Learn view.

Box shapes are a standard-tuning idea. In DADGAD or open G the notes stay correct but the
box buttons switch off, with a note explaining why.

### Circle
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
- **Left-handed** — mirrors the neck; the nut, fret wires, capo and arrow keys all
  flip with it
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

### Pitch detection
`detectPitch(buffer, sampleRate)` implements YIN over a 1024-sample window, bounded
to lags between 70 Hz and 1300 Hz. Tested against synthesised tones at every open
string frequency, pure and with eight harmonics: exact to 0.0 cents, and within
about 7 cents with 5% white noise added. Roughly 1.3 ms a call, run 20 times a
second.

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
