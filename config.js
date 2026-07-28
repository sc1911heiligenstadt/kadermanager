const APP_VERSION = "1.0";

// Server-Cap fürs Datei-Gateway (muss zum admin-worker.js-Limit passen).
const MAX_FILE_BYTES = 10 * 1024 * 1024;

// Spielerfotos werden clientseitig auf diese längste Kante (px) verkleinert, bevor sie
// über das Datei-Gateway hochgeladen werden (siehe resizeImageFile in app.js) — sie
// sind nur kleine Avatare in 36px-Chips, keine Vollbilder.
const FOTO_MAX_DIMENSION = 240;

// Termin-Typen — Reihenfolge bestimmt die Auswahl-Reihenfolge im Formular.
const TERMIN_TYPEN = [
  { id: "training", label: "Training", icon: "🏃", farbe: "#1a56a0" },
  { id: "spiel", label: "Spiel", icon: "⚽", farbe: "#2d8c4e" },
  { id: "sonstiges", label: "Sonstiges", icon: "📅", farbe: "#6b7280" }
];

// Teilnahme-Status je Spieler/Termin. Reihenfolge = Reihenfolge der Zusage-Buttons.
// Fehlt ein Eintrag komplett, gilt der Spieler als "offen" (hat noch nicht reagiert).
const TEILNAHME_STATUS = [
  { id: "zu", label: "Zusage", kurz: "✓", farbe: "#2d8c4e" },
  { id: "unsicher", label: "Unsicher", kurz: "?", farbe: "#c9941f" },
  { id: "ab", label: "Absage", kurz: "✗", farbe: "#c0392b" }
];

// Startbestand des Strafenkatalogs für ein NEU angelegtes Team (keine Personendaten,
// nur Vorschlagswerte in Euro — jederzeit im Kasse-Tab änderbar).
const DEFAULT_STRAFEN = [
  { bezeichnung: "Zu spät zum Training", betrag: 2 },
  { bezeichnung: "Unentschuldigtes Fehlen", betrag: 5 },
  { bezeichnung: "Handy in der Kabine", betrag: 1 },
  { bezeichnung: "Gelb-Rote / Rote Karte (Unsportlichkeit)", betrag: 10 }
];

// Kader-Rollen (1:1 aus der SpielerPlus-Recherche übernommen). Ein Spieler kann
// mehrere Rollen gleichzeitig haben — die daraus resultierenden Rechte sind additiv
// (Vereinigung aller ROLLEN_RECHTE der eigenen Rollen), siehe hasRecht() in app.js.
const KADER_ROLLEN = [
  { id: "admin", label: "Admin" },
  { id: "trainer", label: "Trainer" },
  { id: "co-trainer", label: "Co-Trainer" },
  { id: "tw-trainer", label: "TW-Trainer" },
  { id: "at-trainer", label: "AT-Trainer" },
  { id: "foerdertrainer", label: "Fördertrainer" },
  { id: "nachwuchsleiter", label: "Nachwuchsleiter" },
  { id: "betreuer", label: "Betreuer" },
  { id: "kassenwart", label: "Kassenwart" },
  { id: "spieler", label: "Spieler" },
  { id: "inaktiv", label: "Inaktiv" }
];

// Verwalten-Bereiche, auf die eine Rolle Zugriff geben kann. Bewusst verdichtet ggü.
// SpielerPlus' 19 Einzel-Flags (siehe CLAUDE.md) — für einen Verein mit realistisch
// 2-5 Verantwortlichen reichen diese 10 Bereiche.
const RECHTE_BEREICHE = ["termine", "aufgaben", "aufstellungen", "gruppen", "spielberichte", "kader", "kasse", "urlaubkrank", "team"];

// Anzeige-Labels für die Rechte-Übersichtstabelle im Einstellungen-Tab. "team" deckt
// im Code sowohl Mannschafts-Verwaltung als auch Umfragen ab (siehe hasRecht-Aufrufe
// in app.js), daher der zusammengesetzte Label-Text.
const RECHTE_BEREICH_LABELS = {
  termine: "Termine",
  aufgaben: "Aufgaben",
  aufstellungen: "Aufstellungen",
  // "Trainingsgruppen", nicht "Gruppen": seit team.typ meint "Gruppe" im UI das
  // mannschaftsübergreifende Konstrukt (Torwartgruppe). Hier geht es um die
  // Kleingruppen INNERHALB eines Termins. Der interne Schlüssel bleibt `gruppen`.
  gruppen: "Trainingsgruppen",
  spielberichte: "Spielberichte",
  kader: "Kader (Spieler)",
  kasse: "Kasse",
  urlaubkrank: "Urlaub/Krank",
  team: "Mannschaften & Umfragen"
};

// Startwert der Rechte-Matrix für neue/leere Installationen — die für den laufenden
// Betrieb maßgebliche, admin-editierbare Kopie liegt in appData.meta.rollenRechte
// (siehe normalizeRollenRechte/rollenRechte/toggleRollenRecht in app.js).
const ROLLEN_RECHTE = {
  admin: RECHTE_BEREICHE.slice(),
  trainer: ["termine", "aufgaben", "aufstellungen", "gruppen", "spielberichte", "urlaubkrank"],
  "co-trainer": ["termine", "aufgaben", "aufstellungen", "gruppen", "spielberichte"],
  "tw-trainer": ["aufstellungen", "gruppen"],
  "at-trainer": ["aufgaben", "gruppen"],
  foerdertrainer: [],
  nachwuchsleiter: ["kader", "team"],
  betreuer: ["urlaubkrank"],
  kassenwart: ["kasse"],
  spieler: [],
  inaktiv: []
};

const APP_CHANGELOG = [
  {
    version: "1.2",
    groups: [
      {
        title: "Bedienung am Handy",
        items: [
          "Eingabefelder sind am Handy mindestens 16 Pixel groß. Dadurch zoomt der iPhone-Browser beim Antippen eines Feldes nicht mehr ungefragt in die Seite hinein und bleibt danach verschoben stehen."
        ]
      }
    ]
  },
  {
    version: "1.1",
    groups: [
      {
        title: "Datei-Upload auf älteren iPhones/iPads",
        items: [
          "Auf iOS-Geräten mit Safari älter als 15.4 schlug das Hochladen von Dateien fehl („Ungültige Datei-Id“), weil die intern vergebene Id dort nicht im vom Server verlangten Format erzeugt wurde. Die Id wird jetzt bei Bedarf selbst im richtigen Format erzeugt; auf neueren Geräten ändert sich nichts."
        ]
      }
    ]
  },
  {
    version: "1.0",
    groups: [
      {
        title: "Termine & Zu-/Absagen",
        items: [
          "Vereinsinterne Alternative zu SpielerPlus: mehrere Mannschaften mit je eigenem Kader und eigenen Terminen (Training, Spiel, Sonstiges); wöchentlich wiederkehrende Termine lassen sich in einem Schritt anlegen.",
          "Zu jedem Termin sagen die Spieler zu, ab oder „unsicher“ — mit Bilanz auf einen Blick, wer kommt.",
          "Spieler mit eigenem Tools-Konto verknüpfen sich per „Das bin ich“ selbst mit ihrem Kaderplatz und melden sich dann selbst an/ab; Trainer und Betreuer können für alle anderen eintragen.",
          "Je Termin zusätzlich: Aufgaben (an Spieler verteilen, abhaken), Gruppen (Trainings-Untergruppen), ein Video-Link und eine leichtgewichtige Fahrgemeinschaft (Plätze anbieten/suchen); bei Spielen ein Spielbericht mit Ergebnis, Torschützen und Freitext-Bericht."
        ]
      },
      {
        title: "Gruppen über Mannschaftsgrenzen hinweg",
        items: [
          "Neben Mannschaften lassen sich Gruppen anlegen (z. B. Torwartgruppe, Athletikgruppe): dieselben Termine, Zu-/Absagen, Umfragen und Auswertungen wie bei einer Mannschaft, nur ohne eigene Kasse.",
          "Ein Spieler kann gleichzeitig in seiner Mannschaft und in einer oder mehreren Gruppen stehen.",
          "Beim Anlegen eines Spielers in einer Gruppe lässt sich ein vorhandener Spieler aus einer Mannschaft übernehmen — Name und Kontoverknüpfung kommen mit, sodass es dieselbe Person bleibt.",
          "Meldet sich ein Spieler über den QR-Code für eine zweite Mannschaft oder Gruppe an und ist bereits angemeldet, wird sein bestehendes Konto verknüpft, statt ein zweites anzulegen. Vorher wird angezeigt, mit welchem Konto verknüpft wird.",
          "Die Untergruppen innerhalb eines Termins heißen zur Unterscheidung „Trainingsgruppen“."
        ]
      },
      {
        title: "Aufstellung",
        items: [
          "Visuelles Spielfeld: Spieler per Drag & Drop auf Positionen, Bank oder „Nicht nominiert“ ziehen.",
          "Spieler-Chips zeigen beim Überfahren mit der Maus Name, Position und Rückennummer; Spieler können optional ein Foto bekommen, das dann statt der Nummer im Chip und in der Kader-Liste erscheint."
        ]
      },
      {
        title: "Urlaub/Krank",
        items: [
          "Zeitraum-Abwesenheiten, unabhängig von der Zu-/Absage einzelner Termine, mit Hinweis-Badge im Termin."
        ]
      },
      {
        title: "Anwesenheit, Umfragen & Kasse",
        items: [
          "Anwesenheits-Statistik je Spieler über die vergangenen Termine (Trainings- und Spielquote getrennt).",
          "Umfragen im Team (Einfach- oder Mehrfachauswahl) mit Ergebnis-Balken und Übersicht, wer noch nicht abgestimmt hat.",
          "Mannschaftskasse mit Strafenkatalog, Buchungen je Spieler mit Kategorie (Beitrag/Strafe/Sonstiges) und Filter danach, Kassenstand und offenen Beträgen. Buchungen werden storniert statt gelöscht — Nachvollziehbarkeit bleibt erhalten, zählen aber nicht mehr zum Kassenstand."
        ]
      },
      {
        title: "Spieler-Registrierung per QR-Code",
        items: [
          "Ein Trainer mit Kader-Bearbeiten-Recht öffnet im Kader-Tab ein zeitlich begrenztes Anmelde-Fenster (Standard 15 Minuten) für die Mannschaft — z. B. direkt im Training.",
          "Der dabei erzeugte QR-Code bzw. Link führt zu einer eigenen, schlanken Anmeldeseite: Spieler ohne eigenes Tools-Konto wählen dort ihren Namen aus dem Kader, vergeben ein eigenes Passwort und sind danach sofort angemeldet — ohne dass der Trainer jedes Konto einzeln anlegen muss."
        ]
      },
      {
        title: "Rollen & Rechte",
        items: [
          "Kader-Spieler können mehrere Rollen bekommen (Trainer, Co-Trainer, Torwart-/Athletiktrainer, Betreuer, Kassenwart, Nachwuchsleiter, Fördertrainer u. a.) mit granularen Verwalten-Rechten je Bereich, statt nur Admin/Bearbeiter. Bearbeiten-Rechte auf Tool-Ebene werden über die Gruppenverwaltung der Tools-Übersicht vergeben.",
          "Einstellungen-Tab: Bereich „Rollen im Kader“ zeigt alle Kadermitglieder der Mannschaft mit ihren Rollen auf einen Blick (mit Direktzugriff zum Bearbeiten); Referenztabelle „Rollen-Rechte“ zeigt, welchen Bereich jede Rolle verwalten darf, und ist bearbeitbar für globale Tools-Admins sowie für Gruppen mit der Stufe „Administrieren“ beim Kadermanager (Sichtbarkeits-Panel der Tools-Übersicht).",
          "Kader-Einträge mit verknüpftem Tools-Konto zeigen zusätzlich Lizenz und betreute Mannschaft(en) aus dem zentralen Trainerprofil an (rein informativ).",
          "Spieler ohne Bearbeiten-Recht können weiterhin ihre eigenen Einträge speichern (Zu-/Absage, eigene Aufgaben, Fahrgemeinschaft, Urlaub/Krank) — über einen eingeschränkten Weg, der nur die eigene Änderung überträgt statt der kompletten Mannschaftsdatei. In der Mannschaftskasse sehen sie entsprechend nur ihre eigene offene Summe und ihre eigenen Buchungen statt des gesamten Kassenstands."
        ]
      },
      {
        title: "Speicherung",
        items: [
          "Automatische Nextcloud-Synchronisierung über die zentrale Anmeldung (Tools-Übersicht) — kein separates Passwort nötig; gleichzeitige Änderungen von zwei Geräten werden erkannt und gemeldet."
        ]
      }
    ]
  }
];
