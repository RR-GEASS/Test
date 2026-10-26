import express from "express";
import { randomUUID } from "node:crypto";
import { decodeName, detectDocument, disposition, accountDocumentBytes } from "./attachments.js";
import { documentFileName } from "../src/document-names.js";

export const ENTITY_DOCUMENT_TYPES = {
  supplier: { contrat: "Contrat fournisseur", assurance: "Attestation d’assurance", autre: "Document fournisseur" },
  tenant: { garant: "Document du garant", autre: "Document locataire" },
  lease: { bail: "Bail", avenant: "Avenant", etat_entree: "État des lieux d’entrée", etat_sortie: "État des lieux de sortie", assurance: "Assurance habitation", autre: "Document de location" },
};
const collections = { supplier: "suppliers", tenant: "tenants", lease: "leases" };
const MAX_FILE = 5 * 1024 * 1024;
const MAX_ACCOUNT = 50 * 1024 * 1024;

export function installEntityDocuments(app, db, requireUser) {
  db.exec(`CREATE TABLE IF NOT EXISTS entity_documents (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    kind TEXT NOT NULL CHECK(kind IN ('supplier','tenant','lease')),
    entity_id TEXT NOT NULL,
    document_type TEXT NOT NULL,
    name TEXT NOT NULL,
    original_name TEXT NOT NULL,
    mime TEXT NOT NULL,
    size_bytes INTEGER NOT NULL CHECK(size_bytes > 0 AND size_bytes <= 5242880),
    created_at TEXT NOT NULL,
    data BLOB NOT NULL CHECK(length(data) = size_bytes)
  );
  CREATE INDEX IF NOT EXISTS entity_documents_owner_entity ON entity_documents(user_id,kind,entity_id);`);

  function entityFor(userId, kind, id) {
    if (!Object.hasOwn(collections, kind)) return null;
    const record = db.prepare("SELECT state FROM users WHERE id=?").get(userId);
    if (!record) return null;
    const state = JSON.parse(record.state);
    const entity = state[collections[kind]]?.find((row) => row.id === id);
    if (!entity) return null;
    const title = kind === "lease"
      ? `${state.properties.find((p) => p.id === entity.propertyId)?.name || "Location"} · ${state.tenants?.find((t) => t.id === entity.tenantId)?.name || "Locataire"} · ${entity.startDate}`
      : entity.name;
    return { entity, title };
  }
  function ownsEntity(req, res, next) {
    req.documentEntity = entityFor(req.user.id, req.params.kind, req.params.id);
    if (!req.documentEntity) return res.status(404).json({ error: "Cette fiche est introuvable." });
    next();
  }
  const metadata = (row) => ({
    id: row.id, name: row.name, originalName: row.original_name,
    mime: row.mime, size: row.size_bytes, createdAt: row.created_at,
    documentType: row.document_type,
  });
  const raw = express.raw({ type: "application/octet-stream", limit: MAX_FILE });
  function receive(req, res, next) {
    if (!req.is("application/octet-stream")) return res.status(415).json({ error: "Envoyez le fichier en application/octet-stream." });
    raw(req, res, (error) => {
      if (error?.type === "entity.too.large") return res.status(413).json({ error: "Le document dépasse 5 Mo." });
      if (error) return next(error);
      next();
    });
  }
  app.get("/api/entities/:kind/:id/documents", requireUser, ownsEntity, (req, res) => {
    const documents = db.prepare("SELECT id,name,original_name,mime,size_bytes,created_at,document_type FROM entity_documents WHERE user_id=? AND kind=? AND entity_id=? ORDER BY created_at,id")
      .all(req.user.id, req.params.kind, req.params.id);
    res.json({ documents: documents.map(metadata) });
  });
  app.post("/api/entities/:kind/:id/documents", requireUser, receive, ownsEntity, (req, res) => {
    const originalName = decodeName(req.get("x-file-name"));
    if (!originalName) return res.status(400).json({ error: "Le nom du fichier est invalide (160 caractères maximum, sans chemin)." });
    const documentType = req.get("x-document-type") || "autre";
    if (!Object.hasOwn(ENTITY_DOCUMENT_TYPES[req.params.kind], documentType))
      return res.status(400).json({ error: "Choisissez un type de document adapté à cette fiche." });
    const detected = detectDocument(req.body);
    const extension = originalName.split(".").at(-1).toLowerCase();
    if (!detected || !detected.extensions.includes(extension))
      return res.status(415).json({ error: "Choisissez un véritable fichier PDF, JPEG ou PNG avec l’extension correspondante." });
    const rows = db.prepare("SELECT name FROM entity_documents WHERE user_id=? AND kind=? AND entity_id=?")
      .all(req.user.id, req.params.kind, req.params.id);
    if (rows.length >= 20) return res.status(409).json({ error: "Cette fiche contient déjà 20 documents." });
    if (accountDocumentBytes(db, req.user.id) + req.body.length > MAX_ACCOUNT)
      return res.status(409).json({ error: "Les documents de ce compte sont limités à 50 Mo, justificatifs des opérations compris." });
    const label = `${ENTITY_DOCUMENT_TYPES[req.params.kind][documentType]} · ${req.documentEntity.title}`;
    const names = new Set(rows.map((r) => r.name.normalize("NFC").toLocaleLowerCase("fr")));
    let sequence = 1;
    let name = documentFileName(label, originalName, sequence);
    while (names.has(name.normalize("NFC").toLocaleLowerCase("fr"))) name = documentFileName(label, originalName, ++sequence);
    const row = { id: randomUUID(), name, original_name: originalName, mime: detected.mime,
      size_bytes: req.body.length, created_at: new Date().toISOString(), document_type: documentType };
    db.prepare("INSERT INTO entity_documents(id,user_id,kind,entity_id,document_type,name,original_name,mime,size_bytes,created_at,data) VALUES(?,?,?,?,?,?,?,?,?,?,?)")
      .run(row.id, req.user.id, req.params.kind, req.params.id, documentType, name, originalName, row.mime, row.size_bytes, row.created_at, req.body);
    res.status(201).json({ document: metadata(row) });
  });
  function findDocument(req, res, next) {
    const row = db.prepare("SELECT * FROM entity_documents WHERE id=? AND user_id=?").get(req.params.id, req.user.id);
    if (!row || !entityFor(req.user.id, row.kind, row.entity_id))
      return res.status(404).json({ error: "Ce document est introuvable." });
    req.entityDocument = row;
    next();
  }
  app.get("/api/entity-documents/:id", requireUser, findDocument, (req, res) => {
    const row = req.entityDocument;
    res.set({ "Content-Type": row.mime, "Content-Disposition": disposition(row.name),
      "Content-Length": String(row.size_bytes), "X-Content-Type-Options": "nosniff", "Cache-Control": "no-store" });
    res.send(Buffer.from(row.data));
  });
  app.delete("/api/entity-documents/:id", requireUser, findDocument, (req, res) => {
    db.prepare("DELETE FROM entity_documents WHERE id=? AND user_id=?").run(req.params.id, req.user.id);
    res.json({ ok: true });
  });
}
