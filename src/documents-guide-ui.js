import { CATEGORIES, fold, uid } from "./model.js";
import { esc, icon } from "./ui.js";

const examples = [
  {
    categories: ["rent"],
    documents: "Bail et avenants, montant du loyer applicable, relevé bancaire du règlement. Conservez les quittances ou reçus que vous avez délivrés, s’il y en a.",
    location: "Bail et avenants dans les documents de la location ; pièce liée à une échéance particulière dans son opération.",
    invoice: "Pour un loyer courant, une facture d’achat mensuelle n’est pas attendue. Le bail et la trace du paiement permettent de documenter le mouvement. Une location soumise à TVA ou un bail particulier peut demander d’autres pièces : faites préciser le besoin au comptable.",
    note: "Le bail justifie le loyer attendu, le relevé prouve son règlement : gardez les deux, même si vous ne les joignez pas à chaque mois.",
    keywords: "locataire location quittance reçu bail mensuel",
  },
  {
    categories: ["recoverable"],
    documents: "Bail ou avenant précisant les provisions, trace du règlement et décompte de régularisation avec les dépenses correspondantes.",
    location: "Bail dans la location ; décompte et documents liés à une régularisation dans son opération.",
    invoice: "La provision mensuelle ne demande pas une nouvelle facture fournisseur. Conservez la base du montant et les pièces des dépenses servant au décompte final.",
    note: "Une provision encaissée ne remplace pas la régularisation des charges. Pour une régularisation, décrivez la période et le calcul dans la note au comptable.",
    keywords: "charges locataire régularisation provision décompte eau chauffage",
  },
  {
    categories: ["loan_payment", "loan_interest", "loan_capital"],
    documents: "Contrat de prêt, tableau d’amortissement à jour et relevé du prélèvement. Ajoutez les avis de changement de taux ou d’assurance lorsqu’ils modifient l’échéance.",
    location: "Contrat et échéancier dans les documents de la fiche banque / fournisseur ; document expliquant un changement dans l’opération concernée.",
    invoice: "La banque ne fournit pas forcément une facture à chaque mensualité. L’échéancier et le relevé justifient habituellement la répartition et le règlement, à valider avec votre comptable.",
    note: "Saisissez une seule échéance de prêt, ventilée en capital, intérêts et assurance. Ajustez cette ventilation au pointage ; n’ajoutez pas une seconde dépense pour les mêmes intérêts ou le même capital.",
    keywords: "banque crédit emprunt mensualité capital intérêts assurance amortissement",
  },
  {
    categories: ["loan_received"],
    documents: "Contrat de prêt signé, avis de déblocage des fonds ou décompte du notaire, et trace du versement sur le compte de la SCI.",
    location: "Contrat dans la fiche banque ; avis de déblocage ou décompte dans l’opération d’encaissement.",
    invoice: "Le versement d’un emprunt n’est pas une vente et n’appelle pas de facture de vente. Le contrat et les pièces de déblocage restent nécessaires pour en expliquer l’origine.",
    note: "Un emprunt reçu augmente la trésorerie mais ne constitue pas un loyer ou un bénéfice. Indiquez clairement le prêt et le bien concernés.",
    keywords: "banque crédit fonds déblocage financement notaire",
  },
  {
    categories: ["insurance"],
    documents: "Contrat, avis d’échéance ou attestation indiquant la prime et la période couverte, ainsi que la trace du règlement.",
    location: "Contrat dans la fiche assureur ; avis annuel ou pièce propre à la prime dans l’opération correspondante.",
    invoice: "L’avis d’échéance peut servir de pièce même sans document intitulé « facture ». Pour des prélèvements mensuels identiques, une référence claire à l’avis annuel peut éviter de joindre douze fois le même fichier.",
    note: "Une attestation qui indique seulement que le bien est assuré peut ne pas suffire à justifier le montant de la dépense : gardez aussi l’avis de prime.",
    keywords: "assureur prime propriétaire non occupant PNO avis annuel contrat",
  },
  {
    categories: ["property_tax"],
    documents: "Avis de taxe foncière complet et trace du paiement ou de la mensualisation. Gardez le détail de la taxe d’enlèvement des ordures ménagères, lorsqu’elle figure sur l’avis.",
    location: "Avis dans l’opération du bien concerné. Si l’avis couvre plusieurs biens, expliquez la répartition au comptable.",
    invoice: "Un impôt se justifie par son avis, sans facture fournisseur. Les prélèvements mensuels se rapprochent de cet avis et du relevé bancaire.",
    note: "La part éventuellement récupérable sur le locataire se vérifie séparément ; ne recopiez pas automatiquement tout l’avis en charges locatives.",
    keywords: "impôts avis fiscal trésor mensualisation TEOM ordures ménagères",
  },
  {
    categories: ["condominium"],
    documents: "Appels de fonds du syndic, décompte annuel des charges et, pour les travaux, décisions ou documents précisant leur nature.",
    location: "Appel de fonds ou décompte dans l’opération concernée ; documents généraux dans la fiche syndic.",
    invoice: "Un appel de fonds ou un décompte peut justifier un versement au syndic sans facture directe à votre SCI. Un simple virement au syndic ne suffit pas à expliquer la nature des charges.",
    note: "Les provisions, dépenses définitives, avances et fonds travaux peuvent être traités différemment. Transmettez le décompte annuel au comptable pour éviter de compter deux fois les mêmes sommes.",
    keywords: "syndic appel fonds travaux assemblée générale décompte charges",
  },
  {
    categories: ["maintenance"],
    documents: "Facture détaillée au nom de la SCI, avec le bien concerné, la nature des travaux, les dates et les montants. Conservez aussi devis, acomptes et facture finale lorsqu’il y en a.",
    location: "Facture ou facture d’acompte dans son opération. Ajoutez les précisions utiles au comptable dans la note.",
    invoice: "Pour un achat ou une prestation, demandez la facture. Un devis seul, un ticket de carte bancaire ou le relevé ne remplace généralement pas la facture définitive.",
    note: "Le comptable détermine si les travaux sont une charge ou une immobilisation à amortir. Décrivez ce qui a été remplacé ou amélioré et évitez de présenter un acompte et le total final comme deux achats distincts.",
    keywords: "artisan réparation rénovation facture acompte immobilisation entretien devis matériaux",
  },
  {
    categories: ["management"],
    documents: "Facture du prestataire, mandat ou contrat si utile, et compte rendu de gestion de l’agence lorsqu’elle prélève directement ses honoraires.",
    location: "Facture ou relevé de gestion dans l’opération ; contrat dans la fiche du prestataire.",
    invoice: "Pour une prestation de gestion, de comptabilité ou de conseil, récupérez la facture ou le décompte détaillé adapté. Pour des frais bancaires courants, un relevé détaillé peut suffire selon leur nature et l’accord du comptable.",
    note: "Si une agence reverse un loyer après déduction de ses frais, transmettez son relevé complet : le seul montant net versé ne décrit pas toutes les opérations.",
    keywords: "honoraires comptable agence syndic banque frais bancaires mandat prestation",
  },
  {
    categories: ["contribution"],
    documents: "Trace du versement et identification de l’associé. Selon l’opération : décision d’apport, documents de capital, convention de compte courant ou explication écrite validée avec le comptable.",
    location: "Documents et explication dans l’opération. Précisez le nom de l’associé et « capital » ou « compte courant » dans la note.",
    invoice: "Un apport ou une avance d’associé n’appelle pas une facture de vente. Il faut néanmoins documenter son origine, sa nature et son éventuel remboursement.",
    note: "Capital social et compte courant d’associé ne sont pas interchangeables. L’application les regroupe dans une catégorie : donnez au comptable le détail qui permet de les distinguer.",
    keywords: "associé capital social apport compte courant CCA avance virement",
  },
  {
    categories: ["contribution_returned"],
    documents: "Trace du paiement, associé bénéficiaire, référence de l’avance initiale et décompte ou convention justifiant le remboursement.",
    location: "Décompte et explication dans l’opération de remboursement ; référence à l’avance initiale dans la note.",
    invoice: "Le remboursement d’une avance ne demande pas de facture fournisseur. La dette envers l’associé et son remboursement doivent pouvoir être rapprochés.",
    note: "Ce remboursement n’est pas une dépense d’entretien. S’il inclut des intérêts, faites préciser leur traitement par le comptable au lieu de les confondre avec le capital remboursé.",
    keywords: "associé CCA remboursement avance dette compte courant capital",
  },
  {
    categories: ["deposit_received"],
    documents: "Bail précisant le dépôt de garantie, identité du locataire concerné et trace de la somme effectivement reçue.",
    location: "Bail dans la location ; reçu ou document propre au versement dans l’opération si nécessaire.",
    invoice: "Le dépôt de garantie n’est pas un loyer facturé. Le bail et la trace du versement expliquent la somme, sans nouvelle facture d’achat mensuelle.",
    note: "Rattachez le dépôt à la bonne location. Une somme encaissée à titre de garantie reste distincte des loyers et des provisions sur charges.",
    keywords: "caution locataire bail garantie entrée",
  },
  {
    categories: ["deposit_returned"],
    documents: "Décompte de restitution, trace du paiement et, en cas de retenue, états des lieux et pièces justifiant le calcul : factures, devis ou régularisation selon le cas.",
    location: "États des lieux dans la location ; décompte et pièces de retenue dans l’opération de restitution.",
    invoice: "La restitution du dépôt ne demande pas à elle seule une facture fournisseur. En revanche, les retenues doivent être expliquées et documentées.",
    note: "Précisez le dépôt initial, les retenues et le montant rendu. Une retenue, une facture de travaux et un remboursement ne doivent pas être confondus dans une seule dépense sans explication.",
    keywords: "caution locataire garantie sortie état lieux retenue restitution",
  },
  {
    categories: ["other_income"],
    documents: "Pièce expliquant l’origine : facture ou avoir, décompte de remboursement, indemnité d’assurance, décision ou courrier de l’organisme payeur, avec la trace du règlement.",
    location: "Pièce dans l’opération ; indiquez ce qui est remboursé, indemnisé ou vendu dans le détail et la note.",
    invoice: "Un remboursement ou une indemnité ne donne pas nécessairement lieu à une facture. Conservez le décompte ou le courrier expliquant le calcul. Pour une vente, vérifiez les pièces à émettre avec le comptable.",
    note: "« Autres encaissements » ne suffit pas à qualifier une somme. Un virement entre vos propres comptes n’est pas une recette de location : faites préciser sa saisie au comptable.",
    keywords: "remboursement indemnité avoir assurance vente virement transfert banque",
  },
  {
    categories: ["other_expense"],
    documents: "Facture ou reçu détaillé pour un achat ; avis pour un impôt ; relevé détaillé pour des frais bancaires ; acte et décompte pour une acquisition ou des frais de notaire.",
    location: "Pièce dans l’opération ; contrat ou document de référence dans la fiche du fournisseur lorsque c’est pertinent.",
    invoice: "Des frais bancaires courants ou un paiement d’impôt peuvent être documentés par un relevé ou un avis, sans facture distincte. Pour un achat ou une prestation, recherchez la facture adaptée.",
    note: "Décrivez la nature exacte. Une acquisition immobilière et ses frais demandent les actes et décomptes du notaire ; le comptable déterminera leur classement et les amortissements. Une dépense payée personnellement par un associé demande aussi un suivi de son avance.",
    keywords: "banque frais bancaires impôts IS taxe notaire acquisition achat facture associé personnel virement transfert",
  },
];

const labelsFor = example => example.categories.map(id => CATEGORIES.find(category => category.id === id)?.label || id);

export function createDocumentsGuideUI(ctx) {
  let query = "";
  let type = "all";

  function render(content, { shortcuts = true, uniqueIds = false } = {}) {
    content.innerHTML = `<div class="documents-guide">
      <section class="panel document-guide-intro" aria-labelledby="guide-intro-title">
        <div class="document-guide-mark">${icon("folder")}</div>
        <div><h2 id="guide-intro-title">La bonne pièce pour la bonne opération</h2>
        <p>Pour préparer la comptabilité de votre SCI à l’IS, chaque mouvement doit pouvoir être expliqué : sa nature, son montant, sa date et la personne concernée. Voici les pièces à rechercher et où les ranger dans Cap SCI.</p>
        <p class="document-guide-principle"><strong>Sans facture ne veut pas dire sans trace.</strong> Un bail, un avis d’échéance, un échéancier ou un décompte peut justifier l’opération. Le relevé bancaire prouve le paiement, mais ne remplace pas à lui seul une facture d’achat.</p></div>
      </section>
      <section class="panel document-guide-checkbox" aria-labelledby="guide-checkbox-title">
        <h2 id="guide-checkbox-title">Quand cocher « Justificatif non nécessaire » ?</h2>
        <p>Utilisez cette case lorsqu’aucun fichier distinct n’est attendu sur cette opération, par exemple un loyer mensuel déjà documenté par le bail et le relevé. <strong>Conservez les preuves ailleurs et vérifiez cette organisation avec votre comptable.</strong></p>
        <ol><li>Vérifiez qu’il ne manque pas une facture ou un avis à récupérer.</li><li>Indiquez dans la note où trouver la preuve : « Bail dans la location, virement du 5 novembre sur le relevé de novembre », par exemple.</li><li>Lors de l’export, transmettez aussi les pièces de référence utiles au comptable.</li></ol>
        <p class="form-note">La case retire l’opération de la liste des justificatifs manquants. Elle ne dispense pas de conserver les preuves et ne garantit pas le traitement comptable. Ne la cochez pas simplement parce qu’une pièce est perdue ou n’a pas encore été demandée.</p>
      </section>
      <section class="document-guide-examples" aria-labelledby="guide-examples-title">
        <div class="document-guide-toolbar"><div><h2 id="guide-examples-title">Rechercher votre type d’opération</h2><p>Les trois rubriques d’emprunt sont réunies dans une même fiche.</p></div>
        <div class="document-guide-filters"><label for="document-guide-query" class="sr-only">Rechercher dans le guide des justificatifs</label><div class="search-field">${icon("search")}<input id="document-guide-query" type="search" placeholder="Loyer, prêt, facture, banque…" value="${esc(query)}"></div>
        <label for="document-guide-type" class="sr-only">Filtrer les exemples par type d’opération</label><select id="document-guide-type"><option value="all">Tous les mouvements</option><option value="income" ${type === "income" ? "selected" : ""}>Encaissements</option><option value="expense" ${type === "expense" ? "selected" : ""}>Décaissements</option></select></div></div>
        <p id="document-guide-count" class="document-guide-count" role="status" aria-live="polite"></p>
        <div class="document-guide-grid">${examples.map((example, index) => {
          const labels = labelsFor(example);
          const kind = CATEGORIES.find(category => category.id === example.categories[0]).type;
          return `<article class="panel document-guide-card" data-guide-example="${index}" aria-labelledby="document-guide-card-${index}"><span class="document-guide-kind ${kind}">${icon(kind)}${kind === "income" ? "Encaissement" : "Décaissement"}</span><h3 id="document-guide-card-${index}">${esc(labels[0])}</h3>${labels.length > 1 ? `<p class="document-guide-related">Aussi : ${labels.slice(1).map(esc).join(" · ")}</p>` : ""}<dl><div><dt>Pièces à conserver</dt><dd>${esc(example.documents)}</dd></div><div><dt>Où les ranger</dt><dd>${esc(example.location)}</dd></div><div><dt>Une facture est-elle attendue ?</dt><dd>${esc(example.invoice)}</dd></div></dl><p class="document-guide-tip">${icon("flag")}<span>${esc(example.note)}</span></p></article>`;
        }).join("")}</div>
        <p id="document-guide-empty" class="panel document-guide-empty" hidden>Aucun exemple ne correspond. Essayez un mot comme « banque », « loyer » ou « travaux », ou choisissez tous les mouvements.</p>
      </section>
      <section class="panel document-guide-finish" aria-labelledby="guide-export-title">
        <h2 id="guide-export-title">Avant d’envoyer le dossier au comptable</h2>
        <ul><li>Vérifiez les pièces manquantes et les factures reçues mais encore impayées.</li><li>Contrôlez la lisibilité : toutes les pages, le nom de la SCI, les dates, les montants et le fournisseur doivent être identifiables.</li><li>Joignez les factures à leurs opérations. Le nom du fichier est repris du libellé de l’opération ; son nom d’origine reste conservé comme référence.</li><li>Les justificatifs des opérations sont inclus dans le ZIP si vous les sélectionnez. Les baux et avenants liés peuvent être ajoutés en option. Les autres documents de fiches, dont les contrats fournisseurs et les échéanciers, se téléchargent séparément pour les transmettre si utiles.</li><li>Conservez une copie du dossier transmis et des pièces d’origine. Les documents comptables et justificatifs se conservent en principe 10 ans à compter de la clôture ; les actes immobiliers et certains dossiers peuvent être à garder plus longtemps.</li></ul>
        <p class="form-note">Ce guide vous aide à préparer le dossier. Votre comptable confirme les pièces adaptées à votre situation et réalise les écritures, les amortissements et les déclarations. <a href="https://entreprendre.service-public.gouv.fr/vosdroits/F10029" target="_blank" rel="noopener noreferrer">Durées de conservation des documents — Service Public</a>.</p>
        ${shortcuts ? `<div class="help-shortcuts"><button type="button" class="button secondary" data-guide-view="transactions">${icon("receipt")}Vérifier les opérations</button><button type="button" class="button primary" data-guide-view="exports">${icon("download")}Préparer l’export comptable</button></div>` : ""}
      </section>
    </div>`;

    const search = content.querySelector("#document-guide-query");
    const filter = content.querySelector("#document-guide-type");
    const count = content.querySelector("#document-guide-count");
    const empty = content.querySelector("#document-guide-empty");
    function update() {
      query = search.value;
      type = filter.value;
      const terms = fold(query).trim().split(/\s+/).filter(Boolean);
      let visible = 0;
      content.querySelectorAll("[data-guide-example]").forEach(card => {
        const example = examples[Number(card.dataset.guideExample)];
        const text = fold([...labelsFor(example), example.documents, example.location, example.invoice, example.note, example.keywords].join(" "));
        const matches = (type === "all" || CATEGORIES.find(category => category.id === example.categories[0]).type === type) && terms.every(term => text.includes(term));
        card.hidden = !matches;
        if (matches) visible++;
      });
      count.textContent = `${visible} fiche${visible > 1 ? "s" : ""} affichée${visible > 1 ? "s" : ""}`;
      empty.hidden = visible > 0;
    }
    search.addEventListener("input", update);
    filter.addEventListener("change", update);
    content.querySelectorAll("[data-guide-view]").forEach(button => button.addEventListener("click", () => ctx.navigate(button.dataset.guideView)));
    update();
    if (uniqueIds) {
      const namespace = `documents-guide-${uid()}`;
      const remapped = new Map();
      content.querySelectorAll("[id]").forEach(element => {
        const original = element.id;
        element.id = `${namespace}-${original}`;
        remapped.set(original, element.id);
      });
      content.querySelectorAll("[for],[aria-labelledby],[aria-describedby]").forEach(element => {
        for (const attribute of ["for", "aria-labelledby", "aria-describedby"]) {
          if (element.hasAttribute(attribute)) {
            element.setAttribute(attribute, element.getAttribute(attribute).split(/\s+/).map(id => remapped.get(id) || id).join(" "));
          }
        }
      });
    }
  }

  return { render };
}
