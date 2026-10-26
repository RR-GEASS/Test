import test from "node:test";
import assert from "node:assert/strict";
import { documentBaseName, documentFileName } from "../src/document-names.js";

test("un nom reprend le libellé lisible et conserve l’extension du document", () => {
  const label =
    "Encaissement · République T2 · Loyer et provisions · novembre 2026";
  assert.equal(
    documentFileName(label, "scan du téléphone.PDF"),
    label + ".PDF",
  );
  assert.equal(documentFileName(label, "photo.jpeg", 2), label + " (2).jpeg");
  assert.equal(documentFileName(label, ".png", 3), label + " (3).png");
  assert.equal(documentFileName(label, "jpg"), label + ".jpg");
});
test("les caractères de chemin, contrôles et noms réservés Windows ne créent pas de fichier dangereux", () => {
  for (const label of [
    '../Facture/été\\scan:"?*<>|',
    "\u0000\n\r..",
    "CON",
    "nul.txt",
    "LPT9",
    "AUX",
    "COM¹",
    "lpt².txt",
    "CONIN$",
    "CONOUT$",
  ]) {
    const name = documentFileName(label, "doc.pdf");
    assert.equal(/[<>:"/\\|?*\u0000-\u001f\u007f-\u009f]/u.test(name), false);
    assert.equal(
      /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/iu.test(name),
      false,
    );
    assert.equal(name.startsWith("."), false);
    assert.equal(name.endsWith(".pdf"), true);
  }
  assert.equal(documentBaseName("  ..  "), "Document");
  assert.equal(documentBaseName("   SCI / Général  "), "SCI - Général");
  assert.equal(documentBaseName("facture\u202eexe"), "facture exe");
});
test("les noms longs sont bornés aussi en octets UTF-8 sans couper un caractère", () => {
  const value = documentFileName(
    "É".repeat(400) + "😀".repeat(400),
    "file.png",
    20,
  );
  assert.ok(value.length <= 180);
  assert.ok(Buffer.byteLength(value, "utf8") <= 225);
  assert.equal(value.includes("\ufffd"), false);
  assert.equal(value.endsWith(" (20).png"), true);
  assert.doesNotThrow(() =>
    encodeURIComponent(documentFileName("Libellé \ud800", "x.pdf")),
  );
  assert.equal(
    documentFileName("Libellé \ud800", "x.pdf").includes("\ud800"),
    false,
  );
  assert.equal([...documentBaseName("abc", 1)].length, 1);
});
test("les extensions non autorisées et les suffixes invalides sont rejetés", () => {
  for (const source of ["file.exe", "file.pdf.exe", "file.svg", "file", null])
    assert.throws(() => documentFileName("Nom", source));
  for (const sequence of [0, -1, 1.5, NaN])
    assert.throws(() => documentFileName("Nom", "x.pdf", sequence));
});
