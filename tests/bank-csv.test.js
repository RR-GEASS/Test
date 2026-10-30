import test from "node:test";
import assert from "node:assert/strict";
import { decodeBankCSV, inspectBankCSV, parseBankCSV } from "../src/bank-csv.js";

test("le CSV français identifie ses colonnes après un préambule sans confondre le solde", () => {
  const text = '\uFEFFCompte SCI;FR76 0000\r\nPériode;Octobre 2026\r\nDate de valeur;Libellé;Date comptable;Débit;Crédit;Solde\r\n06/10/2026;VIREMENT LOYER;05/10/2026;;750,00;2 000,00\r\n11/10/2026;ASSURANCE;10/10/2026;32,50;;1 967,50';
  const inspected = inspectBankCSV(text);
  assert.equal(inspected.delimiter, ";");
  assert.equal(inspected.headerRow, 3);
  assert.deepEqual(inspected.mapping, { date: 2, label: 1, amount: -1, debit: 3, credit: 4, valueDate: 0, reference: -1 });
  const parsed = parseBankCSV(text);
  assert.deepEqual(parsed.errors, []);
  assert.deepEqual(parsed.rows, [
    { date: "2026-10-05", valueDate: "2026-10-06", label: "VIREMENT LOYER", amountCents: 75000, reference: "", sourceLineNumber: 4 },
    { date: "2026-10-10", valueDate: "2026-10-11", label: "ASSURANCE", amountCents: -3250, reference: "", sourceLineNumber: 5 },
  ]);
});

test("les guillemets, séparateurs dans les libellés et champs multilignes conservent les lignes source", () => {
  const text = 'Date,Description,Amount,Référence\n2026-10-05,"VIR ""LOYER"", appartement\nÉrable","+750,20",REF-1\n2026-10-10,ASSURANCE,-32.50,REF-2\n';
  const parsed = parseBankCSV(text);
  assert.equal(parsed.delimiter, ",");
  assert.deepEqual(parsed.errors, []);
  assert.equal(parsed.rows[0].label, 'VIR "LOYER", appartement\nÉrable');
  assert.equal(parsed.rows[0].amountCents, 75020);
  assert.equal(parsed.rows[0].sourceLineNumber, 2);
  assert.equal(parsed.rows[1].sourceLineNumber, 4);
  assert.equal(parsed.rows[1].amountCents, -3250);
});

test("les colonnes inconnues restent configurables sans schéma de banque figé", () => {
  const text = "Compte\nJour\tTexte banque\tSomme\tCode\n05/10/2026\tLoyer\t1\u202f234,56 €\tABC";
  const inspected = inspectBankCSV(text);
  assert.equal(inspected.headerRow, 2);
  assert.equal(inspected.delimiter, "\t");
  const auto = parseBankCSV(text);
  assert.equal(auto.rows.length, 0);
  assert.ok(auto.errors.length);
  const configured = parseBankCSV(text, {
    delimiter: "\t", headerRow: 2, mapping: { date: 0, label: 1, amount: 2, reference: 3 }, amountMode: "signed",
  });
  assert.deepEqual(configured.errors, []);
  assert.equal(configured.rows[0].amountCents, 123456);
  assert.equal(configured.rows[0].reference, "ABC");
});

test("les montants ne sont jamais arrondis et les dates impossibles restent des erreurs visibles", () => {
  const parsed = parseBankCSV("Date;Libellé;Montant\n29/02/2026;Impossible;1,00\n01/03/2026;Trois décimales;1,234\n02/03/2026;Zéro;0\n03/03/2026;Valide;-10,01\nTotal;;-10,01");
  assert.equal(parsed.rows.length, 1);
  assert.equal(parsed.rows[0].amountCents, -1001);
  assert.deepEqual(parsed.errors.map(error => error.sourceLineNumber), [2, 3, 4, 6]);
  assert.match(parsed.errors[0].message, /Date/);
  assert.match(parsed.errors[1].message, /Montant/);
  assert.equal(parsed.rows[0].date, "2026-03-03");
});

test("le mode débit crédit signale les conflits et conserve les débits négatifs comme décaissements", () => {
  const parsed = parseBankCSV("Date opération;Libellé;Débit;Crédit\n01/10/2026;Deux sens;10,00;20,00\n02/10/2026;Débit signé;-10,15;\n03/10/2026;Crédit négatif;;-5,00\n04/10/2026;Rien;;");
  assert.deepEqual(parsed.errors.map(error => error.sourceLineNumber), [2, 4, 5]);
  assert.equal(parsed.rows.length, 1);
  assert.equal(parsed.rows[0].amountCents, -1015);
  assert.match(parsed.warnings.join(" "), /négatifs/);
});

test("le choix du montant signé ou des deux colonnes peut être explicite", () => {
  const text = "Date;Libellé;Montant;Débit;Crédit\n01/10/2026;Exemple;-25,00;25,00;";
  const signed = parseBankCSV(text, { amountMode: "signed" });
  const split = parseBankCSV(text, { amountMode: "split" });
  assert.deepEqual(signed.errors, []);
  assert.deepEqual(split.errors, []);
  assert.equal(signed.rows[0].amountCents, -2500);
  assert.equal(split.rows[0].amountCents, -2500);
});

test("une colonne de solde ou une colonne ambiguë ne devient pas un montant par défaut", () => {
  const balance = "Date;Libellé;Solde\n01/10/2026;Exemple;1500,00";
  assert.equal(inspectBankCSV(balance).mapping.amount, -1);
  assert.ok(parseBankCSV(balance, { mapping: { amount: 2 } }).errors.some(error => /solde/.test(error.message)));
  const ambiguous = "Date;Libellé;Montant;Montant\n01/10/2026;Exemple;10,00;50,00";
  assert.equal(inspectBankCSV(ambiguous).mapping.amount, -1);
  assert.ok(parseBankCSV(ambiguous).errors.length);
  assert.deepEqual(parseBankCSV(ambiguous, { mapping: { amount: 2 } }).rows.map(row => row.amountCents), [1000]);
  assert.ok(parseBankCSV(ambiguous, { mapping: { amount: 0 } }).errors.some(error => /différente/.test(error.message)));
});

test("les libellés détaillés sont préférés aux libellés simplifiés", () => {
  const result = parseBankCSV("Date;Libellé simplifié;Libellé complet;Montant\n01/10/2026;VIR;VIR LOCATAIRE APPARTEMENT;-100,00");
  assert.equal(result.mapping.label, 2);
  assert.equal(result.rows[0].label, "VIR LOCATAIRE APPARTEMENT");
});

test("UTF-8 et Windows-1252 sont décodés sans perdre les accents, y compris sur une vue partielle", () => {
  const utf8 = new TextEncoder().encode("Date;Libellé;Montant\n01/10/2026;Échéance;-10,00");
  assert.match(decodeBankCSV(utf8), /Échéance/);
  const latin = Uint8Array.from([0x78, 0x4c, 0x69, 0x62, 0x65, 0x6c, 0x6c, 0xe9, 0x3b, 0x80, 0x79]);
  assert.equal(decodeBankCSV(latin.subarray(1, -1)), "Libellé;€");
  assert.throws(() => decodeBankCSV(latin, "utf-8"), /encodage/);
  assert.throws(() => decodeBankCSV(new Uint8Array(2 * 1024 * 1024 + 1)), /2 Mo/);
});

test("les fichiers malformés, colonnes excédentaires et lignes mal alignées sont rejetés", () => {
  assert.throws(() => parseBankCSV('Date;Libellé;Montant\n01/10/2026;"Jamais fermé;10,00'), /guillemets/);
  const aligned = parseBankCSV("Date;Libellé;Montant\n01/10/2026;Trop;10,00;COLONNE\n02/10/2026;Correct;20,00");
  assert.equal(aligned.rows.length, 1);
  assert.match(aligned.errors[0].message, /nombre de colonnes/);
  assert.throws(() => inspectBankCSV("Date\u0000Libellé"), /CSV texte/);
  assert.throws(() => inspectBankCSV("Date;Libellé;Montant", { headerRow: 0 }), /en-tête/);
  assert.ok(parseBankCSV("Date;Libellé;Montant\n01/10/2026;Test;1,00", { mapping: { amount: 100 } }).errors.length);
});

test("les groupes de milliers ne sont acceptés que si le format ne demande aucun arrondi", () => {
  const result = parseBankCSV('Date;Libellé;Montant\n01/10/2026;FR;1.234,56\n02/10/2026;US;1,234.56\n03/10/2026;Ambigu;1.234');
  assert.deepEqual(result.rows.map(row => row.amountCents), [123456, 123456]);
  assert.deepEqual(result.errors.map(error => error.sourceLineNumber), [4]);
});

test("une colonne de sens ne peut pas transformer silencieusement un débit positif en recette", () => {
  const result = parseBankCSV("Date;Libellé;Montant;Sens\n01/10/2026;Débit non signé;10,00;D\n02/10/2026;Crédit signé;25,00;C\n03/10/2026;Débit signé;-10,00;Débit");
  assert.equal(result.rows.length, 2);
  assert.deepEqual(result.rows.map(row => row.amountCents), [2500, -1000]);
  assert.equal(result.errors.length, 1);
  assert.match(result.errors[0].message, /colonne Sens/);
});
