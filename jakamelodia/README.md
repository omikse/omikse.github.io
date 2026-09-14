# Jaka to melodia?

Gra w rozpoznawanie piosenek po krótkim urywku, ubrana w scenografię teleturnieju
z lat dziewięćdziesiątych. Nieoficjalny projekt fanowski.

Zasada jest prosta: leci jedna sekunda utworu. Nie wiesz — odsłaniasz dłuższy
fragment albo strzelasz, a urywek rośnie do 2, 4, 7, 11 i wreszcie 16 sekund.
Sześć podejść na melodię.

## Menu

Czyta się od lewej do prawej, trzema kolumnami:

1. **Gracze** — jeden gracz albo wspólny pokój
2. **Repertuar** — gatunek albo Twoja playlista ze Spotify, skąd (Polska / świat) i lata
3. **Tryb gry** — melodia dnia, gra bez końca albo runda na punkty

Repertuar nie jest gotową listą. Powstaje z filtrów nałożonych na płaski katalog
w `songs.js`, a licznik pod spodem pokazuje na bieżąco, ile melodii zostało.
Poniżej sześciu tytułów tryby się blokują — z tak wąskiej puli nie da się zrobić
sensownych podpowiedzi.

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

Kolumna „Repertuar" ma na dole przycisk **Zaloguj przez Spotify**. Po zalogowaniu
Twoje playlisty stają tam obok gatunków z katalogu — bez żadnych okien i bez
osobnego kroku „wczytaj". Wybranie playlisty po raz pierwszy buduje z niej
repertuar, każde następne wejście jest natychmiastowe, bo wynik leży
w `localStorage`. Wylogowanie kasuje te repertuary razem z tokenem.

Budowanie chwilę trwa: każdy tytuł trzeba odszukać w katalogu Apple, a zapytania
idą po jednym co 1,3 sekundy, bo API nie lubi natarczywych. Przy pięćdziesięciu
utworach to około minuty; widać pasek postępu i to, czego akurat szuka.

**Spotify mówi tylko, czego słuchasz — dźwięk i tak przychodzi od Apple.** Ich pole
`preview_url` jest oznaczone jako wycofane i często puste, a regulamin zabrania
robić z tych urywków osobnej usługi; pełne odtwarzanie wymagałoby konta Premium
u każdego grającego. Dlatego tytuł z playlisty musi się zgadzać z tym z katalogu
Apple — inaczej do repertuaru trafiałaby przypadkowa piosenka tego wykonawcy.
Czego nie da się dopasować, gra wypisuje wprost, zamiast po cichu skracać listę.

Filtry kraju i lat dotyczą katalogu, nie playlisty — przy wybranej playliście
przygasają, bo to Twoja lista, a nie wycinek katalogu.

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
* `g` — `hity`, `rock`, `rap` albo `film`
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

W losowanie wchodzi też **podpis wyboru** (gatunek, kraj, lata). Dzięki temu
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
