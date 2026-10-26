const encoder = new TextEncoder();

function truncate(value, maxCharacters, maxBytes) {
  let result = "";
  let characters = 0;
  let bytes = 0;
  for (const character of value) {
    const size = encoder.encode(character).length;
    if (characters >= maxCharacters || bytes + size > maxBytes) break;
    result += character;
    characters += 1;
    bytes += size;
  }
  return result;
}

/** A readable filename component valid on Windows, macOS and Linux. */
export function documentBaseName(label, maxLength = 150) {
  const limit =
    Number.isInteger(maxLength) && maxLength > 0
      ? Math.min(maxLength, 180)
      : 150;
  let value = String(label ?? "")
    .replace(/[\uD800-\uDFFF]/gu, "_")
    .normalize("NFC")
    .replace(/[<>:"/\\|?*]+/gu, " - ")
    .replace(/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/gu, " ")
    .replace(/\s+/gu, " ")
    .replace(/^[.\s-]+|[.\s-]+$/gu, "")
    .trim();
  if (!value) value = "Document";
  // Windows reserves these basenames even when an extension is present.
  if (
    /^(con|prn|aux|nul|conin\$|conout\$|com[1-9¹²³]|lpt[1-9¹²³])(?:\.|$)/iu.test(
      value,
    )
  ) {
    value = `Document - ${value}`;
  }
  value = truncate(value, limit, 200).replace(/[.\s-]+$/gu, "");
  if (!value) value = truncate("Document", limit, 200);
  if (
    /^(con|prn|aux|nul|conin\$|conout\$|com[1-9¹²³]|lpt[1-9¹²³])$/iu.test(value)
  ) {
    value = truncate(`_${value}`, limit, 200);
  }
  return value;
}

/** Preserve the actual document extension; suffixes distinguish multiple files. */
export function documentFileName(label, originalOrExtension, sequence = 1) {
  if (!Number.isSafeInteger(sequence) || sequence < 1) {
    throw new Error("Le numéro du justificatif est invalide.");
  }
  const original = String(originalOrExtension ?? "").trim();
  const extension = original.match(/(?:^|\.)(pdf|jpe?g|png)$/iu)?.[1];
  if (!extension) throw new Error("L’extension du justificatif est invalide.");
  const suffix = sequence === 1 ? "" : ` (${sequence})`;
  return `${documentBaseName(label)}${suffix}.${extension}`;
}
