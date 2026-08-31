# ⚽ Kadermanager

Die vereinsinterne Alternative zu SpielerPlus, je Mannschaft: Termine mit An-
und Abmeldung, Kader, Statistik, Umfragen und die Mannschaftskasse — alles an
einer Stelle und ohne fremden Anbieter.

**➡️ [Kadermanager öffnen](https://sc1911heiligenstadt.github.io/kadermanager/)**

## Seiten

| Seite | Wofür |
|---|---|
| [Kadermanager](https://sc1911heiligenstadt.github.io/kadermanager/) | Die App selbst — für Trainer, Spieler und Eltern der eigenen Mannschaft |
| [Registrieren](https://sc1911heiligenstadt.github.io/kadermanager/registrieren.html) | Zugang anfordern — für Spieler und Eltern ohne Vereinskonto |

## Was drin ist

| Reiter | Wofür |
|---|---|
| **Termine** | Training und Spiele mit An- und Abmeldung; wer nicht kann, meldet sich ab und sagt warum |
| **Kader** | Die Mannschaft mit ihren Rollen; unter **Rollen-Rechte** steht, wer was darf |
| **Statistik** | Wer war wie oft dabei |
| **Umfragen** | Kurze Abfragen an die Mannschaft |
| **Kasse** | Die Mannschaftskasse mit den **offenen Beträgen je Spieler** |
| **Einstellungen** | Mannschaft, Termine und Rollen pflegen |

Abwesenheiten laufen über **Urlaub/Krank** — einmal eingetragen, gilt der
Zeitraum für alle Termine darin.

## Zugang für Spieler und Eltern

Nicht jeder im Kader hat ein Vereinskonto. Über die Seite **Registrieren**
fordern Spieler und Eltern einen Zugang an, der nur für ihre Mannschaft gilt.

## Zugang

Die Anmeldung läuft über die [Tools-Übersicht](https://sc1911heiligenstadt.github.io/ToolsUebersicht/) — dort einmal anmelden, danach ist dieses Werkzeug offen.

Die Rechte gelten in drei Stufen: **Sehen** (Termine, Kader und Statistik der eigenen Mannschaft ansehen), **Bearbeiten** (zu- und absagen, an Umfragen teilnehmen, eigene Einträge pflegen) und **Administrieren** (Reiter *Einstellungen*: Termine und Kader anlegen, Umfragen starten, Mannschaftskasse führen). Wer welche Stufe hat, legt die Tools-Übersicht fest.

## Lokal starten

Über den Eintrag `kadermanager` in `E:\.claude\launch.json` — der Server läuft dann auf `http://localhost:8780/`.

## Technik

Vanilla JavaScript ohne Build-Schritt — die Dateien werden so ausgeliefert, wie sie im Repo liegen. Veröffentlicht über GitHub Pages. Die Daten liegen in der Vereins-Nextcloud; der Zugriff läuft ausschließlich über den Login-Worker der Tools-Übersicht, nie mit Zugangsdaten im Browser.

Das Konto-Foto aus der Tools-Übersicht erscheint auch hier im Kader.

---

Ein Werkzeug des 1. SC 1911 Heiligenstadt. Alle Werkzeuge auf einen Blick: [Tools-Übersicht](https://sc1911heiligenstadt.github.io/ToolsUebersicht/) · Erklärungen im [Toolbox Wiki](https://sc1911heiligenstadt.github.io/Vereinswiki/).
