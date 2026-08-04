// Persistenz über das zentrale ToolsUebersicht-Login-Gateway.
// Gleiches Gateway-Muster wie E:\busplan\db.js / E:\platzbelegung\db.js — reines
// Gateway ohne lokalen Datei-Modus.
const GATEWAY_URL = "https://landingpage.michel-brunner.workers.dev";
const TOKEN_STORAGE_KEY = "tu_session_token";
const GATEWAY_APP_ID = "kadermanager";

class NotLoggedInError extends Error {
  constructor(message) {
    super(message || "Nicht angemeldet");
    this.name = "NotLoggedInError";
  }
}

class ConflictError extends Error {
  constructor(message) {
    super(message || "Daten wurden zwischenzeitlich von einem anderen Gerät geändert");
    this.name = "ConflictError";
  }
}

// ETag des zuletzt geladenen/geschriebenen Stands. Wird bei dav-save mitgeschickt,
// damit der Worker Konflikte (anderes Gerät hat inzwischen gespeichert) erkennt.
let gatewayRev = null;

function getSessionToken() {
  try { return localStorage.getItem(TOKEN_STORAGE_KEY); } catch (_) { return null; }
}

async function gatewayRequest(payload) {
  const token = getSessionToken();
  if (!token) throw new NotLoggedInError();
  const resp = await fetch(GATEWAY_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: "Bearer " + token },
    body: JSON.stringify(payload)
  });
  if (resp.status === 401) throw new NotLoggedInError("Sitzung abgelaufen");
  if (resp.status === 403) throw new Error("Kein Zugriff auf dieses Tool.");
  if (resp.status === 409) throw new ConflictError();
  if (!resp.ok) {
    let detail = "";
    try { const b = await resp.json(); if (b && b.error) detail = ": " + b.error; } catch (_) {}
    throw new Error(`Gateway-Fehler (HTTP ${resp.status})${detail}`);
  }
  return resp.json();
}

// Das "me" aus der letzten dav-load-Antwort. Der Worker legt es bei, weil er
// nutzer.json und die Rechte-Datei fuer diesen Request ohnehin gelesen hat --
// der erste fetchMe() nach dem Laden kommt damit ohne eigenen Roundtrip aus.
let gatewayMe = null;

async function gatewayLoad() {
  const body = await gatewayRequest({ action: "dav-load", app: GATEWAY_APP_ID });
  gatewayRev = typeof body.rev === "string" ? body.rev : null;
  gatewayMe = (body.me && typeof body.me === "object") ? body.me : null;
  return body.data; // Objekt oder null (Datei noch nicht vorhanden)
}

async function gatewaySave(dataObj) {
  const payload = { action: "dav-save", app: GATEWAY_APP_ID, data: dataObj };
  if (gatewayRev) payload.rev = gatewayRev;
  const body = await gatewayRequest(payload);
  gatewayRev = typeof body.rev === "string" ? body.rev : null;
}

// Letzter Rettungsversuch beim Verlassen der Seite. Ein normaler fetch wird beim
// Entladen abgebrochen -- mit keepalive ueberlebt der Request das Schliessen des
// Tabs. Betrifft zwei Faelle: einen noch nicht abgelaufenen Debounce-Timer und
// einen gerade laufenden Schreibvorgang.
// Bewusst MIT gatewayRev: ein unbedingter Schreibvorgang wuerde hier zwar immer
// durchgehen, koennte aber die Aenderung eines anderen Geraets ueberschreiben,
// ohne dass es jemand merkt. Lieber ein wirkungsloser 409 als stiller fremder
// Datenverlust.
//
// Grenze: Browser erlauben fuer keepalive-Requests nur 64 KB Body. Groessere
// Datenbestaende gehen auf diesem Weg gar nicht raus -- deshalb meldet die
// Funktion zurueck, ob sie abschicken konnte; der Aufrufer (beforeunload in
// app.js) fragt dann stattdessen nach.
const KEEPALIVE_MAX_BYTES = 64 * 1024;

function gatewaySaveBeacon(dataObj) {
  const token = getSessionToken();
  if (!token) return false;
  const payload = { action: "dav-save", app: GATEWAY_APP_ID, data: dataObj };
  if (gatewayRev) payload.rev = gatewayRev;
  const body = JSON.stringify(payload);
  if (new Blob([body]).size > KEEPALIVE_MAX_BYTES) return false;
  try {
    fetch(GATEWAY_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer " + token },
      body,
      keepalive: true
    });
    return true;
  } catch (_) {
    return false; // z.B. wenn der Browser den keepalive-Request doch ablehnt
  }
}

// Liefert {username, isAdmin, groupIds, vorname, nachname, canEdit} der eingeloggten Person.
async function fetchMe() {
  // Genau EINMAL aus dem letzten dav-load bedienen, danach wieder echt fragen:
  // ein spaeterer Aufruf will den aktuellen Stand (etwa nach einem Rechte-
  // wechsel), nicht eine beliebig alte Kopie. Faellt von selbst auf den Request
  // zurueck, wenn der Worker das Feld noch nicht mitschickt.
  if (gatewayMe) { const me = gatewayMe; gatewayMe = null; return me; }
  return gatewayRequest({ action: "me", app: GATEWAY_APP_ID });
}

// Selbstbedienung ohne Bearbeiten-Recht ("Briefschlitz", siehe handleKmSelf im
// admin-worker). Schickt nur die eine Änderung statt der ganzen Datei — für Spieler
// der EINZIGE Schreibweg, weil dav-save für den Kadermanager Bearbeiten-Recht
// verlangt und sie das bewusst nicht haben.
async function gatewaySelf(nachricht) {
  return gatewayRequest({ action: "km-self", ...nachricht });
}

// Öffnet ein kurzlebiges Registrierungsfenster für eine Mannschaft (Spieler-
// Onboarding per QR/Link, siehe registrieren.html). Liefert das signierte Token;
// es wird nirgends gespeichert und läuft nach ttlSeconds von selbst ab.
async function gatewayRegOeffnen(teamId) {
  return gatewayRequest({ action: "km-reg-oeffnen", teamId });
}

// Zentrales Trainerprofil (Lizenz + Mannschaften) ALLER Nutzer — für die read-only
// Anzeige am Kader-Eintrag (Join über linkedUsername), nicht Teil des Kadermanager-
// eigenen rollen/ROLLEN_RECHTE-Berechtigungssystems.
async function fetchTrainerProfiles() {
  const body = await gatewayRequest({ action: "list-trainer-profiles" });
  return Array.isArray(body.profiles) ? body.profiles : [];
}

// Nutzerfotos aus der ToolsUebersicht (seit 2026-08-04). Wer hat eins, und in
// welchem Stand? Ein Aufruf für ALLE — die Bilder selbst holt app.js danach
// einzeln und nur für das, was wirklich angezeigt wird.
//
// ⚠️ Bewusst keine Sammel-Aktion für die Bilder: bei ~200 Spielern wären das 200
// Nextcloud-Zugriffe in einem einzigen Worker-Request (Grenze für Unteranfragen)
// und mehrere Megabyte in einer Antwort.
async function fetchNutzerfotoVersionen() {
  const body = await gatewayRequest({ action: "nutzerfoto-versionen" });
  return (body && body.versionen && typeof body.versionen === "object") ? body.versionen : {};
}

// Ein einzelnes Nutzerfoto. Anders als gatewayFetchFileBlob läuft das NICHT über
// dav-file-get: das Foto gehört zum Konto, nicht zu dieser App.
async function gatewayFetchNutzerfoto(username) {
  const token = getSessionToken();
  if (!token) throw new NotLoggedInError();
  const resp = await fetch(GATEWAY_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: "Bearer " + token },
    body: JSON.stringify({ action: "nutzerfoto-get", username })
  });
  if (resp.status === 401) throw new NotLoggedInError("Sitzung abgelaufen");
  if (!resp.ok) throw new Error("Foto nicht abrufbar (HTTP " + resp.status + ")");
  return resp.blob();
}

// ---------- Datei-Gateway (Binär-Upload über die dav-file-*-Gateway-Aktionen) ----------
// Gleiches Muster wie E:\vereinskalender\db.js — dieselben Worker-Aktionen sind generisch
// über DAV_APPS[app] geroutet, kein zusätzlicher admin-worker.js-Code nötig. Wird von
// den Spielerfotos genutzt (siehe app.js).
function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => {
      const res = String(r.result || "");
      const comma = res.indexOf(",");
      resolve(comma >= 0 ? res.slice(comma + 1) : res);
    };
    r.onerror = () => reject(new Error("Datei konnte nicht gelesen werden."));
    r.readAsDataURL(file);
  });
}
async function gatewayUploadFile(file) {
  if (file.size > MAX_FILE_BYTES) {
    throw new Error("Datei ist zu groß (max. " + Math.round(MAX_FILE_BYTES / 1024 / 1024) + " MB).");
  }
  const id = uuid();
  const dataBase64 = await fileToBase64(file);
  await gatewayRequest({
    action: "dav-file-put",
    app: GATEWAY_APP_ID,
    id,
    name: file.name,
    contentType: file.type || "application/octet-stream",
    dataBase64
  });
  return { id, name: file.name, mime: file.type || "application/octet-stream", size: file.size };
}
async function gatewayFetchFileBlob(id) {
  const token = getSessionToken();
  if (!token) throw new NotLoggedInError();
  const resp = await fetch(GATEWAY_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: "Bearer " + token },
    body: JSON.stringify({ action: "dav-file-get", app: GATEWAY_APP_ID, id })
  });
  if (resp.status === 401) throw new NotLoggedInError("Sitzung abgelaufen");
  if (!resp.ok) throw new Error("Datei nicht abrufbar (HTTP " + resp.status + ")");
  return resp.blob();
}
async function gatewayDeleteFile(id) {
  try {
    await gatewayRequest({ action: "dav-file-delete", app: GATEWAY_APP_ID, id });
  } catch (e) {
    console.warn("Datei-Löschen fehlgeschlagen für", id, e);
  }
}
