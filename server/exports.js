import { ZipArchive } from "archiver";
import {
  getPayments,
  paidCents,
  parseBackup,
  remainingCents,
  transactionLabel,
} from "../src/model.js";
import {
  accountantCSVs,
  exportSelection,
  parisToday,
} from "../src/accountant-export.js";
import { synchronizeAttachmentNames } from "./attachments.js";
import { documentFileName } from "../src/document-names.js";

/** The package contains a scoped, authenticated snapshot, never credentials. */
export function installExports(app, db, requireUser) {
  app.post("/api/exports/accountant", requireUser, (req, res, next) => {
    let snapshot;
    try {
      db.exec("BEGIN IMMEDIATE");
      try {
        const record = db
          .prepare("SELECT state,revision FROM users WHERE id=?")
          .get(req.user.id);
        if (!record) throw new Error("Le compte est introuvable.");
        const state = parseBackup(record.state);
        const today = parisToday();
        const selection = exportSelection(state, req.body, { today });
        synchronizeAttachmentNames(db, req.user.id, state);
        const selectedIds = new Set(selection.transactions.map((t) => t.id));
        const metadata = db
          .prepare(
            "SELECT id,transaction_id,name,original_name,mime,size_bytes,created_at FROM attachments WHERE user_id=? ORDER BY created_at,id",
          )
          .all(req.user.id)
          .filter((row) => selectedIds.has(row.transaction_id));
        const documentIndex = new Map(
          selection.transactions.map((t, index) => [
            t.id,
            { transaction: t, index: index + 1, count: 0 },
          ]),
        );
        const usedPaths = new Set();
        const documents = metadata.map((row) => {
          const entry = documentIndex.get(row.transaction_id);
          entry.count++;
          let fileName = documentFileName(
            transactionLabel(entry.transaction, state),
            row.original_name || row.name,
            entry.count,
          );
          const directory = `justifs/${String(entry.index).padStart(5, "0")}`;
          let path = `${directory}/${fileName}`,
            suffix = entry.count;
          while (usedPaths.has(path.toLocaleLowerCase("fr"))) {
            fileName = documentFileName(
              transactionLabel(entry.transaction, state),
              row.original_name || row.name,
              ++suffix,
            );
            path = `${directory}/${fileName}`;
          }
          usedPaths.add(path.toLocaleLowerCase("fr"));
          const data = selection.options.includeDocuments
            ? db
                .prepare(
                  "SELECT data FROM attachments WHERE id=? AND user_id=?",
                )
                .get(row.id, req.user.id)?.data
            : null;
          return {
            id: row.id,
            transactionId: row.transaction_id,
            label: transactionLabel(entry.transaction, state),
            name: fileName,
            originalName: row.original_name || row.name,
            mime: row.mime,
            size: row.size_bytes,
            createdAt: row.created_at,
            path: data ? path : null,
            included: Boolean(data),
            ...(data ? { data: Buffer.from(data) } : {}),
          };
        });
        const publicDocuments = documents.map(
          ({ data, ...metadata }) => metadata,
        );
        const documentIdsByTransaction = new Map();
        for (const doc of documents) {
          if (!documentIdsByTransaction.has(doc.transactionId))
            documentIdsByTransaction.set(doc.transactionId, []);
          documentIdsByTransaction.get(doc.transactionId).push(doc.id);
        }
        const csvs = accountantCSVs(state, selection, {
          documents: publicDocuments,
          today,
        });
        const propertyIds = new Set(
          selection.transactions.map((t) => t.propertyId),
        );
        const recurrenceIds = new Set(
          selection.transactions.map((t) => t.recurrenceId).filter(Boolean),
        );
        const exportedPaymentsByTransaction = new Map();
        for (const payment of selection.payments) {
          if (!exportedPaymentsByTransaction.has(payment.transactionId))
            exportedPaymentsByTransaction.set(payment.transactionId, []);
          exportedPaymentsByTransaction
            .get(payment.transactionId)
            .push(payment);
        }
        const exportedAt = new Date().toISOString();
        const manifest = {
          format: "cap-sci-accountant-export",
          version: 1,
          exportedAt,
          sourceRevision: record.revision,
          sciName: state.settings.name,
          filters: selection.options,
          summary: {
            ...selection.summary,
            documentCount: documents.length,
            includedDocumentCount: documents.filter((d) => d.included).length,
            missingDocumentCount: selection.options.includeDocuments
              ? documents.filter((d) => !d.included).length
              : 0,
          },
          operations: selection.transactions.map((t) => ({
            id: t.id,
            label: transactionLabel(t, state),
            documentIds: documentIdsByTransaction.get(t.id) || [],
          })),
          documents: publicDocuments,
        };
        const selectedData = {
          format: "cap-sci-accountant-selection",
          version: 1,
          exportedAt,
          sourceRevision: record.revision,
          settings: state.settings,
          filters: selection.options,
          properties: state.properties.filter((p) => propertyIds.has(p.id)),
          operations: selection.transactions.map((transaction) => {
            const { payments, ...metadata } = transaction;
            return {
              ...metadata,
              totalRegleHistoriqueCents: paidCents(transaction),
              resteAReglerCents: remainingCents(transaction),
              nombreReglementsHistoriques: getPayments(transaction).length,
              reglementsExportes:
                exportedPaymentsByTransaction.get(transaction.id) || [],
            };
          }),
          recurrences: (state.recurrences || []).filter((r) =>
            recurrenceIds.has(r.id),
          ),
          exportedPayments: selection.payments,
        };
        snapshot = {
          selection,
          documents,
          csvs,
          manifest,
          selectedData,
          settings: {
            ...state.settings,
            exportedAt,
            sourceRevision: record.revision,
            filters: selection.options,
          },
          readme: readme(selection, manifest),
        };
        db.exec("COMMIT");
      } catch (error) {
        db.exec("ROLLBACK");
        throw error;
      }
    } catch (error) {
      return res.status(400).json({
        error: error.message || "La sélection d’export est invalide.",
      });
    }
    const archive = new ZipArchive({ store: true });
    let failed = false;
    const abort = (error) => {
      if (failed) return;
      failed = true;
      archive.abort();
      if (res.headersSent) res.destroy(error);
      else next(error);
    };
    archive.on("error", abort);
    archive.on("warning", abort);
    res.on("close", () => {
      if (!res.writableFinished) archive.abort();
    });
    res.set({
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="cap-sci-comptable-${snapshot.selection.options.startDate}-${snapshot.selection.options.endDate}.zip"`,
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "no-store",
    });
    archive.pipe(res);
    for (const [name, text] of Object.entries(snapshot.csvs))
      archive.append(text, { name });
    archive.append(JSON.stringify(snapshot.settings, null, 2), {
      name: "parametres-sci.json",
    });
    archive.append(JSON.stringify(snapshot.manifest, null, 2), {
      name: "manifest.json",
    });
    archive.append(JSON.stringify(snapshot.selectedData, null, 2), {
      name: "selection.json",
    });
    archive.append(snapshot.readme, { name: "README.txt" });
    for (const doc of snapshot.documents)
      if (doc.data) archive.append(doc.data, { name: doc.path });
    archive.finalize().catch(abort);
  });
}
function readme(selection, manifest) {
  const { options, summary } = selection;
  const basis = {
    payments:
      "Dates réelles des règlements. Une opération est retenue si au moins un règlement se situe dans la plage.",
    due: "Dates d’échéance initiale (à défaut, date de l’opération). Tous les règlements des opérations retenues sont fournis ; ceux hors plage sont repérés.",
    period:
      "Mois concerné par l’opération. Les mois de début et de fin sont inclus entièrement, même si les dates ne sont pas le premier ou le dernier jour. Tous les règlements des opérations retenues sont fournis ; ceux hors plage sont repérés.",
  }[options.dateBasis];
  return `CAP SCI — DOSSIER COMPTABLE\n\nSCI : ${manifest.sciName}\nExport : ${manifest.exportedAt}\nVersion des données source : ${manifest.sourceRevision}\nPlage inclusive : ${options.startDate} au ${options.endDate}\nSélection : ${basis}\nHistorique complet supplémentaire des règlements : ${options.includeFullPaymentHistory ? "oui" : "non"}\n\nCONTENU\n- operations.csv : toutes les informations des opérations sélectionnées. Montant attendu, total réglé historique et reste dû sont des informations de suivi, pas des encaissements supplémentaires.\n- reglements.csv : un règlement par ligne, avec sa date réelle et sa ventilation loyer/provisions. La colonne « Dans la plage de dates » distingue les règlements de la plage et les éléments historiques hors plage.\n- biens.csv : coordonnées et loyers de référence des biens liés, y compris les biens archivés.\n- parametres-sci.json : paramètres de la SCI, solde de départ et critères de sélection.\n- manifest.json : inventaire des opérations et pièces jointes, correspondance entre nom d’origine et nom normalisé.\n- selection.json : données détaillées de la sélection et historique complet des opérations ; ce fichier est une extraction, PAS une sauvegarde restaurable de l’application. Il contient les métadonnées des opérations et uniquement les règlements explicitement retenus. Les totaux historiques des opérations sont des montants cumulés, pas une liste supplémentaire de règlements. Les règlements hors plage ne sont inclus que si vous avez demandé l’historique complet ou sélectionné par échéance/période ; leur indicateur de plage reste explicite.\n- justifs/ : fichiers demandés, classés dans des dossiers courts dont la correspondance figure dans le manifeste.\n\nCOMPTAGE\nOpérations : ${summary.operationCount}\nRèglements exportés : ${summary.paymentCount}\nJustificatifs liés : ${manifest.summary.documentCount}\nJustificatifs inclus : ${manifest.summary.includedDocumentCount}\nFichiers liés manquants : ${manifest.summary.missingDocumentCount}\n\nLes totaux « periodIncomeCents » et « periodExpenseCents » du manifeste sont en centimes et comptent uniquement les règlements réels dans la plage inclusive, pour les opérations sélectionnées. L’historique hors plage ne les augmente pas.\n\nIMPORTANT\nLa sélection ne contient pas les opérations non retenues, les comptes utilisateurs, mots de passe ou sessions. Les CSV sont en UTF-8 (BOM), séparés par des points-virgules ; les montants utilisent une virgule décimale. Les cellules texte susceptibles d’être interprétées comme une formule Excel sont préfixées par une apostrophe.\nLes noms des justificatifs suivent le libellé de l’opération, avec extension conservée et suffixe en cas de plusieurs fichiers. Les caractères interdits sur Windows sont remplacés. Aucun contenu de justificatif n’est modifié.\nCet export suit la trésorerie et ses justificatifs. Il ne constitue ni un FEC, ni un bilan, ni un calcul du résultat fiscal ou des amortissements. Pour sauvegarder intégralement comptes et fichiers, utilisez la sauvegarde SQLite du serveur.\n`;
}
