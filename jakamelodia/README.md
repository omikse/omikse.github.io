# Jaka to melodia?

Gra w rozpoznawanie piosenek po krótkim urywku, ubrana w scenografię teleturnieju
z lat dziewięćdziesiątych. Nieoficjalny projekt fanowski.

Zasada jest prosta: leci jedna sekunda utworu. Nie wiesz — odsłaniasz dłuższy
fragment albo strzelasz, a urywek rośnie do 2, 4, 7, 11 i wreszcie 16 sekund.
Sześć podejść na melodię.

## Menu

Czyta się od lewej do prawej, czterema kolumnami:

1. **Gracze** — jeden gracz albo wspólny pokój
2. **Repertuar** — gatunek, Twoja playlista ze Spotify (pozycja „Moje") i przełącznik „tylko polskie"
3. **Lata** — suwak z zakresem, osobna kolumna, żeby nie tłoczyć się z resztą filtrów
4. **Tryb gry** — melodia dnia, gra bez końca albo runda na punkty

Repertuar nie jest gotową listą. Powstaje z filtrów nałożonych na płaski katalog
w `songs.js`, a licznik pod spodem pokazuje na bieżąco, ile melodii zostało.
Poniżej sześciu tytułów tryby się blokują — z tak wąskiej puli nie da się zrobić
sensownych podpowiedzi.

Gatunki nie są już ręcznie ułożone jedna po drugiej — poza Hitami i Filmowymi
(oryginalny polski wybór) każdy z nich pochodzi z rzeczywistej, popularnej
playlisty Spotify dla danego gatunku (Rock, Rap, Pop, Jazz, Elektronika, Indie,
Soul/R&B), przepuszczonej przez to samo dopasowanie do katalogu Apple, którego
używa „Moje". Zobacz sekcję **Skąd się wzięły gatunki** niżej.

| tryb | na czym polega |
|---|---|
| Melodia dnia | jedna piosenka na dobę, ta sama dla wszystkich z tym samym wyborem |
| Gra bez końca | melodia za melodią, z licznikiem serii i rekordem |
| Runda na punkty | siedem utworów, 6 punktów za trafienie w pierwszym podejściu, 1 w szóstym |

## Gra w wielu graczy

W duchu Gartic Phone: wszyscy słuchają tego samego urywka w tej samej chwili
i piszą równocześnie. Nikt nikogo nie blokuje — urywek rośnie sam, po zegarze,
a punktów jest tym więcej, im mniej zdążył odsłonić, zanim trafiłeś:
6 punktów przy jednej sekundzie, 1 przy szesnastu. Siedem rund, potem podium.

Zakładający dostaje pięcioznakowy kod i link do wysłania. Kod nie zawiera
liter I, O ani cyfr 0 i 1, żeby nie było pomyłek przy dyktowaniu przez telefon.

**Dźwięk nigdy nie idzie między graczami.** Każdy pobiera tę samą próbkę od Apple;
przez sieć leci wyłącznie stan pokoju. Zegary równane są przez
`.info/serverTimeOffset`, więc nie ma znaczenia, że komuś spieszy się zegarek.

Punkty liczy i zapisuje założyciel pokoju. Bez serwera nie da się tego zrobić
szczelnie — uparty gracz może skłamać, kiedy trafił. To gra dla znajomych,
nie turniej, i lepiej powiedzieć to wprost, niż udawać inaczej.

Konfiguracja Firebase i układ danych: patrz komentarz w `firebase.js`.
Reguły bazy dają pokój założycielowi, a każdemu innemu wyłącznie własny wpis.

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
adresy przy starcie i chowa wynik w `localStorage` na tydzień. Sama próbka nie
jest u nas przechowywana ani przepisywana — leci prosto z serwerów Apple.

Urywki gramy przez Web Audio, a nie przez `<audio>`, z dwóch powodów:
`source.start(kiedy, 0, ile)` ucina dźwięk co do próbki, więc „jedna sekunda"
naprawdę trwa sekundę, a przy okazji dostajemy `AnalyserNode`, który napędza
korektor graficzny na scenie. Słupki chodzą od prawdziwego dźwięku, nie z animacji.

## Dźwięki studia

Motyw menu, czołówka, fanfara po trafieniu, klakson po pudle, werbel przed
odsłonięciem odpowiedzi i finał rundy są **składane z oscylatorów w locie** —
blaszany zespół z filtrem dolnoprzepustowym, talerz z szumu, bas pod spodem.
W katalogu nie ma ani jednego pliku dźwiękowego.

To są **własne motywy w konwencji teleturnieju**, a nie sygnał z programu.
Oryginalna czołówka jest cudzym nagraniem i nie może tu trafić — ani jako plik,
ani odtwarzana z cudzego serwera.

Motyw menu rusza dopiero przy pierwszym kliknięciu, bo przeglądarki nie pozwalają
zagrać niczego przed gestem użytkownika. Złota nuta w prawym górnym rogu wycisza
wszystkie te dźwięki; melodii do zgadywania przełącznik nie dotyczy, bo bez nich
nie ma gry.

## Repertuar ze Spotify

W kolumnie „Repertuar", pod listą gatunków, stoi pozycja **Moje** — wygląda jak
reszta przycisków, ale jest rozwijaną listą (`<select>`). Niezalogowanym pokazuje
jedną opcję, która po kliknięciu od razu prowadzi do logowania Spotify; zalogowanym
listę własnych playlist. Wybranie playlisty po raz pierwszy buduje z niej repertuar,
każde następne wejście jest natychmiastowe, bo wynik leży w `localStorage`.
Link **Wyloguj ze Spotify** pod spodem kasuje te repertuary razem z tokenem.

Budowanie chwilę trwa: każdy tytuł trzeba odszukać w katalogu Apple, a zapytania
idą po jednym co 1,3–1,8 sekundy, bo API nie lubi natarczywych i potrafi na chwilę
zacząć odrzucać zapytania (HTTP 403), gdy się je zbytnio przyspieszy. Przy
pięćdziesięciu utworach budowanie to około minuty; widać pasek postępu i to,
czego akurat szuka.

**Spotify mówi tylko, czego słuchasz — dźwięk i tak przychodzi od Apple.** Ich pole
`preview_url` jest oznaczone jako wycofane i często puste, a regulamin zabrania
robić z tych urywków osobnej usługi; pełne odtwarzanie wymagałoby konta Premium
u każdego grającego. Dlatego zarówno tytuł, jak i **wykonawca** z playlisty muszą
się zgadzać z tym z katalogu Apple — samo dopasowanie tytułu nie wystarczy, bo pod
tym samym tytułem trafiają się covery i nagrania innych wykonawców (szczególnie
w rapie i hip‑hopie). Czego nie da się dopasować — albo bo tytuł nie pasuje, albo
bo w wynikach nie ma tej samej piosenki od tego samego wykonawcy — gra wypisuje
wprost, zamiast po cichu skracać listę albo podstawiać przypadkową piosenkę.

Suwak lat i przełącznik „tylko polskie" dotyczą katalogu, nie playlisty — przy
wybranej playliście przygasają, bo to Twoja lista, a nie wycinek katalogu.

### Tryb deweloperski — ważne

Nowa aplikacja w panelu Spotify startuje w **Development mode**. Znaczy to, że
zalogować się może właściciel aplikacji i **najwyżej 25 osób dopisanych ręcznie**
w zakładce *User Management* (imię i adres e-mail konta Spotify). Ktoś spoza tej
listy dostanie odmowę — gra pokazuje wtedy komunikat, a nie puste okno.

Żeby otworzyć to na wszystkich, trzeba wystąpić do Spotify o *extended quota mode*.
Dla gry dla znajomych 25 kont zwykle wystarcza.

### Adresy powrotu

W panelu Spotify muszą być wpisane co do znaku:

```
https://omikse.github.io/jakamelodia/
http://127.0.0.1:8000/jakamelodia/
```

Do pracy na własnym komputerze trzeba wchodzić przez **127.0.0.1**, a nie
`localhost` — Spotify nie przyjmuje `localhost` po http.

## Skąd się wzięły gatunki

Rock, Rap, Pop, Jazz, Elektronika, Indie i Soul/R&B nie są ułożone ręcznie —
każdy pochodzi z jednej realnej, popularnej publicznej playlisty Spotify dla tego
gatunku (np. „Jazz Top 100 — Most Popular on Spotify", „100 Greatest Indie Rock
of All Time"). Spis utworów z każdej z nich przeszedł przez to samo dopasowanie
tytuł+wykonawca do katalogu Apple, którego używa „Moje" — opisane wyżej wymaganie
zgodności wykonawcy dotyczy więc też tych gatunków. Hity i Filmowe zostały przy
oryginalnym, ręcznie ułożonym polskim wyborze.

Spotify od listopada 2024 blokuje aplikacjom w trybie Development odczyt cudzych
playlist przez swoje API (nawet zwykłe „Get Playlist Items" na oficjalnej
playliście Spotify kończy się błędem 403) — to ograniczenie obchodzi tylko
zatwierdzenie *Extended Quota Mode*. Listy utworów dla tych siedmiu playlist
zostały więc odczytane z ich publicznych stron na open.spotify.com (to, co widać
bez logowania), a nie przez API.

Nie każdy utwór z playlisty źródłowej znalazł się w katalogu — część nie ma
w Apple Music nagrania z poprawnie przypisanym wykonawcą i podglądem audio,
zwłaszcza wśród świeższych hitów rapu. Orientacyjna skuteczność dopasowania:
Rock ~94%, Indie ~66%, Jazz ~66%, Soul/R&B ~82%, Pop ~70%, Elektronika ~75%,
Rap ~54% (dużo remixów i "type beat" bez oficjalnego wydania).

## Jak dopisać piosenkę

Katalog to jedna płaska lista `window.KATALOG`. Wpis wygląda tak:

```js
{ id:1484081264, t:"Mniej niż zero", a:"Lady Pank", r:1983, k:"pl", g:"rock" },
{ id:1375814284, t:"Gwiezdne wojny", a:"John Williams", r:1977, k:"sw", g:"film",
  alt:["Star Wars","Main Title"] },
```

* `t` — tytuł, który gracz widzi i wpisuje w odpowiedzi
* `a` — wykonawca
* `r` — rok premiery **utworu**, nie data pliku w sklepie (patrz niżej)
* `k` — `pl` albo `sw` (świat)
* `g` — `hity`, `rock`, `rap`, `pop`, `jazz`, `elektro`, `indie`, `soul` albo `film`
* `alt` — inne uznawane pisownie; przydatne przy muzyce filmowej, gdzie Apple
  trzyma utwór jako „Main Title", a gracz myśli „Gwiezdne wojny"

Porównywanie tytułów pomija wielkość liter, znaki interpunkcyjne i polskie ogonki,
więc „malgoska" zalicza się jako „Małgośka". Takich wariantów nie trzeba wypisywać.

**Identyfikator znajdziesz tak** — w konsoli przeglądarki:

```js
fetch('https://itunes.apple.com/search?term=lady+pank+mniej+niz+zero&entity=song&limit=5&country=PL')
  .then(r=>r.json())
  .then(j=>console.table(j.results.map(x=>({id:x.trackId, t:x.trackName, a:x.artistName, rok:(x.releaseDate||'').slice(0,4)}))));
```

Trzy pułapki:

1. **Wersje.** Wyszukiwarka chętnie podsuwa nagrania koncertowe, remiksy i nowe
   nagrania z gościnnym udziałem. Przy „Niech żyje bal" pierwszy wynik to przeróbka
   z 2024 roku, a nie oryginał z 1986. Omijaj *Live*, *Remix* i *feat.*; samo
   *Remastered* jest w porządku, bo to to samo nagranie.
2. **Rocznik z API to data pliku, nie premiery.** Apple podaje przy klasykach datę
   wznowienia: „Biały krzyż" jako 2009, „Autobiografia" jako 2003. Dlatego pole `r`
   jest ustawiane ręcznie. Przy mniej znanych nagraniach może się mylić o rok — do
   suwaka dekad to wystarcza, ale nie jest to dane źródłowe.
3. **Refren zdradza tytuł.** Próbka Apple zwykle zaczyna się w połowie utworu,
   często na refrenie, w którym wokalista śpiewa tytuł. Tak są przycięte i nic na
   to nie poradzimy.

Po dopisaniu warto sprawdzić, czy wszystko się rozwiązuje. W konsoli gry:

```js
ITunes.rozwiaz(KATALOG.filter(s=>s.g==='rock')).then(r=>console.log('martwe:', r.martwe));
```

Pusta lista znaczy, że komplet gra.

## Melodia dnia

Dzień liczony jest w UTC, więc wszyscy dostają tę samą piosenkę niezależnie od strefy.

Samo haszowanie daty potrafiło wrócić do tej samej piosenki po trzech dniach,
a innej nie pokazać ani razu. Dlatego repertuar jest tasowany raz na obieg
(tyle dni, ile melodii) — każda wypada dokładnie raz, zanim którakolwiek się
powtórzy, a następny obieg ma inną kolejność.

W losowanie wchodzi też **podpis wyboru** (gatunek, „tylko polskie", lata). Dzięki temu
melodia dnia jest ta sama dla każdego, kto ustawił to samo, a wynik do skopiowania
nazywa ten wybór — żeby było wiadomo, o którą stawkę chodzi. Zmiana liczby utworów
w katalogu przestawia harmonogram i to jest w porządku.

Do testów można podać datę ręcznie: `?date=2026-12-24`.

## Pliki

```
index.html   scena i cały wygląd
songs.js     katalog — trackId, tytuł, wykonawca, rok, kraj, gatunek
itunes.js    trackId -> adres próbki, z pamięcią podręczną
audio.js     Web Audio: odtwarzanie urywków, korektor, dźwięki studia
firebase.js  jawna konfiguracja projektu + opis układu danych
pokoj.js     gra w wielu graczy: pokoje, synchronizacja rund, punkty
spotify.js   logowanie PKCE, spis playlist i budowanie z nich repertuaru
game.js      menu, filtry, tryby, punktacja, losowanie melodii dnia
```

## Prawa

Nazwa i formuła teleturnieju należą do ich właścicieli; to projekt fanowski,
niekomercyjny i niezwiązany z nadawcą. Urywki pochodzą z publicznego API Apple
i są odtwarzane z serwerów Apple.
