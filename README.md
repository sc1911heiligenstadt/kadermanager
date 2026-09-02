# ⚽ Kadermanager

Die vereinsinterne Alternative zu SpielerPlus, je Mannschaft: Termine mit An-
und Abmeldung, Kader, Statistik, Umfragen und die Mannschaftskasse — alles an
einer Stelle und ohne fremden Anbieter.

**➡️ [Kadermanager öffnen](https://sc1911heiligenstadt.github.io/kadermanager/)**

## Seiten

| Seite | Wofür |
|---|---|
| [Kadermanager](https://sc1911heiligenstadt.github.io/kadermanager/) (`index.html`) | Die App selbst — für Trainer, Spieler und Eltern der eigenen Mannschaft |
| [Registrieren](https://sc1911heiligenstadt.github.io/kadermanager/registrieren.html) (`registrieren.html`) | Zugang anfordern — für Spieler und Eltern ohne Vereinskonto. Öffentlich erreichbar, aber nur mit dem kurzlebigen Token aus QR-Code oder Link brauchbar |

## Was drin ist

| Reiter | Wofür |
|---|---|
| **Termine** | Training, Spiele und Sonstiges mit An- und Abmeldung — dazu Aufgaben, Trainingsgruppen, Video-Link, Fahrgemeinschaft und bei Spielen der Spielbericht |
| **Kader** | Die Mannschaft mit ihren Rollen, Fotos und der Aufstellung auf dem Spielfeld. Von hier öffnet der Trainer auch das Anmeldefenster mit QR-Code |
| **Statistik** | Wer war wie oft dabei — Trainings- und Spielquote, wahlweise auf einen Zeitraum eingegrenzt |
| **Umfragen** | Kurze Abfragen an die Mannschaft, mit Ergebnisbalken und der Liste derer, die noch fehlen |
| **Kasse** | Die Mannschaftskasse mit Strafenkatalog, Buchungen und den **offenen Beträgen je Spieler**. Gruppen führen keine Kasse — dort fehlt der Reiter |
| **Einstellungen** | Mannschaften und Gruppen anlegen, **Rollen im Kader** einsehen und die Tabelle **Rollen-Rechte** pflegen |
| **Info** | Was das Werkzeug tut, die Änderungsliste und der Datenschutz-Hinweis |

Abwesenheiten laufen über **Urlaub/Krank** — einmal eingetragen, gilt der
Zeitraum für alle Termine darin.

## Mannschaften und Gruppen

Neben Mannschaften gibt es **Gruppen** (Torwart-, Athletikgruppe) über
Mannschaftsgrenzen hinweg: dieselben Termine, Rückmeldungen, Umfragen und
Auswertungen, nur keine Kasse. Ein Spieler kann in seiner Mannschaft und in
mehreren Gruppen zugleich stehen; beim Anlegen in einer Gruppe wird ein
vorhandener Spieler übernommen, statt eine zweite Person zu erzeugen.

Beim Anlegen schlägt das Namensfeld die echten Mannschaften des Vereins vor —
dieselbe Liste, die in der Tools-Übersicht gepflegt wird.

## Zugang für Spieler und Eltern

Nicht jeder im Kader hat ein Vereinskonto. Der Trainer öffnet im Reiter *Kader*
ein Anmeldefenster (standardmäßig 15 Minuten) und zeigt den **QR-Code** im
Training oder schickt den Link in die Mannschaftsgruppe. Auf der Seite
*Registrieren* tippt der Spieler seinen Namen aus dem Kader an und vergibt ein
Passwort; wer schon ein Konto hat, verknüpft es mit einem Klick. Der Zugang gilt
nur für diese Mannschaft, und der Trainer sieht die Neuzugänge live mitlaufen.

## Rechte

Die Anmeldung läuft über die [Tools-Übersicht](https://sc1911heiligenstadt.github.io/ToolsUebersicht/) — dort einmal anmelden, danach ist dieses Werkzeug offen.

Es greifen **zwei** Ebenen ineinander:

**1. Die drei Stufen der Tools-Übersicht**

- **Sehen** — alles ansehen, was zur eigenen Mannschaft gehört. Die *eigenen*
  Einträge werden trotzdem gespeichert: Zu- und Absage für kommende Termine,
  eigene Aufgaben, Fahrgemeinschaft, Urlaub und Krankheit. Übertragen wird dabei
  nur die eigene Änderung, nicht die ganze Mannschaftsdatei — das ist auf dem
  Server auch so gesperrt. In der Kasse sieht diese Stufe nur die eigene offene
  Summe und die eigenen Buchungen, nicht den Kassenstand.
- **Bearbeiten** — verwalten: Termine, Kader, Aufstellung, Umfragen, Kasse.
  Wie weit das reicht, entscheidet die Rolle im Kader (siehe unten).
- **Administrieren** — zusätzlich der Reiter *Einstellungen*: Mannschaften und
  Gruppen, die Rollenübersicht und die Rechte-Tabelle.

**2. Die Rollen im Kader**

Ein Kadermitglied kann mehrere Rollen tragen — Admin, Trainer, Co-Trainer,
TW-Trainer, AT-Trainer, Fördertrainer, Nachwuchsleiter, Betreuer, Kassenwart,
Spieler, Inaktiv; die Rechte mehrerer Rollen addieren sich. Verwaltet wird nach
Bereichen: Termine, Aufgaben, Aufstellungen, Trainingsgruppen, Spielberichte,
Kader, Kasse, Urlaub/Krank sowie Mannschaften & Umfragen. Welche Rolle welchen
Bereich verwalten darf, steht in der Tabelle **Rollen-Rechte** und ist für
Administratoren per Häkchen änderbar — sofort und mannschaftsübergreifend.

> Wer noch **gar keine** Rolle zugewiesen bekommen hat, darf vorübergehend
> überall mitverwalten. Erst eine zugewiesene Rolle schränkt gezielt ein.

## Lokal starten

Über den Eintrag `kadermanager` in `E:\.claude\launch.json` — der Server läuft dann auf `http://localhost:8780/`.

## Technik

Vanilla JavaScript ohne Build-Schritt — die Dateien werden so ausgeliefert, wie sie im Repo liegen. Veröffentlicht über GitHub Pages. Die Daten liegen in der Vereins-Nextcloud; der Zugriff läuft ausschließlich über den Login-Worker der Tools-Übersicht, nie mit Zugangsdaten im Browser.

| Datei | Inhalt |
|---|---|
| `index.html` | die App mit allen Reitern |
| `app.js` | Termine, Kader, Aufstellung, Statistik, Umfragen, Kasse, Rechte |
| `config.js` | Termin-Typen, Rollen, Rechte-Matrix, Strafenkatalog-Vorschlag, Änderungsliste |
| `db.js` | Anbindung an den Gateway-Worker |
| `qrcode.js` | erzeugt den QR-Code für das Anmeldefenster |
| `registrieren.html` | eigenständige Anmeldeseite, bewusst ohne `app.js`/`db.js` |
| `style.css` | Gestaltung |

Das Konto-Foto aus der Tools-Übersicht erscheint auch hier im Kader.

---

Ein Werkzeug des 1. SC 1911 Heiligenstadt. Alle Werkzeuge auf einen Blick: [Tools-Übersicht](https://sc1911heiligenstadt.github.io/ToolsUebersicht/) · Erklärungen im [Toolbox Wiki](https://sc1911heiligenstadt.github.io/Vereinswiki/).
