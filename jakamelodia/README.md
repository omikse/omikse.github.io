# Jaka to melodia?

Gra w rozpoznawanie piosenek po krótkim urywku, ubrana w scenografię teleturnieju
z lat dziewięćdziesiątych. Nieoficjalny projekt fanowski.

Zasada jest prosta: leci jedna sekunda utworu. Nie wiesz — pasujesz albo strzelasz,
a urywek rośnie do 2, 4, 7, 11 i wreszcie 16 sekund. Sześć podejść na melodię.

**Tryby**

| tryb | na czym polega |
|---|---|
| Melodia dnia | jedna piosenka na dobę, ta sama dla wszystkich, z wynikiem do skopiowania |
| Gra bez końca | melodia za melodią, z licznikiem serii i rekordem |
| Runda na punkty | siedem utworów, 6 punktów za trafienie w pierwszym podejściu, 1 w szóstym |

Do wyboru pięć repertuarów: polskie przeboje, polski rock, lata 80. i 90.,
hity świata oraz muzyka filmowa i telewizyjna. Razem blisko dwieście melodii.

## Uruchomienie

Nie ma tu żadnego budowania — to zwykłe pliki. Trzeba je jednak podać przez HTTP,
bo z `file://` przeglądarka uzna stronę za obcą i zablokuje zapytania do API:

```bash
python -m http.server 8000
```

Potem `http://localhost:8000/jakamelodia/`.

## Skąd bierze się dźwięk

Z publicznego API sklepu Apple (iTunes Search API). Nie trzeba klucza ani konta,
a serwery Apple wysyłają nagłówki CORS, więc przeglądarka może sięgnąć po dane
bezpośrednio ze strony statycznej.

W `songs.js` leżą wyłącznie **trackId** — stałe identyfikatory utworów.
Adresy trzydziestosekundowych próbek (`previewUrl`) zmieniają się co jakiś czas,
więc nie ma sensu ich zapisywać; `itunes.js` zamienia identyfikatory na świeże
adresy przy starcie i chowa wynik w `localStorage` na tydzień.

Sama próbka nie jest u nas przechowywana ani przepisywana — leci prosto z serwerów Apple.

Urywki gramy przez Web Audio, a nie przez `<audio>`, z dwóch powodów:
`source.start(kiedy, 0, ile)` ucina dźwięk co do próbki, więc „jedna sekunda"
naprawdę trwa sekundę, a przy okazji dostajemy `AnalyserNode`, który napędza
korektor graficzny na scenie. Słupki chodzą od prawdziwego dźwięku, nie z animacji.

## Dźwięki studia

Czołówka, fanfara po trafieniu, klakson po pudle, werbel przed odsłonięciem
odpowiedzi i finał rundy są **składane z oscylatorów w locie** — blaszany zespół
z filtrem dolnoprzepustowym, talerz z szumu, bas pod spodem. W katalogu nie ma
ani jednego pliku dźwiękowego.

To są **własne motywy w konwencji teleturnieju**, a nie sygnał z programu.
Oryginalna czołówka jest cudzym nagraniem i nie może tu trafić — ani jako plik,
ani z cudzego serwera.

Złota nuta w prawym górnym rogu wycisza te dźwięki. Melodii do zgadywania
przełącznik nie dotyczy, bo bez nich nie ma gry.

## Własny repertuar

„Ułóż własny repertuar" na ekranie startowym przyjmuje wklejoną listę piosenek —
po jednej w wierszu, najlepiej `wykonawca - tytuł`. Każdy wiersz jest wyszukiwany
w katalogu Apple, a tytuł i wykonawca brane są z odpowiedzi API, nie z wpisanego
tekstu. Zniesie numerację listy, tabulatory z arkusza, cudzysłowy i brak ogonków.

Zapytania idą po jednym co 1,3 sekundy, bo API nie lubi natarczywych; przy
pięćdziesięciu tytułach to około minuty. Gotowy pakiet ląduje w `localStorage`
i dołącza do listy repertuarów.

### Dlaczego nie „zaloguj się przez Spotify"

Bo Spotify nie da nam dźwięku. Pole `preview_url` w ich API jest **oznaczone jako
wycofane**, bywa puste, a regulamin mówi wprost, że urywków nie wolno udostępniać
jako osobnej usługi. Pełne odtwarzanie idzie przez Web Playback SDK, który wymaga
konta Premium u każdego grającego.

Sensowny podział jest więc taki: **Spotify mówi, czego słuchasz, a gra i tak
odtwarza próbkę od Apple.** Logowanie przez Authorization Code z PKCE działa bez
serwera, więc da się to zrobić na GitHub Pages — ale wymaga zarejestrowania
własnej aplikacji w panelu Spotify i wpisania tu jej `client_id`. Do tego czasu
wklejanie listy robi dokładnie to samo, tylko ręcznie.

## Jak dopisać piosenkę

Wpis wygląda tak:

```js
{ id:1484081264, t:'Mniej niż zero', a:'Lady Pank' },
{ id:1375814284, t:'Gwiezdne wojny', a:'John Williams', alt:['Star Wars','Main Title'] },
```

* `t` — tytuł, który gracz widzi na podpowiedziach i wpisuje w odpowiedzi
* `a` — wykonawca
* `alt` — inne uznawane pisownie (przydatne przy muzyce filmowej, gdzie Apple
  trzyma utwór pod nazwą w rodzaju „Main Title", a gracz myśli „Gwiezdne wojny")

Porównywanie tytułów pomija wielkość liter, znaki interpunkcyjne i polskie ogonki,
więc „malgoska" zalicza się jako „Małgośka". Nie trzeba wypisywać takich wariantów.

**Identyfikator znajdziesz tak** — w konsoli przeglądarki:

```js
fetch('https://itunes.apple.com/search?term=lady+pank+mniej+niz+zero&entity=song&limit=5&country=PL')
  .then(r=>r.json())
  .then(j=>console.table(j.results.map(x=>({id:x.trackId, t:x.trackName, a:x.artistName, rok:(x.releaseDate||'').slice(0,4)}))));
```

Dwie pułapki, na które trzeba uważać przy wybieraniu:

1. **Wersje.** Wyszukiwarka chętnie podsuwa nagrania koncertowe, remiksy i nowe
   nagrania z gościnnym udziałem. Przy „Niech żyje bal" pierwszy wynik to
   przeróbka z 2024 roku, a nie oryginał z 1986. Patrz na rok wydania i omijaj
   tytuły z dopiskiem *Live*, *Remix* czy *feat.* Same *Remastered* są w porządku
   — to to samo nagranie.
2. **Refren zdradza tytuł.** Próbka Apple zwykle zaczyna się w połowie utworu,
   często dokładnie na refrenie, w którym wokalista śpiewa tytuł. Nic na to nie
   poradzimy — tak są przycięte.

Po dopisaniu warto sprawdzić, czy wszystko się rozwiązuje. W konsoli gry:

```js
ITunes.rozwiaz(PACKS.find(p=>p.id==='rock').songs).then(r=>console.log('martwe:', r.martwe));
```

Pusta lista znaczy, że komplet gra.

## Melodia dnia

Dzień liczony jest w UTC, więc wszyscy dostają tę samą piosenkę niezależnie od strefy.

Samo haszowanie daty potrafiło wrócić do tej samej piosenki po trzech dniach,
a innej nie pokazać ani razu. Dlatego cały pakiet jest tasowany raz na obieg
(tyle dni, ile melodii w pakiecie) — każda wypada dokładnie raz, zanim którakolwiek
się powtórzy, a następny obieg ma inną kolejność. Zmiana liczby utworów w pakiecie
przestawia harmonogram i to jest w porządku.

Do testów można podać datę ręcznie: `?date=2026-12-24`.

## Pliki

```
index.html   scena i cały wygląd
songs.js     katalog — same trackId, tytuły i wykonawcy
itunes.js    trackId -> adres próbki, z pamięcią podręczną
audio.js     Web Audio: odtwarzanie urywków, korektor, dźwięki studia
moje.js      budowanie własnego repertuaru z wklejonej listy
game.js      tryby, punktacja, losowanie melodii dnia, obsługa ekranów
```

## Prawa

Nazwa i formuła teleturnieju należą do ich właścicieli; to projekt fanowski,
niekomercyjny i niezwiązany z nadawcą. Urywki pochodzą z publicznego API Apple
i są odtwarzane z serwerów Apple.
