import test from "node:test";
import assert from "node:assert/strict";
import { inflateRawSync } from "node:zlib";
import { createWorkbook } from "../server/workbook.js";

function zipFiles(bytes) {
  let end = -1;
  for (let at = bytes.length - 22; at >= Math.max(0, bytes.length - 65557); at--)
    if (bytes.readUInt32LE(at) === 0x06054b50) { end = at; break; }
  assert.ok(end >= 0, "a real ZIP central directory is present");
  const count = bytes.readUInt16LE(end + 10);
  let cursor = bytes.readUInt32LE(end + 16);
  const entries = new Map();
  for (let index = 0; index < count; index++) {
    assert.equal(bytes.readUInt32LE(cursor), 0x02014b50);
    const method = bytes.readUInt16LE(cursor + 10);
    const size = bytes.readUInt32LE(cursor + 20);
    const nameLength = bytes.readUInt16LE(cursor + 28);
    const extraLength = bytes.readUInt16LE(cursor + 30);
    const commentLength = bytes.readUInt16LE(cursor + 32);
    const local = bytes.readUInt32LE(cursor + 42);
    const name = bytes.subarray(cursor + 46, cursor + 46 + nameLength).toString("utf8");
    assert.equal(bytes.readUInt32LE(local), 0x04034b50);
    const dataAt = local + 30 + bytes.readUInt16LE(local + 26) + bytes.readUInt16LE(local + 28);
    const data = bytes.subarray(dataAt, dataAt + size);
    assert.ok(method === 0 || method === 8);
    entries.set(name, (method === 0 ? data : inflateRawSync(data)).toString("utf8"));
    cursor += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

test("the workbook is a complete XLSX with separately linked sheets, frozen headers and filters", async () => {
  const files = zipFiles(await createWorkbook([
    { name: "Opérations", rows: [["Libellé", "Montant", "Vérifié"], ["Loyer", 850.25, true], ["Assurance", -42, false]] },
    { name: "Rapprochement bancaire", rows: [["Date", "Banque"], ["2026-10-05", "Caisse d’Épargne"]] },
    { name: "Biens & associés", rows: [] },
  ]));
  assert.deepEqual([...files.keys()].sort(), [
    "[Content_Types].xml", "_rels/.rels", "xl/_rels/workbook.xml.rels", "xl/styles.xml", "xl/workbook.xml",
    "xl/worksheets/sheet1.xml", "xl/worksheets/sheet2.xml", "xl/worksheets/sheet3.xml",
  ].sort());
  assert.match(files.get("[Content_Types].xml"), /spreadsheetml\.sheet\.main\+xml/);
  assert.match(files.get("[Content_Types].xml"), /PartName="\/xl\/worksheets\/sheet3.xml"/);
  assert.match(files.get("_rels/.rels"), /officeDocument" Target="xl\/workbook.xml"/);
  assert.match(files.get("xl/workbook.xml"), /name="Opérations" sheetId="1" r:id="rId1"/);
  assert.match(files.get("xl/workbook.xml"), /name="Biens &amp; associés" sheetId="3"/);
  assert.match(files.get("xl/_rels/workbook.xml.rels"), /Id="rId2"[^>]*Target="worksheets\/sheet2.xml"/);
  assert.match(files.get("xl/styles.xml"), /<b\/>/);
  const sheet = files.get("xl/worksheets/sheet1.xml");
  assert.match(sheet, /<pane ySplit="1"[^>]*state="frozen"/);
  assert.match(sheet, /<autoFilter ref="A1:C3"\/>/);
  assert.match(sheet, /<c r="B2"><v>850\.25<\/v><\/c>/);
  assert.match(sheet, /<c r="B3"><v>-42<\/v><\/c>/);
  assert.match(sheet, /<c r="C2" t="b"><v>1<\/v><\/c>/);
  assert.match(sheet, /<c r="C3" t="b"><v>0<\/v><\/c>/);
  assert.match(files.get("xl/worksheets/sheet3.xml"), /<sheetData><\/sheetData>/);
});

test("external labels remain literal text, XML is escaped and invalid control characters are removed", async () => {
  const files = zipFiles(await createWorkbook([{ name: "Données", rows: [
    ["Valeur", "Note"],
    ['=HYPERLINK("https://example.test","clic")', "<&>\"'"],
    ["+123", "@SUM(A1:A9)"],
    ["-42", "\u0000\u0001\u000b\ud800Texte 🏠\r\nSuite\ufffe"],
    [null, undefined],
  ] }]));
  const xml = files.get("xl/worksheets/sheet1.xml");
  assert.doesNotMatch(xml, /<f(?:\s|>)/);
  assert.match(xml, /t="inlineStr"[^>]*><is><t xml:space="preserve">=HYPERLINK\(&quot;/);
  assert.match(xml, /&lt;&amp;&gt;&quot;&apos;/);
  assert.match(xml, />\+123<\/t>/);
  assert.match(xml, />-42<\/t>/);
  assert.match(xml, /Texte 🏠&#13;\nSuite/);
  assert.doesNotMatch(xml, /[\u0000\u0001\u000b\ufffe\ud800]/u);
  assert.match(xml, /<c r="A5"\/><c r="B5"\/>/);
  assert.equal([...files.keys()].some(name => /externalLink|vba|macros/i.test(name)), false);
});

test("column references continue beyond Z without dropping sparse trailing columns", async () => {
  const header = Array.from({ length: 100 }, (_, index) => `Colonne ${index + 1}`);
  const row = Array.from({ length: 100 }, (_, index) => index);
  const sheet = zipFiles(await createWorkbook([{ name: "Large", rows: [header, row] }])).get("xl/worksheets/sheet1.xml");
  assert.match(sheet, /dimension ref="A1:CV2"/);
  assert.match(sheet, /<c r="Z2"><v>25<\/v>/);
  assert.match(sheet, /<c r="AA2"><v>26<\/v>/);
  assert.match(sheet, /<c r="CV2"><v>99<\/v>/);
});

test("invalid sheet names, non-finite numbers and overlong text fail before producing a misleading workbook", async () => {
  for (const name of ["", "   ", "A/B", "X:Y", "[Banque]", "A\\B", "'Feuille", "Feuille'", "x".repeat(32)])
    await assert.rejects(createWorkbook([{ name, rows: [] }]), /nom.*feuille/i);
  await assert.rejects(createWorkbook([{ name: "Biens", rows: [] }, { name: "BIENS", rows: [] }]), /uniques/);
  await assert.rejects(createWorkbook([{ name: "Données", rows: [] }, { name: "Donne\u0301es", rows: [] }]), /uniques/);
  for (const value of [NaN, Infinity, -Infinity])
    await assert.rejects(createWorkbook([{ name: "Test", rows: [["Montant"], [value]] }]), /nombre non fini/);
  await assert.rejects(createWorkbook([{ name: "Test", rows: [["Note"], ["x".repeat(32768)]] }]), /32 767/);
  await assert.rejects(createWorkbook([{ name: "Test", rows: [[{}]] }]), /cellule/);
  await assert.rejects(createWorkbook([{ name: "Test", rows: [new Array(101).fill(0)] }]), /100 colonnes/);
  await assert.rejects(createWorkbook([]), /entre 1 et 20/);
});
