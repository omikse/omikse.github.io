/* ============================================================
   firebase.js — dane projektu do gry w wielu graczy
   ------------------------------------------------------------
   Te wartosci sa jawne z zalozenia. Klucz `apiKey` nie jest
   haslem — identyfikuje projekt, a nie uprawnia do niczego.
   O to, kto co moze zapisac, dbaja reguly bazy (zakladka Rules
   w konsoli Firebase), a nie ukrywanie tego pliku.

   Baza stoi w europe-west1 (Belgia), bo stamtad jest najblizej
   do grajacych w Polsce. Logowanie jest anonimowe: gracz
   dostaje identyfikator bez zakladania konta, a konta starsze
   niz 30 dni sprzata sie same.

   Uklad danych w bazie:
     pokoje/<KOD>
       host       — uid zalozyciela
       utworzony  — znacznik czasu
       stan       — 'lobby' | 'gra' | 'koniec'
       wybor      — gatunek, kraj, lata (to samo co w menu)
       runda      — nr, trackId, startAt, podejscie
       gracze/<uid>  — imie, pkt, odp

   Reguly pozwalaja kazdemu zalogowanemu czytac pokoj i zapisywac
   wylacznie wlasny wpis w `gracze`; reszta pokoju nalezy do hosta.
   ============================================================ */
window.FIREBASE_CONFIG = {
  apiKey: "AIzaSyCswMoWOTTotCvPb75ykiEJZ6XEe_iVHOA",
  authDomain: "jaka-to-melodia-4e7c5.firebaseapp.com",
  databaseURL: "https://jaka-to-melodia-4e7c5-default-rtdb.europe-west1.firebasedatabase.app",
  projectId: "jaka-to-melodia-4e7c5",
  storageBucket: "jaka-to-melodia-4e7c5.firebasestorage.app",
  messagingSenderId: "886509798625",
  appId: "1:886509798625:web:7bdc85a257c0bec96ca3a0"
};
