# Kadermanager (v1.0)

Vereinsinterne Alternative zu SpielerPlus (Teamorganisation, An-/Abmeldungen zu Terminen, Anwesenheit, Umfragen, Mannschaftskasse) — Teil der [Tools-Übersicht](https://sc1911heiligenstadt.github.io/ToolsUebersicht/) des 1. SC 1911 Heiligenstadt.

## Funktionen

- **Mehrere Mannschaften** mit je eigenem Kader, Terminen, Umfragen und Kasse (Auswahl oben im Kopf).
- **Termine** (Training, Spiel, Sonstiges) mit individueller **Zu-/Absage** je Spieler und Teilnahme-Bilanz auf einen Blick. Neue Termine können wöchentlich wiederholt angelegt werden. Je Termin außerdem: **Aufgaben** (an Spieler verteilen und abhaken), **Gruppen** (Trainings-Untergruppen), ein **Video-Link**, eine leichtgewichtige **Fahrgemeinschaft** (Plätze anbieten/suchen) und bei Spielen ein **Spielbericht** (Ergebnis, Torschützen, Bericht).
- **Aufstellung**: visuelles Spielfeld mit frei per Drag & Drop platzierbaren Spielern, Bank und "Nicht nominiert". Chips zeigen beim Überfahren mit der Maus Name, Position und Nummer; Spieler können optional ein Foto bekommen, das dann statt der Nummer im Chip und in der Kader-Liste erscheint.
- **Mischform der Rückmeldung:** Spieler mit eigenem Tools-Konto verknüpfen sich per „Das bin ich“ selbst mit ihrem Kaderplatz und melden sich dann selbst an/ab; Trainer und Betreuer können für alle anderen eintragen.
- **Urlaub/Krank**: Zeitraum-Abwesenheiten getrennt von der Termin-Einzel-RSVP, mit Hinweis-Badge im Termin.
- **Anwesenheits-Statistik** je Spieler über vergangene Termine (Trainings- und Spielquote getrennt).
- **Umfragen** mit Einfach- oder Mehrfachauswahl, Ergebnis-Balken und Abstimm-Übersicht.
- **Mannschaftskasse** mit Strafenkatalog, Beiträgen, manuellen Buchungen (je Kategorie filterbar), Stornos (Audit-Spur statt Löschen), Kassenstand und offenen Beträgen.
- **Rollen je Spieler** (Trainer, Co-Trainer, Torwart-/Athletiktrainer, Betreuer, Kassenwart, Nachwuchsleiter, Fördertrainer u. a.) mit granularen Verwalten-Rechten je Bereich statt nur "Admin/Bearbeiter". Echte Tools-Admins können die Rechte-Matrix je Rolle im Einstellungen-Tab direkt bearbeiten.
- **Zentrales Trainerprofil**: Kader-Einträge mit verknüpftem Tools-Konto zeigen automatisch Lizenz und betreute Mannschaft(en) aus dem zentralen Trainerprofil an (rein informativ).

## Rechte

Zwei Ebenen: Wer in der Tools-Übersicht für dieses Tool als „Bearbeiten“ freigeschaltet ist (Admins immer), darf grundsätzlich verwalten. Darüber hinaus können Kader-Spielern Rollen zugewiesen werden, die den Zugriff auf einzelne Bereiche (Termine, Aufgaben, Aufstellung, Gruppen, Spielberichte, Kader, Kasse, Urlaub/Krank, Team/Umfragen) granular einschränken — ohne zugewiesene Rolle bleibt es wie bisher bei vollem Zugriff. Alle übrigen eingeloggten Nutzer sehen die Mannschaften und melden sich für ihren eigenen, selbst verknüpften Kaderplatz an/ab.

Im Einstellungen-Tab zeigt „Rollen im Kader“ alle Kadermitglieder der Mannschaft mit ihren Rollen auf einen Blick (mit Direktzugriff zum Bearbeiten), die Referenztabelle „Rollen-Rechte“ zeigt, welchen Bereich jede Rolle verwalten darf.

## Technik

Vanilla JS (kein Build-Step). Anmeldung und Speicherung laufen über das zentrale
Login-Gateway der Tools-Übersicht (Cloudflare Worker → Nextcloud/WebDAV) — kein
separates Passwort. Gleichzeitige Änderungen von zwei Geräten werden erkannt und
gemeldet.

Hieß in einer früheren Entwicklungsphase „Spielerplus-Klon“.
