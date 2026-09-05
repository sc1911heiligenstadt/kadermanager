// ---------- Helpers ----------
// Ids fuer Datensaetze UND fuer hochgeladene Dateien (db.js: gatewayUploadFile
// schickt sie als "id" an dav-file-put). Der Worker prueft diese Id in
// prepareFileAction() gegen FILE_ID_RE und akzeptiert AUSSCHLIESSLICH das
// UUID-Format. Der Guard auf crypto.randomUUID war da, der Fallback lieferte
// aber "s" + 8 Hex-Zeichen: auf iOS mit Safari < 15.4 (kein randomUUID) schlug
// deshalb nicht der Aufruf fehl, sondern der Upload -- mit HTTP 400
// "Ungueltige Datei-Id". crypto.getRandomValues gibt es dort seit jeher,
// daraus bauen wir das Format selbst: 16 Zufallsbytes, Version 4 und Variante
// gesetzt.
function uuid() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  const b = new Uint8Array(16);
  crypto.getRandomValues(b);
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const hex = Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
  return hex.slice(0, 8) + "-" + hex.slice(8, 12) + "-" + hex.slice(12, 16) +
         "-" + hex.slice(16, 20) + "-" + hex.slice(20);
}
function escapeHtml(str) {
  if (str == null) return "";
  return String(str)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}
function clone(o) { return JSON.parse(JSON.stringify(o)); }
function val(id) { const el = document.getElementById(id); return el ? el.value : ""; }
function checked(id) { const el = document.getElementById(id); return !!(el && el.checked); }

const WOCHENTAGE_KURZ = ["So", "Mo", "Di", "Mi", "Do", "Fr", "Sa"];
function fmtDatum(iso) {
  if (!iso) return "—";
  const d = new Date(iso + "T00:00:00");
  if (isNaN(d.getTime())) return iso;
  return `${WOCHENTAGE_KURZ[d.getDay()]}, ${String(d.getDate()).padStart(2, "0")}.${String(d.getMonth() + 1).padStart(2, "0")}.${d.getFullYear()}`;
}
function todayISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function addDaysISO(iso, days) {
  const d = new Date(iso + "T00:00:00");
  d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function zeitText(t) {
  if (!t.startZeit) return "";
  return t.endZeit ? `${t.startZeit}–${t.endZeit} Uhr` : `${t.startZeit} Uhr`;
}
function fmtEuro(n) {
  const num = Number(n) || 0;
  return num.toLocaleString("de-DE", { style: "currency", currency: "EUR" });
}
function parseBetrag(s) {
  const n = parseFloat(String(s).replace(",", "."));
  return isNaN(n) ? NaN : n;
}
function terminTyp(id) { return TERMIN_TYPEN.find((t) => t.id === id) || TERMIN_TYPEN[0]; }

// ---------- State ----------
let appData = { meta: {}, teams: [] };
let currentUser = null;
let trainerProfiles = []; // zentrale Lizenz/Mannschaft-Profile aller Nutzer (read-only, Join über linkedUsername)
// Die Mannschaften des Vereins aus der zentralen Liste (seit 2026-08-12).
//
// Der Kadermanager führt seine Teams weiterhin selbst — an ihrer `id` hängen
// Kader, Termine, Kasse und die Freigabelinks. Die Vereinsliste ist deshalb ein
// VORSCHLAG fürs Namensfeld, keine Schranke: sie fasst nichts Bestehendes an,
// und ein eigener Name bleibt möglich.
//
// ⚠️ Bewusst NUR die Auswahlliste, KEIN Knopf zum Sammel-Übernehmen. Im Busplan
// gab es einen, und Michel hat ihn am 2026-08-12 wieder streichen lassen.
// Nicht ungefragt neu bauen.
let vereinsMannschaften = [];

function renderVereinsListe() {
  const dl = document.getElementById("vereins-mannschaften");
  if (!dl) return;
  dl.innerHTML = vereinsMannschaften
    .map((m) => `<option value="${escapeHtml(m.kurz)}">${escapeHtml(m.lang)}${m.liga ? " · " + escapeHtml(m.liga) : ""}</option>`)
    .join("");
}
let currentTab = "termine";
let currentTeamId = null;
let termineFilter = "kommend";
let statistikJahr = "alle";
let kasseKategorieFilter = "alle";
let kasseZeigeStornos = false;
let editingTeamId = null;
let editingSpielerId = null;
let editingFotoId = "";
let fotoUploadBusy = false;
let editingTerminId = null;
let detailTerminId = null;
let editingUmfrageId = null;
let editingBuchungId = null;
let persistTimer = null;

// ---------- Normalisierung ----------
function normalizeSpieler(s) {
  const d = s && typeof s === "object" ? s : {};
  return {
    id: d.id || uuid(),
    name: typeof d.name === "string" ? d.name : "",
    position: typeof d.position === "string" ? d.position : "",
    nummer: d.nummer == null ? "" : String(d.nummer),
    linkedUsername: typeof d.linkedUsername === "string" ? d.linkedUsername : "",
    rollen: Array.isArray(d.rollen) ? d.rollen.filter((r) => KADER_ROLLEN.some((k) => k.id === r)) : [],
    fotoId: typeof d.fotoId === "string" ? d.fotoId : ""
  };
}
function normalizeTeilnahme(obj, kaderIds) {
  const out = {};
  if (obj && typeof obj === "object") {
    Object.keys(obj).forEach((sid) => {
      if (!kaderIds.includes(sid)) return;
      const e = obj[sid] || {};
      const status = TEILNAHME_STATUS.some((s) => s.id === e.status) ? e.status : null;
      if (!status) return;
      out[sid] = { status, grund: typeof e.grund === "string" ? e.grund : "", am: typeof e.am === "string" ? e.am : "" };
    });
  }
  return out;
}
function normalizeAufgabe(a, kaderIds) {
  const d = a && typeof a === "object" ? a : {};
  const spielerIds = Array.isArray(d.spielerIds) ? d.spielerIds.filter((id) => kaderIds.includes(id)) : [];
  const erledigt = {};
  if (d.erledigt && typeof d.erledigt === "object") {
    Object.keys(d.erledigt).forEach((sid) => { if (spielerIds.includes(sid) && d.erledigt[sid]) erledigt[sid] = true; });
  }
  return { id: d.id || uuid(), text: typeof d.text === "string" ? d.text : "", spielerIds, erledigt };
}
function normalizeGruppe(g, kaderIds) {
  const d = g && typeof g === "object" ? g : {};
  return {
    id: d.id || uuid(),
    name: typeof d.name === "string" ? d.name : "",
    spielerIds: Array.isArray(d.spielerIds) ? d.spielerIds.filter((id) => kaderIds.includes(id)) : []
  };
}
function normalizeSpielbericht(sb, kaderIds) {
  const d = sb && typeof sb === "object" ? sb : {};
  const torschuetzen = Array.isArray(d.torschuetzen)
    ? d.torschuetzen.filter((t) => t && kaderIds.includes(t.spielerId)).map((t) => ({ spielerId: t.spielerId, anzahl: Math.max(1, Number(t.anzahl) || 1) }))
    : [];
  return {
    ergebnisEigenes: d.ergebnisEigenes == null ? "" : String(d.ergebnisEigenes),
    ergebnisGegner: d.ergebnisGegner == null ? "" : String(d.ergebnisGegner),
    torschuetzen,
    bericht: typeof d.bericht === "string" ? d.bericht : ""
  };
}
function normalizeFahrgemeinschaft(f, kaderIds) {
  const d = f && typeof f === "object" ? f : {};
  const angebote = Array.isArray(d.angebote)
    ? d.angebote.filter((a) => a && kaderIds.includes(a.spielerId)).map((a) => ({ spielerId: a.spielerId, plaetze: Math.max(1, Number(a.plaetze) || 1) }))
    : [];
  const gesuche = Array.isArray(d.gesuche) ? d.gesuche.filter((id) => kaderIds.includes(id)) : [];
  return { angebote, gesuche };
}
function normalizeAufstellung(a, kaderIds) {
  const d = a && typeof a === "object" ? a : {};
  const feld = Array.isArray(d.feld)
    ? d.feld.filter((p) => p && kaderIds.includes(p.spielerId)).map((p) => ({
        spielerId: p.spielerId,
        x: Math.max(0, Math.min(100, Number(p.x) || 0)),
        y: Math.max(0, Math.min(100, Number(p.y) || 0))
      }))
    : [];
  const feldIds = feld.map((p) => p.spielerId);
  const bank = Array.isArray(d.bank) ? d.bank.filter((id) => kaderIds.includes(id) && !feldIds.includes(id)) : [];
  return { feld, bank };
}
// Default-Werte für die Termin-Erweiterungen, die ein neu angelegter/zyklisch
// kopierter Termin sofort braucht (sonst würden Render-Funktionen auf fehlenden
// Feldern scheitern, weil normalizeTermin erst beim nächsten Laden vom Server läuft).
function emptyTerminExtras() {
  return {
    videoUrl: "",
    aufgaben: [],
    gruppen: [],
    spielbericht: { ergebnisEigenes: "", ergebnisGegner: "", torschuetzen: [], bericht: "" },
    fahrgemeinschaft: { angebote: [], gesuche: [] },
    aufstellung: { feld: [], bank: [] }
  };
}
function normalizeTermin(t, kaderIds) {
  const d = t && typeof t === "object" ? t : {};
  return {
    id: d.id || uuid(),
    typ: TERMIN_TYPEN.some((x) => x.id === d.typ) ? d.typ : "training",
    titel: typeof d.titel === "string" ? d.titel : "",
    datum: typeof d.datum === "string" ? d.datum : "",
    startZeit: typeof d.startZeit === "string" ? d.startZeit : "",
    endZeit: typeof d.endZeit === "string" ? d.endZeit : "",
    ort: typeof d.ort === "string" ? d.ort : "",
    gegner: typeof d.gegner === "string" ? d.gegner : "",
    treffpunkt: typeof d.treffpunkt === "string" ? d.treffpunkt : "",
    notiz: typeof d.notiz === "string" ? d.notiz : "",
    videoUrl: typeof d.videoUrl === "string" ? d.videoUrl : "",
    teilnahme: normalizeTeilnahme(d.teilnahme, kaderIds),
    aufgaben: Array.isArray(d.aufgaben) ? d.aufgaben.map((a) => normalizeAufgabe(a, kaderIds)) : [],
    gruppen: Array.isArray(d.gruppen) ? d.gruppen.map((g) => normalizeGruppe(g, kaderIds)) : [],
    spielbericht: normalizeSpielbericht(d.spielbericht, kaderIds),
    fahrgemeinschaft: normalizeFahrgemeinschaft(d.fahrgemeinschaft, kaderIds),
    aufstellung: normalizeAufstellung(d.aufstellung, kaderIds)
  };
}
function normalizeUmfrage(u, kaderIds) {
  const d = u && typeof u === "object" ? u : {};
  const optionen = Array.isArray(d.optionen)
    ? d.optionen.filter((o) => o && o.id && typeof o.text === "string").map((o) => ({ id: String(o.id), text: o.text }))
    : [];
  const optionIds = optionen.map((o) => o.id);
  const stimmen = {};
  if (d.stimmen && typeof d.stimmen === "object") {
    Object.keys(d.stimmen).forEach((sid) => {
      if (!kaderIds.includes(sid)) return;
      const arr = Array.isArray(d.stimmen[sid]) ? d.stimmen[sid].filter((oid) => optionIds.includes(oid)) : [];
      if (arr.length) stimmen[sid] = arr;
    });
  }
  return {
    id: d.id || uuid(),
    frage: typeof d.frage === "string" ? d.frage : "",
    mehrfach: !!d.mehrfach,
    offen: d.offen !== false,
    erstelltAm: typeof d.erstelltAm === "string" ? d.erstelltAm : new Date().toISOString(),
    optionen,
    stimmen
  };
}
function normalizeStrafe(s) {
  const d = s && typeof s === "object" ? s : {};
  return { id: d.id || uuid(), bezeichnung: typeof d.bezeichnung === "string" ? d.bezeichnung : "", betrag: Number(d.betrag) || 0 };
}
function normalizeBuchung(b, kaderIds) {
  const d = b && typeof b === "object" ? b : {};
  const sid = kaderIds.includes(d.spielerId) ? d.spielerId : null;
  return {
    id: d.id || uuid(),
    datum: typeof d.datum === "string" ? d.datum : "",
    spielerId: sid,
    bezeichnung: typeof d.bezeichnung === "string" ? d.bezeichnung : "",
    betrag: Math.abs(Number(d.betrag) || 0),
    richtung: d.richtung === "aus" ? "aus" : "ein",
    bezahlt: !!d.bezahlt,
    kategorie: ["beitrag", "strafe", "sonstiges"].includes(d.kategorie) ? d.kategorie : "sonstiges",
    storniert: !!d.storniert,
    storniertAm: typeof d.storniertAm === "string" ? d.storniertAm : ""
  };
}
function normalizeAbwesenheit(a, kaderIds) {
  const d = a && typeof a === "object" ? a : {};
  return {
    id: d.id || uuid(),
    spielerId: kaderIds.includes(d.spielerId) ? d.spielerId : null,
    von: typeof d.von === "string" ? d.von : "",
    bis: typeof d.bis === "string" ? d.bis : "",
    grund: typeof d.grund === "string" ? d.grund : "",
    typ: d.typ === "krank" ? "krank" : "urlaub"
  };
}
function normalizeKasse(k, kaderIds) {
  const d = k && typeof k === "object" ? k : {};
  return {
    strafenkatalog: Array.isArray(d.strafenkatalog) ? d.strafenkatalog.map(normalizeStrafe) : [],
    buchungen: Array.isArray(d.buchungen) ? d.buchungen.map((b) => normalizeBuchung(b, kaderIds)) : []
  };
}
function normalizeTeam(t) {
  const d = t && typeof t === "object" ? t : {};
  const kader = Array.isArray(d.kader) ? d.kader.map(normalizeSpieler) : [];
  const kaderIds = kader.map((s) => s.id);
  return {
    id: d.id || uuid(),
    name: typeof d.name === "string" ? d.name : "",
    // "gruppe" = mannschaftsübergreifendes Konstrukt (Torwart-, Athletikgruppe), dessen
    // Spieler zusätzlich in ihrer regulären Mannschaft stehen. Technisch identisch zu
    // einer Mannschaft, nur ohne Kasse. Fehlendes Feld ⇒ "mannschaft", damit
    // Bestandsdaten unverändert weiterlaufen.
    typ: d.typ === "gruppe" ? "gruppe" : "mannschaft",
    farbe: /^#[0-9a-fA-F]{6}$/.test(d.farbe) ? d.farbe : "#1a56a0",
    kader,
    termine: Array.isArray(d.termine) ? d.termine.map((x) => normalizeTermin(x, kaderIds)) : [],
    umfragen: Array.isArray(d.umfragen) ? d.umfragen.map((x) => normalizeUmfrage(x, kaderIds)) : [],
    kasse: normalizeKasse(d.kasse, kaderIds),
    abwesenheiten: Array.isArray(d.abwesenheiten) ? d.abwesenheiten.map((x) => normalizeAbwesenheit(x, kaderIds)).filter((a) => a.spielerId) : []
  };
}
// appData.meta.rollenRechte ist die admin-editierbare Live-Kopie der Rechte-Matrix
// (Startwert ROLLEN_RECHTE aus config.js) — siehe rollenRechte()/renderRechteMatrix()/
// toggleRollenRecht() weiter unten. Unbekannte/gelöschte Bereiche werden beim Laden
// rausgefiltert, fehlende Rollen fallen auf den config.js-Startwert zurück.
function normalizeRollenRechte(obj) {
  const src = obj && typeof obj === "object" ? obj : {};
  const out = {};
  KADER_ROLLEN.forEach((r) => {
    const v = src[r.id];
    out[r.id] = Array.isArray(v) ? v.filter((b) => RECHTE_BEREICHE.includes(b)) : (ROLLEN_RECHTE[r.id] || []).slice();
  });
  return out;
}
function normalizeData(data) {
  const d = data && typeof data === "object" ? data : {};
  const teams = Array.isArray(d.teams) ? d.teams.map(normalizeTeam) : [];
  const meta = d.meta && typeof d.meta === "object" ? Object.assign({}, d.meta) : {};
  if (!teams.some((t) => t.id === meta.currentTeamId)) meta.currentTeamId = teams[0] ? teams[0].id : null;
  meta.rollenRechte = normalizeRollenRechte(meta.rollenRechte);
  return { meta, teams };
}
function seedTeam(name, farbe, typ) {
  const istGruppe = typ === "gruppe";
  return {
    id: uuid(), name, typ: istGruppe ? "gruppe" : "mannschaft", farbe: farbe || "#1a56a0",
    kader: [], termine: [], umfragen: [], abwesenheiten: [],
    // Gruppen führen keine Kasse (der Tab ist für sie ausgeblendet) — der Strafenkatalog
    // wäre eine Datenleiche. Das Feld selbst bleibt, damit ein späterer Typwechsel
    // zur Mannschaft nicht auf fehlende Strukturen läuft.
    kasse: { strafenkatalog: istGruppe ? [] : clone(DEFAULT_STRAFEN).map((s) => ({ id: uuid(), bezeichnung: s.bezeichnung, betrag: s.betrag })), buchungen: [] }
  };
}
function istGruppe(team) { return !!team && team.typ === "gruppe"; }
// Abwesenheit (Urlaub/Krank) eines Spielers, deren Zeitraum das gegebene Datum
// überdeckt — rein informativ, ändert nie den Zu-/Absage-Status eines Termins.
function abwesenheitFuer(team, spielerId, datum) {
  return team.abwesenheiten.find((a) => a.spielerId === spielerId && a.von <= datum && datum <= a.bis) || null;
}

// ---------- Zugriff / Rechte ----------
function currentTeam() { return appData.teams.find((t) => t.id === currentTeamId) || null; }
function canManage() {
  if (!currentUser) return false;
  return currentUser.isAdmin || !!currentUser.canEdit;
}
// Administrieren-Ebene (dritte Rechte-Stufe): der Einstellungen-Tab (Team-/Rollen-/
// Rechte-Verwaltung) ist Administratoren vorbehalten (2026-07-24).
function canAdmin() {
  if (!currentUser) return false;
  return currentUser.isAdmin || !!currentUser.canAdmin;
}
function myUsername() { return currentUser && currentUser.username ? currentUser.username : null; }
function myPlayerId(team) {
  const u = myUsername();
  if (!u || !team) return null;
  const p = team.kader.find((s) => s.linkedUsername && s.linkedUsername.toLowerCase() === u.toLowerCase());
  return p ? p.id : null;
}
function findSpieler(team, id) { return team.kader.find((s) => s.id === id) || null; }
// Zentrales Trainerprofil (Lizenz + Mannschaften) für einen per Self-Claim verknüpften
// Kader-Eintrag — rein informative Anzeige, kein Bezug zu rollen/ROLLEN_RECHTE.
function trainerProfileFor(linkedUsername) {
  if (!linkedUsername) return null;
  return trainerProfiles.find((p) => p.username.toLowerCase() === linkedUsername.toLowerCase()) || null;
}
function trainerProfileBadgeHtml(linkedUsername) {
  const p = trainerProfileFor(linkedUsername);
  if (!p || (!p.lizenz && !p.mannschaften.length)) return "";
  const parts = [p.lizenz, p.mannschaften.join(", ")].filter(Boolean);
  return `<span class="muted" title="Zentrales Trainerprofil">${escapeHtml(parts.join(" · "))}</span>`;
}
function terminIstKommend(termin) { return (termin.datum || "") >= todayISO(); }
// Rollen des eigenen (per Self-Claim verknüpften) Kaderplatzes in diesem Team.
function myRollen(team) {
  const id = myPlayerId(team);
  const s = id ? findSpieler(team, id) : null;
  return s ? s.rollen : [];
}
// Granulare Verwalten-Rechte je Bereich (RECHTE_BEREICHE in config.js, Zuordnung in
// appData.meta.rollenRechte, admin-editierbar über die Rollen-Rechte-Tabelle).
// canEdit-Nutzer OHNE zugewiesene Rollen (leeres Array, z.B. weil noch nie welche
// vergeben wurden) gelten rückwärtskompatibel als "darf alles" — erst eine aktiv
// zugewiesene Rolle schränkt granular ein.
function rollenRechte(rolle) {
  return (appData.meta.rollenRechte && appData.meta.rollenRechte[rolle]) || ROLLEN_RECHTE[rolle] || [];
}
function hasRecht(team, bereich) {
  if (!currentUser) return false;
  if (currentUser.isAdmin) return true;
  if (!currentUser.canEdit) return false;
  const rollen = myRollen(team);
  if (!rollen.length) return true;
  return rollen.some((r) => rollenRechte(r).includes(bereich));
}
function canSetStatusFor(team, spielerId, termin) {
  if (hasRecht(team, "termine")) return true;
  return myPlayerId(team) === spielerId && terminIstKommend(termin);
}

// ---------- Team-Auswahl ----------
function renderTeamSelect() {
  const el = document.getElementById("team-select");
  const teams = appData.teams;
  if (!teams.some((t) => t.id === currentTeamId)) currentTeamId = teams[0] ? teams[0].id : null;
  const optionen = (liste) => liste.map((t) => `<option value="${escapeHtml(t.id)}">${escapeHtml(t.name)}</option>`).join("");
  const mannschaften = teams.filter((t) => !istGruppe(t));
  const gruppen = teams.filter(istGruppe);
  // Gruppierung nur, wenn beide Arten vorkommen — sonst wäre eine einzelne
  // optgroup-Überschrift über der ohnehin vollständigen Liste nur Ballast.
  el.innerHTML = gruppen.length && mannschaften.length
    ? `<optgroup label="Mannschaften">${optionen(mannschaften)}</optgroup><optgroup label="Gruppen">${optionen(gruppen)}</optgroup>`
    : optionen(teams);
  if (currentTeamId) el.value = currentTeamId;
  el.disabled = teams.length === 0;
}
function selectTeam(id) {
  currentTeamId = id;
  appData.meta.currentTeamId = id;
  // switchTab() ist die einzige Stelle, die den aktiven Tab umschaltet — ohne diesen
  // Aufruf bliebe der Kasse-Inhalt sichtbar, obwohl sein Nav-Button gerade verschwindet.
  if (currentTab === "kasse" && istGruppe(currentTeam())) switchTab("termine");
  renderAll();
}
// Blendet den passenden "Noch keine Mannschaft"-Hinweis ein und liefert das aktuelle
// Team (oder null). true -> Inhalt rendern, false -> abbrechen.
function teamOr(noTeamId, contentIds) {
  const team = currentTeam();
  const noTeam = document.getElementById(noTeamId);
  if (noTeam) noTeam.classList.toggle("hidden", !!team);
  contentIds.forEach((cid) => { const el = document.getElementById(cid); if (el) el.classList.toggle("hidden", !team); });
  return team;
}

// ---------- Termine ----------
function bilanz(team, termin) {
  const c = { zu: 0, unsicher: 0, ab: 0, offen: 0 };
  team.kader.forEach((s) => {
    const e = termin.teilnahme[s.id];
    if (e && c[e.status] != null) c[e.status]++;
    else c.offen++;
  });
  return c;
}
function bilanzHtml(c) {
  return `<div class="termin-bilanz">
    <span class="bilanz-chip zu">✓ ${c.zu}</span>
    <span class="bilanz-chip unsicher">? ${c.unsicher}</span>
    <span class="bilanz-chip ab">✗ ${c.ab}</span>
    <span class="bilanz-chip offen">offen ${c.offen}</span>
  </div>`;
}
function terminSubHtml(t) {
  const parts = [fmtDatum(t.datum)];
  const z = zeitText(t);
  if (z) parts.push(z);
  let html = parts.join(" · ");
  const line2 = [];
  if (t.ort) line2.push("📍 " + escapeHtml(t.ort));
  if (t.typ === "spiel" && t.gegner) line2.push("gegen " + escapeHtml(t.gegner));
  if (t.treffpunkt) line2.push("🕑 " + escapeHtml(t.treffpunkt));
  return `${escapeHtml(html)}${line2.length ? `<br>${line2.join(" · ")}` : ""}`;
}
function renderTermine() {
  const team = teamOr("no-team-termine", ["termine-list", "termine-empty"]);
  document.querySelectorAll("#termine-filter button").forEach((b) => b.classList.toggle("active", b.dataset.filter === termineFilter));
  const listEl = document.getElementById("termine-list");
  const emptyEl = document.getElementById("termine-empty");
  if (!team) { listEl.innerHTML = ""; emptyEl.classList.add("hidden"); return; }
  const today = todayISO();
  let list = team.termine.filter((t) => termineFilter === "kommend" ? (t.datum || "") >= today : (t.datum || "") < today);
  list.sort((a, b) => termineFilter === "kommend" ? (a.datum || "").localeCompare(b.datum || "") : (b.datum || "").localeCompare(a.datum || ""));
  emptyEl.classList.toggle("hidden", list.length > 0);
  const myId = myPlayerId(team);
  listEl.innerHTML = list.map((t) => {
    const typ = terminTyp(t.typ);
    const titel = t.titel || typ.label;
    const c = bilanz(team, t);
    let rsvp = "";
    if (myId && termineFilter === "kommend") {
      const mine = t.teilnahme[myId] ? t.teilnahme[myId].status : "";
      rsvp = `<div class="rsvp-row">
        <span class="rsvp-label">Deine Rückmeldung:</span>
        <div class="rsvp-buttons">
          ${TEILNAHME_STATUS.map((s) => `<button class="rsvp-btn${s.id === mine ? " active" : ""}" data-rsvp-termin="${escapeHtml(t.id)}" data-status="${s.id}">${s.kurz} ${s.label}</button>`).join("")}
        </div>
      </div>`;
    }
    return `<div class="termin-card" style="border-left-color:${typ.farbe}">
      <div class="termin-main" data-open-termin="${escapeHtml(t.id)}">
        <div class="termin-info">
          <span class="termin-type-icon">${typ.icon}</span>
          <div>
            <div class="termin-title">${escapeHtml(titel)}</div>
            <div class="termin-sub">${terminSubHtml(t)}</div>
          </div>
        </div>
        ${bilanzHtml(c)}
      </div>
      ${rsvp}
    </div>`;
  }).join("");
}

// gemeinsame Statuslogik (Toggle: gleicher Status erneut -> zurück auf "offen")
function applyStatus(termin, spielerId, status) {
  const cur = termin.teilnahme[spielerId] && termin.teilnahme[spielerId].status;
  if (cur === status) delete termin.teilnahme[spielerId];
  else termin.teilnahme[spielerId] = { status, am: new Date().toISOString() };
}
function setMyStatus(terminId, status) {
  const team = currentTeam();
  if (!team) return;
  const termin = team.termine.find((t) => t.id === terminId);
  if (!termin) return;
  const myId = myPlayerId(team);
  if (!myId || !terminIstKommend(termin)) return;
  applyStatus(termin, myId, status);
  // applyStatus togglet: gleicher Status erneut -> Eintrag weg ("offen"). Dem Server
  // deshalb den TATSAECHLICHEN Stand danach schicken, nicht den geklickten Wert.
  const neu = termin.teilnahme[myId] ? termin.teilnahme[myId].status : null;
  persistSelbst({ art: "teilnahme", terminId, status: neu });
  renderTermine();
  if (detailTerminId === terminId) renderDetail();
}
function setStatusFor(terminId, spielerId, status) {
  const team = currentTeam();
  if (!team) return;
  const termin = team.termine.find((t) => t.id === terminId);
  if (!termin || !canSetStatusFor(team, spielerId, termin)) return;
  applyStatus(termin, spielerId, status);
  persist();
  renderDetail();
  renderTermine();
}

// ---------- Termin-Detail (Teilnahme je Spieler) ----------
function openDetail(terminId) {
  const team = currentTeam();
  if (!team) return;
  const termin = team.termine.find((t) => t.id === terminId);
  if (!termin) return;
  detailTerminId = terminId;
  renderDetail();
  document.getElementById("detail-modal").classList.remove("hidden");
}
function closeDetail() {
  document.getElementById("detail-modal").classList.add("hidden");
  detailTerminId = null;
}
function renderDetail() {
  const team = currentTeam();
  if (!team || !detailTerminId) return;
  const termin = team.termine.find((t) => t.id === detailTerminId);
  if (!termin) { closeDetail(); return; }
  const typ = terminTyp(termin.typ);
  document.getElementById("detail-modal-title").textContent = termin.titel || typ.label;
  const ctxLines = [`<div class="dc-title">${typ.icon} ${escapeHtml(termin.titel || typ.label)}</div>`];
  ctxLines.push(`${escapeHtml(fmtDatum(termin.datum))}${zeitText(termin) ? " · " + escapeHtml(zeitText(termin)) : ""}`);
  if (termin.ort) ctxLines.push("📍 " + escapeHtml(termin.ort));
  if (termin.typ === "spiel" && termin.gegner) ctxLines.push("Gegner: " + escapeHtml(termin.gegner));
  if (termin.treffpunkt) ctxLines.push("🕑 Treffpunkt: " + escapeHtml(termin.treffpunkt));
  if (termin.notiz) ctxLines.push("📝 " + escapeHtml(termin.notiz));
  document.getElementById("detail-context").innerHTML = ctxLines.join("<br>");

  const myId = myPlayerId(team);
  const selfEl = document.getElementById("detail-self");
  if (myId && terminIstKommend(termin)) {
    const mine = termin.teilnahme[myId] ? termin.teilnahme[myId].status : "";
    selfEl.innerHTML = `<div class="rsvp-row" style="border:none;padding:0 0 14px;">
      <span class="rsvp-label">Deine Rückmeldung:</span>
      <div class="rsvp-buttons">
        ${TEILNAHME_STATUS.map((s) => `<button class="rsvp-btn${s.id === mine ? " active" : ""}" data-detail-self data-status="${s.id}">${s.kurz} ${s.label}</button>`).join("")}
      </div>
    </div>`;
  } else selfEl.innerHTML = "";

  const manage = hasRecht(team, "termine");
  const rows = team.kader.slice().sort((a, b) => a.name.localeCompare(b.name)).map((s) => {
    const st = termin.teilnahme[s.id] ? termin.teilnahme[s.id].status : "offen";
    const isSelf = s.id === myId;
    const label = TEILNAHME_STATUS.find((x) => x.id === st);
    const abwesenheit = abwesenheitFuer(team, s.id, termin.datum);
    let right;
    if (manage) {
      right = `<div class="mini-rsvp">${TEILNAHME_STATUS.map((x) => `<button data-set-spieler="${escapeHtml(s.id)}" data-status="${x.id}" class="${x.id === st ? "active" : ""}" title="${x.label}">${x.kurz}</button>`).join("")}</div>`;
    } else {
      right = `<span class="status-pill ${st}">${label ? label.kurz + " " + label.label : "offen"}</span>`;
    }
    const abwesendTag = abwesenheit
      ? `<span class="abwesend-tag" title="${abwesenheit.typ === "krank" ? "Krank" : "Urlaub"}${abwesenheit.grund ? ": " + escapeHtml(abwesenheit.grund) : ""}">${abwesenheit.typ === "krank" ? "🤒" : "🏖️"}</span>`
      : "";
    return `<div class="teilnahme-row${isSelf ? " is-self" : ""}">
      <span class="tr-name">${escapeHtml(s.name || "—")}${isSelf ? '<span class="self-tag">DU</span>' : ""}${abwesendTag}</span>
      ${right}
    </div>`;
  }).join("");
  document.getElementById("detail-teilnahme").innerHTML = rows || `<p class="muted">Noch keine Spieler im Kader.</p>`;

  document.getElementById("btn-edit-termin-detail").classList.toggle("hidden", !manage);
  document.getElementById("btn-delete-termin-detail").classList.toggle("hidden", !manage);

  renderAufstellung(team, termin);
  renderAufgaben(team, termin);
  renderGruppen(team, termin);
  renderSpielbericht(team, termin);
  renderFahrgemeinschaft(team, termin);
}

// ---------- Spielerfotos (Blob-Cache über das Datei-Gateway) ----------
// fotoId zeigt auf die dav-file-*-Ablage (siehe db.js) — kein eigener
// Speichermechanismus, und die Fotos landen NICHT in appData selbst (das wird
// bei jedem persist() komplett neu geladen/gespeichert, siehe doPersist/gatewaySave).
// Client-seitig auf FOTO_MAX_DIMENSION verkleinert/komprimiert (siehe resizeImageFile).
const fotoUrlCache = new Map();
const fotoLoadPromises = new Map();

// Nutzername -> Zeitstempel des im ToolsUebersicht-Konto hinterlegten Fotos
// (seit 2026-08-04). Wird beim Laden EINMAL für alle geholt, siehe init().
let nutzerfotoVersionen = {};

// Welches Bild gilt für diesen Kader-Eintrag?
//
// Vorrangkette: das im Konto hinterlegte Nutzerfoto → der Upload des Trainers →
// (in applyAvatarVisual) Nummer bzw. Initiale.
//
// ⚠️ Der Trainer-Upload wird dadurch NICHT überflüssig: er bleibt der einzige Weg
// für Spieler ohne eigenes Konto. Er wird nur überstimmt, sobald die Person selbst
// ein Bild hinterlegt hat — die pflegt sich damit selbst, und niemand muss 200
// Fotos von Hand nachziehen.
//
// Der Schlüssel trägt die Version mit: ein neues Konto-Foto erzeugt einen neuen
// Schlüssel und damit einen frischen Abruf, statt hinter dem alten hängenzubleiben.
function avatarFotoSchluessel(s) {
  const u = (s && s.linkedUsername) ? String(s.linkedUsername).toLowerCase() : "";
  const version = u ? nutzerfotoVersionen[u] : null;
  if (version) return "konto:" + u + "@" + version;
  return (s && s.fotoId) ? s.fotoId : "";
}

function loadFoto(schluessel) {
  if (!schluessel) return Promise.resolve(null);
  if (fotoUrlCache.has(schluessel)) return Promise.resolve(fotoUrlCache.get(schluessel));
  if (fotoLoadPromises.has(schluessel)) return fotoLoadPromises.get(schluessel);
  // "konto:<nutzername>@<version>" kommt aus der ToolsUebersicht und gehört zum
  // Konto; alles andere ist eine Datei-Id aus der dav-file-Ablage dieser App.
  const holen = schluessel.indexOf("konto:") === 0
    ? gatewayFetchNutzerfoto(schluessel.slice(6, schluessel.lastIndexOf("@")))
    : gatewayFetchFileBlob(schluessel);
  const p = holen
    .then((blob) => { const url = URL.createObjectURL(blob); fotoUrlCache.set(schluessel, url); return url; })
    .catch((e) => { console.warn("Foto konnte nicht geladen werden:", e); return null; })
    .finally(() => fotoLoadPromises.delete(schluessel));
  fotoLoadPromises.set(schluessel, p);
  return p;
}
// Verkleinert/komprimiert eine ausgewählte Bilddatei clientseitig auf maxDim (längste
// Kante) als JPEG, bevor sie hochgeladen wird — Spielerfotos sind nur kleine Avatare,
// eine Rohdatei vom Handy (mehrere MB) wäre unnötig groß für Chips von 36px.
function resizeImageFile(file, maxDim) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const reader = new FileReader();
    reader.onload = () => { img.src = reader.result; };
    reader.onerror = () => reject(new Error("Datei konnte nicht gelesen werden."));
    img.onload = () => {
      const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
      const w = Math.max(1, Math.round(img.width * scale));
      const h = Math.max(1, Math.round(img.height * scale));
      const canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
      canvas.getContext("2d").drawImage(img, 0, 0, w, h);
      canvas.toBlob((blob) => {
        if (!blob) { reject(new Error("Bild konnte nicht verarbeitet werden.")); return; }
        resolve(new File([blob], "foto.jpg", { type: "image/jpeg" }));
      }, "image/jpeg", 0.85);
    };
    img.onerror = () => reject(new Error("Datei ist kein gültiges Bild."));
    reader.readAsDataURL(file);
  });
}
// Setzt Foto (falls schon geladen) oder ersatzweise Nummer/Initiale auf ein
// Avatar-Element (Aufstellung-Chip oder Kader-Zeile). Fehlt das Foto noch im Cache,
// wird es asynchron nachgeladen und dasselbe Element erneut aktualisiert — sofern es
// noch im DOM hängt und nicht inzwischen neu gerendert/wiederverwendet wurde.
// Verwaltet NUR ein eigenes ".avatar-content"-Kind, damit andere, separat angehängte
// Kinder (z. B. der Hover-Tooltip der Aufstellung-Chips) beim Nachladen unangetastet bleiben.
function applyAvatarVisual(el, s, opts) {
  const withBadge = !opts || opts.badge !== false;
  let content = el.querySelector(":scope > .avatar-content");
  if (!content) {
    content = document.createElement("span");
    content.className = "avatar-content";
    el.insertBefore(content, el.firstChild);
  }
  content.innerHTML = "";
  el.style.backgroundImage = "";
  el.classList.remove("has-foto");
  content.textContent = s.nummer || (s.name ? s.name.trim().charAt(0).toUpperCase() : "?");
  // Seit 2026-08-04 nicht mehr direkt s.fotoId, sondern der Schlüssel aus der
  // Vorrangkette (Konto-Foto vor Trainer-Upload).
  const schluessel = avatarFotoSchluessel(s);
  if (!schluessel) { delete el.dataset.fotoFor; return; }
  el.dataset.fotoFor = schluessel;
  const cached = fotoUrlCache.get(schluessel);
  if (cached) {
    el.style.backgroundImage = `url("${cached}")`;
    el.classList.add("has-foto");
    content.textContent = "";
    if (withBadge && s.nummer) {
      const badge = document.createElement("span");
      badge.className = "avatar-nummer-badge";
      badge.textContent = s.nummer;
      content.appendChild(badge);
    }
    return;
  }
  loadFoto(schluessel).then((url) => {
    if (url && el.isConnected && el.dataset.fotoFor === schluessel) applyAvatarVisual(el, s, opts);
  });
}
function avatarTooltip(s) {
  const tip = document.createElement("span");
  tip.className = "chip-tooltip";
  const meta = [s.position, s.nummer ? "#" + s.nummer : ""].filter(Boolean).join(" · ");
  tip.innerHTML = escapeHtml(s.name || "?") + (meta ? `<small>${escapeHtml(meta)}</small>` : "");
  return tip;
}

// ---------- Termin-Erweiterungen: Aufstellung (visuelles Spielfeld, Drag & Drop) ----------
// Pointer-Events statt natives HTML5-DnD, damit Touch (mobile) und Maus (desktop)
// einheitlich funktionieren (App ist laut ToolsUebersicht als mobile+desktop registriert).
let aufstellungDrag = null;
function renderAufstellung(team, termin) {
  const manage = hasRecht(team, "aufstellungen");
  const a = termin.aufstellung;
  const feldIds = a.feld.map((p) => p.spielerId);
  const bankIds = a.bank;
  const poolIds = team.kader.filter((s) => !feldIds.includes(s.id) && !bankIds.includes(s.id)).map((s) => s.id);

  function makeChip(className, spielerId) {
    const s = findSpieler(team, spielerId);
    if (!s) return null;
    const chip = document.createElement("div");
    chip.className = className + (manage ? "" : " readonly");
    chip.dataset.spieler = s.id;
    applyAvatarVisual(chip, s);
    chip.appendChild(avatarTooltip(s));
    if (manage) chip.addEventListener("pointerdown", startAufstellungDrag);
    return chip;
  }

  const feldEl = document.getElementById("spielfeld");
  feldEl.querySelectorAll(".feld-chip").forEach((el) => el.remove());
  a.feld.forEach((p) => {
    const chip = makeChip("feld-chip", p.spielerId);
    if (!chip) return;
    chip.style.left = p.x + "%";
    chip.style.top = p.y + "%";
    feldEl.appendChild(chip);
  });

  ["aufstellung-bank", "aufstellung-pool"].forEach((elId, i) => {
    const el = document.getElementById(elId);
    el.innerHTML = "";
    (i === 0 ? bankIds : poolIds).forEach((sid) => {
      const chip = makeChip("az-chip", sid);
      if (chip) el.appendChild(chip);
    });
  });
}
function startAufstellungDrag(e) {
  e.preventDefault();
  const chip = e.currentTarget;
  const rect = chip.getBoundingClientRect();
  aufstellungDrag = {
    spielerId: chip.dataset.spieler,
    offsetX: e.clientX - (rect.left + rect.width / 2),
    offsetY: e.clientY - (rect.top + rect.height / 2)
  };
  chip.setPointerCapture(e.pointerId);
  chip.classList.add("dragging");
  chip.style.position = "fixed";
  chip.style.left = (rect.left + rect.width / 2) + "px";
  chip.style.top = (rect.top + rect.height / 2) + "px";
  chip.style.margin = "0";
  chip.style.zIndex = "999";
  chip.addEventListener("pointermove", onAufstellungDragMove);
  chip.addEventListener("pointerup", onAufstellungDragEnd);
}
function onAufstellungDragMove(e) {
  if (!aufstellungDrag) return;
  e.currentTarget.style.left = (e.clientX - aufstellungDrag.offsetX) + "px";
  e.currentTarget.style.top = (e.clientY - aufstellungDrag.offsetY) + "px";
}
function onAufstellungDragEnd(e) {
  const chip = e.currentTarget;
  chip.removeEventListener("pointermove", onAufstellungDragMove);
  chip.removeEventListener("pointerup", onAufstellungDragEnd);
  if (!aufstellungDrag) return;
  const spielerId = aufstellungDrag.spielerId;
  aufstellungDrag = null;
  const team = currentTeam();
  const termin = team && detailTerminId ? team.termine.find((t) => t.id === detailTerminId) : null;
  if (!team || !termin) return;
  const a = termin.aufstellung;
  a.feld = a.feld.filter((p) => p.spielerId !== spielerId);
  a.bank = a.bank.filter((id) => id !== spielerId);
  const feldRect = document.getElementById("spielfeld").getBoundingClientRect();
  const bankRect = document.getElementById("aufstellung-bank").getBoundingClientRect();
  const x = e.clientX, y = e.clientY;
  if (x >= feldRect.left && x <= feldRect.right && y >= feldRect.top && y <= feldRect.bottom) {
    const px = Math.round(((x - feldRect.left) / feldRect.width) * 100);
    const py = Math.round(((y - feldRect.top) / feldRect.height) * 100);
    a.feld.push({ spielerId, x: Math.max(2, Math.min(98, px)), y: Math.max(2, Math.min(98, py)) });
  } else if (x >= bankRect.left && x <= bankRect.right && y >= bankRect.top && y <= bankRect.bottom) {
    a.bank.push(spielerId);
  } // sonst: weder Feld noch Bank -> gilt als "nicht nominiert"
  persist();
  renderAufstellung(team, termin);
}

function spielerOptions(team) {
  return team.kader.slice().sort((a, b) => a.name.localeCompare(b.name))
    .map((s) => `<option value="${escapeHtml(s.id)}">${escapeHtml(s.name)}</option>`).join("");
}

// ---------- Termin-Erweiterungen: Aufgaben ----------
function renderAufgaben(team, termin) {
  const manage = hasRecht(team, "aufgaben");
  const myId = myPlayerId(team);
  const list = document.getElementById("detail-aufgaben");
  list.innerHTML = termin.aufgaben.map((a) => {
    const zeilen = (a.spielerIds.length ? a.spielerIds : [null]).map((sid) => {
      const s = sid ? findSpieler(team, sid) : null;
      const name = s ? s.name : "(niemand zugewiesen)";
      const done = sid ? !!a.erledigt[sid] : false;
      const kannAbhaken = sid && (manage || sid === myId);
      return `<label class="aufgabe-zeile"><input type="checkbox" data-aufgabe-toggle="${escapeHtml(a.id)}" data-spieler="${sid ? escapeHtml(sid) : ""}" ${done ? "checked" : ""} ${kannAbhaken ? "" : "disabled"} /> ${escapeHtml(name)}</label>`;
    }).join("");
    return `<div class="aufgabe-row">
      <div class="aufgabe-text"><span>${escapeHtml(a.text)}</span>${manage ? `<button class="icon-btn" data-remove-aufgabe="${escapeHtml(a.id)}" title="Entfernen">×</button>` : ""}</div>
      <div class="aufgabe-zeilen">${zeilen}</div>
    </div>`;
  }).join("") || `<p class="muted">Noch keine Aufgaben.</p>`;
  document.getElementById("af-spieler").innerHTML = spielerOptions(team);
}
function addAufgabe() {
  const team = currentTeam();
  if (!team || !detailTerminId || !hasRecht(team, "aufgaben")) return;
  const termin = team.termine.find((t) => t.id === detailTerminId);
  if (!termin) return;
  const text = val("af-text").trim();
  if (!text) { alert("Bitte eine Aufgabenbeschreibung eingeben."); return; }
  const spielerIds = Array.from(document.getElementById("af-spieler").selectedOptions).map((o) => o.value);
  termin.aufgaben.push({ id: uuid(), text, spielerIds, erledigt: {} });
  document.getElementById("af-text").value = "";
  persist();
  renderAufgaben(team, termin);
}
function toggleAufgabe(aufgabeId, spielerId) {
  const team = currentTeam();
  if (!team || !detailTerminId || !spielerId) return;
  const termin = team.termine.find((t) => t.id === detailTerminId);
  const a = termin && termin.aufgaben.find((x) => x.id === aufgabeId);
  if (!a || !a.spielerIds.includes(spielerId)) return;
  if (!(hasRecht(team, "aufgaben") || spielerId === myPlayerId(team))) return;
  if (a.erledigt[spielerId]) delete a.erledigt[spielerId]; else a.erledigt[spielerId] = true;
  persistSelbst({ art: "aufgabe", terminId: detailTerminId, aufgabeId, erledigt: !!a.erledigt[spielerId] });
  renderAufgaben(team, termin);
}
function removeAufgabe(aufgabeId) {
  const team = currentTeam();
  if (!team || !detailTerminId || !hasRecht(team, "aufgaben")) return;
  const termin = team.termine.find((t) => t.id === detailTerminId);
  if (!termin) return;
  termin.aufgaben = termin.aufgaben.filter((a) => a.id !== aufgabeId);
  persist();
  renderAufgaben(team, termin);
}

// ---------- Termin-Erweiterungen: Gruppen ----------
function renderGruppen(team, termin) {
  const manage = hasRecht(team, "gruppen");
  const list = document.getElementById("detail-gruppen");
  list.innerHTML = termin.gruppen.map((g) => {
    const namen = g.spielerIds.map((sid) => { const s = findSpieler(team, sid); return s ? s.name : "?"; }).join(", ") || "—";
    return `<div class="gruppe-row">
      <div class="gruppe-name"><span>${escapeHtml(g.name || "Gruppe")}</span>${manage ? `<button class="icon-btn" data-remove-gruppe="${escapeHtml(g.id)}" title="Entfernen">×</button>` : ""}</div>
      <div class="gruppe-mitglieder">${escapeHtml(namen)}</div>
    </div>`;
  }).join("") || `<p class="muted">Noch keine Gruppen.</p>`;
  document.getElementById("gf-spieler").innerHTML = spielerOptions(team);
}
function addGruppe() {
  const team = currentTeam();
  if (!team || !detailTerminId || !hasRecht(team, "gruppen")) return;
  const termin = team.termine.find((t) => t.id === detailTerminId);
  if (!termin) return;
  const name = val("gf-name").trim();
  if (!name) { alert("Bitte einen Gruppennamen eingeben."); return; }
  const spielerIds = Array.from(document.getElementById("gf-spieler").selectedOptions).map((o) => o.value);
  termin.gruppen.push({ id: uuid(), name, spielerIds });
  document.getElementById("gf-name").value = "";
  persist();
  renderGruppen(team, termin);
}
function removeGruppe(gruppeId) {
  const team = currentTeam();
  if (!team || !detailTerminId || !hasRecht(team, "gruppen")) return;
  const termin = team.termine.find((t) => t.id === detailTerminId);
  if (!termin) return;
  termin.gruppen = termin.gruppen.filter((g) => g.id !== gruppeId);
  persist();
  renderGruppen(team, termin);
}

// ---------- Termin-Erweiterungen: Spielbericht (nur typ === "spiel") ----------
function renderSpielbericht(team, termin) {
  const wrap = document.getElementById("detail-spielbericht-wrap");
  wrap.classList.toggle("hidden", termin.typ !== "spiel");
  if (termin.typ !== "spiel") return;
  const sb = termin.spielbericht;
  document.getElementById("sb-eigene").value = sb.ergebnisEigenes;
  document.getElementById("sb-gegner").value = sb.ergebnisGegner;
  document.getElementById("sb-bericht").value = sb.bericht;
  const manage = hasRecht(team, "spielberichte");
  document.getElementById("sb-eigene").disabled = !manage;
  document.getElementById("sb-gegner").disabled = !manage;
  document.getElementById("sb-bericht").disabled = !manage;
  document.getElementById("detail-torschuetzen").innerHTML = sb.torschuetzen.map((t, i) => {
    const s = findSpieler(team, t.spielerId);
    return `<div class="torschuetze-row"><span>⚽ ${escapeHtml(s ? s.name : "?")} (${t.anzahl})</span>${manage ? `<button class="icon-btn" data-remove-torschuetze="${i}" title="Entfernen">×</button>` : ""}</div>`;
  }).join("") || `<p class="muted">Noch keine Torschützen erfasst.</p>`;
  document.getElementById("tf-spieler").innerHTML = spielerOptions(team);
}
function updateSpielbericht(feld, value) {
  const team = currentTeam();
  if (!team || !detailTerminId || !hasRecht(team, "spielberichte")) return;
  const termin = team.termine.find((t) => t.id === detailTerminId);
  if (!termin) return;
  termin.spielbericht[feld] = value;
  persist();
}
function addTorschuetze() {
  const team = currentTeam();
  if (!team || !detailTerminId || !hasRecht(team, "spielberichte")) return;
  const termin = team.termine.find((t) => t.id === detailTerminId);
  if (!termin) return;
  const spielerId = val("tf-spieler");
  if (!spielerId) return;
  const anzahl = Math.max(1, parseInt(val("tf-anzahl"), 10) || 1);
  termin.spielbericht.torschuetzen.push({ spielerId, anzahl });
  persist();
  renderSpielbericht(team, termin);
}
function removeTorschuetze(idx) {
  const team = currentTeam();
  if (!team || !detailTerminId || !hasRecht(team, "spielberichte")) return;
  const termin = team.termine.find((t) => t.id === detailTerminId);
  if (!termin) return;
  termin.spielbericht.torschuetzen.splice(idx, 1);
  persist();
  renderSpielbericht(team, termin);
}

// ---------- Termin-Erweiterungen: Fahrgemeinschaft ----------
function renderFahrgemeinschaft(team, termin) {
  const myId = myPlayerId(team);
  const manage = hasRecht(team, "termine");
  const f = termin.fahrgemeinschaft;
  const angeboteHtml = f.angebote.map((a) => {
    const s = findSpieler(team, a.spielerId);
    const kannEntfernen = manage || a.spielerId === myId;
    return `<div class="fg-row">🚗 ${escapeHtml(s ? s.name : "?")} bietet ${a.plaetze} Platz/Plätze${kannEntfernen ? ` <button class="icon-btn" data-remove-fg-angebot="${escapeHtml(a.spielerId)}" title="Entfernen">×</button>` : ""}</div>`;
  }).join("");
  const gesucheHtml = f.gesuche.map((sid) => {
    const s = findSpieler(team, sid);
    const kannEntfernen = manage || sid === myId;
    return `<div class="fg-row">🙋 ${escapeHtml(s ? s.name : "?")} sucht einen Platz${kannEntfernen ? ` <button class="icon-btn" data-remove-fg-gesuch="${escapeHtml(sid)}" title="Entfernen">×</button>` : ""}</div>`;
  }).join("");
  document.getElementById("detail-fahrgemeinschaft").innerHTML = (angeboteHtml + gesucheHtml) || `<p class="muted">Noch keine Einträge.</p>`;
  const meinAngebot = myId ? f.angebote.some((a) => a.spielerId === myId) : false;
  const meinGesuch = myId ? f.gesuche.includes(myId) : false;
  document.getElementById("fg-self-row").classList.toggle("hidden", !myId || meinAngebot || meinGesuch);
}
function fgAnbieten() {
  const team = currentTeam();
  const myId = team ? myPlayerId(team) : null;
  if (!team || !detailTerminId || !myId) return;
  const termin = team.termine.find((t) => t.id === detailTerminId);
  if (!termin) return;
  const plaetze = Math.max(1, parseInt(val("fg-plaetze"), 10) || 1);
  termin.fahrgemeinschaft.angebote = termin.fahrgemeinschaft.angebote.filter((a) => a.spielerId !== myId);
  termin.fahrgemeinschaft.angebote.push({ spielerId: myId, plaetze });
  persistSelbst({ art: "fahrt-angebot", terminId: detailTerminId, plaetze });
  renderFahrgemeinschaft(team, termin);
}
function fgSuchen() {
  const team = currentTeam();
  const myId = team ? myPlayerId(team) : null;
  if (!team || !detailTerminId || !myId) return;
  const termin = team.termine.find((t) => t.id === detailTerminId);
  if (!termin) return;
  if (!termin.fahrgemeinschaft.gesuche.includes(myId)) termin.fahrgemeinschaft.gesuche.push(myId);
  persistSelbst({ art: "fahrt-gesuch", terminId: detailTerminId, an: true });
  renderFahrgemeinschaft(team, termin);
}
function fgEntferneAngebot(spielerId) {
  const team = currentTeam();
  if (!team || !detailTerminId) return;
  const termin = team.termine.find((t) => t.id === detailTerminId);
  if (!termin) return;
  if (!(hasRecht(team, "termine") || spielerId === myPlayerId(team))) return;
  termin.fahrgemeinschaft.angebote = termin.fahrgemeinschaft.angebote.filter((a) => a.spielerId !== spielerId);
  // plaetze 0 = eigenes Angebot zurückziehen. Entfernt ein Bearbeiter ein FREMDES
  // Angebot, greift in persistSelbst ohnehin der normale dav-save-Weg.
  persistSelbst({ art: "fahrt-angebot", terminId: detailTerminId, plaetze: 0 });
  renderFahrgemeinschaft(team, termin);
}
function fgEntferneGesuch(spielerId) {
  const team = currentTeam();
  if (!team || !detailTerminId) return;
  const termin = team.termine.find((t) => t.id === detailTerminId);
  if (!termin) return;
  if (!(hasRecht(team, "termine") || spielerId === myPlayerId(team))) return;
  termin.fahrgemeinschaft.gesuche = termin.fahrgemeinschaft.gesuche.filter((id) => id !== spielerId);
  persistSelbst({ art: "fahrt-gesuch", terminId: detailTerminId, an: false });
  renderFahrgemeinschaft(team, termin);
}

// ---------- Termin-Formular ----------
function openTerminModal(id) {
  const team = currentTeam();
  if (!team || !hasRecht(team, "termine")) return;
  const t = id ? team.termine.find((x) => x.id === id) : null;
  editingTerminId = t ? t.id : null;
  document.getElementById("termin-modal-title").textContent = t ? "Termin bearbeiten" : "Neuer Termin";
  document.getElementById("ef-typ").innerHTML = TERMIN_TYPEN.map((x) => `<option value="${x.id}">${x.icon} ${escapeHtml(x.label)}</option>`).join("");
  document.getElementById("ef-typ").value = t ? t.typ : "training";
  document.getElementById("ef-titel").value = t ? t.titel : "";
  document.getElementById("ef-datum").value = t ? t.datum : todayISO();
  document.getElementById("ef-startzeit").value = t ? t.startZeit : "";
  document.getElementById("ef-endzeit").value = t ? t.endZeit : "";
  document.getElementById("ef-ort").value = t ? t.ort : "";
  document.getElementById("ef-gegner").value = t ? t.gegner : "";
  document.getElementById("ef-treffpunkt").value = t ? t.treffpunkt : "";
  document.getElementById("ef-notiz").value = t ? t.notiz : "";
  document.getElementById("ef-video").value = t ? t.videoUrl : "";
  document.getElementById("btn-delete-termin").classList.toggle("hidden", !t);
  document.getElementById("ef-zyklisch-wrap").classList.toggle("hidden", !!t);
  document.getElementById("ef-zyklisch").checked = false;
  document.getElementById("ef-wochen").value = "";
  updateGegnerVisibility();
  updateZyklischVisibility();
  document.getElementById("termin-modal").classList.remove("hidden");
  document.getElementById("ef-datum").focus();
}
function updateGegnerVisibility() {
  document.getElementById("ef-gegner-field").style.display = val("ef-typ") === "spiel" ? "" : "none";
}
function updateZyklischVisibility() {
  document.getElementById("ef-wochen-field").classList.toggle("hidden", !checked("ef-zyklisch"));
}
function closeTerminModal() { document.getElementById("termin-modal").classList.add("hidden"); editingTerminId = null; }
function saveTermin() {
  const team = currentTeam();
  if (!team) return;
  const datum = val("ef-datum");
  if (!datum) { alert("Bitte ein Datum angeben."); return; }
  const zyklisch = !editingTerminId && checked("ef-zyklisch");
  let wochen = 1;
  if (zyklisch) {
    wochen = parseInt(val("ef-wochen"), 10);
    if (!wochen || wochen < 2) { alert("Bitte bei „Wöchentlich wiederholen“ eine Anzahl Wochen von mindestens 2 angeben."); return; }
    if (wochen > 52) wochen = 52;
  }
  let t = editingTerminId ? team.termine.find((x) => x.id === editingTerminId) : null;
  if (!t) { t = Object.assign({ id: uuid(), teilnahme: {} }, emptyTerminExtras()); team.termine.push(t); }
  t.typ = val("ef-typ");
  t.titel = val("ef-titel").trim();
  t.datum = datum;
  t.startZeit = val("ef-startzeit");
  t.endZeit = val("ef-endzeit");
  t.ort = val("ef-ort").trim();
  t.gegner = t.typ === "spiel" ? val("ef-gegner").trim() : "";
  t.treffpunkt = val("ef-treffpunkt").trim();
  t.notiz = val("ef-notiz").trim();
  t.videoUrl = val("ef-video").trim();
  for (let i = 1; i < wochen; i++) {
    team.termine.push(Object.assign({
      id: uuid(), typ: t.typ, titel: t.titel, datum: addDaysISO(datum, i * 7),
      startZeit: t.startZeit, endZeit: t.endZeit, ort: t.ort,
      gegner: t.gegner, treffpunkt: t.treffpunkt, notiz: t.notiz, teilnahme: {}
    }, emptyTerminExtras()));
  }
  persist();
  renderTermine();
  closeTerminModal();
}
function deleteTermin(id) {
  const team = currentTeam();
  if (!team || !id) return;
  if (!confirm("Diesen Termin mit allen Rückmeldungen wirklich löschen?")) return;
  team.termine = team.termine.filter((x) => x.id !== id);
  persist();
  renderTermine();
  closeTerminModal();
  closeDetail();
}

// ---------- Urlaub/Krank ----------
function renderUrlaubKrank() {
  const team = currentTeam();
  if (!team) return;
  const manage = hasRecht(team, "urlaubkrank");
  const myId = myPlayerId(team);
  const list = team.abwesenheiten.slice().sort((a, b) => (b.von || "").localeCompare(a.von || ""));
  document.getElementById("urlaub-liste").innerHTML = list.map((a) => {
    const s = findSpieler(team, a.spielerId);
    const kannLoeschen = manage || a.spielerId === myId;
    return `<div class="urlaub-row">
      <span class="urlaub-typ ${a.typ}">${a.typ === "krank" ? "🤒 Krank" : "🏖️ Urlaub"}</span>
      <span class="urlaub-name">${escapeHtml(s ? s.name : "?")}</span>
      <span class="urlaub-zeitraum">${escapeHtml(fmtDatum(a.von))} – ${escapeHtml(fmtDatum(a.bis))}</span>
      ${a.grund ? `<span class="urlaub-grund muted">${escapeHtml(a.grund)}</span>` : ""}
      ${kannLoeschen ? `<button class="icon-btn" data-remove-abwesenheit="${escapeHtml(a.id)}" title="Entfernen">×</button>` : ""}
    </div>`;
  }).join("") || `<p class="muted">Noch keine Einträge.</p>`;

  const addRow = document.getElementById("urlaub-add-row");
  const spielerSelect = document.getElementById("uk-spieler");
  if (manage) {
    spielerSelect.innerHTML = spielerOptions(team);
    spielerSelect.disabled = false;
    addRow.classList.remove("hidden");
  } else if (myId) {
    const me = findSpieler(team, myId);
    spielerSelect.innerHTML = `<option value="${escapeHtml(myId)}">${escapeHtml(me ? me.name : "")}</option>`;
    spielerSelect.disabled = true;
    addRow.classList.remove("hidden");
  } else {
    addRow.classList.add("hidden");
  }
}
function openUrlaubModal() {
  const team = currentTeam();
  if (!team) return;
  renderUrlaubKrank();
  document.getElementById("uk-von").value = todayISO();
  document.getElementById("uk-bis").value = todayISO();
  document.getElementById("uk-grund").value = "";
  document.getElementById("urlaub-modal").classList.remove("hidden");
}
function closeUrlaubModal() { document.getElementById("urlaub-modal").classList.add("hidden"); }
function addAbwesenheit() {
  const team = currentTeam();
  if (!team) return;
  const manage = hasRecht(team, "urlaubkrank");
  const myId = myPlayerId(team);
  const spielerId = manage ? val("uk-spieler") : myId;
  if (!spielerId) return;
  const von = val("uk-von"), bis = val("uk-bis");
  if (!von || !bis) { alert("Bitte Zeitraum (von/bis) angeben."); return; }
  if (bis < von) { alert("„Bis“ darf nicht vor „Von“ liegen."); return; }
  // Id lokal erzeugen und mitschicken, damit der Server denselben Schlüssel nutzt --
  // sonst zeigt die Liste eine Id, die es serverseitig nicht gibt, und ein sofortiges
  // Löschen liefe ins Leere.
  const neueId = uuid();
  const grund = val("uk-grund").trim(), typ = val("uk-typ");
  team.abwesenheiten.push({ id: neueId, spielerId, von, bis, grund, typ });
  persistSelbst({ art: "urlaub-add", id: neueId, von, bis, grund, typ });
  renderUrlaubKrank();
  renderTermine();
  if (detailTerminId) renderDetail();
}
function removeAbwesenheit(id) {
  const team = currentTeam();
  if (!team) return;
  const a = team.abwesenheiten.find((x) => x.id === id);
  if (!a || !(hasRecht(team, "urlaubkrank") || a.spielerId === myPlayerId(team))) return;
  team.abwesenheiten = team.abwesenheiten.filter((x) => x.id !== id);
  persistSelbst({ art: "urlaub-del", abwesenheitId: id });
  renderUrlaubKrank();
  renderTermine();
  if (detailTerminId) renderDetail();
}

// ---------- Kader ----------
// ---------- Spieler-Registrierung (QR/Link, siehe registrieren.html) ----------
// Onboarding ohne Zettelwirtschaft: der Trainer öffnet im Training ein
// 15-Minuten-Fenster, die Spieler tragen sich selbst ein. Der Auth-Faktor ist,
// dass sie in der Kabine stehen -- deshalb sieht der Trainer die Neuzugänge live
// (regPollTimer) und merkt sofort, wenn sich jemand als ein anderer einträgt.
let regPollTimer = null;
let regCountdownTimer = null;
let regAblaufAt = 0;

function schliesseRegPanel() {
  document.getElementById("reg-panel").classList.add("hidden");
  if (regPollTimer) { clearInterval(regPollTimer); regPollTimer = null; }
  if (regCountdownTimer) { clearTimeout(regCountdownTimer); regCountdownTimer = null; }
  regAblaufAt = 0;
}

async function oeffneRegistrierung() {
  const team = currentTeam();
  if (!team) { alert("Bitte zuerst eine Mannschaft auswählen."); return; }
  if (!hasRecht(team, "kader")) return;

  const panel = document.getElementById("reg-panel");
  const inhalt = document.getElementById("reg-inhalt");
  panel.classList.remove("hidden");
  inhalt.innerHTML = `<p class="muted">Anmelde-Link wird erstellt…</p>`;

  let res;
  try {
    res = await gatewayRegOeffnen(team.id);
  } catch (e) {
    inhalt.innerHTML = `<p class="muted">Konnte nicht geöffnet werden: ${escapeHtml(e.message)}</p>`;
    return;
  }

  // Absolute URL aus der aktuellen Adresse ableiten, statt sie hart zu setzen:
  // funktioniert damit lokal (localhost:8780) genauso wie live auf GitHub Pages.
  const url = new URL("registrieren.html", location.href).href + "#" + encodeURIComponent(res.token);
  regAblaufAt = res.expiresAt || 0;

  inhalt.innerHTML = `
    <p style="margin:0 0 12px;">Lass die Spieler diesen Code mit der Handy-Kamera scannen — oder schick den Link in die Mannschaftsgruppe. Beides gilt <strong>${Math.round((res.ttlSeconds || 900) / 60)} Minuten</strong> und öffnet nur diesen Kader.</p>
    <div id="reg-qr" style="display:flex;justify-content:center;margin:4px 0 14px;"></div>
    <div class="toolbar" style="gap:8px;flex-wrap:wrap;">
      <button class="btn small" id="btn-reg-teilen">Link teilen</button>
      <button class="btn secondary small" id="btn-reg-kopieren">Link kopieren</button>
      <span class="muted" id="reg-countdown"></span>
    </div>
    <p class="muted" id="reg-status" style="margin-top:12px;"></p>
  `;

  // QR bewusst mit reichlich Modulgröße: der Trainer hält das Handy hoch, mehrere
  // Spieler scannen aus ~1-2 m Abstand. Version 10 (57x57) braucht dafür Fläche.
  try {
    QRCodeMini.zeichneQrCode(document.getElementById("reg-qr"), url, 6);
  } catch (e) {
    document.getElementById("reg-qr").innerHTML = `<span class="muted">QR-Code konnte nicht erzeugt werden — bitte den Link nutzen.</span>`;
  }

  document.getElementById("btn-reg-kopieren").addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(url);
      document.getElementById("btn-reg-kopieren").textContent = "Kopiert ✓";
    } catch (_) {
      // Clipboard-API braucht HTTPS/Nutzergeste und kann trotzdem scheitern --
      // dann den Link wenigstens sichtbar machen, statt nichts zu tun.
      prompt("Link kopieren:", url);
    }
  });
  const teilenBtn = document.getElementById("btn-reg-teilen");
  if (navigator.share) {
    teilenBtn.addEventListener("click", () => {
      navigator.share({ title: "Kadermanager-Anmeldung", text: `Melde dich beim Kadermanager an (${team.name}):`, url }).catch(() => {});
    });
  } else {
    // Web Share gibt es auf dem Desktop meist nicht -- dort ist Kopieren der Weg.
    teilenBtn.classList.add("hidden");
  }

  starteRegCountdown();
  starteRegPolling(team.id);
}

function starteRegCountdown() {
  const el = document.getElementById("reg-countdown");
  const tick = () => {
    if (!el.isConnected) return;
    const rest = regAblaufAt - Date.now();
    if (rest <= 0) {
      el.textContent = "Fenster abgelaufen";
      if (regPollTimer) { clearInterval(regPollTimer); regPollTimer = null; }
      return;
    }
    const min = Math.floor(rest / 60000);
    const sek = Math.floor((rest % 60000) / 1000);
    el.textContent = `Noch ${min}:${String(sek).padStart(2, "0")}`;
    regCountdownTimer = setTimeout(tick, 1000);
  };
  tick();
}

// Live-Rückmeldung für den Trainer: alle 5s neu laden und zeigen, wer seit dem
// Öffnen dazugekommen ist. Das ist die eigentliche Kontrolle des Verfahrens --
// ein falscher Name fällt hier sofort auf, solange alle noch im Raum stehen.
function starteRegPolling(teamId) {
  const vorher = new Set((currentTeam().kader || []).filter((s) => s.linkedUsername).map((s) => s.id));
  const statusEl = document.getElementById("reg-status");
  statusEl.textContent = "Wartet auf Anmeldungen…";
  if (regPollTimer) clearInterval(regPollTimer);
  regPollTimer = setInterval(async () => {
    if (!statusEl.isConnected) { clearInterval(regPollTimer); regPollTimer = null; return; }
    try {
      const data = await gatewayLoad();
      if (!data) return;
      const team = (data.teams || []).find((t) => t.id === teamId);
      if (!team) return;
      const neue = (team.kader || []).filter((s) => s.linkedUsername && !vorher.has(s.id));
      statusEl.textContent = neue.length
        ? `✓ Angemeldet: ${neue.map((s) => s.name).join(", ")}`
        : "Wartet auf Anmeldungen…";
      // Den lokalen Stand mitziehen, damit die Kaderliste im Hintergrund die
      // neuen Verknüpfungen zeigt und ein späteres persist() sie nicht
      // überschreibt (dav-save schickt appData komplett).
      appData = normalizeData(data);
      renderKader();
    } catch (_) { /* Polling ist best effort, Fehler nicht dem Trainer vorwerfen */ }
  }, 5000);
}

function renderKader() {
  const team = teamOr("no-team-kader", ["kader-claim-hint", "kader-list", "kader-empty"]);
  const listEl = document.getElementById("kader-list");
  const emptyEl = document.getElementById("kader-empty");
  const hintEl = document.getElementById("kader-claim-hint");
  const titleEl = document.getElementById("kader-title");
  if (!team) { listEl.innerHTML = ""; emptyEl.classList.add("hidden"); return; }
  titleEl.textContent = `Kader — ${team.name} (${team.kader.length})`;
  const myId = myPlayerId(team);
  const hintText = document.getElementById("kader-claim-text");
  if (myId) {
    const me = findSpieler(team, myId);
    hintText.textContent = `Du bist in dieser Mannschaft als „${me ? me.name : ""}“ verknüpft und kannst dich selbst zu Terminen an- und abmelden.`;
  } else {
    hintText.textContent = "Bist du in dieser Mannschaft im Kader? Klicke bei deinem Namen auf „Das bin ich“, um dich selbst an- und abmelden zu können.";
  }
  hintEl.classList.remove("hidden");
  const manage = hasRecht(team, "kader");
  emptyEl.classList.toggle("hidden", team.kader.length > 0);
  const sorted = team.kader.slice().sort((a, b) => a.name.localeCompare(b.name));
  listEl.innerHTML = sorted.map((s) => {
    const isSelf = s.id === myId;
    let badge;
    if (isSelf) badge = `<span class="link-badge self">Das bist du</span><button class="btn small secondary" data-unclaim="${escapeHtml(s.id)}">Verknüpfung lösen</button>`;
    else if (s.linkedUsername) badge = `<span class="link-badge linked">🔗 ${escapeHtml(s.linkedUsername)}</span>`;
    else badge = `<span class="link-badge free">nicht verknüpft</span>${myId ? "" : `<button class="btn small" data-claim="${escapeHtml(s.id)}">Das bin ich</button>`}`;
    const editBtn = manage ? `<button class="icon-btn edit" data-edit-spieler="${escapeHtml(s.id)}" title="Bearbeiten">✎</button>` : "";
    const rollenLabels = (s.rollen || []).map((r) => { const k = KADER_ROLLEN.find((x) => x.id === r); return k ? k.label : r; });
    return `<div class="kader-row">
      <div class="kader-left">
        <span class="kader-nummer" data-spieler-id="${escapeHtml(s.id)}"></span>
        <div>
          <div class="kader-name">${escapeHtml(s.name || "—")}</div>
          ${s.position ? `<div class="kader-pos">${escapeHtml(s.position)}</div>` : ""}
          ${rollenLabels.length ? `<div class="kader-rollen">${rollenLabels.map((l) => `<span class="rolle-chip">${escapeHtml(l)}</span>`).join("")}</div>` : ""}
          ${trainerProfileBadgeHtml(s.linkedUsername)}
        </div>
      </div>
      <div class="kader-right">${badge}${editBtn}</div>
    </div>`;
  }).join("");
  listEl.querySelectorAll(".kader-nummer[data-spieler-id]").forEach((el) => {
    const s = findSpieler(team, el.dataset.spielerId);
    if (s) applyAvatarVisual(el, s);
  });
}
function claimSpieler(id) {
  const team = currentTeam();
  const u = myUsername();
  if (!team || !u) return;
  const target = findSpieler(team, id);
  if (!target) return;
  if (target.linkedUsername) { alert("Dieser Spieler ist bereits mit einem Konto verknüpft."); return; }
  // pro Team nur einen eigenen Spieler: bestehende eigene Verknüpfung lösen
  team.kader.forEach((s) => { if (s.linkedUsername && s.linkedUsername.toLowerCase() === u.toLowerCase()) s.linkedUsername = ""; });
  target.linkedUsername = u;
  persistSelbst({ art: "claim", spielerId: id });
  renderKader();
  renderTermine();
}
function unclaimSpieler(id) {
  const team = currentTeam();
  if (!team) return;
  const target = findSpieler(team, id);
  if (!target) return;
  target.linkedUsername = "";
  persistSelbst({ art: "unclaim" });
  renderKader();
  renderTermine();
}
function updateFotoPreview() {
  const preview = document.getElementById("pf-foto-preview");
  const removeBtn = document.getElementById("btn-remove-foto");
  preview.style.backgroundImage = "";
  preview.textContent = "?";
  removeBtn.classList.add("hidden");
  if (!editingFotoId) return;
  removeBtn.classList.remove("hidden");
  const cached = fotoUrlCache.get(editingFotoId);
  if (cached) { preview.style.backgroundImage = `url("${cached}")`; preview.textContent = ""; return; }
  loadFoto(editingFotoId).then((url) => { if (url && editingFotoId) updateFotoPreview(); });
}
async function onFotoFileChange(e) {
  const file = e.target.files && e.target.files[0];
  e.target.value = "";
  if (!file) return;
  const statusEl = document.getElementById("pf-foto-status");
  fotoUploadBusy = true;
  statusEl.textContent = "Wird hochgeladen…";
  try {
    const resized = await resizeImageFile(file, FOTO_MAX_DIMENSION);
    const meta = await gatewayUploadFile(resized);
    fotoUrlCache.set(meta.id, URL.createObjectURL(resized));
    editingFotoId = meta.id;
    statusEl.textContent = "";
    updateFotoPreview();
  } catch (err) {
    statusEl.textContent = "";
    alert("Foto-Upload fehlgeschlagen: " + err.message);
  } finally {
    fotoUploadBusy = false;
  }
}
function removeFotoPending() {
  editingFotoId = "";
  updateFotoPreview();
}
// Nur in Gruppen und nur beim Anlegen: die Spieler stehen dort bereits in ihrer
// Mannschaft, und ihr Konto-Nutzername (automatisch erzeugt, z. B. "leon.mueller2")
// ist dem Trainer nicht bekannt — abtippen wäre Rateraten.
function renderUebernehmenAuswahl(team, istNeu) {
  const wrap = document.getElementById("pf-uebernehmen-wrap");
  const sel = document.getElementById("pf-uebernehmen");
  const kandidaten = [];
  if (istGruppe(team) && istNeu) {
    const schonDrin = new Set(team.kader.map((s) => (s.linkedUsername || "").toLowerCase()).filter(Boolean));
    appData.teams.filter((t) => !istGruppe(t)).forEach((t) => {
      t.kader.forEach((s) => {
        if (s.linkedUsername && schonDrin.has(s.linkedUsername.toLowerCase())) return;
        kandidaten.push({ teamId: t.id, spielerId: s.id, label: `${s.name} — ${t.name}` });
      });
    });
  }
  wrap.classList.toggle("hidden", kandidaten.length === 0);
  sel.innerHTML = `<option value="">— neuen Spieler von Hand anlegen —</option>` + kandidaten
    .sort((a, b) => a.label.localeCompare(b.label))
    .map((k) => `<option value="${escapeHtml(k.teamId)}|${escapeHtml(k.spielerId)}">${escapeHtml(k.label)}</option>`).join("");
}
function uebernehmeSpieler(wert) {
  if (!wert) return;
  const [teamId, spielerId] = wert.split("|");
  const quelle = appData.teams.find((t) => t.id === teamId);
  const s = quelle ? findSpieler(quelle, spielerId) : null;
  if (!s) return;
  document.getElementById("pf-name").value = s.name || "";
  document.getElementById("pf-position").value = s.position || "";
  document.getElementById("pf-nummer").value = s.nummer || "";
  document.getElementById("pf-linked").value = s.linkedUsername || "";
  // fotoId bewusst NICHT: zwei Kader-Einträge mit derselben Datei-Id wären eine Falle,
  // weil saveSpieler()/deleteSpieler() sie per gatewayDeleteFile() wegräumen und der
  // jeweils andere Eintrag sein Bild verlöre.
}
function openSpielerModal(id) {
  const team = currentTeam();
  if (!team || !hasRecht(team, "kader")) return;
  const s = id ? findSpieler(team, id) : null;
  renderUebernehmenAuswahl(team, !s);
  editingSpielerId = s ? s.id : null;
  editingFotoId = s ? s.fotoId : "";
  document.getElementById("pf-foto-status").textContent = "";
  updateFotoPreview();
  document.getElementById("spieler-modal-title").textContent = s ? "Spieler bearbeiten" : "Neuer Spieler";
  document.getElementById("pf-name").value = s ? s.name : "";
  document.getElementById("pf-position").value = s ? s.position : "";
  document.getElementById("pf-nummer").value = s ? s.nummer : "";
  document.getElementById("pf-linked").value = s ? s.linkedUsername : "";
  const rollen = s ? s.rollen : [];
  document.getElementById("pf-rollen").innerHTML = KADER_ROLLEN.map((r) =>
    `<label class="rollen-check"><input type="checkbox" value="${r.id}" ${rollen.includes(r.id) ? "checked" : ""} /> ${escapeHtml(r.label)}</label>`).join("");
  document.getElementById("btn-delete-spieler").classList.toggle("hidden", !s);
  document.getElementById("spieler-modal").classList.remove("hidden");
  document.getElementById("pf-name").focus();
}
function closeSpielerModal() { document.getElementById("spieler-modal").classList.add("hidden"); editingSpielerId = null; editingFotoId = ""; }
function saveSpieler() {
  const team = currentTeam();
  if (!team) return;
  if (fotoUploadBusy) { alert("Foto wird noch hochgeladen — bitte kurz warten."); return; }
  const name = val("pf-name").trim();
  if (!name) { alert("Bitte einen Namen eingeben."); return; }
  let s = editingSpielerId ? findSpieler(team, editingSpielerId) : null;
  if (!s) { s = { id: uuid() }; team.kader.push(s); }
  s.name = name;
  s.position = val("pf-position").trim();
  s.nummer = val("pf-nummer").trim();
  s.linkedUsername = val("pf-linked").trim();
  s.rollen = Array.from(document.querySelectorAll("#pf-rollen input:checked")).map((el) => el.value);
  const oldFotoId = s.fotoId || "";
  s.fotoId = editingFotoId || "";
  if (oldFotoId && oldFotoId !== s.fotoId) gatewayDeleteFile(oldFotoId);
  persist();
  renderKader();
  renderTermine();
  renderKaderRollenUebersicht();
  closeSpielerModal();
}
function deleteSpieler() {
  const team = currentTeam();
  if (!team || !editingSpielerId) return;
  if (!confirm("Diesen Spieler wirklich aus dem Kader entfernen? Seine Rückmeldungen und Buchungen werden ebenfalls entfernt.")) return;
  const id = editingSpielerId;
  const spieler = findSpieler(team, id);
  const fotoId = spieler ? spieler.fotoId : "";
  team.kader = team.kader.filter((s) => s.id !== id);
  team.termine.forEach((t) => { delete t.teilnahme[id]; });
  team.umfragen.forEach((u) => { delete u.stimmen[id]; });
  team.kasse.buchungen.forEach((b) => { if (b.spielerId === id) b.spielerId = null; });
  persist();
  if (fotoId) gatewayDeleteFile(fotoId);
  renderKader();
  renderTermine();
  renderKaderRollenUebersicht();
  closeSpielerModal();
}

// ---------- Statistik ----------
function fillStatistikJahr() {
  const team = currentTeam();
  const el = document.getElementById("statistik-jahr");
  const jahre = new Set();
  if (team) team.termine.forEach((t) => { if (t.datum && t.datum < todayISO()) jahre.add(t.datum.slice(0, 4)); });
  const opts = ["alle"].concat(Array.from(jahre).sort().reverse());
  if (!opts.includes(statistikJahr)) statistikJahr = "alle";
  el.innerHTML = opts.map((j) => `<option value="${j}">${j === "alle" ? "Alle Jahre" : j}</option>`).join("");
  el.value = statistikJahr;
}
function renderStatistik() {
  const team = teamOr("no-team-statistik", ["statistik-wrap", "statistik-empty"]);
  fillStatistikJahr();
  const wrap = document.getElementById("statistik-wrap");
  const emptyEl = document.getElementById("statistik-empty");
  const countEl = document.getElementById("statistik-count");
  if (!team) { wrap.innerHTML = ""; emptyEl.classList.add("hidden"); countEl.textContent = ""; return; }
  const today = todayISO();
  const past = team.termine.filter((t) => t.datum && t.datum < today && (statistikJahr === "alle" || t.datum.slice(0, 4) === statistikJahr));
  emptyEl.classList.toggle("hidden", past.length > 0);
  if (!past.length) { wrap.innerHTML = ""; countEl.textContent = ""; return; }
  const nTraining = past.filter((t) => t.typ === "training").length;
  const nSpiel = past.filter((t) => t.typ === "spiel").length;
  countEl.textContent = `${past.length} Termine · ${nTraining} Training · ${nSpiel} Spiel`;

  function statFor(spielerId, typ) {
    const rel = past.filter((t) => t.typ === typ);
    let zu = 0, gemeldet = 0;
    rel.forEach((t) => {
      const e = t.teilnahme[spielerId];
      if (!e) return;
      gemeldet++;
      if (e.status === "zu") zu++;
    });
    return { zu, gemeldet, gesamt: rel.length };
  }
  // ⚠️ Die Quote zaehlt bewusst nur Termine MIT Rueckmeldung (siehe CLAUDE.md) --
  // daran wird hier nichts geaendert. Der Haken daran ist die Lesart: wer gar
  // nicht antwortet, taucht im Nenner nicht auf und steht mit 100 % da, waehrend
  // ueber der Tabelle die Gesamtzahl der Termine steht. Zwei Zusagen aus zwei
  // Rueckmeldungen sahen damit besser aus als neun Zusagen aus zehn.
  //
  // Deshalb wird die Zahl der offenen Termine danebengeschrieben, statt die
  // Rechenart umzudrehen: die Quote bleibt die vereinbarte, aber sie steht nicht
  // mehr allein da. Genau dafuer war "gesamt" gedacht -- es wurde berechnet und
  // bis hierher nie benutzt.
  function quote(s) { return s.gemeldet ? Math.round((s.zu / s.gemeldet) * 100) + " %" : "—"; }
  function zelle(s) {
    const offen = s.gesamt - s.gemeldet;
    return `${s.zu} / ${s.gemeldet}` +
      (offen > 0 ? ` <span class="muted">+${offen} offen</span>` : "");
  }
  const rows = team.kader.slice().sort((a, b) => a.name.localeCompare(b.name)).map((s) => {
    const tr = statFor(s.id, "training");
    const sp = statFor(s.id, "spiel");
    return `<tr>
      <td class="strong">${escapeHtml(s.name || "—")}</td>
      <td class="num">${zelle(tr)}</td>
      <td class="num">${quote(tr)}</td>
      <td class="num">${zelle(sp)}</td>
      <td class="num">${quote(sp)}</td>
    </tr>`;
  }).join("");
  wrap.innerHTML = `<table class="data-table">
    <thead><tr><th>Spieler</th><th class="num">🏃 Zusagen</th><th class="num">🏃 Quote</th><th class="num">⚽ Zusagen</th><th class="num">⚽ Quote</th></tr></thead>
    <tbody>${rows || `<tr><td colspan="5" class="muted">Noch keine Spieler im Kader.</td></tr>`}</tbody>
  </table>
  <p class="muted" style="margin:8px 0 0;">„Zusagen“ heißt Zusagen von den Terminen mit Rückmeldung; die Quote rechnet genauso. „offen“ sind Termine, zu denen nichts kam — sie zählen in keine der beiden Zahlen.</p>`;
}

// ---------- Umfragen ----------
function renderUmfragen() {
  const team = teamOr("no-team-umfragen", ["umfragen-list", "umfragen-empty"]);
  const listEl = document.getElementById("umfragen-list");
  const emptyEl = document.getElementById("umfragen-empty");
  if (!team) { listEl.innerHTML = ""; emptyEl.classList.add("hidden"); return; }
  const manage = hasRecht(team, "team");
  const myId = myPlayerId(team);
  const umfragen = team.umfragen.slice().sort((a, b) => (b.erstelltAm || "").localeCompare(a.erstelltAm || ""));
  emptyEl.classList.toggle("hidden", umfragen.length > 0);
  listEl.innerHTML = umfragen.map((u) => {
    const counts = {};
    u.optionen.forEach((o) => { counts[o.id] = 0; });
    let voters = 0;
    Object.keys(u.stimmen).forEach((sid) => { if (u.stimmen[sid].length) voters++; u.stimmen[sid].forEach((oid) => { if (counts[oid] != null) counts[oid]++; }); });
    const maxCount = Math.max(1, ...Object.values(counts));
    const myVotes = myId && u.stimmen[myId] ? u.stimmen[myId] : [];
    const canVote = u.offen && myId;
    const options = u.optionen.map((o) => {
      const cnt = counts[o.id];
      const pct = Math.round((cnt / maxCount) * 100);
      const chosen = myVotes.includes(o.id);
      return `<div class="poll-option${canVote ? " votable" : ""}${chosen ? " chosen" : ""}" ${canVote ? `data-vote-umfrage="${escapeHtml(u.id)}" data-option="${escapeHtml(o.id)}"` : ""}>
        <div class="poll-bar-track">
          <div class="poll-bar-fill" style="width:${pct}%"></div>
          <div class="poll-bar-label"><span>${chosen ? "✓ " : ""}${escapeHtml(o.text)}</span><span class="poll-bar-count">${cnt}</span></div>
        </div>
      </div>`;
    }).join("");
    const adminBtns = manage ? `<div class="btn-row" style="justify-content:flex-start;margin-top:12px;">
      <button class="btn small secondary" data-toggle-umfrage="${escapeHtml(u.id)}">${u.offen ? "Abstimmung schließen" : "Wieder öffnen"}</button>
      <button class="btn small secondary" data-edit-umfrage="${escapeHtml(u.id)}">Bearbeiten</button>
    </div>` : "";
    let hint;
    if (!u.offen) hint = "Diese Umfrage ist geschlossen.";
    else if (!myId) hint = "Verknüpfe dich im Kader-Tab mit deinem Spieler, um abzustimmen.";
    else hint = u.mehrfach ? "Mehrfachauswahl — tippe die Optionen an." : "Tippe eine Option an, um abzustimmen.";
    return `<div class="umfrage-card">
      <div class="umfrage-frage">${escapeHtml(u.frage)}${u.offen ? "" : '<span class="umfrage-closed-tag">geschlossen</span>'}</div>
      <div class="umfrage-meta">${voters} von ${team.kader.length} Kaderspielern haben abgestimmt${u.mehrfach ? " · Mehrfachauswahl" : ""}</div>
      ${options}
      <div class="umfrage-open-hint">${escapeHtml(hint)}</div>
      ${adminBtns}
    </div>`;
  }).join("");
}
function vote(umfrageId, optionId) {
  const team = currentTeam();
  if (!team) return;
  const u = team.umfragen.find((x) => x.id === umfrageId);
  if (!u || !u.offen) return;
  const myId = myPlayerId(team);
  if (!myId) return;
  const cur = Array.isArray(u.stimmen[myId]) ? u.stimmen[myId].slice() : [];
  if (u.mehrfach) {
    const i = cur.indexOf(optionId);
    if (i >= 0) cur.splice(i, 1); else cur.push(optionId);
  } else {
    if (cur.length === 1 && cur[0] === optionId) cur.length = 0; // abwählen
    else { cur.length = 0; cur.push(optionId); }
  }
  if (cur.length) u.stimmen[myId] = cur; else delete u.stimmen[myId];
  persistSelbst({ art: "umfrage", umfrageId, optionIds: cur });
  renderUmfragen();
}
function openUmfrageModal(id) {
  const team = currentTeam();
  if (!team || !hasRecht(team, "team")) return;
  const u = id ? team.umfragen.find((x) => x.id === id) : null;
  editingUmfrageId = u ? u.id : null;
  document.getElementById("umfrage-modal-title").textContent = u ? "Umfrage bearbeiten" : "Neue Umfrage";
  document.getElementById("uf-frage").value = u ? u.frage : "";
  document.getElementById("uf-mehrfach").checked = u ? u.mehrfach : false;
  const wrap = document.getElementById("uf-optionen");
  wrap.innerHTML = "";
  // ⚠️ Die Id der Option muss mit in die Zeile. Sie ist die einzige stabile
  // Klammer zwischen der alten und der neuen Fassung — siehe saveUmfrage().
  const opts = u && u.optionen.length ? u.optionen.map((o) => ({ text: o.text, id: o.id })) : [{ text: "" }, { text: "" }];
  opts.forEach((o) => addOptionRow(o.text, o.id));
  document.getElementById("btn-delete-umfrage").classList.toggle("hidden", !u);
  document.getElementById("umfrage-modal").classList.remove("hidden");
  document.getElementById("uf-frage").focus();
}
// Eine Zeile im Optionen-Kasten. `optId` ist die Id einer BESTEHENDEN Option;
// eine frisch hinzugefügte Zeile bekommt keine und damit beim Speichern eine neue.
function addOptionRow(text, optId) {
  const wrap = document.getElementById("uf-optionen");
  const row = document.createElement("div");
  row.className = "uf-option-row";
  if (optId) row.dataset.optId = optId;
  row.innerHTML = `<input type="text" class="uf-opt-input" placeholder="Antwortoption" /><button type="button" class="icon-btn uf-opt-remove" title="Entfernen">×</button>`;
  row.querySelector("input").value = text || "";
  wrap.appendChild(row);
}
function closeUmfrageModal() { document.getElementById("umfrage-modal").classList.add("hidden"); editingUmfrageId = null; }
function saveUmfrage() {
  const team = currentTeam();
  if (!team) return;
  const frage = val("uf-frage").trim();
  if (!frage) { alert("Bitte eine Frage eingeben."); return; }
  // Gelesen wird die ZEILE, nicht nur das Eingabefeld: an ihr hängt die Id.
  const zeilen = Array.from(document.querySelectorAll("#uf-optionen .uf-option-row"))
    .map((row) => {
      const feld = row.querySelector(".uf-opt-input");
      return { text: feld ? feld.value.trim() : "", id: row.dataset.optId || "" };
    })
    .filter((z) => z.text);
  if (zeilen.length < 2) { alert("Bitte mindestens zwei Antwortoptionen angeben."); return; }
  let u = editingUmfrageId ? team.umfragen.find((x) => x.id === editingUmfrageId) : null;

  // ⚠️ Zugeordnet wird über die ID der Zeile, NIEMALS über den Text.
  // Über den Text lief es bis zum 05.09.2026: wer eine Option nur korrigierte
  // („10 Uhr" → „10:00 Uhr", ein Leerzeichen zu viel), bekam eine neue Id — und
  // die Filterzeile weiter unten warf jede Stimme weg, die auf die alte zeigte.
  // Lautlos, ohne Rückfrage, und die Umfrage zeigte danach ein falsches
  // Ergebnis, das niemand mehr rekonstruieren konnte ([[f-name-als-key]]).
  // Nebenbei behoben: zwei Optionen mit gleichem Text teilten sich eine Id.
  const alt = u && u.optionen ? u.optionen.slice() : [];
  const neu = zeilen.map((z) => {
    const match = z.id ? alt.find((o) => o.id === z.id) : null;
    return match ? { id: match.id, text: z.text } : { id: uuid(), text: z.text };
  });
  const neuIds = neu.map((o) => o.id);

  // Eine wirklich ENTFERNTE Option nimmt ihre Stimmen mit — das ist richtig so,
  // muss aber vorher dastehen. Ohne die Rückfrage verschwinden abgegebene
  // Stimmen bei einem Klick auf „Speichern", und niemand erfährt davon.
  if (u) {
    let verlorene = 0;
    Object.values(u.stimmen || {}).forEach((arr) => {
      (arr || []).forEach((oid) => { if (!neuIds.includes(oid)) verlorene++; });
    });
    if (verlorene && !confirm(
      (verlorene === 1 ? "1 bereits abgegebene Stimme geht" : verlorene + " bereits abgegebene Stimmen gehen") +
      " verloren, weil die zugehörige Antwortoption entfernt wird.\n\nTrotzdem speichern?")) return;
  }

  if (!u) { u = { id: uuid(), stimmen: {}, erstelltAm: new Date().toISOString(), offen: true }; team.umfragen.push(u); }
  u.frage = frage;
  u.mehrfach = checked("uf-mehrfach");
  u.optionen = neu;
  Object.keys(u.stimmen).forEach((sid) => {
    u.stimmen[sid] = u.stimmen[sid].filter((oid) => neuIds.includes(oid));
    if (!u.stimmen[sid].length) delete u.stimmen[sid];
  });
  persist();
  renderUmfragen();
  closeUmfrageModal();
}
function deleteUmfrage() {
  const team = currentTeam();
  if (!team || !editingUmfrageId) return;
  if (!confirm("Diese Umfrage wirklich löschen?")) return;
  team.umfragen = team.umfragen.filter((x) => x.id !== editingUmfrageId);
  persist();
  renderUmfragen();
  closeUmfrageModal();
}
function toggleUmfrageOffen(id) {
  const team = currentTeam();
  if (!team || !hasRecht(team, "team")) return;
  const u = team.umfragen.find((x) => x.id === id);
  if (!u) return;
  u.offen = !u.offen;
  persist();
  renderUmfragen();
}

// ---------- Kasse ----------
function renderKasse() {
  const team = teamOr("no-team-kasse", ["kasse-summary", "buchungen-wrap", "buchungen-empty", "strafenkatalog-list", "kasse-salden-wrap"]);
  if (!team) {
    document.getElementById("kasse-summary").innerHTML = "";
    document.getElementById("buchungen-wrap").innerHTML = "";
    document.getElementById("strafenkatalog-list").innerHTML = "";
    document.getElementById("kasse-salden-wrap").innerHTML = "";
    return;
  }
  const manage = hasRecht(team, "kasse");
  const alleBuchungen = team.kasse.buchungen;
  const aktiv = (b) => !b.storniert;
  let bezahltEin = 0, bezahltAus = 0, offenEin = 0;
  alleBuchungen.filter(aktiv).forEach((b) => {
    if (b.richtung === "ein") { if (b.bezahlt) bezahltEin += b.betrag; else offenEin += b.betrag; }
    else if (b.bezahlt) bezahltAus += b.betrag;
  });
  const stand = bezahltEin - bezahltAus;
  // Spieler bekommen vom Server nur ihre EIGENEN Buchungen (kmSpielerSicht im
  // admin-worker). Ein daraus berechneter "Kassenstand" wäre schlicht falsch — er
  // sähe aus wie der Stand der Mannschaftskasse, wäre aber die eigene Bilanz.
  // Deshalb für sie andere Beschriftungen statt einer irreführenden Zahl.
  document.getElementById("kasse-summary").innerHTML = nurSelbstbedienung()
    ? `<div class="summary-card warn"><div class="sc-label">Dein offener Betrag</div><div class="sc-value">${escapeHtml(fmtEuro(offenEin))}</div><div class="sc-sub">noch nicht bezahlt</div></div>
       <div class="summary-card"><div class="sc-label">Deine Buchungen</div><div class="sc-value">${alleBuchungen.filter(aktiv).length}</div><div class="sc-sub">nur deine eigenen</div></div>`
    : `<div class="summary-card strong"><div class="sc-label">Kassenstand</div><div class="sc-value">${escapeHtml(fmtEuro(stand))}</div><div class="sc-sub">bezahlte Ein- minus Ausgaben</div></div>
       <div class="summary-card warn"><div class="sc-label">Offene Beträge</div><div class="sc-value">${escapeHtml(fmtEuro(offenEin))}</div><div class="sc-sub">noch nicht bezahlt</div></div>
       <div class="summary-card"><div class="sc-label">Buchungen</div><div class="sc-value">${alleBuchungen.filter(aktiv).length}</div></div>`;

  // Filter (Kategorie + Stornos-Sichtbarkeit)
  document.querySelectorAll("#kasse-kategorie-filter button").forEach((b) => b.classList.toggle("active", b.dataset.kategorie === kasseKategorieFilter));
  document.getElementById("kasse-stornos-toggle").checked = kasseZeigeStornos;

  // Buchungen-Tabelle
  const spielerName = (id) => { const s = id ? findSpieler(team, id) : null; return s ? s.name : "Mannschaft"; };
  const kategorieLabels = { beitrag: "Beitrag", strafe: "Strafe", sonstiges: "Sonstiges" };
  const gefiltert = alleBuchungen
    .filter((b) => kasseZeigeStornos || !b.storniert)
    .filter((b) => kasseKategorieFilter === "alle" || b.kategorie === kasseKategorieFilter)
    .sort((a, b) => (b.datum || "").localeCompare(a.datum || ""));
  const buEmpty = document.getElementById("buchungen-empty");
  buEmpty.classList.toggle("hidden", gefiltert.length > 0);
  const buRows = gefiltert.map((b) => {
    const vorz = b.richtung === "ein" ? "+" : "−";
    const farbe = b.richtung === "ein" ? "var(--green)" : "var(--red)";
    const bezahltCell = manage
      ? `<button class="btn small ${b.bezahlt ? "success" : "secondary"}" data-toggle-bezahlt="${escapeHtml(b.id)}" ${b.storniert ? "disabled" : ""}>${b.bezahlt ? "bezahlt" : "offen"}</button>`
      : (b.bezahlt ? "bezahlt" : "offen");
    const editCell = manage ? `<td><button class="icon-btn edit" data-edit-buchung="${escapeHtml(b.id)}" title="Bearbeiten">✎</button></td>` : "";
    return `<tr${b.storniert ? ' class="storniert"' : ""}>
      <td>${escapeHtml(fmtDatum(b.datum))}</td>
      <td>${escapeHtml(spielerName(b.spielerId))}</td>
      <td>${escapeHtml(b.bezeichnung)}${b.storniert ? ' <span class="storno-tag">storniert</span>' : ""}</td>
      <td><span class="kategorie-tag">${kategorieLabels[b.kategorie] || "Sonstiges"}</span></td>
      <td class="num" style="color:${farbe};font-weight:700;">${vorz}${escapeHtml(fmtEuro(b.betrag))}</td>
      <td>${bezahltCell}</td>
      ${editCell}
    </tr>`;
  }).join("");
  document.getElementById("buchungen-wrap").innerHTML = gefiltert.length
    ? `<table class="data-table"><thead><tr><th>Datum</th><th>Spieler</th><th>Bezeichnung</th><th>Kategorie</th><th class="num">Betrag</th><th>Status</th>${manage ? "<th></th>" : ""}</tr></thead><tbody>${buRows}</tbody></table>`
    : "";

  // Strafenkatalog
  document.getElementById("strafenkatalog-list").innerHTML = team.kasse.strafenkatalog.map((s, i) => `
    <div class="param-row">
      <input class="pg-label" data-strafe-idx="${i}" value="${escapeHtml(s.bezeichnung)}" placeholder="Bezeichnung" ${manage ? "" : "disabled"} />
      <input class="pg-betrag" type="number" min="0" step="0.01" data-strafe-betrag-idx="${i}" value="${escapeHtml(String(s.betrag))}" ${manage ? "" : "disabled"} />
      ${manage ? `<button class="icon-btn" data-remove-strafe="${i}" title="Entfernen">×</button>` : ""}
    </div>`).join("") || `<p class="muted">Noch keine Einträge im Strafenkatalog.</p>`;

  // Offene Salden je Spieler (Stornos zählen nicht mit)
  const salden = {};
  alleBuchungen.filter(aktiv).forEach((b) => { if (b.richtung === "ein" && !b.bezahlt && b.spielerId) salden[b.spielerId] = (salden[b.spielerId] || 0) + b.betrag; });
  const saldenRows = Object.keys(salden).map((sid) => ({ name: spielerName(sid), betrag: salden[sid] }))
    .sort((a, b) => b.betrag - a.betrag)
    .map((r) => `<tr><td class="strong">${escapeHtml(r.name)}</td><td class="num" style="color:var(--red);font-weight:700;">${escapeHtml(fmtEuro(r.betrag))}</td></tr>`).join("");
  document.getElementById("kasse-salden-wrap").innerHTML = saldenRows
    ? `<table class="data-table"><thead><tr><th>Spieler</th><th class="num">Offen</th></tr></thead><tbody>${saldenRows}</tbody></table>`
    : `<p class="muted">Aktuell keine offenen Beträge.</p>`;
}
function openBuchungModal(id) {
  const team = currentTeam();
  if (!team || !hasRecht(team, "kasse")) return;
  const b = id ? team.kasse.buchungen.find((x) => x.id === id) : null;
  editingBuchungId = b ? b.id : null;
  document.getElementById("buchung-modal-title").textContent = b ? "Buchung bearbeiten" : "Neue Buchung";
  document.getElementById("bf-vorlage").innerHTML = `<option value="">— frei —</option>` +
    team.kasse.strafenkatalog.map((s) => `<option value="${escapeHtml(s.id)}">${escapeHtml(s.bezeichnung)} (${escapeHtml(fmtEuro(s.betrag))})</option>`).join("");
  document.getElementById("bf-vorlage").value = "";
  document.getElementById("bf-spieler").innerHTML = `<option value="">— Mannschaft allgemein —</option>` +
    team.kader.slice().sort((a, b2) => a.name.localeCompare(b2.name)).map((s) => `<option value="${escapeHtml(s.id)}">${escapeHtml(s.name)}</option>`).join("");
  document.getElementById("bf-spieler").value = b && b.spielerId ? b.spielerId : "";
  document.getElementById("bf-richtung").value = b ? b.richtung : "ein";
  document.getElementById("bf-kategorie").value = b ? b.kategorie : "sonstiges";
  document.getElementById("bf-betrag").value = b ? String(b.betrag) : "";
  document.getElementById("bf-datum").value = b && b.datum ? b.datum : todayISO();
  document.getElementById("bf-bezeichnung").value = b ? b.bezeichnung : "";
  document.getElementById("bf-bezahlt").checked = b ? b.bezahlt : false;
  document.getElementById("btn-delete-buchung").classList.toggle("hidden", !b);
  document.getElementById("btn-delete-buchung").textContent = b && b.storniert ? "Reaktivieren" : "Stornieren";
  document.getElementById("buchung-modal").classList.remove("hidden");
}
function applyVorlage() {
  const team = currentTeam();
  if (!team) return;
  const s = team.kasse.strafenkatalog.find((x) => x.id === val("bf-vorlage"));
  if (!s) return;
  document.getElementById("bf-bezeichnung").value = s.bezeichnung;
  document.getElementById("bf-betrag").value = String(s.betrag);
  document.getElementById("bf-richtung").value = "ein";
  document.getElementById("bf-kategorie").value = "strafe";
}
function closeBuchungModal() { document.getElementById("buchung-modal").classList.add("hidden"); editingBuchungId = null; }
function saveBuchung() {
  const team = currentTeam();
  if (!team) return;
  const betrag = parseBetrag(val("bf-betrag"));
  const bezeichnung = val("bf-bezeichnung").trim();
  if (isNaN(betrag) || betrag < 0) { alert("Bitte einen gültigen Betrag angeben."); return; }
  if (!bezeichnung) { alert("Bitte eine Bezeichnung angeben."); return; }
  let b = editingBuchungId ? team.kasse.buchungen.find((x) => x.id === editingBuchungId) : null;
  if (!b) { b = { id: uuid(), storniert: false, storniertAm: "" }; team.kasse.buchungen.push(b); }
  b.spielerId = val("bf-spieler") || null;
  b.richtung = val("bf-richtung") === "aus" ? "aus" : "ein";
  b.kategorie = val("bf-kategorie");
  b.betrag = Math.abs(betrag);
  b.datum = val("bf-datum");
  b.bezeichnung = bezeichnung;
  b.bezahlt = checked("bf-bezahlt");
  persist();
  renderKasse();
  closeBuchungModal();
}
// Buchungen werden storniert statt gelöscht (Audit-Spur, zählen dann nicht mehr
// zum Kassenstand) — Strafenkatalog-Vorlagen bleiben davon unberührt (Hard-Delete
// über data-remove-strafe, das sind Vorlagen, keine Transaktionen).
function toggleStorno() {
  const team = currentTeam();
  if (!team || !editingBuchungId || !hasRecht(team, "kasse")) return;
  const b = team.kasse.buchungen.find((x) => x.id === editingBuchungId);
  if (!b) return;
  const frage = b.storniert ? "Diese Buchung wieder aktivieren?" : "Diese Buchung stornieren? Sie bleibt zur Nachvollziehbarkeit erhalten, zählt aber nicht mehr zum Kassenstand.";
  if (!confirm(frage)) return;
  b.storniert = !b.storniert;
  b.storniertAm = b.storniert ? new Date().toISOString() : "";
  persist();
  renderKasse();
  closeBuchungModal();
}
function toggleBezahlt(id) {
  const team = currentTeam();
  if (!team || !hasRecht(team, "kasse")) return;
  const b = team.kasse.buchungen.find((x) => x.id === id);
  if (!b) return;
  b.bezahlt = !b.bezahlt;
  persist();
  renderKasse();
}

// ---------- Einstellungen: Mannschaften ----------
function renderTeamAdmin() {
  const manage = hasRecht(currentTeam(), "team");
  const list = document.getElementById("team-admin-list");
  const empty = document.getElementById("team-admin-empty");
  list.innerHTML = appData.teams.map((t) => `
    <div class="team-admin-row">
      <div class="team-admin-left"><span class="team-dot" style="background:${/^#[0-9a-fA-F]{6}$/.test(t.farbe) ? t.farbe : "#1a56a0"}"></span>
        <div><div class="kader-name">${escapeHtml(t.name)}${istGruppe(t) ? ` <span class="kategorie-tag">Gruppe</span>` : ""}</div><div class="kader-pos">${t.kader.length} Spieler · ${t.termine.length} Termine</div></div>
      </div>
      ${manage ? `<button class="icon-btn edit" data-edit-team="${escapeHtml(t.id)}" title="Bearbeiten">✎</button>` : ""}
    </div>`).join("");
  empty.classList.toggle("hidden", appData.teams.length > 0 || !manage);
}
function setTeamModalTyp(typ) {
  const gruppe = typ === "gruppe";
  document.querySelectorAll("#tf-typ button").forEach((b) => b.classList.toggle("active", (b.dataset.typ === "gruppe") === gruppe));
  const nameFeld = document.getElementById("tf-name");
  nameFeld.placeholder = gruppe ? "z. B. Torwartgruppe" : "z. B. B1";
  // ⚠️ Die Vereinsmannschaften werden NUR bei einer Mannschaft vorgeschlagen.
  // Eine Gruppe ist mannschaftsübergreifend (Torwartgruppe, Athletikgruppe) —
  // dort wäre „B1" als Vorschlag genau der falsche Hinweis.
  if (gruppe) nameFeld.removeAttribute("list");
  else nameFeld.setAttribute("list", "vereins-mannschaften");
  document.getElementById("tf-typ-hinweis").textContent = gruppe
    ? "Mannschaftsübergreifend: die Spieler stehen zusätzlich in ihrer eigenen Mannschaft. Eigene Termine und Auswertung, aber keine Kasse."
    : "";
  const titel = document.getElementById("team-modal-title");
  titel.textContent = editingTeamId
    ? (gruppe ? "Gruppe bearbeiten" : "Mannschaft bearbeiten")
    : (gruppe ? "Neue Gruppe" : "Neue Mannschaft");
}
function teamModalTyp() {
  const aktiv = document.querySelector("#tf-typ button.active");
  return aktiv && aktiv.dataset.typ === "gruppe" ? "gruppe" : "mannschaft";
}
function openTeamModal(id) {
  if (!hasRecht(currentTeam(), "team")) return;
  const t = id ? appData.teams.find((x) => x.id === id) : null;
  editingTeamId = t ? t.id : null;
  setTeamModalTyp(t ? t.typ : "mannschaft");
  document.getElementById("tf-name").value = t ? t.name : "";
  document.getElementById("tf-farbe").value = /^#[0-9a-fA-F]{6}$/.test(t && t.farbe) ? t.farbe : "#1a56a0";
  document.getElementById("btn-delete-team").classList.toggle("hidden", !t);
  document.getElementById("team-modal").classList.remove("hidden");
  document.getElementById("tf-name").focus();
}
function closeTeamModal() { document.getElementById("team-modal").classList.add("hidden"); editingTeamId = null; }
function saveTeam() {
  const name = val("tf-name").trim();
  if (!name) { alert("Bitte einen Namen eingeben."); return; }
  const typ = teamModalTyp();
  let t = editingTeamId ? appData.teams.find((x) => x.id === editingTeamId) : null;
  if (!t) { t = seedTeam(name, val("tf-farbe"), typ); appData.teams.push(t); if (!currentTeamId) { currentTeamId = t.id; appData.meta.currentTeamId = t.id; } }
  t.name = name;
  // Typwechsel ist erlaubt und verlustfrei: er blendet die Kasse nur ein oder aus,
  // gelöscht wird nichts. Eine versehentlich als Mannschaft angelegte Gruppe muss
  // deshalb nicht neu aufgebaut werden.
  t.typ = typ;
  t.farbe = val("tf-farbe");
  persist();
  renderAll();
  closeTeamModal();
}
function deleteTeam() {
  if (!editingTeamId) return;
  const t = appData.teams.find((x) => x.id === editingTeamId);
  const frage = istGruppe(t)
    ? "Diese Gruppe mit Kader, Terminen und Umfragen wirklich löschen? Die Spieler bleiben in ihren Mannschaften."
    : "Diese Mannschaft mit Kader, Terminen, Umfragen und Kasse wirklich löschen?";
  if (!confirm(frage)) return;
  appData.teams = appData.teams.filter((x) => x.id !== editingTeamId);
  if (currentTeamId === editingTeamId) { currentTeamId = appData.teams[0] ? appData.teams[0].id : null; appData.meta.currentTeamId = currentTeamId; }
  persist();
  renderAll();
  closeTeamModal();
}

// ---------- Einstellungen: Rechte & Rollen ----------
function renderKaderRollenUebersicht() {
  const wrap = document.getElementById("rechte-kader-wrap");
  if (!wrap) return;
  const team = teamOr("no-team-rechte", ["rechte-kader-wrap"]);
  const titleEl = document.getElementById("rechte-kader-title");
  if (!team) { wrap.innerHTML = ""; if (titleEl) titleEl.textContent = "Rollen im Kader"; return; }
  if (titleEl) titleEl.textContent = `Rollen im Kader — ${team.name}`;
  const manage = hasRecht(team, "kader");
  const sorted = team.kader.slice().sort((a, b) => a.name.localeCompare(b.name));
  const rows = sorted.map((s) => {
    const rollenLabels = (s.rollen || []).map((r) => { const k = KADER_ROLLEN.find((x) => x.id === r); return k ? k.label : r; });
    const chips = rollenLabels.length
      ? rollenLabels.map((l) => `<span class="rolle-chip">${escapeHtml(l)}</span>`).join("")
      : `<span class="muted">keine Rolle</span>`;
    const editBtn = manage ? `<button class="icon-btn edit" data-edit-spieler="${escapeHtml(s.id)}" title="Rollen bearbeiten">✎</button>` : "";
    const profilHtml = trainerProfileBadgeHtml(s.linkedUsername) || `<span class="muted">–</span>`;
    return `<tr><td class="strong">${escapeHtml(s.name || "—")}</td><td>${chips}</td><td>${profilHtml}</td><td class="num">${editBtn}</td></tr>`;
  }).join("");
  wrap.innerHTML = `<table class="data-table">
    <thead><tr><th>Spieler</th><th>Rollen</th><th>Trainerprofil</th><th class="num"></th></tr></thead>
    <tbody>${rows || `<tr><td colspan="4" class="muted">Noch keine Spieler im Kader.</td></tr>`}</tbody>
  </table>`;
}
function renderRechteMatrix() {
  const wrap = document.getElementById("rechte-matrix-wrap");
  if (!wrap) return;
  const manage = !!(currentUser && (currentUser.isAdmin || currentUser.canAdmin));
  const hint = document.getElementById("rechte-matrix-admin-hint");
  if (hint) hint.classList.toggle("hidden", !manage);
  const header = `<th>Rolle</th>` + RECHTE_BEREICHE.map((b) => `<th>${escapeHtml(RECHTE_BEREICH_LABELS[b] || b)}</th>`).join("");
  const rows = KADER_ROLLEN.map((r) => {
    const rechte = rollenRechte(r.id);
    const cells = RECHTE_BEREICHE.map((b) => {
      const on = rechte.includes(b);
      return manage
        ? `<td class="num"><input type="checkbox" data-recht-rolle="${escapeHtml(r.id)}" data-recht-bereich="${escapeHtml(b)}" ${on ? "checked" : ""}></td>`
        : `<td class="num">${on ? "✓" : "–"}</td>`;
    }).join("");
    return `<tr><td class="strong">${escapeHtml(r.label)}</td>${cells}</tr>`;
  }).join("");
  wrap.innerHTML = `<table class="data-table"><thead><tr>${header}</tr></thead><tbody>${rows}</tbody></table>`;
}
// Die Rechte-Matrix ändern darf, wer global Admin ist ODER die Administrieren-
// Stufe für den Kadermanager hat (canAdmin aus me, dritte Rechte-Stufe der
// Tools-Übersicht) — systemweite, mannschaftsübergreifende Einstellung, deshalb
// bewusst NICHT bloß canEdit/hasRecht().
function toggleRollenRecht(rolle, bereich, on) {
  if (!currentUser || !(currentUser.isAdmin || currentUser.canAdmin)) return;
  if (!KADER_ROLLEN.some((r) => r.id === rolle) || !RECHTE_BEREICHE.includes(bereich)) return;
  const cur = new Set(rollenRechte(rolle));
  if (on) cur.add(bereich); else cur.delete(bereich);
  appData.meta.rollenRechte[rolle] = RECHTE_BEREICHE.filter((b) => cur.has(b));
  persist();
  renderAll();
}

// ---------- Meta / Changelog / Nutzer ----------
function renderMeta() {
  const m = appData.meta || {};
  const gruppen = appData.teams.filter(istGruppe).length;
  const rows = [
    ["Mannschaften", String(appData.teams.length - gruppen)],
    ["Gruppen", String(gruppen)],
    ["Letzter Stand", m.stand ? new Date(m.stand).toLocaleString("de-DE") : "—"]
  ];
  document.getElementById("meta-view").innerHTML = rows.map(([k, v]) =>
    `<div class="form-field"><label>${escapeHtml(k)}</label><span>${escapeHtml(v)}</span></div>`).join("");
}
function renderVersionInfo() {
  document.querySelectorAll("#version-badge, #version-badge-2").forEach((el) => { if (el) el.textContent = "v" + APP_VERSION; });
  const list = document.getElementById("changelog-list");
  if (!list) return;
  list.innerHTML = APP_CHANGELOG.map((entry) => `
    <div class="changelog-entry">
      <div class="cv">Version ${escapeHtml(entry.version)}</div>
      ${entry.groups.map((g) => `
        <div class="changelog-group">
          <div class="cg-title">${escapeHtml(g.title)}</div>
          <ul class="cg-items">${g.items.map((i) => `<li>${escapeHtml(i)}</li>`).join("")}</ul>
        </div>`).join("")}
    </div>`).join("");
}
function renderHeaderUser() {
  const el = document.getElementById("header-user");
  const el2 = document.getElementById("einstellungen-user");
  if (!currentUser) { if (el) el.textContent = ""; if (el2) el2.textContent = ""; return; }
  const name = (currentUser.vorname || currentUser.nachname)
    ? `${currentUser.vorname || ""} ${currentUser.nachname || ""}`.trim()
    : currentUser.username;
  const rolle = currentUser.isAdmin ? " (Admin)" : (canManage() ? " (Bearbeiter)" : "");
  if (el) el.textContent = "👤 " + name + rolle;
  if (el2) el2.textContent = "Angemeldet als " + name + rolle +
    (canManage() ? "" : " — Verwalten (Termine/Kader/Kasse anlegen) ist Trainern und Betreuern vorbehalten. Für deinen eigenen Kaderplatz kannst du dich selbst an- und abmelden.");
}
function applyEditVisibility() {
  const editable = canManage();
  document.body.classList.toggle("can-edit", editable);
  // Gruppen führen keine Kasse. Bewusst VOR dem frühen Return unten, sonst liefe das
  // für Spielerkonten (kein canManage) nie und die sähen den Tab weiterhin.
  const kasseBtn = document.querySelector('nav button[data-tab="kasse"]');
  if (kasseBtn) kasseBtn.classList.toggle("hidden", istGruppe(currentTeam()));
  // Einstellungen-Tab = Administrieren-Ebene (2026-07-24): nur für Admins sichtbar. VOR dem
  // frühen Return, damit es auch für Spieler-/Nur-Seher-Konten greift (Info bleibt sichtbar).
  const einstBtn = document.querySelector('nav button[data-tab="einstellungen"]');
  if (einstBtn) einstBtn.classList.toggle("hidden", !canAdmin());
  document.querySelectorAll(".editor-only").forEach((el) => el.classList.toggle("hidden", !editable));
  if (!editable) return;
  const team = currentTeam();
  document.querySelectorAll("[data-bereich]").forEach((el) => el.classList.toggle("hidden", !hasRecht(team, el.dataset.bereich)));
}

function renderAll() {
  if (bildschirmGeraeumt) return;
  renderTeamSelect();
  renderTermine();
  renderKader();
  renderStatistik();
  renderUmfragen();
  renderKasse();
  renderTeamAdmin();
  renderKaderRollenUebersicht();
  renderRechteMatrix();
  renderMeta();
  renderVersionInfo();
  applyEditVisibility();
}

// ---------- Tabs ----------
function switchTab(tab) {
  currentTab = tab;
  document.querySelectorAll("nav button").forEach((b) => b.classList.toggle("active", b.dataset.tab === tab));
  document.querySelectorAll(".tab-section").forEach((s) => s.classList.toggle("active", s.id === "tab-" + tab));
  if (tab === "termine") renderTermine();
  if (tab === "kader") renderKader();
  if (tab === "statistik") renderStatistik();
  if (tab === "umfragen") renderUmfragen();
  if (tab === "kasse") renderKasse();
  if (tab === "einstellungen") { renderTeamAdmin(); renderKaderRollenUebersicht(); renderRechteMatrix(); }
  if (tab === "info") { renderMeta(); renderVersionInfo(); }
}

// ---------- Gateway: Laden / Speichern / Konflikte ----------
function setSaveStatus(text, kind) {
  const el = document.getElementById("save-status");
  if (!el) return;
  el.textContent = text;
  el.className = "header-status" + (kind ? " is-" + kind : "");
}
function persist() {
  clearTimeout(persistTimer);
  setSaveStatus("Änderung noch nicht gespeichert…", "pending");
  ungespeicherteAenderungen = true;
  persistTimer = setTimeout(doPersist, 300);
}

// Nur-Lesen-Nutzer (typisch: ein Spieler) dürfen den Kadermanager nicht per
// dav-save schreiben — das würde die komplette Datei zurückschreiben und ist für
// sie serverseitig gesperrt. Ihre eigenen Einträge speichern sie stattdessen über
// die schmale km-self-Aktion ("Briefschlitz").
function nurSelbstbedienung() {
  return !!currentUser && !currentUser.isAdmin && !currentUser.canEdit;
}

// Speichert eine Selbstbedienungs-Änderung auf dem passenden Weg. Der lokale Stand
// wurde vom Aufrufer bereits geändert (damit die Oberfläche sofort reagiert); hier
// geht es nur noch darum, WIE das zum Server kommt.
// Bei Fehlschlag wird neu geladen, damit die Anzeige nicht dauerhaft etwas zeigt,
// das serverseitig nie angekommen ist.
function persistSelbst(nachricht) {
  if (!nurSelbstbedienung()) { persist(); return; }
  const team = currentTeam();
  if (!team) return;
  clearTimeout(persistTimer);
  setSaveStatus("Speichern…", "pending");
  gatewaySelf(Object.assign({ teamId: team.id }, nachricht))
    .then(() => {
      const t = new Date().toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" });
      setSaveStatus("Gespeichert " + t, "ok");
    })
    .catch(async (e) => {
      if (e instanceof NotLoggedInError) { showConnectScreen("Sitzung abgelaufen — bitte neu anmelden."); return; }
      console.error("Selbstbedienung fehlgeschlagen", e);
      setSaveStatus("Nicht gespeichert", "error");
      alert("Konnte nicht gespeichert werden: " + e.message);
      await reloadAfterConflict();
    });
}

// Es darf immer nur EIN dav-save unterwegs sein. gatewayRev (das ETag, mit dem der
// Worker Konflikte erkennt) wird erst aktualisiert, wenn ein Save zurückkommt —
// ein zweiter Save, der währenddessen startet, schickt also dasselbe, inzwischen
// veraltete ETag und wird zwangsläufig mit 409 abgelehnt. Für die bearbeitende
// Person sah das aus wie "ein anderes Gerät hat geändert", obwohl sie allein war,
// und reloadAfterConflict() verwarf dabei ihre letzte Eingabe. Besonders sichtbar
// an den input-Listenern (Spielbericht, Strafenkatalog), die pro Tastendruck
// persist() auslösen.
// Deshalb: Änderungen, die während eines laufenden Saves anfallen, nur vormerken
// und danach in einem Rutsch nachschreiben. appData wird ohnehin immer komplett
// geschrieben, es geht also nichts verloren, wenn mehrere Änderungen zusammenfallen.
// Betrifft nur diesen dav-save-Weg — persistSelbst()/gatewaySelf (km-self) schickt
// je Aufruf nur die eine Änderung ohne ETag und braucht den Guard nicht.
let saveRunner = null;
let saveDirty = false;
// Fuer das Sicherheitsnetz beim Verlassen der Seite (beforeunload unter
// runSaveLoop): "es liegt etwas an" und "der letzte Versuch ging schief".
// Beides wird eigens gepflegt statt aus saveDirty/saveRunner abgeleitet -- der
// Debounce-Timer laeuft schon, bevor saveDirty ueberhaupt gesetzt ist, und
// genau dieses Fenster ist der Fall, den das Netz auffangen soll.
let ungespeicherteAenderungen = false;
let letzterSaveFehlgeschlagen = false;

function doPersist() {
  saveDirty = true;
  ungespeicherteAenderungen = true;
  if (!saveRunner) saveRunner = runSaveLoop().finally(() => { saveRunner = null; });
  return saveRunner;
}
async function runSaveLoop() {
  let ok = true;
  while (saveDirty) {
    saveDirty = false;
    ok = await writeToGateway();
    // Bei Konflikt/Fehler wurde der Stand neu geladen bzw. der Login-Screen
    // gezeigt — dann NICHT blind nachschreiben, das würde den fremden Stand
    // wieder überbügeln.
    if (!ok) { saveDirty = false; break; }
  }
  // Nach einem sauberen Durchlauf ist alles draussen, sonst liegt noch etwas an.
  ungespeicherteAenderungen = !ok;
  letzterSaveFehlgeschlagen = !ok;
  return ok;
}

// Sicherheitsnetz beim Verlassen der Seite: ein noch nicht abgelaufener
// Debounce-Timer und ein gerade laufender fetch gehen beim Entladen beide
// verloren -- der Browser bricht laufende Requests ab. Der keepalive-Request
// ueberlebt das Schliessen des Tabs.
//
// Nachgefragt wird NUR, wenn dieser Weg nicht traegt (Daten ueber der
// 64-KB-Grenze, kein Token, oder der letzte regulaere Versuch schlug schon
// fehl). Sonst kaeme die Rueckfrage bei JEDEM Schliessen kurz nach einer
// Aenderung -- also staendig -- und wuerde reflexhaft weggeklickt, gerade dann
// wenn sie einmal wirklich zaehlt.
window.addEventListener("beforeunload", (e) => {
  if (!ungespeicherteAenderungen) return;
  // Apps mit zusaetzlichem lokalem Datei-Modus duerfen hier nichts ins Gateway
  // schicken: dort ist die lokale Datei die Wahrheit, nicht Nextcloud.
  if (typeof storageMode !== "undefined" && storageMode !== "gateway") return;
  const abgeschickt = gatewaySaveBeacon(appData);
  if (abgeschickt && !letzterSaveFehlgeschlagen) return;
  e.preventDefault();
  e.returnValue = "";
});
async function writeToGateway() {
  setSaveStatus("Speichern…", "pending");
  try {
    appData.meta = Object.assign({}, appData.meta, { stand: new Date().toISOString(), currentTeamId });
    await gatewaySave(appData);
    const t = new Date().toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" });
    setSaveStatus("Gespeichert " + t, "ok");
    return true;
  } catch (e) {
    if (e instanceof ConflictError) { await reloadAfterConflict(); setSaveStatus("Von anderem Gerät aktualisiert", ""); return false; }
    if (e instanceof NotLoggedInError) { showConnectScreen("Sitzung abgelaufen — bitte neu anmelden."); return false; }
    console.error("Speichern fehlgeschlagen", e);
    setSaveStatus("Nicht gespeichert", "error");
    alert("Speichern fehlgeschlagen: " + e.message);
    return false;
  }
}
async function reloadAfterConflict() {
  try {
    const data = await gatewayLoad();
    appData = normalizeData(data);
    currentTeamId = appData.meta.currentTeamId;
    renderAll();
    if (detailTerminId) renderDetail();
    alert("Die Daten wurden zwischenzeitlich auf einem anderen Gerät geändert — die aktuelle Version wurde neu geladen. Bitte die letzte Änderung bei Bedarf erneut vornehmen.");
  } catch (e) {
    console.error("Neuladen nach Konflikt fehlgeschlagen", e);
  }
}

// ---------- Start ----------
// ---------- Sitzungsverlust: räumen, nicht nur verstecken ----------

// ⚠️ Verstecken ist nicht Räumen. Fällt die Sitzung weg, WÄHREND die App
// offen ist, steht bereits alles auf dem Bildschirm. display:none macht das
// unsichtbar, nicht weg -- Namen, Nummern und ausgefüllte Formularfelder sind
// im Seitenquelltext weiter lesbar.
//
// ⚠️ Über die CONTAINER räumen, nie über eine Id-Liste. Eine Liste veraltet
// lautlos: wer später ein Feld ergänzt, müsste daran denken, und genau das eine
// bliebe stehen.
//
// ⚠️ Dialoge, Druckbereich und Bild-Lightbox stehen NEBEN der Hülle, nicht
// darin -- ihr innerHTML erwischt sie nicht. Ein offener Dialog ist dabei der
// schlimmste Fall: er steht nicht nur gespeichert, sondern SICHTBAR da.
//
// ⚠️ #header-user steht in einigen Apps im Seitenkopf und damit ebenfalls
// außerhalb. Der Rest des Kopfes (Titel, Logo, Zurück-Link) bleibt absichtlich:
// ohne ihn stünde man vor einer weißen Seite ohne Weg zurück.
//
// Wegwerfen ist gefahrlos: zurück in die App geht es ausschließlich über ein
// Neuladen der Seite. Wer sich neu anmeldet, bekommt sie ohnehin frisch.
let bildschirmGeraeumt = false;

// Vor dem ersten Aufbau gibt es nichts zu räumen -- und wer gar nicht angemeldet
// ist, soll nicht "Sitzung abgelaufen" lesen. Gesetzt wird das erst, wenn die
// Hülle wirklich sichtbar wird.
let appLaeuft = false;

function raeumeBildschirm() {
  bildschirmGeraeumt = true;
  const huelle = document.getElementById("app-shell");
  if (huelle) huelle.innerHTML = "";
  document.querySelectorAll(".modal-overlay, .overlay, #print-area, .foto-lightbox, #header-user").forEach((el) => {
    el.innerHTML = "";
    el.classList.add("hidden");
    el.style.display = "none";
  });
}

// ⚠️ Gerufen aus db.js -- an der EINEN Stelle, an der die 401 ankommt. Sonst
// müsste jeder einzelne Fehlerweg daran denken, und einer vergisst es.
function raeumeBeiSitzungsverlust() {
  if (!appLaeuft) return;
  showConnectScreen("Die Sitzung ist abgelaufen. Bitte über die Tools-Übersicht neu anmelden.");
}

function showConnectScreen(errorMsg) {
  raeumeBildschirm();
  document.getElementById("connect-screen").style.display = "";
  document.getElementById("app-shell").style.display = "none";
  document.getElementById("cloud-error").textContent = errorMsg ? "Fehler: " + errorMsg : "";
}
async function startApp() {
  appLaeuft = true;
  document.getElementById("connect-screen").style.display = "none";
  document.getElementById("app-shell").style.display = "";
  currentTeamId = appData.meta.currentTeamId;
  renderAll();
  // fetchMe() kostet hier nichts: der Merker aus gatewayLoad() bedient es (db.js).
  try { currentUser = await fetchMe(); } catch (_) { /* best effort */ }

  // ⚠️ Die drei Aufrufe hier liefen bis 2026-08-28 streng NACHEINANDER, obwohl
  // keiner das Ergebnis eines anderen braucht -- drei serielle Roundtrips a
  // ~180 ms, in denen der Nutzer die Kaderliste ohne Fotos und ohne Mannschaften
  // ansieht. Jetzt eine Welle. Jeder faengt seinen Fehler weiterhin SELBST ab:
  // ohne das eigene catch wuerde ein einzelner Fehlschlag ueber Promise.all die
  // beiden anderen Ergebnisse mitreissen.
  //
  // Muss weiterhin VOR renderAll() stehen, sonst zeigt der erste Aufbau die
  // Initialen und erst ein spaeteres Rendern die Fotos.
  const [profileR, fotosR, mannschaftenR] = await Promise.all([
    fetchTrainerProfiles().catch(() => null),
    fetchNutzerfotoVersionen().catch(() => null),
    // Die Mannschaften des Vereins für die Auswahl im Team-Formular. Die Funktion
    // faengt ihre Fehler selbst ab und liefert dann [] -- das catch hier ist nur
    // der Guertel dazu, damit renderVereinsListe() nie auf null trifft (die Zeile
    // macht ein .map darauf).
    fetchVereinsMannschaften().catch(() => [])
  ]);
  if (profileR !== null) trainerProfiles = profileR;
  if (fotosR !== null) nutzerfotoVersionen = fotosR;
  vereinsMannschaften = Array.isArray(mannschaftenR) ? mannschaftenR : [];
  renderVereinsListe();
  renderHeaderUser();
  renderAll();
}
async function init() {
  setupListeners();
  if (!getSessionToken()) { showConnectScreen(); return; }
  try {
    const data = await gatewayLoad();
    appData = normalizeData(data);
    await startApp();
  } catch (e) {
    if (e instanceof NotLoggedInError) { showConnectScreen(); return; }
    console.error("Nextcloud-Zugriff über Login fehlgeschlagen", e);
    showConnectScreen(e.message);
  }
}

function setupListeners() {
  document.querySelectorAll("nav button").forEach((b) => b.addEventListener("click", () => switchTab(b.dataset.tab)));

  document.getElementById("team-select").addEventListener("change", (e) => selectTeam(e.target.value));

  // Termine
  document.getElementById("termine-filter").addEventListener("click", (e) => {
    const btn = e.target.closest("button[data-filter]");
    if (btn) { termineFilter = btn.dataset.filter; renderTermine(); }
  });
  document.getElementById("btn-new-termin").addEventListener("click", () => openTerminModal(null));
  document.getElementById("termine-list").addEventListener("click", (e) => {
    const rsvp = e.target.closest("[data-rsvp-termin]");
    if (rsvp) { setMyStatus(rsvp.dataset.rsvpTermin, rsvp.dataset.status); return; }
    const open = e.target.closest("[data-open-termin]");
    if (open) openDetail(open.dataset.openTermin);
  });

  // Urlaub/Krank
  document.getElementById("btn-urlaub-krank").addEventListener("click", openUrlaubModal);
  document.getElementById("urlaub-modal-close").addEventListener("click", closeUrlaubModal);
  document.getElementById("btn-close-urlaub").addEventListener("click", closeUrlaubModal);
  document.getElementById("urlaub-modal").addEventListener("click", (e) => { if (e.target.id === "urlaub-modal") closeUrlaubModal(); });
  document.getElementById("btn-add-abwesenheit").addEventListener("click", addAbwesenheit);
  document.getElementById("urlaub-liste").addEventListener("click", (e) => {
    const rm = e.target.closest("[data-remove-abwesenheit]"); if (rm) removeAbwesenheit(rm.dataset.removeAbwesenheit);
  });

  // Termin-Modal
  document.getElementById("ef-typ").addEventListener("change", updateGegnerVisibility);
  document.getElementById("ef-zyklisch").addEventListener("change", updateZyklischVisibility);
  document.getElementById("termin-modal-close").addEventListener("click", closeTerminModal);
  document.getElementById("btn-cancel-termin").addEventListener("click", closeTerminModal);
  document.getElementById("btn-save-termin").addEventListener("click", saveTermin);
  document.getElementById("btn-delete-termin").addEventListener("click", () => deleteTermin(editingTerminId));
  document.getElementById("termin-modal").addEventListener("click", (e) => { if (e.target.id === "termin-modal") closeTerminModal(); });
  document.getElementById("termin-form").addEventListener("submit", (e) => { e.preventDefault(); saveTermin(); });

  // Termin-Detail
  document.getElementById("detail-modal-close").addEventListener("click", closeDetail);
  document.getElementById("btn-close-detail").addEventListener("click", closeDetail);
  document.getElementById("detail-modal").addEventListener("click", (e) => { if (e.target.id === "detail-modal") closeDetail(); });
  document.getElementById("detail-self").addEventListener("click", (e) => {
    const btn = e.target.closest("[data-detail-self]");
    if (btn && detailTerminId) setMyStatus(detailTerminId, btn.dataset.status);
  });
  document.getElementById("detail-teilnahme").addEventListener("click", (e) => {
    const btn = e.target.closest("[data-set-spieler]");
    if (btn && detailTerminId) setStatusFor(detailTerminId, btn.dataset.setSpieler, btn.dataset.status);
  });
  document.getElementById("btn-edit-termin-detail").addEventListener("click", () => { if (detailTerminId) { const id = detailTerminId; closeDetail(); openTerminModal(id); } });
  document.getElementById("btn-delete-termin-detail").addEventListener("click", () => { if (detailTerminId) deleteTermin(detailTerminId); });

  // Termin-Detail: Aufgaben
  document.getElementById("btn-add-aufgabe").addEventListener("click", addAufgabe);
  document.getElementById("detail-aufgaben").addEventListener("click", (e) => {
    const rm = e.target.closest("[data-remove-aufgabe]"); if (rm) removeAufgabe(rm.dataset.removeAufgabe);
  });
  document.getElementById("detail-aufgaben").addEventListener("change", (e) => {
    const cb = e.target.closest("[data-aufgabe-toggle]"); if (cb) toggleAufgabe(cb.dataset.aufgabeToggle, cb.dataset.spieler);
  });

  // Termin-Detail: Gruppen
  document.getElementById("btn-add-gruppe").addEventListener("click", addGruppe);
  document.getElementById("detail-gruppen").addEventListener("click", (e) => {
    const rm = e.target.closest("[data-remove-gruppe]"); if (rm) removeGruppe(rm.dataset.removeGruppe);
  });

  // Termin-Detail: Spielbericht
  document.getElementById("sb-eigene").addEventListener("input", (e) => updateSpielbericht("ergebnisEigenes", e.target.value));
  document.getElementById("sb-gegner").addEventListener("input", (e) => updateSpielbericht("ergebnisGegner", e.target.value));
  document.getElementById("sb-bericht").addEventListener("input", (e) => updateSpielbericht("bericht", e.target.value));
  document.getElementById("btn-add-torschuetze").addEventListener("click", addTorschuetze);
  document.getElementById("detail-torschuetzen").addEventListener("click", (e) => {
    const rm = e.target.closest("[data-remove-torschuetze]"); if (rm) removeTorschuetze(Number(rm.dataset.removeTorschuetze));
  });

  // Termin-Detail: Fahrgemeinschaft
  document.getElementById("btn-fg-anbieten").addEventListener("click", fgAnbieten);
  document.getElementById("btn-fg-suchen").addEventListener("click", fgSuchen);
  document.getElementById("detail-fahrgemeinschaft").addEventListener("click", (e) => {
    const rmA = e.target.closest("[data-remove-fg-angebot]"); if (rmA) { fgEntferneAngebot(rmA.dataset.removeFgAngebot); return; }
    const rmG = e.target.closest("[data-remove-fg-gesuch]"); if (rmG) fgEntferneGesuch(rmG.dataset.removeFgGesuch);
  });

  // Kader
  document.getElementById("btn-new-spieler").addEventListener("click", () => openSpielerModal(null));
  document.getElementById("btn-reg-oeffnen").addEventListener("click", oeffneRegistrierung);
  document.getElementById("btn-reg-schliessen").addEventListener("click", schliesseRegPanel);
  document.getElementById("kader-list").addEventListener("click", (e) => {
    const claim = e.target.closest("[data-claim]"); if (claim) { claimSpieler(claim.dataset.claim); return; }
    const unclaim = e.target.closest("[data-unclaim]"); if (unclaim) { unclaimSpieler(unclaim.dataset.unclaim); return; }
    const edit = e.target.closest("[data-edit-spieler]"); if (edit) openSpielerModal(edit.dataset.editSpieler);
  });
  document.getElementById("pf-uebernehmen").addEventListener("change", (e) => uebernehmeSpieler(e.target.value));
  document.getElementById("spieler-modal-close").addEventListener("click", closeSpielerModal);
  document.getElementById("btn-cancel-spieler").addEventListener("click", closeSpielerModal);
  document.getElementById("btn-save-spieler").addEventListener("click", saveSpieler);
  document.getElementById("btn-delete-spieler").addEventListener("click", deleteSpieler);
  document.getElementById("pf-foto-input").addEventListener("change", onFotoFileChange);
  document.getElementById("btn-remove-foto").addEventListener("click", removeFotoPending);
  document.getElementById("spieler-modal").addEventListener("click", (e) => { if (e.target.id === "spieler-modal") closeSpielerModal(); });
  document.getElementById("spieler-form").addEventListener("submit", (e) => { e.preventDefault(); saveSpieler(); });

  // Statistik
  document.getElementById("statistik-jahr").addEventListener("change", (e) => { statistikJahr = e.target.value; renderStatistik(); });

  // Umfragen
  document.getElementById("btn-new-umfrage").addEventListener("click", () => openUmfrageModal(null));
  document.getElementById("umfragen-list").addEventListener("click", (e) => {
    const opt = e.target.closest("[data-vote-umfrage]"); if (opt) { vote(opt.dataset.voteUmfrage, opt.dataset.option); return; }
    const tog = e.target.closest("[data-toggle-umfrage]"); if (tog) { toggleUmfrageOffen(tog.dataset.toggleUmfrage); return; }
    const ed = e.target.closest("[data-edit-umfrage]"); if (ed) openUmfrageModal(ed.dataset.editUmfrage);
  });
  document.getElementById("umfrage-modal-close").addEventListener("click", closeUmfrageModal);
  document.getElementById("btn-cancel-umfrage").addEventListener("click", closeUmfrageModal);
  document.getElementById("btn-save-umfrage").addEventListener("click", saveUmfrage);
  document.getElementById("btn-delete-umfrage").addEventListener("click", deleteUmfrage);
  document.getElementById("btn-add-option").addEventListener("click", () => addOptionRow(""));
  document.getElementById("uf-optionen").addEventListener("click", (e) => {
    const rm = e.target.closest(".uf-opt-remove");
    if (rm) rm.closest(".uf-option-row").remove();
  });
  document.getElementById("umfrage-modal").addEventListener("click", (e) => { if (e.target.id === "umfrage-modal") closeUmfrageModal(); });

  // Kasse
  document.getElementById("btn-new-buchung").addEventListener("click", () => openBuchungModal(null));
  document.getElementById("btn-add-strafe").addEventListener("click", () => {
    currentTeam().kasse.strafenkatalog.push({ id: uuid(), bezeichnung: "Neue Strafe", betrag: 0 });
    persist(); renderKasse();
  });
  document.getElementById("buchungen-wrap").addEventListener("click", (e) => {
    const tog = e.target.closest("[data-toggle-bezahlt]"); if (tog) { toggleBezahlt(tog.dataset.toggleBezahlt); return; }
    const ed = e.target.closest("[data-edit-buchung]"); if (ed) openBuchungModal(ed.dataset.editBuchung);
  });
  const sk = document.getElementById("strafenkatalog-list");
  sk.addEventListener("input", (e) => {
    const team = currentTeam(); if (!team) return;
    const li = e.target.dataset.strafeIdx;
    if (li != null) { team.kasse.strafenkatalog[Number(li)].bezeichnung = e.target.value; persist(); return; }
    const bi = e.target.dataset.strafeBetragIdx;
    if (bi != null) { const n = parseBetrag(e.target.value); team.kasse.strafenkatalog[Number(bi)].betrag = isNaN(n) ? 0 : n; persist(); }
  });
  sk.addEventListener("click", (e) => {
    const rm = e.target.closest("[data-remove-strafe]");
    if (!rm) return;
    if (!confirm("Diesen Eintrag aus dem Strafenkatalog entfernen?")) return;
    currentTeam().kasse.strafenkatalog.splice(Number(rm.dataset.removeStrafe), 1);
    persist(); renderKasse();
  });
  document.getElementById("bf-vorlage").addEventListener("change", applyVorlage);
  document.getElementById("buchung-modal-close").addEventListener("click", closeBuchungModal);
  document.getElementById("btn-cancel-buchung").addEventListener("click", closeBuchungModal);
  document.getElementById("btn-save-buchung").addEventListener("click", saveBuchung);
  document.getElementById("btn-delete-buchung").addEventListener("click", toggleStorno);
  document.getElementById("buchung-modal").addEventListener("click", (e) => { if (e.target.id === "buchung-modal") closeBuchungModal(); });
  document.getElementById("buchung-form").addEventListener("submit", (e) => { e.preventDefault(); saveBuchung(); });
  document.getElementById("kasse-kategorie-filter").addEventListener("click", (e) => {
    const btn = e.target.closest("button[data-kategorie]");
    if (btn) { kasseKategorieFilter = btn.dataset.kategorie; renderKasse(); }
  });
  document.getElementById("kasse-stornos-toggle").addEventListener("change", (e) => { kasseZeigeStornos = e.target.checked; renderKasse(); });

  // Einstellungen: Mannschaften
  document.getElementById("btn-new-team").addEventListener("click", () => openTeamModal(null));
  document.getElementById("team-admin-list").addEventListener("click", (e) => {
    const ed = e.target.closest("[data-edit-team]"); if (ed) openTeamModal(ed.dataset.editTeam);
  });
  document.getElementById("tf-typ").addEventListener("click", (e) => {
    const btn = e.target.closest("button[data-typ]");
    if (btn) setTeamModalTyp(btn.dataset.typ);
  });
  document.getElementById("team-modal-close").addEventListener("click", closeTeamModal);
  document.getElementById("btn-cancel-team").addEventListener("click", closeTeamModal);
  document.getElementById("btn-save-team").addEventListener("click", saveTeam);
  document.getElementById("btn-delete-team").addEventListener("click", deleteTeam);
  document.getElementById("team-modal").addEventListener("click", (e) => { if (e.target.id === "team-modal") closeTeamModal(); });

  // Einstellungen: Rechte & Rollen
  document.getElementById("rechte-kader-wrap").addEventListener("click", (e) => {
    const ed = e.target.closest("[data-edit-spieler]"); if (ed) openSpielerModal(ed.dataset.editSpieler);
  });
  document.getElementById("rechte-matrix-wrap").addEventListener("change", (e) => {
    const cb = e.target.closest("[data-recht-rolle]");
    if (cb) toggleRollenRecht(cb.dataset.rechtRolle, cb.dataset.rechtBereich, cb.checked);
  });
  document.getElementById("team-form").addEventListener("submit", (e) => { e.preventDefault(); saveTeam(); });

  // ESC schließt das oberste offene Modal
  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    const modals = ["urlaub-modal", "buchung-modal", "umfrage-modal", "detail-modal", "termin-modal", "spieler-modal", "team-modal"];
    for (const m of modals) {
      const el = document.getElementById(m);
      if (el && !el.classList.contains("hidden")) {
        if (m === "detail-modal") closeDetail();
        else el.classList.add("hidden");
        return;
      }
    }
  });
}

document.addEventListener("DOMContentLoaded", init);
