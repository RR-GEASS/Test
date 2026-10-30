import { ZipArchive } from "archiver";

const XML = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
const MAIN = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";
const REL = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const PACKAGE_REL = "http://schemas.openxmlformats.org/package/2006/relationships";
const MAX_ROWS = 200_000;
const MAX_COLUMNS = 100;
const MAX_CELLS = 5_000_000;
const MAX_BYTES = 128 * 1024 * 1024;

// XML 1.0 excludes control characters and lone UTF-16 surrogates. Valid
// surrogate pairs are preserved by the Unicode regular expression.
function xml(value) {
  return String(value)
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\ufffe\uffff\ud800-\udfff]/gu, "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;")
    .replace(/\r/g, "&#13;");
}

function columnName(index) {
  let name = "";
  for (let value = index + 1; value; value = Math.floor((value - 1) / 26))
    name = String.fromCharCode(65 + (value - 1) % 26) + name;
  return name;
}

function cellXML(value, reference, header) {
  const style = header ? ' s="1"' : "";
  if (value === null || value === undefined)
    return `<c r="${reference}"${style}/>`;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("Le classeur contient un nombre non fini.");
    return `<c r="${reference}"${style}><v>${value}</v></c>`;
  }
  if (typeof value === "boolean")
    return `<c r="${reference}" t="b"${style}><v>${value ? 1 : 0}</v></c>`;
  if (typeof value !== "string")
    throw new Error("Une cellule du classeur doit être un texte, un nombre ou un booléen.");
  if (value.length > 32767)
    throw new Error("Un texte du classeur dépasse la limite Excel de 32 767 caractères par cellule.");
  // inlineStr is deliberately used even for strings starting with '='. Bank
  // labels, references and notes are data, never formulas or external links.
  return `<c r="${reference}" t="inlineStr"${style}><is><t xml:space="preserve">${xml(value)}</t></is></c>`;
}

function worksheetXML(rows) {
  const columns = rows.reduce((maximum, row) => Math.max(maximum, row.length), 0);
  const last = `${columnName(Math.max(0, columns - 1))}${Math.max(1, rows.length)}`;
  const widths = Array.from({ length: columns }, (_, column) => {
    // A bounded sample keeps large financial exports quick to create.
    let width = 12;
    for (const row of rows.slice(0, 100)) {
      const value = row[column];
      if (value !== null && value !== undefined)
        width = Math.max(width, Math.min(55, String(value).length + 2));
    }
    return `<col min="${column + 1}" max="${column + 1}" width="${width}" customWidth="1"/>`;
  }).join("");
  const body = rows.map((row, index) => `<row r="${index + 1}"${index === 0 ? ' ht="30" customHeight="1"' : ""}>${row.map((value, column) => cellXML(value, `${columnName(column)}${index + 1}`, index === 0)).join("")}</row>`).join("");
  return `${XML}<worksheet xmlns="${MAIN}"><dimension ref="A1:${last}"/><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/><selection pane="bottomLeft" activeCell="A2" sqref="A2"/></sheetView></sheetViews><sheetFormatPr defaultRowHeight="15"/>${columns ? `<cols>${widths}</cols>` : ""}<sheetData>${body}</sheetData>${columns && rows.length ? `<autoFilter ref="A1:${last}"/>` : ""}</worksheet>`;
}

const styles = `${XML}<styleSheet xmlns="${MAIN}"><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font></fonts><fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF173B64"/><bgColor indexed="64"/></patternFill></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1" applyAlignment="1"><alignment vertical="center" wrapText="1"/></xf></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`;

/** Build a standalone XLSX without running spreadsheet formulas or macros.
 * Each sheet is { name, rows }, with row 1 used as its filtered header. */
export async function createWorkbook(sheets) {
  if (!Array.isArray(sheets) || !sheets.length || sheets.length > 20)
    throw new Error("Le classeur doit contenir entre 1 et 20 feuilles.");
  const names = new Set();
  let totalRows = 0, totalCells = 0;
  for (const sheet of sheets) {
    const name = sheet?.name;
    if (typeof name !== "string" || !name.trim() || name.length > 31 ||
      /[\[\]:*?/\\\u0000-\u001f]/.test(name) || /[\ufffe\uffff\ud800-\udfff]/u.test(name) || /^'|'$/.test(name))
      throw new Error("Le nom d’une feuille Excel est invalide (31 caractères maximum).");
    const key = name.normalize("NFC").toLocaleLowerCase("fr");
    if (names.has(key)) throw new Error("Les noms des feuilles Excel doivent être uniques.");
    names.add(key);
    if (!Array.isArray(sheet.rows)) throw new Error("Les lignes d’une feuille Excel sont invalides.");
    totalRows += sheet.rows.length;
    if (totalRows > MAX_ROWS) throw new Error("Le classeur dépasse 200 000 lignes.");
    for (const row of sheet.rows) {
      if (!Array.isArray(row) || row.length > MAX_COLUMNS)
        throw new Error("Une ligne du classeur dépasse 100 colonnes ou est invalide.");
      totalCells += row.length;
      if (totalCells > MAX_CELLS) throw new Error("Le classeur contient trop de cellules.");
    }
  }

  const entries = [
    ["[Content_Types].xml", `${XML}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${sheets.map((_, index) => `<Override PartName="/xl/worksheets/sheet${index + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join("")}</Types>`],
    ["_rels/.rels", `${XML}<Relationships xmlns="${PACKAGE_REL}"><Relationship Id="rId1" Type="${REL}/officeDocument" Target="xl/workbook.xml"/></Relationships>`],
    ["xl/workbook.xml", `${XML}<workbook xmlns="${MAIN}" xmlns:r="${REL}"><bookViews><workbookView/></bookViews><sheets>${sheets.map((sheet, index) => `<sheet name="${xml(sheet.name)}" sheetId="${index + 1}" r:id="rId${index + 1}"/>`).join("")}</sheets></workbook>`],
    ["xl/_rels/workbook.xml.rels", `${XML}<Relationships xmlns="${PACKAGE_REL}">${sheets.map((_, index) => `<Relationship Id="rId${index + 1}" Type="${REL}/worksheet" Target="worksheets/sheet${index + 1}.xml"/>`).join("")}<Relationship Id="rId${sheets.length + 1}" Type="${REL}/styles" Target="styles.xml"/></Relationships>`],
    ["xl/styles.xml", styles],
    ...sheets.map((sheet, index) => [`xl/worksheets/sheet${index + 1}.xml`, worksheetXML(sheet.rows)]),
  ];
  return new Promise((resolve, reject) => {
    const archive = new ZipArchive({ store: true });
    const chunks = [];
    let size = 0, failed = false;
    const fail = error => {
      if (failed) return;
      failed = true;
      archive.abort();
      reject(error);
    };
    archive.on("error", fail);
    archive.on("warning", fail);
    archive.on("data", chunk => {
      size += chunk.length;
      if (size > MAX_BYTES) return fail(new Error("Le classeur dépasse 128 Mo."));
      chunks.push(chunk);
    });
    archive.on("end", () => { if (!failed) resolve(Buffer.concat(chunks, size)); });
    for (const [name, content] of entries) archive.append(content, { name });
    archive.finalize().catch(fail);
  });
}
