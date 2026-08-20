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
    version: "2.4",
    groups: [
      {
        title: "Am Handy",
        items: [
          "Bisher brach die Reiterleiste selbst um, die rechte Reiter-Gruppe darin aber nicht: Sie rutschte als ein Stück in die zweite Zeile und lief dort weiter über den rechten Rand hinaus. Jetzt bricht auch sie um, sobald sie zu breit wird. Zu sehen ist das nur, wenn genug Reiter nebeneinanderstehen — bis dahin sieht alles aus wie bisher."
        ]
      }
    ]
  },
  {
    version: "2.3",
    groups: [
      {
        title: "Mannschaften aus der Vereinsliste",
        items: [
          "Beim Anlegen einer Mannschaft schlägt das Namensfeld die echten Mannschaften des Vereins vor — die Liste, die in der Tools-Übersicht unter Einstellungen → Mannschaften gepflegt wird. Wählst du eine aus, heißt sie hier genauso wie überall sonst.",
          "Einen eigenen Namen tippen geht weiter.",
          "Bei einer Gruppe (Torwartgruppe, Athletikgruppe) werden bewusst keine Mannschaften vorgeschlagen — eine Gruppe ist ja mannschaftsübergreifend.",
          "Aufgelöste Mannschaften werden nicht vorgeschlagen.",
          "An bestehenden Mannschaften ändert sich nichts: Kader, Termine, Kasse und die Freigabelinks bleiben unangetastet."
        ]
      }
    ]
  },
  {
    version: "1.0",
    groups: [
      {
        title: "Termine und Zu- oder Absagen",
        items: [
          "Die vereinseigene Alternative zu SpielerPlus: mehrere Mannschaften mit je eigenem Kader und eigenen Terminen für Training, Spiel und Sonstiges. Wöchentlich wiederkehrende Termine lassen sich in einem Schritt anlegen.",
          "Zu jedem Termin sagen die Spieler zu, ab oder „unsicher“ — mit Bilanz auf einen Blick, wer kommt.",
          "Spieler mit eigenem Konto verknüpfen sich per „Das bin ich“ selbst mit ihrem Kaderplatz und melden sich danach selbst an und ab. Trainer und Betreuer tragen für alle übrigen ein.",
          "Zu jedem Termin gehören außerdem: Aufgaben zum Verteilen und Abhaken, Trainingsgruppen, ein Video-Link und eine einfache Fahrgemeinschaft mit Plätzen anbieten und suchen.",
          "Bei Spielen kommt ein Spielbericht dazu — Ergebnis, Torschützen und Freitext."
        ]
      },
      {
        title: "Gruppen über Mannschaftsgrenzen hinweg",
        items: [
          "Neben Mannschaften lassen sich Gruppen anlegen, etwa eine Torwart- oder Athletikgruppe. Sie haben dieselben Termine, Zu- und Absagen, Umfragen und Auswertungen wie eine Mannschaft — nur keine eigene Kasse.",
          "Ein Spieler kann gleichzeitig in seiner Mannschaft und in mehreren Gruppen stehen.",
          "Beim Anlegen in einer Gruppe lässt sich ein vorhandener Spieler übernehmen. Name und Kontoverknüpfung kommen mit, es bleibt dieselbe Person.",
          "Meldet sich jemand per QR-Code für eine zweite Mannschaft oder Gruppe an und hat schon ein Konto, wird das bestehende verknüpft statt ein zweites angelegt. Vorher wird angezeigt, um welches Konto es geht.",
          "Die Untergruppen innerhalb eines Termins heißen zur Unterscheidung „Trainingsgruppen“."
        ]
      },
      {
        title: "Aufstellung",
        items: [
          "Visuelles Spielfeld: Spieler per Ziehen auf Positionen, auf die Bank oder zu „nicht nominiert“.",
          "Die Spieler-Kacheln zeigen beim Überfahren Name, Position und Rückennummer.",
          "Ein Spieler kann ein Foto bekommen; es erscheint dann an Stelle der Nummer in der Kachel und in der Kaderliste.",
          "Wer in der Tools-Übersicht unter „Mein Konto“ ein eigenes Bild hinterlegt hat, wird hier automatisch damit angezeigt — verknüpft über sein Konto. Bei rund 200 Spielern muss so niemand mehr Bilder von Hand zusammentragen.",
          "Der Upload durch den Trainer bleibt: er ist der Weg für alle ohne eigenes Vereinskonto und wird nur überstimmt, sobald jemand selbst ein Bild hinterlegt. Ohne beides steht wie gehabt die Nummer oder der Anfangsbuchstabe da.",
          "Tauscht jemand sein Konto-Bild aus, ist das neue sofort zu sehen — es bleibt kein altes im Zwischenspeicher hängen."
        ]
      },
      {
        title: "Anwesenheit, Umfragen und Kasse",
        items: [
          "Abwesenheiten über einen Zeitraum — Urlaub oder krank — unabhängig von der Zu- oder Absage einzelner Termine, mit Hinweis im Termin.",
          "Anwesenheitsstatistik je Spieler über die vergangenen Termine, getrennt nach Trainings- und Spielquote.",
          "Umfragen im Team mit Einfach- oder Mehrfachauswahl, Ergebnisbalken und der Übersicht, wer noch nicht abgestimmt hat.",
          "Mannschaftskasse mit Strafenkatalog, Buchungen je Spieler nach Kategorie — Beitrag, Strafe, Sonstiges —, Kassenstand und offenen Beträgen.",
          "Eine Buchung wird storniert statt gelöscht: sie bleibt nachvollziehbar, zählt aber nicht mehr zum Kassenstand."
        ]
      },
      {
        title: "Spieler-Anmeldung per QR-Code",
        items: [
          "Ein Trainer öffnet im Kader-Reiter ein zeitlich begrenztes Anmeldefenster, standardmäßig 15 Minuten — zum Beispiel direkt im Training.",
          "Der dabei erzeugte QR-Code führt zu einer schlanken Anmeldeseite: Spieler ohne eigenes Konto wählen ihren Namen aus dem Kader, vergeben ein Passwort und sind sofort angemeldet.",
          "So muss der Trainer nicht jedes Konto einzeln anlegen."
        ]
      },
      {
        title: "Rollen und Rechte",
        items: [
          "Kaderspieler können mehrere Rollen tragen: Trainer, Co-Trainer, Torwart- und Athletiktrainer, Betreuer, Kassenwart, Nachwuchsleiter, Fördertrainer und weitere — jeweils mit eigenen Verwaltungsrechten je Bereich.",
          "Im Reiter „Einstellungen“ zeigt der Bereich „Rollen im Kader“ alle Kadermitglieder mit ihren Rollen auf einen Blick, mit Direktzugriff zum Bearbeiten.",
          "Die Referenztabelle „Rollen-Rechte“ zeigt, welchen Bereich jede Rolle verwalten darf. Sie ist für Administratoren pflegbar.",
          "Kadereinträge mit verknüpftem Konto zeigen zusätzlich Lizenz und betreute Mannschaften aus dem zentralen Trainerprofil — rein zur Information.",
          "Spieler ohne Bearbeiten-Recht speichern trotzdem ihre eigenen Einträge: Zu- und Absage, eigene Aufgaben, Fahrgemeinschaft, Urlaub und Krankheit. Übertragen wird dabei nur die eigene Änderung, nicht die komplette Mannschaftsdatei.",
          "In der Kasse sehen sie entsprechend nur ihre eigene offene Summe und ihre eigenen Buchungen, nicht den Kassenstand.",
          "Der Reiter „Info“ ist für alle sichtbar."
        ]
      },
      {
        title: "Bedienung am Handy",
        items: [
          "Die Ansicht ist für das Handy gebaut — Zu- und Absagen funktionieren dort genauso wie am Rechner.",
          "Eingabefelder sind mindestens 16 Pixel groß, damit der iPhone-Browser beim Antippen nicht ungefragt in die Seite hineinzoomt und verschoben stehen bleibt.",
          "Der Datei-Upload funktioniert auch auf älteren iPhones und iPads: die interne Datei-Kennung wird notfalls selbst im geforderten Format erzeugt. Zuvor schlug er dort mit „Ungültige Datei-Id“ fehl.",
          "Das Ziehen in der Aufstellung braucht eine Maus."
        ]
      },
      {
        title: "Daten & Speicherung",
        items: [
          "Gespeichert wird in der Vereins-Nextcloud über die zentrale Anmeldung der Tools-Übersicht — ein eigenes Passwort braucht es nicht.",
          "Ändern zwei Geräte gleichzeitig denselben Stand, erkennt die App das, lädt den fremden Stand nach und sagt Bescheid."
        ]
      }
    ]
  }
];
