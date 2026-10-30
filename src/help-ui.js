import { icon, esc } from "./ui.js";
import "./consolidation.css";

const pages = {
  dashboard: {
    title: "Comprendre votre tableau de bord",
    intro: "Commencez ici pour repérer les loyers à recevoir, les dépenses à régler et votre trésorerie.",
    steps: ["Choisissez l’année et, si nécessaire, un bien.", "Consultez les montants restant à recevoir, y compris les anciennes échéances non soldées.", "Ouvrez le pointage pour confirmer les mouvements réellement visibles sur votre relevé."],
    tips: ["Avant la première saisie, vérifiez la date et le montant du solde initial dans les paramètres de la SCI.", "Une échéance prévue ne fait pas encore partie de votre trésorerie.", "Le solde des mouvements d’un bien n’est pas son bénéfice fiscal : il peut comprendre le capital d’un prêt ou un dépôt de garantie."],
    links: [["pointing", "Pointer le mois"], ["properties", "Ouvrir mes biens"]],
  },
  transactions: {
    title: "Saisir et retrouver une opération",
    intro: "Une opération décrit une somme attendue ; ses règlements indiquent quand l’argent a réellement circulé.",
    steps: ["Choisissez encaissement ou décaissement, puis la catégorie.", "Sélectionnez la location pour un loyer ou un dépôt de garantie, le fournisseur pour une dépense, ou indiquez la personne concernée pour un apport.", "Renseignez la date, le montant et la référence de la facture si vous l’avez.", "Ajoutez les justificatifs depuis le menu de l’opération. Vérifiez le statut avant de confirmer un règlement."],
    tips: ["Le choix d’une fiche conserve un lien vers le bon bien ou interlocuteur ; un nom saisi librement ne remplace pas ce lien.", "Dupliquer reprend une saisie utile, avec une nouvelle date, sans ses paiements ni ses fichiers.", "Une opération réglée se corrige en conservant une trace : utilisez l’annulation plutôt qu’une suppression définitive."],
    links: [["pointing", "Pointer les règlements"], ["history", "Voir les modifications"]],
  },
  recurrences: {
    title: "Préparer les opérations régulières",
    intro: "Une périodicité prépare les échéances répétitives sans présumer qu’elles sont réglées.",
    steps: ["Créez une périodicité pour un loyer, un prêt, une assurance ou une autre somme régulière.", "Choisissez la location ou le fournisseur, les montants, la fréquence et les dates.", "Vérifiez le jour d’échéance : le 31 tombe au dernier jour d’un mois plus court.", "À chaque mois, comparez les échéances au relevé et confirmez seulement les règlements constatés."],
    tips: ["Pour changer un loyer, utilisez le changement daté dans la location : les règlements déjà enregistrés conservent leur historique.", "Une mensualité de prêt regroupe capital, intérêts et assurance. Ajustez sa répartition au pointage avec le tableau bancaire.", "La référence du contrat appartient au fournisseur. Le numéro de chaque facture se renseigne sur son opération."],
    links: [["leases", "Ouvrir les locations"], ["pointing", "Faire le pointage"]],
  },
  pointing: {
    title: "Faire le pointage du mois",
    intro: "Le relevé bancaire est votre point de départ : vérifiez les sommes et leurs dates avant de cocher.",
    steps: ["Choisissez le mois et filtrez éventuellement par bien ou par sens.", "Comparez chaque échéance au mouvement du relevé ; pour un prêt, ajustez le capital, les intérêts et l’assurance si nécessaire.", "Choisissez la date réelle des règlements, puis cochez les lignes à solder. Pour des dates différentes, faites plusieurs validations.", "Utilisez Paiement partiel si la somme constatée est inférieure au reste dû, puis comparez le solde bancaire en fin de pointage."],
    tips: ["Changer un filtre remet les cases cochées à zéro pour éviter de régler une ligne masquée.", "Un règlement partiel peut aussi être en retard : vérifiez ce qui reste à recevoir.", "Un trop-perçu doit être suivi séparément ; ne le forcez pas dans une échéance déjà soldée."],
    links: [["bank-checks", "Comparer le solde bancaire"], ["arrears", "Retrouver les impayés"]],
  },
  arrears: {
    title: "Suivre les loyers impayés",
    intro: "Cet écran rassemble les loyers et provisions échus dont il reste une somme à recevoir.",
    steps: ["Repérez le locataire, la période et le reste dû.", "Vérifiez les paiements déjà saisis dans Règlements.", "Enregistrez un paiement partiel ou soldez l’échéance uniquement après réception de l’argent."],
    tips: ["Les anciens loyers restent dus après un changement d’année ou de locataire.", "Une correction et une réception d’argent sont deux actions différentes ; gardez la bonne date de règlement."],
    links: [["pointing", "Pointer un règlement"], ["tenants", "Ouvrir les locataires"]],
  },
  properties: {
    title: "Organiser les biens",
    intro: "Le dossier du bien rassemble ses locations, ses fournisseurs et ses opérations.",
    steps: ["Créez le bien avec un nom court unique et son adresse.", "Créez le locataire, puis une location pour préciser les dates et les montants du bail.", "Depuis la location, préparez le loyer périodique.", "Rattachez les fournisseurs habituels et utilisez Dossier du bien pour retrouver les informations liées."],
    tips: ["La location conserve le montant contractuel du loyer. Un changement doit avoir une date d’effet.", "Archiver conserve l’historique et met en pause les périodicités liées. Vérifiez les échéances déjà préparées."],
    links: [["tenants", "Créer un locataire"], ["leases", "Créer une location"]],
  },
  suppliers: {
    title: "Utiliser les fiches fournisseurs",
    intro: "Une seule fiche évite les variantes de nom et permet de retrouver les contrats et dépenses du même interlocuteur.",
    steps: ["Renseignez le nom court ; complétez les coordonnées, la raison sociale et le SIRET si utiles.", "Indiquez éventuellement la catégorie habituelle et la référence client ou contrat.", "Sélectionnez cette fiche dans les opérations ou périodicités ; ajoutez les factures à leurs opérations."],
    tips: ["Une banque ou un assureur peut aussi avoir une fiche fournisseur.", "Désactivez une fiche devenue inutile pour conserver les opérations et documents déjà rattachés.", "Le numéro d’une facture ne remplace pas la référence de votre contrat."],
    links: [["transactions", "Saisir une opération"], ["properties", "Rattacher un bien"]],
  },
  tenants: {
    title: "Retrouver les locataires et leurs documents",
    intro: "La fiche locataire décrit la personne ou l’entreprise. Ses occupations et baux se trouvent dans ses locations.",
    steps: ["Créez la fiche avec le nom et les coordonnées utiles.", "Ouvrez l’onglet Locations pour associer la personne à un bien et à une période.", "Classez les documents personnels dans Documents et le bail ou les états des lieux sur la location.", "Consultez les opérations liées pour retrouver les sommes et règlements enregistrés."],
    tips: ["Lors d’un changement d’occupant, terminez l’ancienne location et créez la nouvelle.", "Les documents personnels ne sont pas ajoutés à l’export comptable."],
    links: [["leases", "Ouvrir les locations"], ["arrears", "Voir les impayés"]],
  },
  leases: {
    title: "Gérer une location et son loyer",
    intro: "La location relie le bon locataire au bon bien pendant une période donnée.",
    steps: ["Choisissez le bien et le locataire, puis renseignez les dates, le loyer, les provisions et le jour d’échéance.", "Joignez le bail, les avenants, les états des lieux et l’assurance habitation dans ses documents.", "Préparez le loyer périodique depuis cette fiche.", "Pour une évolution du loyer, utilisez le changement daté ; pour un départ, renseignez la sortie et contrôlez les dernières échéances."],
    tips: ["Les montants déjà réglés ne sont pas réécrits lors d’un changement de loyer.", "Le dépôt de garantie indiqué au bail est un montant prévu : saisissez aussi son encaissement et sa restitution.", "Les premiers et derniers loyers peuvent nécessiter un prorata à vérifier manuellement."],
    links: [["recurrences", "Voir les périodicités"], ["pointing", "Pointer les loyers"]],
  },
  "bank-checks": {
    title: "Comparer le solde bancaire",
    intro: "Ce contrôle compare le solde de fin de journée du relevé à celui calculé avec vos mouvements réglés.",
    steps: ["Choisissez une date de relevé et recopiez son solde exact.", "Si l’écart n’est pas nul, cherchez les mouvements oubliés, en double, mal datés ou saisis pour un mauvais montant.", "Corrigez les opérations concernées, puis vérifiez à nouveau le contrôle."],
    tips: ["Ce contrôle convient à un seul compte bancaire suivi dans l’application.", "Un écart nul ne prouve pas que chaque mouvement est correct : deux erreurs peuvent se compenser.", "Le contrôle se recalcule après correction ; il ne verrouille pas une période."],
    links: [["pointing", "Retour au pointage"], ["transactions", "Vérifier les opérations"]],
  },
  forecast: {
    title: "Lire le prévisionnel",
    intro: "Le prévisionnel estime les mouvements à venir d’après les opérations et périodicités connues.",
    steps: ["Vérifiez d’abord le solde réel et les échéances déjà saisies.", "Consultez séparément les sommes échues non réglées.", "Utilisez la projection pour repérer un mois tendu, puis vérifiez les dépenses et recettes qui la composent."],
    tips: ["Une recette prévue peut être reçue en retard. La projection reste une hypothèse.", "Les dépenses échues affichées à part restent à payer : gardez-en compte avant de décider d’une nouvelle dépense.", "Le prévisionnel ne calcule pas le résultat fiscal ou les amortissements."],
    links: [["bank-checks", "Vérifier le solde réel"], ["recurrences", "Vérifier les périodicités"]],
  },
  exports: {
    title: "Préparer un dossier pour le comptable",
    intro: "Choisissez la période et le contenu selon ce que le comptable vous demande, puis contrôlez les pièces avant l’envoi.",
    steps: ["Pour un dossier annuel, vérifiez que les factures et loyers non réglés de l’exercice sont aussi retenus.", "Choisissez les dates, les biens et les catégories ; contrôlez l’aperçu et les pièces manquantes.", "Incluez les justificatifs et, seulement si nécessaire, les baux et avenants liés.", "Téléchargez le ZIP et conservez une copie du dossier effectivement transmis."],
    tips: ["Le mode Règlements réels sélectionne les paiements : une facture non payée peut donc en être absente.", "Les tableaux distinguent les montants attendus des règlements. Ne les additionnez pas comme deux recettes.", "Le dossier ZIP sert aux échanges avec le comptable. Les comptes annuels et déclarations restent à établir avec lui."],
    links: [["transactions", "Compléter les pièces"], ["backups", "Faire une sauvegarde"]],
  },
  backups: {
    title: "Sauvegarder et restaurer les données",
    intro: "Une sauvegarde utile est une copie que vous pourrez réellement restaurer, conservée sur un autre support.",
    steps: ["Téléchargez un JSON pour conserver les fiches, opérations, périodicités et réglages.", "Pour les comptes et tous les fichiers, utilisez également la sauvegarde complète du serveur.", "Conservez une copie hors de la machine qui héberge l’application.", "Avant une restauration, vérifiez le nom de la SCI et gardez l’état actuel ; contrôlez ensuite les soldes et documents."],
    tips: ["Le JSON ne contient pas les fichiers justificatifs, baux ou documents personnels.", "Un état conservé avant restauration facilite un retour en arrière, mais ne remplace pas une sauvegarde complète hors machine.", "Testez la restauration sur une copie avant de compter sur votre dispositif de sauvegarde."],
    links: [["history", "Voir l’historique"], ["storage", "Voir les documents stockés"]],
  },
  access: {
    title: "Travailler à deux sur la même SCI",
    intro: "Chaque personne garde son identifiant ; les deux comptes autorisés utilisent les mêmes données de SCI.",
    steps: ["Le propriétaire de l’espace prépare une invitation pour l’adresse e-mail de l’autre personne.", "Copiez le lien et transmettez-le à cette personne par votre moyen habituel.", "Elle ouvre le lien, se connecte ou crée son compte avec l’adresse invitée, puis accepte le partage.", "Vérifiez les membres affichés et retirez un accès qui n’est plus nécessaire."],
    tips: ["Ne partagez pas votre mot de passe ; chaque personne utilise son propre compte.", "Une invitation ne transfère pas automatiquement une autre SCI déjà renseignée.", "Le VPN limite l’accès au réseau ; les droits de l’application déterminent l’espace que chaque personne peut consulter."],
    links: [["history", "Voir les modifications"], ["backups", "Sauvegarder les données"]],
  },
  history: {
    title: "Comprendre l’historique des corrections",
    intro: "Retrouvez les modifications enregistrées, leur date et la personne qui les a effectuées.",
    steps: ["Recherchez une opération, une fiche ou un utilisateur.", "Consultez le motif et les informations disponibles pour comprendre une correction ou une annulation.", "Après une restauration, contrôlez les données reprises et conservez votre sauvegarde précédente."],
    tips: ["Annuler un mouvement réglé conserve sa trace ; créez ensuite la bonne opération si nécessaire.", "L’historique explique les changements, mais ne remplace pas la sauvegarde des documents."],
    links: [["transactions", "Ouvrir les opérations"], ["backups", "Ouvrir les sauvegardes"]],
  },
  "documents-guide": {
    title: "Choisir les justificatifs utiles",
    intro: "Retrouvez les pièces adaptées à chaque type de mouvement de votre SCI.",
    steps: ["Recherchez la catégorie ou un mot comme banque, travaux ou loyer.", "Consultez les pièces à conserver et leur emplacement dans Cap SCI.", "Avant l’export, ajoutez les documents de référence qui ne sont pas inclus automatiquement."],
    tips: ["Une opération sans facture doit rester expliquée par des preuves adaptées.", "La case Justificatif non nécessaire signifie qu’aucune pièce distincte n’est attendue sur cette opération ; les preuves restent à conserver."],
    links: [["transactions", "Vérifier les opérations"], ["exports", "Préparer le dossier comptable"]],
  },
  storage: {
    title: "Gérer l’espace des documents",
    intro: "L’espace affiché couvre les justificatifs des opérations et les documents des fiches.",
    steps: ["Vérifiez l’espace utilisé avant d’ajouter de gros fichiers.", "Privilégiez les PDF lisibles et les photos cadrées à la taille utile.", "Si des documents sont sans fiche ou opération, vérifiez leur origine avant de les supprimer définitivement."],
    tips: ["Une fiche désactivée conserve ses documents et n’est pas un document orphelin.", "Téléchargez ou sauvegardez une pièce utile avant de la supprimer.", "Les documents personnels restent exclus du dossier comptable."],
    links: [["backups", "Sauvegarder avant nettoyage"]],
  },
};
const start = [
  ["properties", "1. Créer le bien", "Un nom court unique et une adresse."],
  ["tenants", "2. Créer le locataire", "Les coordonnées utiles de la personne ou de l’entreprise."],
  ["leases", "3. Créer sa location", "Le bien, les dates, le loyer et le bail."],
  ["recurrences", "4. Préparer le loyer périodique", "Les échéances restent en attente de règlement."],
  ["pointing", "5. Pointer le relevé", "Confirmer les paiements et leurs dates réelles."],
  ["exports", "6. Préparer le dossier comptable", "Compléter les pièces puis choisir la bonne période."],
];
export function createHelpUI(ctx) {
  function open(view = "dashboard") {
    const page = pages[view] || pages.dashboard;
    const d = ctx.mountDialog(`<dialog class="form-dialog help-dialog" aria-labelledby="dialog-title">${ctx.formHeader("Aide · " + page.title, page.intro, "receipt")}<ol class="help-steps">${page.steps.map(step => `<li>${esc(step)}</li>`).join("")}</ol><div class="help-practices"><h3>À retenir sur cette page</h3><ul>${page.tips.map(tip => `<li>${esc(tip)}</li>`).join("")}</ul></div><div class="help-shortcuts">${page.links.map(([target, label]) => `<button type="button" class="button secondary compact" data-help-view="${esc(target)}">${icon("arrow")}${esc(label)}</button>`).join("")}</div><button type="button" class="button secondary document-guide-link" data-help-guide>${icon("folder")}Guide des justificatifs</button><details class="help-start" ${view === "dashboard" ? "open" : ""}><summary>Bien démarrer avec votre SCI</summary><p class="form-note">Avant les premières opérations, ouvrez les paramètres de la SCI et renseignez le solde bancaire initial à la bonne date, avant les mouvements de cette journée.</p><div class="help-start-grid">${start.map(([target, label, description]) => `<button type="button" data-help-view="${esc(target)}"><strong>${esc(label)}</strong><span>${esc(description)}</span></button>`).join("")}</div></details><details class="help-start"><summary>Les bonnes habitudes à garder</summary><ul class="help-steps"><li>Pointez régulièrement le relevé et comparez le solde à la même date.</li><li>Joignez les factures à leurs opérations et le bail à sa location.</li><li>Vérifiez les champs préremplis et gardez la vraie date de règlement.</li><li>Conservez une copie du dossier envoyé au comptable et des sauvegardes hors du serveur.</li><li>Les dépenses payées personnellement, trop-perçus et régularisations de charges demandent un suivi particulier à vérifier avec votre comptable.</li></ul></details><div class="dialog-footer"><button type="button" class="button primary" data-close>J’ai compris</button></div></dialog>`);
    d.querySelectorAll("[data-help-view]").forEach(button => button.addEventListener("click", () => {
      ctx.closeDialog();
      ctx.navigate(button.dataset.helpView);
    }));
    d.querySelector("[data-help-guide]").addEventListener("click", ctx.openDocumentsGuide);
    return d;
  }
  return { open };
}
