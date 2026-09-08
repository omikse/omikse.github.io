# Fretboard Lab

A single-page interactive tool for learning the guitar fretboard from first principles. Combines **sound waves, music theory, and hands-on practice** into one unified learning environment.

## Features

### Learn Tab (Unified Sound & Fretboard)
The entry point for absolute beginners. Combines waveform visualization with the fretboard as the central interactive element.

**Layout:**
- **Top:** Explanatory card ("Start here: a note is a wave")
- **Center:** The fretboard (the focal point)
  - Draggable capo — click and drag to any fret
  - Mutes everything before it; open strings update live
  - Visual capo bar with metallic finish
- **Left panel:** Root, Scale/Chord, Labels, Capo selector
- **Right panel:** A and B slot info (pitch names, Hz, cycle time)
- **Wave display:** 20 ms oscilloscope with A/B overlaid
- **Bottom controls:** Timbre (guitar string / pure tone), window width, overlays, quick interval buttons

**How to Use:**
1. Click any fret → loads into slot A
2. B keeps your previous note for comparison (unless you turn off "Keep the previous note")
3. Click one of the quick buttons (octave up, fifth, fourth, etc.) → B jumps to that interval
4. Watch the wave: twice as many humps in 20 ms = octave (exactly double frequency)
5. Drag the capo → all muted frets turn grey, open strings rename, every note shifts

**Why this layout:**
The fretboard is the thing you're learning. Waves are supporting evidence. The capo is an interaction, not a menu choice. Everything else radiates around the neck itself.

### Guessing Game
Four modes to drill note recognition:
- **Name the note:** A fret lights up; pick from 12 buttons
- **Find the note:** Given a note name and string, click the fret
- **Find every octave:** One position shown; find all other octaves in range
- **Find the interval:** Shown a root and an interval name; find the target note

Settings: filter by string, highest fret, time limit, naturals-only mode.
Stats persist in localStorage: accuracy per note, streak, best streak, average time.

### Pentatonics
All five boxes, with CAGED shape labels (standard tuning only).
- Minor and major modes
- Optional blue note (♭5)
- Ghost other positions to see where boxes join
- Full map or single-box zoom

### Circle of Fifths
Clickable 12-point circle:
- Sharps clockwise, flats anticlockwise
- Major/relative minor on inner ring
- Diatonic triads with Roman numerals
- Direct link back to the fretboard to explore the key

### Theory
Reference material:
- 12 notes, intervals with cultural examples
- Major scale as the ruler
- Diatonic harmony (chord per degree)
- Chord formulas
- Modes and their color
- The neck's own logic (octave shapes, anchor frets, CAGED)

---

## Architecture

### Audio System
- **Master bus:** All sounds route through one `master` gain node + `analyser` for real-time signal capture
- **Sustained tones:** `toneOn()` / `toneOff()` for pure sine waves (used in Learn tab overlays)
- **Plucked notes:** Karplus-Strong algorithm generates guitar-like decay with harmonics
- **Frequency mapping:** MIDI numbers → Hz → string/fret lookup

### Fretboard Component
```javascript
const fb = new Fretboard(containerID, opts);
fb.set(string, fret, class, label);    // Mark a dot
fb.clear();                            // Clear all marks
fb.paint(contextRoot);                 // Render and label using the given root note
fb.setCapo(fretNumber);                // Visually place and mute frets before capo
fb.onCell = (string, fret) => {};      // Callback when clicked
```

**Features:**
- Per-cell click handler with optional `canPlay(s, f)` veto (capo uses this to block closed frets)
- Capo layer: divs at each fret position; one marked with `.capoon` class shows the bar
- Logical borders (`border-inline-end`) flip for left-handed mode
- Per-cell `dot` divs with classes for state: `root`, `on`, `ghost`, `mute`, `picked`, `pickedB`, `target`, `bad`

### Learn Tab (v-play)
Central data structure:
```javascript
const PL = {
  timbre: 'string' | 'sine',          // Harmonic content
  win: 20,                            // Milliseconds to display
  live: false,                        // Overlay real speaker output?
  hold: false,                        // Keep tones sustaining?
  keep: true,                         // Keep previous note in B?
  A: {s, f, midi} | null,           // Slot A (blue)
  B: {s, f, midi} | null,           // Slot B (orange)
  root: 'A',                         // Scale root
  scale: 'minPent',                  // Scale key
  labels: 'name' | 'pitch' | 'deg' | 'none',  // What to show on dots
  capo: 0,                           // Fret capo starts at
  sweeping: false                    // Currently running the sweep?
};
```

**Rendering flow:**
1. `setSlot('A', s, f)` → loads note into A, shifts old A to B (if keep=true), plays it
2. `renderPlay()` → updates fretboard marks, slot cards, ratio line, wave display
3. `drawWave()` → canvas oscilloscope
4. `drawHarm()` → harmonic stack bar chart
5. `plLoop(on)` → RAF loop for live signal overlay

### Draggable Capo
Currently: static dropdown selector. To make draggable:
1. Detect mouse down on any capo cell (`.capoon`)
2. Track mouse position → map to fret number
3. On mouse up → snap to nearest fret, call `fbW.setCapo(n)`
4. Visual feedback: capo bar follows cursor during drag

**Implementation sketch:**
```javascript
fbW.host.addEventListener('mousedown', (e) => {
  const cell = e.target.closest('.capoon');
  if (!cell) return;
  const start = { x: e.clientX, fret: PL.capo };
  const onMove = (e) => {
    const delta = (e.clientX - start.x) / cellWidth;
    const newFret = Math.max(0, Math.min(S.frets, start.fret + Math.round(delta)));
    // Update capo visually
  };
  document.addEventListener('mousemove', onMove, { once: false });
  document.addEventListener('mouseup', () => {
    document.removeEventListener('mousemove', onMove);
    PL.capo = finalFret;
    renderPlay();
  }, { once: true });
});
```

### Music Model
**Pitch class:** 0–11 (C=0, C#=1, ..., B=11)
**Intervals:** Semitone counts (0=unison, 7=perfect 5th, 12=octave)
**Scales:** Arrays of intervals from root, e.g. `[0, 2, 4, 5, 7, 9, 11]` for major

**Key naming:** 
- Sharp keys if the root doesn't contain 'b'
- Flat keys otherwise
- Per-key override via `FLAT_KEYS` set

**Spelling:** `spellScale(rootName, intervals)` → array of note names preserving letter identity
- C major: `['C','D','E','F','G','A','B']`
- F major: `['F','G','A','B♭','C','D','E']`

---

## Settings & Storage

**Global settings** (localStorage, top header):
- Tuning (8 choices including alternate tunings and ukulele)
- Fret range (12–24)
- Accidental preference (sharps, flats, auto-detect by key)
- Left-handed mode (flips direction via `direction:rtl`)
- Sound on/off

**Learn tab settings** (PL object, auto-saved):
- Root, scale, labels, capo, timbre, window, overlay, hold, keep

**Game stats** (localStorage, persists across sessions):
- Accuracy per note (% correct out of N attempts)
- Streak, best streak, average response time

---

## Theming

**Light & dark modes** via CSS custom properties:
- `:root` sets dark defaults
- `@media (prefers-color-scheme: dark)` overrides on dark systems
- `[data-theme="light"]` / `[data-theme="dark"]` for explicit toggle

**Fretboard-specific:**
- `.fb .board`: wood gradient (maple wood in dark, light wood in light)
- `.fb .dot`: color-coded by state (root=orange, scale=teal, ghost=faint grey)
- `.fb .capolayer div.capoon::before`: metallic capo bar

---

## Keyboard & Mobile

**Keyboard shortcuts** (in Guessing Game):
- `1`–`=`: answer buttons (13 options for all 12 notes + space)
- `Space`: skip to next question

**Touch:** 
- Fretboard clicks work on mobile
- Drag-and-drop capo should support touch events (touchstart, touchmove, touchend)

**Responsive:**
- Fretboard uses relative grid sizing
- Controls stack on narrow screens
- Canvas wave display scales to container

---

## Known Limitations & Future Work

1. **Capo is not yet draggable.** Currently a dropdown selector; drag interaction is high-priority.
2. **Pentatonic boxes** assume standard tuning. Other tunings show notes but disable box numbers.
3. **Adapted VARIANTS** (200 autism, 600 Braille, etc.) are out of scope. Only `100` papers convert.
4. **No API integration yet.** The game grades locally; future: AI essay grading (on the essay exam papers).
5. **Responsive tuning selector.** On mobile, the tuning dropdown is hard to read.

---

## Development Notes

### File Structure
- **index.html:** Single-page application, ~100KB
  - Inline CSS (no external stylesheets)
  - Inline JavaScript (no build step)
  - Can be opened locally (double-click) or served over HTTP (strongly recommended for audio context & ES modules)

### Audio Context Management
- Created on first note play (not on page load, to respect autoplay policies)
- Suspended on mobile until user interaction
- Master bus + analyser graph allows real-time capture for overlay visualization

### Why a Single File?
- No build toolchain
- No external network calls (except GitHub)
- Works on any HTTP server, or served locally via `python -m http.server`
- Easy to version, fork, embed

---

## How to Run Locally

### Quick Start (No Installation)
```bash
# Navigate to the folder
cd "path/to/learning fretboard"

# Start a simple server (Python 3)
python -m http.server 8000

# Open in browser
# http://localhost:8000/index.html
```

### Why Not `file://`?
ES modules (used for audio) fail silently under `file://` protocol. Must use HTTP.

---

## Practice Path (Recommended Order)

1. **Learn tab:** Play with the capo. Drag it around. Watch the wave double when you go up an octave. Read the intro card.
2. **Game, Name the note:** Naturals only, one string (E), frets 0–5. Aim for 95% accuracy.
3. **Game, Find the note:** Same filter. Click to land on the right fret.
4. **Game, Find every octave:** Learn the pattern: +2 strings, +2 frets (except G→B: +3 frets).
5. **Pentatonics, box 1:** All 12 keys, one box at a time. Say the note name out loud as you play.
6. **Game, Name the note:** All strings, all naturals. Then unlock sharps/flats.
7. **Theory tab:** Reference as you practice. Intervals, modes, the neck's logic.

---

## Credits

Built as a learning tool for absolute-beginner guitarists. Audio synthesis via the Web Audio API. Music theory reference from Berklee and music pedagogy best practices.

---

## Future Ideas

- [ ] Draggable capo
- [ ] Touch support for drag capo
- [ ] Visualize chord voicings on the fretboard
- [ ] Scale mode explorer (play a mode, hear its color)
- [ ] Record a lick, play it back transposed to every key
- [ ] Ear training: match a played interval to its name
- [ ] MIDI keyboard input (route an external keyboard to the fretboard)
