// Bank downloads vary by institution and account type. No bank-specific
// positions are assumed: detected columns always remain editable in the UI.
const MAX_BYTES = 2 * 1024 * 1024;
const MAX_ROWS = 20_000;
const MAX_COLUMNS = 40;
const DELIMITERS = [";", ",", "\t"];
const ROLES = ["date", "label", "amount", "debit", "credit", "valueDate", "reference"];
const ROLE_LABELS = { date: "Date d’opération", label: "Libellé", amount: "Montant", debit: "Débit", credit: "Crédit", valueDate: "Date de valeur", reference: "Référence" };
const fold = value => String(value ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
const headerText = value => fold(value).replace(/[^a-z0-9]+/g, " ").trim();

export function decodeBankCSV(bytes, encoding = "auto") {
  const data = bytes instanceof ArrayBuffer ? new Uint8Array(bytes)
    : ArrayBuffer.isView(bytes) ? new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength) : null;
  if (!data) throw new Error("Le contenu du fichier CSV est invalide.");
  if (data.byteLength > MAX_BYTES) throw new Error("Le fichier bancaire dépasse 2 Mo.");
  if (!["auto", "utf-8", "windows-1252"].includes(encoding))
    throw new Error("Choisissez un encodage UTF-8 ou Windows-1252.");
  if (encoding !== "auto") {
    try { return new TextDecoder(encoding, { fatal: true }).decode(data); }
    catch { throw new Error("Le fichier ne correspond pas à l’encodage choisi."); }
  }
  try { return new TextDecoder("utf-8", { fatal: true }).decode(data); }
  catch { return new TextDecoder("windows-1252").decode(data); }
}

function readRecords(text, delimiter) {
  const records = [];
  let cells = [], cell = "", quoted = false, closed = false, line = 1, start = 1;
  const finishCell = () => {
    cells.push(cell);
    if (cells.length > MAX_COLUMNS) throw new Error("Le fichier contient plus de 40 colonnes.");
    cell = ""; closed = false;
  };
  const finishRecord = () => {
    finishCell();
    // Blank physical lines carry no bank movement. All other rows remain
    // visible, including totals/footers that must not be silently imported.
    if (cells.some(value => value.trim())) records.push({ sourceLineNumber: start, cells });
    if (records.length > MAX_ROWS + 100) throw new Error("Le fichier contient trop de lignes (20 000 mouvements maximum).");
    cells = [];
  };
  for (let index = 0; index < text.length; index++) {
    const char = text[index];
    if (quoted) {
      if (char === '"') {
        if (text[index + 1] === '"') { cell += '"'; index++; }
        else { quoted = false; closed = true; }
      } else if (char === "\r" || char === "\n") {
        if (char === "\r" && text[index + 1] === "\n") index++;
        cell += "\n"; line++;
      } else cell += char;
      continue;
    }
    if (char === delimiter) { finishCell(); continue; }
    if (char === "\r" || char === "\n") {
      if (char === "\r" && text[index + 1] === "\n") index++;
      finishRecord(); line++; start = line;
      continue;
    }
    if (char === '"') {
      if (closed || cell.trim()) throw new Error(`Guillemets CSV invalides à la ligne ${line}.`);
      cell = ""; quoted = true;
      continue;
    }
    if (closed && !/\s/.test(char)) throw new Error(`Un séparateur est attendu après les guillemets à la ligne ${line}.`);
    if (!closed) cell += char;
  }
  if (quoted) throw new Error(`Un champ entre guillemets n’est pas fermé à partir de la ligne ${start}.`);
  if (cell || cells.length || closed) finishRecord();
  return records;
}

function scoresFor(value) {
  const name = headerText(value);
  const scores = Object.fromEntries(ROLES.map(role => [role, 0]));
  if (!name || /\bsolde\b|\bbalance\b/.test(name)) return scores;
  const debit = /\bdebit\b/.test(name), credit = /\bcredit\b/.test(name);
  if (debit !== credit) scores[debit ? "debit" : "credit"] = 110;
  if ((/\bmontant\b|^amount$|^valeur en euros?$/.test(name) && !debit && !credit) || (debit && credit)) scores.amount = 100;
  if (/\bdate\b/.test(name)) {
    if (/\bvaleur\b|\bvalue\b/.test(name)) scores.valueDate = 110;
    else if (/\boperation\b|\bcomptable\b|\bcomptabilisation\b|\btransaction\b|\bbooking\b/.test(name)) scores.date = 120;
    else scores.date = 100;
  }
  if (/\breference\b|^ref$|\bidentifiant\b|\btransaction id\b|^(numero|n|id) (d )?operation$/.test(name)) scores.reference = 100;
  if (/\blibelle\b/.test(name)) scores.label = /\bcomplet\b|\bdetaille\b/.test(name) ? 120 : /\bsimplifie\b/.test(name) ? 100 : 110;
  else if (/^description$|^details?$/.test(name)) scores.label = 100;
  else if (/^operation$|^nature$|^intitule$|^motif$/.test(name)) scores.label = 80;
  return scores;
}

function detectMapping(headers) {
  const scores = headers.map(scoresFor);
  const mapping = Object.fromEntries(ROLES.map(role => [role, -1]));
  const warnings = [];
  let strength = 0;
  for (const role of ROLES) {
    const maximum = Math.max(0, ...scores.map(score => score[role]));
    const candidates = scores.flatMap((score, index) => score[role] === maximum && maximum ? [index] : []);
    if (candidates.length === 1) { mapping[role] = candidates[0]; strength += maximum; }
    else if (candidates.length > 1) warnings.push(`Plusieurs colonnes peuvent correspondre à « ${ROLE_LABELS[role]} » : choisissez la bonne colonne dans l’aperçu.`);
  }
  return { mapping, warnings, strength };
}

function chooseHeader(records, requested) {
  if (requested !== "auto") {
    const number = Number(requested);
    if (!Number.isInteger(number) || number < 1) throw new Error("La ligne d’en-tête doit être un numéro de ligne valide.");
    const index = records.findIndex(record => record.sourceLineNumber === number);
    if (index < 0) throw new Error("La ligne choisie est vide, absente ou située dans un champ entre guillemets.");
    return index;
  }
  let best = -1, bestScore = -1;
  for (let index = 0; index < Math.min(records.length, 100); index++) {
    const record = records[index];
    if (record.cells.length < 2) continue;
    const detected = detectMapping(record.cells);
    const score = detected.strength + (detected.mapping.date >= 0 ? 100 : 0) + (detected.mapping.label >= 0 ? 100 : 0);
    if (score > bestScore) { best = index; bestScore = score; }
  }
  return best < 0 ? 0 : best;
}

export function inspectBankCSV(text, { delimiter = "auto", headerRow = "auto" } = {}) {
  if (typeof text !== "string" || !text.trim()) throw new Error("Le fichier bancaire est vide.");
  if (text.length > MAX_BYTES) throw new Error("Le fichier bancaire dépasse 2 Mo.");
  if (/\u0000/.test(text)) throw new Error("Ce fichier n’est pas un CSV texte. Exportez les opérations au format CSV.");
  text = text.replace(/^\uFEFF/, "");
  if (delimiter !== "auto" && !DELIMITERS.includes(delimiter)) throw new Error("Choisissez un séparateur point-virgule, virgule ou tabulation.");
  let best = null, firstError = null;
  for (const candidate of delimiter === "auto" ? DELIMITERS : [delimiter]) {
    try {
      const all = readRecords(text, candidate);
      if (!all.length) throw new Error("Le fichier bancaire est vide.");
      const index = chooseHeader(all, headerRow);
      const headers = all[index].cells.map(value => value.trim());
      const detection = detectMapping(headers);
      // A wrong delimiter often leaves the entire header in one cell; words
      // from that cell must not outscore a real multi-column header.
      const score = headers.length >= 2 ? detection.strength * 100 + headers.length : -1;
      if (!best || score > best.score) best = {
        score, headers, records: all.slice(index + 1), mapping: detection.mapping,
        warnings: detection.warnings, delimiter: candidate, headerRow: all[index].sourceLineNumber,
      };
    } catch (error) { firstError ||= error; }
  }
  if (!best) throw firstError || new Error("Le fichier CSV n’a pas pu être lu.");
  if (best.records.length > MAX_ROWS) throw new Error("Importez au maximum 20 000 mouvements à la fois.");
  const { score, ...result } = best;
  return result;
}

function bankDate(value) {
  const raw = String(value ?? "").trim();
  let date;
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) date = raw;
  else {
    const match = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(raw);
    if (!match) return null;
    date = `${match[3]}-${match[2].padStart(2, "0")}-${match[1].padStart(2, "0")}`;
  }
  const [year, month, day] = date.split("-").map(Number);
  const checked = new Date(Date.UTC(year, month - 1, day));
  return year >= 1000 && checked.getUTCFullYear() === year && checked.getUTCMonth() === month - 1 && checked.getUTCDate() === day ? date : null;
}

function bankMoney(value) {
  let raw = String(value ?? "").trim().replace(/^(EUR|€)\s*|\s*(EUR|€)$/gi, "").replace(/[\s\u00a0\u202f]/g, "");
  // Where both separators occur, only a complete thousands grouping is
  // accepted. Three decimal digits alone remain ambiguous and are rejected.
  if (/^[+-]?\d{1,3}(?:\.\d{3})+,\d{1,2}$/.test(raw)) raw = raw.replace(/\./g, "");
  else if (/^[+-]?\d{1,3}(?:,\d{3})+\.\d{1,2}$/.test(raw)) raw = raw.replace(/,/g, "");
  if (!/^[+-]?\d+(?:[.,]\d{1,2})?$/.test(raw)) return null;
  const negative = raw.startsWith("-");
  const [whole, fraction = ""] = raw.replace(/^[+-]/, "").replace(",", ".").split(".");
  const cents = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
  return Number.isSafeInteger(cents) && cents <= 100_000_000_000 ? (negative ? -cents : cents) : null;
}

export function parseBankCSV(text, { mapping: overrides, delimiter = "auto", headerRow = "auto", amountMode = "auto" } = {}) {
  const inspected = inspectBankCSV(text, { delimiter, headerRow });
  const mapping = { ...inspected.mapping };
  const errors = [], rows = [], warnings = [...inspected.warnings];
  const fail = message => errors.push({ sourceLineNumber: inspected.headerRow, message });
  if (overrides !== undefined && (!overrides || typeof overrides !== "object" || Array.isArray(overrides))) fail("Le choix des colonnes est invalide.");
  else if (overrides) for (const role of ROLES) {
    if (overrides[role] !== undefined) mapping[role] = overrides[role] === "" ? -1
      : typeof overrides[role] === "number" || typeof overrides[role] === "string" ? Number(overrides[role]) : NaN;
  }
  for (const role of ROLES) if (!Number.isInteger(mapping[role]) || mapping[role] < -1 || mapping[role] >= inspected.headers.length) fail(`La colonne « ${ROLE_LABELS[role]} » est invalide.`);
  if (!["auto", "signed", "split"].includes(amountMode)) fail("Choisissez un montant signé ou deux colonnes débit/crédit.");
  const split = amountMode === "split" || (amountMode === "auto" && mapping.debit >= 0 && mapping.credit >= 0);
  if (amountMode === "auto" && split && mapping.amount >= 0) warnings.push("Plusieurs formats de montant sont présents. L’aperçu utilise les colonnes Débit et Crédit ; vérifiez ce choix.");
  const required = ["date", "label", ...(split ? ["debit", "credit"] : ["amount"])];
  for (const role of required) if (mapping[role] < 0) fail(`Choisissez la colonne « ${ROLE_LABELS[role]} » dans l’aperçu.`);
  const selected = [...required, ...["valueDate", "reference"].filter(role => mapping[role] >= 0)];
  if (new Set(selected.map(role => mapping[role])).size !== selected.length) fail("Chaque information doit utiliser une colonne différente.");
  if (required.some(role => role === "amount" && /\bsolde\b|\bbalance\b/.test(headerText(inspected.headers[mapping[role]])))) fail("La colonne de solde ne peut pas servir de montant d’opération.");
  if (errors.length) return { ...inspected, mapping, amountMode: split ? "split" : "signed", rows, errors, warnings };
  if (!inspected.records.length) warnings.push("Aucun mouvement ne figure après la ligne d’en-tête.");
  const directionColumns = inspected.headers.flatMap((header, index) => /^(sens|direction|sens (de l )?operation|sens (du )?mouvement)$/.test(headerText(header)) ? [index] : []);
  let negativeDebits = false;
  for (const record of inspected.records) {
    const error = message => errors.push({ sourceLineNumber: record.sourceLineNumber, message });
    if (record.cells.length !== inspected.headers.length) { error(`Le nombre de colonnes (${record.cells.length}) ne correspond pas à l’en-tête (${inspected.headers.length}).`); continue; }
    const cell = role => mapping[role] >= 0 ? record.cells[mapping[role]].trim() : "";
    const date = bankDate(cell("date")), valueDate = cell("valueDate") ? bankDate(cell("valueDate")) : "";
    if (!date) { error("Date d’opération invalide : utilisez JJ/MM/AAAA ou AAAA-MM-JJ."); continue; }
    if (valueDate === null) { error("Date de valeur invalide : utilisez JJ/MM/AAAA ou AAAA-MM-JJ."); continue; }
    const label = cell("label"), reference = cell("reference");
    if (!label || label.length > 1000 || reference.length > 300) { error("Renseignez un libellé de 1 à 1 000 caractères et une référence de 300 caractères maximum."); continue; }
    let amountCents;
    if (split) {
      const debit = cell("debit") ? bankMoney(cell("debit")) : 0;
      const credit = cell("credit") ? bankMoney(cell("credit")) : 0;
      if (debit === null || credit === null || credit < 0 || (debit !== 0 && credit !== 0)) { error("Vérifiez le débit et le crédit : un seul montant non nul est attendu, sans crédit négatif."); continue; }
      if (debit < 0) negativeDebits = true;
      amountCents = debit ? -Math.abs(debit) : credit;
    } else amountCents = bankMoney(cell("amount"));
    if (amountCents === null || amountCents === 0) { error("Montant invalide ou nul : utilisez au maximum deux décimales, avec un signe négatif pour un décaissement."); continue; }
    if (!split && directionColumns.some(index => {
      const direction = headerText(record.cells[index]);
      if (!direction) return false;
      const expected = ["d", "debit", "debiteur", "sortie", "dbit"].includes(direction) ? -1
        : ["c", "credit", "crediteur", "entree", "crdt"].includes(direction) ? 1 : null;
      return expected === null || Math.sign(amountCents) !== expected;
    })) {
      error("Le signe du montant ne correspond pas à la colonne Sens. Choisissez un export avec des montants signés ou deux colonnes Débit et Crédit.");
      continue;
    }
    rows.push({ date, valueDate, label, amountCents, reference, sourceLineNumber: record.sourceLineNumber });
  }
  if (negativeDebits) warnings.push("Les montants négatifs de la colonne Débit sont conservés comme décaissements.");
  return { ...inspected, mapping, amountMode: split ? "split" : "signed", rows, errors, warnings: [...new Set(warnings)] };
}
