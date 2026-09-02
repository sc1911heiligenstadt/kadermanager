// Minimaler QR-Code-Encoder (Byte-Modus, Level L, Version 1-13).
//
// Warum eigener Code statt einer fertigen Bibliothek: die Registrierungs-URL
// enthält das komplette signierte Token und ist damit ~265 Bytes lang -- der QR
// landet dadurch auf Version 10. Ein CDN-Skript kommt nicht in Frage (der Token
// würde bei jedem Aufruf an einen fremden Server gemeldet), und eine fremde
// Bibliothek ungeprüft ins Repo zu legen wäre für diese eine Funktion zu viel
// Angriffsfläche. Der Umfang hier ist überschaubar, weil bewusst nur der Fall
// abgedeckt wird, den diese App braucht: Byte-Modus, Level L, kein Kanji, keine
// Alphanumerik-Optimierung, keine Versionen über 13.
//
// Verifiziert gegen segno (Python-Referenzimplementierung): für mehrere Eingaben
// stimmt die erzeugte Matrix bitgenau überein, inkl. der selbst gewählten Maske.
// Siehe qrcode.test.html im Repo-Root.
//
// Spezifikation: ISO/IEC 18004. Die Tabellen unten sind reine Spec-Daten.

(function (global) {
  "use strict";

  // ---------- Galois-Feld GF(256), Primitivpolynom 0x11D ----------
  const GF_EXP = new Uint8Array(512);
  const GF_LOG = new Uint8Array(256);
  (function initGF() {
    let x = 1;
    for (let i = 0; i < 255; i++) {
      GF_EXP[i] = x;
      GF_LOG[x] = i;
      x <<= 1;
      if (x & 0x100) x ^= 0x11D;
    }
    for (let i = 255; i < 512; i++) GF_EXP[i] = GF_EXP[i - 255];
  })();

  function gfMul(a, b) {
    if (a === 0 || b === 0) return 0;
    return GF_EXP[GF_LOG[a] + GF_LOG[b]];
  }

  // Polynome: Index 0 = höchster Grad.
  function polyMul(a, b) {
    const res = new Array(a.length + b.length - 1).fill(0);
    for (let i = 0; i < a.length; i++) {
      for (let j = 0; j < b.length; j++) res[i + j] ^= gfMul(a[i], b[j]);
    }
    return res;
  }

  // Generatorpolynom (x - a^0)(x - a^1)...(x - a^(grad-1))
  function rsGenerator(grad) {
    let poly = [1];
    for (let i = 0; i < grad; i++) poly = polyMul(poly, [1, GF_EXP[i]]);
    return poly;
  }

  // Polynomdivision: liefert die ecLen Fehlerkorrektur-Codewords zu data.
  function rsEncode(data, ecLen) {
    const gen = rsGenerator(ecLen);
    const res = new Array(data.length + ecLen).fill(0);
    for (let i = 0; i < data.length; i++) res[i] = data[i];
    for (let i = 0; i < data.length; i++) {
      const coef = res[i];
      if (coef === 0) continue;
      for (let j = 1; j < gen.length; j++) res[i + j] ^= gfMul(gen[j], coef);
    }
    return res.slice(data.length);
  }

  // ---------- Spec-Tabellen (nur Level L, Version 1-13) ----------
  // [ecCodewordsProBlock, [blockAnzahl, datenCodewordsProBlock], ...]
  // Ab Version 6 mehrere Blöcke; Version 10 und 12 haben zwei Gruppen mit
  // unterschiedlich großen Blöcken -- daher die verschachtelte Form.
  const EC_L = {
    1:  [7,  [[1, 19]]],
    2:  [10, [[1, 34]]],
    3:  [15, [[1, 55]]],
    4:  [20, [[1, 80]]],
    5:  [26, [[1, 108]]],
    6:  [18, [[2, 68]]],
    7:  [20, [[2, 78]]],
    8:  [24, [[2, 97]]],
    9:  [30, [[2, 116]]],
    10: [18, [[2, 68], [2, 69]]],
    11: [20, [[4, 81]]],
    12: [24, [[2, 92], [2, 93]]],
    13: [26, [[4, 107]]]
  };

  // Zentren der Ausrichtungsmuster je Version (Version 1 hat keine).
  const ALIGN = {
    1: [], 2: [6, 18], 3: [6, 22], 4: [6, 26], 5: [6, 30], 6: [6, 34],
    7: [6, 22, 38], 8: [6, 24, 42], 9: [6, 26, 46], 10: [6, 28, 50],
    11: [6, 30, 54], 12: [6, 32, 58], 13: [6, 34, 62]
  };

  // 18-Bit-Versionsinformation (BCH), erst ab Version 7 im Code enthalten.
  const VERSION_INFO = {
    7: 0x07C94, 8: 0x085BC, 9: 0x09A99, 10: 0x0A4D3,
    11: 0x0BBF6, 12: 0x0C762, 13: 0x0D847
  };

  function datenKapazitaet(version) {
    const [, gruppen] = EC_L[version];
    return gruppen.reduce((s, [anz, len]) => s + anz * len, 0);
  }

  function waehleVersion(byteLen) {
    for (let v = 1; v <= 13; v++) {
      // 4 Bit Modus + Zeichenzähler (8 Bit bis V9, danach 16) + Nutzdaten
      const zaehlerBits = v <= 9 ? 8 : 16;
      const noetig = Math.ceil((4 + zaehlerBits + byteLen * 8) / 8);
      if (datenKapazitaet(v) >= noetig) return v;
    }
    throw new Error("Text zu lang für QR-Version 13 (Level L)");
  }

  // ---------- Bitstrom ----------
  function baueDatenCodewords(bytes, version) {
    const bits = [];
    const push = (wert, anzahl) => {
      for (let i = anzahl - 1; i >= 0; i--) bits.push((wert >> i) & 1);
    };
    push(0b0100, 4); // Byte-Modus
    push(bytes.length, version <= 9 ? 8 : 16);
    bytes.forEach((b) => push(b, 8));

    const kapazitaetBits = datenKapazitaet(version) * 8;
    // Abschlusszeichen: bis zu vier Nullbits, aber nur so viele wie noch passen.
    for (let i = 0; i < 4 && bits.length < kapazitaetBits; i++) bits.push(0);
    while (bits.length % 8 !== 0) bits.push(0);

    const codewords = [];
    for (let i = 0; i < bits.length; i += 8) {
      let b = 0;
      for (let j = 0; j < 8; j++) b = (b << 1) | bits[i + j];
      codewords.push(b);
    }
    // Auffüllen mit den in der Spec vorgeschriebenen Füllbytes.
    const fueller = [0xEC, 0x11];
    let fi = 0;
    while (codewords.length < datenKapazitaet(version)) codewords.push(fueller[fi++ % 2]);
    return codewords;
  }

  // Blöcke bilden, je Block Fehlerkorrektur rechnen, dann verschachteln.
  function baueFinaleCodewords(datenCodewords, version) {
    const [ecLen, gruppen] = EC_L[version];
    const datenBloecke = [];
    let pos = 0;
    gruppen.forEach(([anzahl, laenge]) => {
      for (let i = 0; i < anzahl; i++) {
        datenBloecke.push(datenCodewords.slice(pos, pos + laenge));
        pos += laenge;
      }
    });
    const ecBloecke = datenBloecke.map((b) => rsEncode(b, ecLen));

    const out = [];
    const maxDaten = Math.max(...datenBloecke.map((b) => b.length));
    for (let i = 0; i < maxDaten; i++) {
      datenBloecke.forEach((b) => { if (i < b.length) out.push(b[i]); });
    }
    for (let i = 0; i < ecLen; i++) {
      ecBloecke.forEach((b) => out.push(b[i]));
    }
    return out;
  }

  // ---------- Matrix ----------
  // matrix[y][x]: 0/1 = Modul, null = noch frei. reserviert[y][x] markiert
  // Funktionsmuster, die von der Datenplatzierung und der Maske unberührt bleiben.
  function baueMatrix(version, finaleCodewords) {
    const groesse = version * 4 + 17;
    const m = Array.from({ length: groesse }, () => new Array(groesse).fill(null));
    const res = Array.from({ length: groesse }, () => new Array(groesse).fill(false));

    const setzeFunktion = (x, y, wert) => {
      if (x < 0 || y < 0 || x >= groesse || y >= groesse) return;
      m[y][x] = wert;
      res[y][x] = true;
    };

    // Suchmuster (3x) inkl. Trennlinien
    const finder = (cx, cy) => {
      for (let dy = -1; dy <= 7; dy++) {
        for (let dx = -1; dx <= 7; dx++) {
          const x = cx + dx, y = cy + dy;
          if (x < 0 || y < 0 || x >= groesse || y >= groesse) continue;
          const rand = dx === -1 || dx === 7 || dy === -1 || dy === 7;
          const inner = dx >= 2 && dx <= 4 && dy >= 2 && dy <= 4;
          const ring = dx === 0 || dx === 6 || dy === 0 || dy === 6;
          setzeFunktion(x, y, rand ? 0 : (inner || ring) ? 1 : 0);
        }
      }
    };
    finder(0, 0);
    finder(groesse - 7, 0);
    finder(0, groesse - 7);

    // Taktmuster
    for (let i = 8; i < groesse - 8; i++) {
      setzeFunktion(i, 6, i % 2 === 0 ? 1 : 0);
      setzeFunktion(6, i, i % 2 === 0 ? 1 : 0);
    }

    // Ausrichtungsmuster (nicht über die Suchmuster legen)
    const zentren = ALIGN[version];
    zentren.forEach((cy) => {
      zentren.forEach((cx) => {
        const beiFinder =
          (cx <= 8 && cy <= 8) ||
          (cx >= groesse - 9 && cy <= 8) ||
          (cx <= 8 && cy >= groesse - 9);
        if (beiFinder) return;
        for (let dy = -2; dy <= 2; dy++) {
          for (let dx = -2; dx <= 2; dx++) {
            const rand = Math.abs(dx) === 2 || Math.abs(dy) === 2;
            const mitte = dx === 0 && dy === 0;
            setzeFunktion(cx + dx, cy + dy, (rand || mitte) ? 1 : 0);
          }
        }
      });
    });

    // Dunkles Modul (immer 1) + Reservierung der Formatbereiche
    setzeFunktion(8, groesse - 8, 1);
    for (let i = 0; i < 9; i++) {
      if (m[i][8] === null) setzeFunktion(8, i, 0);
      if (m[8][i] === null) setzeFunktion(i, 8, 0);
    }
    for (let i = 0; i < 8; i++) {
      if (m[8][groesse - 1 - i] === null) setzeFunktion(groesse - 1 - i, 8, 0);
      if (m[groesse - 1 - i][8] === null) setzeFunktion(8, groesse - 1 - i, 0);
    }

    // Versionsinformation (ab Version 7): zwei 3x6-Blöcke
    if (version >= 7) {
      const vi = VERSION_INFO[version];
      for (let i = 0; i < 18; i++) {
        const bit = (vi >> i) & 1;
        const a = Math.floor(i / 3);
        const b = i % 3;
        setzeFunktion(a, groesse - 11 + b, bit);
        setzeFunktion(groesse - 11 + b, a, bit);
      }
    }

    // Datenbits im Zickzack von rechts unten nach oben
    const bits = [];
    finaleCodewords.forEach((cw) => {
      for (let i = 7; i >= 0; i--) bits.push((cw >> i) & 1);
    });
    let bitIdx = 0;
    let aufwaerts = true;
    for (let spalte = groesse - 1; spalte > 0; spalte -= 2) {
      if (spalte === 6) spalte--; // Taktmuster-Spalte überspringen
      for (let i = 0; i < groesse; i++) {
        const y = aufwaerts ? groesse - 1 - i : i;
        for (let s = 0; s < 2; s++) {
          const x = spalte - s;
          if (res[y][x]) continue;
          m[y][x] = bitIdx < bits.length ? bits[bitIdx++] : 0;
        }
      }
      aufwaerts = !aufwaerts;
    }

    return { m, res, groesse };
  }

  const MASKEN = [
    (x, y) => (x + y) % 2 === 0,
    (x, y) => y % 2 === 0,
    (x, y) => x % 3 === 0,
    (x, y) => (x + y) % 3 === 0,
    (x, y) => (Math.floor(y / 2) + Math.floor(x / 3)) % 2 === 0,
    (x, y) => ((x * y) % 2) + ((x * y) % 3) === 0,
    (x, y) => (((x * y) % 2) + ((x * y) % 3)) % 2 === 0,
    (x, y) => (((x + y) % 2) + ((x * y) % 3)) % 2 === 0
  ];

  // 15-Bit-Formatinformation: 5 Datenbits (Level+Maske) + BCH(15,5), XOR 0x5412.
  function formatBits(maske) {
    const daten = (0b01 << 3) | maske; // 01 = Level L
    let rest = daten << 10;
    const g = 0b10100110111;
    for (let i = 14; i >= 10; i--) {
      if ((rest >> i) & 1) rest ^= g << (i - 10);
    }
    return ((daten << 10) | rest) ^ 0b101010000010010;
  }

  function setzeFormat(m, groesse, maske) {
    const bits = formatBits(maske);
    for (let i = 0; i < 15; i++) {
      const bit = (bits >> i) & 1;
      // Kopie 1: um das linke obere Suchmuster
      if (i < 6) m[i][8] = bit;
      else if (i < 8) m[i + 1][8] = bit;
      else if (i === 8) m[8][7] = bit;
      else m[8][14 - i] = bit;
      // Kopie 2: verteilt an den anderen beiden Suchmustern
      if (i < 8) m[8][groesse - 1 - i] = bit;
      else m[groesse - 15 + i][8] = bit;
    }
  }

  // Bewertung nach Spec: je kleiner, desto besser scanbar.
  function strafe(m, groesse) {
    let p = 0;
    // Regel 1: >=5 gleiche Module in Reihe
    for (let y = 0; y < groesse; y++) {
      for (let richtung = 0; richtung < 2; richtung++) {
        let lauf = 1;
        for (let i = 1; i < groesse; i++) {
          const a = richtung ? m[i - 1][y] : m[y][i - 1];
          const b = richtung ? m[i][y] : m[y][i];
          if (a === b) { lauf++; } else { if (lauf >= 5) p += 3 + (lauf - 5); lauf = 1; }
        }
        if (lauf >= 5) p += 3 + (lauf - 5);
      }
    }
    // Regel 2: 2x2-Blöcke gleicher Farbe
    for (let y = 0; y < groesse - 1; y++) {
      for (let x = 0; x < groesse - 1; x++) {
        const v = m[y][x];
        if (v === m[y][x + 1] && v === m[y + 1][x] && v === m[y + 1][x + 1]) p += 3;
      }
    }
    // Regel 3: Suchmuster-ähnliche Folgen
    const muster1 = [1, 0, 1, 1, 1, 0, 1, 0, 0, 0, 0];
    const muster2 = [0, 0, 0, 0, 1, 0, 1, 1, 1, 0, 1];
    const passt = (arr, i, muster) => muster.every((v, j) => arr[i + j] === v);
    for (let y = 0; y < groesse; y++) {
      const zeile = m[y];
      const spalte = m.map((r) => r[y]);
      for (let i = 0; i + 11 <= groesse; i++) {
        if (passt(zeile, i, muster1) || passt(zeile, i, muster2)) p += 40;
        if (passt(spalte, i, muster1) || passt(spalte, i, muster2)) p += 40;
      }
    }
    // Regel 4: Abweichung vom 50/50-Verhältnis
    let dunkel = 0;
    for (let y = 0; y < groesse; y++) for (let x = 0; x < groesse; x++) if (m[y][x]) dunkel++;
    const prozent = (dunkel * 100) / (groesse * groesse);
    p += Math.floor(Math.abs(prozent - 50) / 5) * 10;
    return p;
  }

  // Baut die fertige Matrix: alle acht Masken durchrechnen, beste behalten.
  // maskeFix ist nur für die Verifikation gegen die Referenzimplementierung da
  // (qrcode.test.html) -- im Betrieb wählt die Bewertung die Maske selbst.
  function erzeuge(text, maskeFix) {
    const bytes = Array.from(new TextEncoder().encode(String(text)));
    const version = waehleVersion(bytes.length);
    const daten = baueDatenCodewords(bytes, version);
    const final = baueFinaleCodewords(daten, version);
    const { m, res, groesse } = baueMatrix(version, final);

    const kandidaten = (maskeFix === undefined || maskeFix === null) ? [0, 1, 2, 3, 4, 5, 6, 7] : [maskeFix];
    let beste = null;
    for (const maske of kandidaten) {
      const kandidat = m.map((zeile) => zeile.slice());
      for (let y = 0; y < groesse; y++) {
        for (let x = 0; x < groesse; x++) {
          if (!res[y][x] && MASKEN[maske](x, y)) kandidat[y][x] ^= 1;
        }
      }
      setzeFormat(kandidat, groesse, maske);
      const p = strafe(kandidat, groesse);
      if (!beste || p < beste.p) beste = { p, maske, matrix: kandidat };
    }
    return { matrix: beste.matrix, groesse, version, maske: beste.maske };
  }

  // Rendert als SVG. Bewusst SVG statt Canvas: skaliert verlustfrei, wenn der
  // Trainer das Handy hochhält oder der QR auf einen Beamer kommt.
  function zeichneQrCode(el, text, modulPx) {
    const { matrix, groesse } = erzeuge(text);
    const rand = 4; // "Quiet Zone", laut Spec mindestens 4 Module
    const gesamt = groesse + rand * 2;
    const px = modulPx || 6;
    let pfad = "";
    for (let y = 0; y < groesse; y++) {
      for (let x = 0; x < groesse; x++) {
        if (matrix[y][x]) pfad += `M${x + rand} ${y + rand}h1v1h-1z`;
      }
    }
    el.innerHTML =
      `<svg viewBox="0 0 ${gesamt} ${gesamt}" width="${gesamt * px}" height="${gesamt * px}" ` +
      `shape-rendering="crispEdges" role="img" aria-label="QR-Code zum Anmelden" ` +
      `style="max-width:100%;height:auto;background:#fff;border-radius:8px">` +
      `<path d="${pfad}" fill="#000"/></svg>`;
  }

  global.QRCodeMini = { erzeuge, zeichneQrCode };
})(typeof window !== "undefined" ? window : this);
