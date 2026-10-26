# Atelier SCI

Un site en français pour suivre les biens, les loyers et la trésorerie d’une **SCI à l’IS**, avec un compte personnel et des données conservées dans une base SQLite côté serveur.

![Aperçu du tableau de bord Atelier SCI, avec des données fictives](docs/apercu.png)

## Essayer sous Windows

Installez **Node.js 24 LTS ou plus récent**. Téléchargez le ZIP du dépôt, décompressez-le et ouvrez PowerShell dans le dossier qui contient `package.json`.

```powershell
npm.cmd ci
npm.cmd run dev
```

Ouvrez l’adresse indiquée par Vite dans le terminal (port 5173 par défaut). Gardez le terminal ouvert. **Ctrl + C** arrête les deux serveurs.

Le mode démonstration présente des biens, locataires et montants **fictifs**. Cliquez sur **Créer mon espace** pour créer votre propre compte : votre SCI démarre vide, au régime IS. Aucun e-mail de validation n’est envoyé. Choisissez un mot de passe d’au moins 12 caractères et conservez-le : cette version ne comporte pas encore de réinitialisation du mot de passe par e-mail.

`npm.cmd run dev` lance à la fois l’API Node.js (port 3001) et Vite (port 5173). Le serveur doit rester actif pour enregistrer les données. L’ancienne clé de stockage de l’application de tâches Atelier n’est pas modifiée.

## Ce qui fonctionne

- Tableau de bord annuel : loyers encaissés hors provisions, décaissements réglés, trésorerie et montants à encaisser.
- Graphique mensuel des mouvements réglés, filtres par année et par bien.
- Création et modification des biens, loyers de référence, provisions, locataires et archivage sans suppression de l’historique.
- Journal avec saisie, modification et suppression confirmée des opérations ; recherche, catégories, filtres et pagination.
- Distinction entre loyers, provisions, apports, emprunts, intérêts, capital remboursé et dépôts de garantie.
- Échéances en attente, enregistrées comme réglées à la **date effective du règlement**, avec conservation de l’échéance initiale dans l’export.
- Export CSV compatible Excel ; sauvegarde et restauration JSON avec validation et confirmation.
- Connexion du même compte depuis plusieurs navigateurs. Les données sont rechargées au retour sur l’onglet ou au rechargement de la page. Les conflits d’édition sont signalés et ne remplacent pas les changements d’un autre appareil.
- Mode sombre et interface pour téléphone.

Les montants de la fiche du bien servent de référence. Configurez ensuite une **opération périodique** pour préparer les échéances : la seule création d’un bien ne suffit pas. Les quittances ne sont pas générées. Les opérations prévues et les règlements datés après la date d’arrêté ne gonflent pas la trésorerie.

![Opérations périodiques avec données fictives](docs/periodicites.png)

## Organiser les opérations régulières

1. Donnez un **nom court unique** à chaque bien, par exemple « République T2 ». L’adresse reste dans la fiche. Les anciens noms sont conservés ; renommez les éventuels doublons avant de créer de nouvelles fiches.
2. Ouvrez **Opérations périodiques → Nouvelle périodicité** : choisissez le type, le bien, la catégorie, la fréquence mensuelle/trimestrielle/annuelle et les dates de début et de fin. Le jour du début est conservé ; le 31 tombe au dernier jour des mois plus courts, sans décaler les mois suivants.
3. Pour un loyer, renseignez séparément le hors-charges et les provisions. Une seule échéance et un seul paiement peuvent couvrir les deux. Les nouveaux libellés sont proposés automatiquement : **Type · Nom court · Catégorie · Période**, avec un détail libre facultatif. La période concernée reste distincte de la date réelle du paiement.
4. Les échéances sont préparées jusqu’à la fin du mois courant lors de l’ouverture/actualisation du compte, et après l’enregistrement d’une périodicité. Les mois manqués sont rattrapés depuis le début choisi. Aucun paiement n’est présumé effectué ; il n’y a ni connexion bancaire ni service payant ajouté.
5. Dans **Pointage mensuel**, comparez les lignes à votre relevé, cochez les règlements réellement constatés et choisissez leur date. Une confirmation précède la validation groupée. Les lignes non cochées restent prévues ou en retard.
6. Pour un **paiement partiel**, indiquez le montant reçu. La ventilation loyer/provisions est proposée proportionnellement en centimes, et vous pouvez la modifier. Plusieurs règlements peuvent solder la même échéance. « Règlements » affiche leurs dates et permet d’annuler une erreur.
7. **Loyers impayés** retrouve les loyers et provisions échus non soldés, paiements partiels compris. **Prévisionnel** projette les 12 mois à venir à partir du solde réel et des opérations prévues, sans compter deux fois les échéances déjà créées. Les impayés échus sont affichés séparément : leur encaissement n’est pas supposé certain.

Mettre une périodicité en pause ou la supprimer conserve toutes les échéances déjà créées et leurs règlements. La reprise repart d’aujourd’hui, sans recréer les mois suspendus. Modifier un modèle s’applique aux échéances non encore créées ; corrigez séparément une échéance existante si nécessaire. Archiver un bien met ses périodicités en pause.

Pour un **prêt**, distinguez capital, intérêts et assurance si vous disposez de leur répartition. Une mensualité fixe ne signifie pas que capital et intérêts sont constants : ajustez les montants variables à partir du tableau d’amortissement. L’application ne reconstruit pas automatiquement ce tableau.

![Pointage mensuel avec données fictives](docs/pointage.png)

## Joindre des justificatifs

Dans le menu d’une opération ou depuis le pointage, ouvrez **Justificatifs** pour ajouter et télécharger des PDF, JPEG ou PNG. Limites : **5 Mo par fichier, 20 fichiers par opération, 50 Mo par compte**. L’accès nécessite le compte propriétaire. Les fichiers sont stockés dans la base SQLite, sans être publiés dans les fichiers du site.

**L’export JSON contient les opérations, les périodicités et les règlements, mais pas les fichiers justificatifs.** Téléchargez-les séparément ou sauvegardez toute la base serveur avec le script fourni. Lorsqu’une opération est supprimée/remplacée par un import, ses anciens fichiers restent conservés dans la base mais ne sont plus accessibles tant que l’opération correspondante n’est pas restaurée ; cette rétention compte dans le quota.

## Mettre à jour sans perdre votre SCI sous Windows

1. Faites un export JSON, puis arrêtez l’application avec **Ctrl+C**.
2. Copiez **tout le dossier `data`** dans un emplacement de sauvegarde privé, une fois le serveur arrêté. Ce dossier contient les comptes, les opérations et les fichiers justificatifs.
3. Téléchargez et décompressez la nouvelle version. Replacez une copie de votre dossier `data` dans le nouveau dossier du projet, avant le premier lancement. Ne remplacez jamais votre base existante par une base vide.
4. Lancez `npm.cmd ci`, puis `npm.cmd run dev`. Retrouvez votre compte habituel. Les anciennes sauvegardes JSON version 1 restent lisibles ; les anciens libellés sont conservés jusqu’à leur modification.

## Ce que signifient les chiffres

Les calculs utilisent des **centimes entiers**. La trésorerie globale correspond au solde initial plus les encaissements réglés moins les décaissements réglés, de la date initiale jusqu’à la date d’arrêté. La date d’arrêté est aujourd’hui pour l’exercice courant, ou le 31 décembre pour un exercice passé. Pour un bien isolé, l’indicateur affiche le solde de ses mouvements de l’année : le solde bancaire initial n’est pas réparti arbitrairement entre les biens.

L’application prépare un **suivi de trésorerie à partager avec le comptable**. Elle ne produit pas la comptabilité en partie double, les amortissements, la TVA, le bilan, le résultat fiscal à l’IS, les déclarations ou un FEC. Un remboursement de capital ou une restitution de dépôt reste un mouvement de trésorerie, sans être présenté comme une charge fiscale déductible.

## Accéder depuis plusieurs appareils

Les données d’un compte sont conservées sur **le serveur auquel vous vous connectez**, pas dans le stockage local du navigateur. La base est dans `data/atelier.sqlite` par défaut ; le dossier est exclu de Git et des images Docker.

**Un nom de domaine seul n’héberge pas le site.** Pour un accès permanent depuis votre téléphone et votre ordinateur, il faut aussi un serveur avec un disque persistant, puis faire pointer un sous-domaine vers celui-ci. Un hébergement uniquement statique (par exemple GitHub Pages) ne suffit pas pour l’API et SQLite. Les instructions ci-dessous ne créent ni abonnement, ni serveur, ni enregistrement DNS.

## Mise en ligne sur un VPS avec Docker

Prérequis : un VPS avec Docker et Docker Compose, une sauvegarde du disque, les ports 80 et 443 accessibles, et un sous-domaine pointant vers son adresse IP. Un seul exemplaire du serveur d’application doit utiliser cette base SQLite locale.

1. Récupérez le dépôt sur le VPS et placez-vous dans son dossier.
2. Copiez `.env.example` vers `.env` et remplacez `compta.votre-domaine.fr` par votre sous-domaine.
3. Lancez :

   ```bash
   docker compose up -d --build
   docker compose ps
   docker compose logs --tail=50 app caddy
   ```

4. Ouvrez votre sous-domaine en HTTPS et créez votre compte. Caddy obtient le certificat TLS si le DNS et les ports sont correctement configurés.

La syntaxe de Compose, la construction de l’image et le lancement Node.js de production ont été vérifiés. Un essai HTTPS local avec certificat vérifié a aussi validé l’inscription, l’écriture, la sauvegarde et la conservation des données après redémarrage. Le déploiement Compose complet, le DNS et le certificat HTTPS public devront être vérifiés sur l’hébergement choisi avant la saisie de données réelles.

Le volume `sci_data` conserve la base lors des redémarrages et des mises à jour. **Ne supprimez pas ce volume** pour mettre à jour le site. Les cookies de production nécessitent HTTPS. Le serveur d’application n’est pas exposé directement au réseau public ; Caddy est le point d’entrée. Les sessions expirent au bout de sept jours.

Le projet utilise des mots de passe hachés avec scrypt, des cookies HttpOnly/SameSite, une limite de tentatives de connexion, des contrôles d’origine des écritures et une vérification de version avant chaque enregistrement. Les comptes sont isolés ; partager l’accès à la même SCI se fait avec le même compte dans cette version, sans gestion de collaborateurs.

### Sauvegarder le serveur

L’export JSON depuis l’application sauvegarde la SCI connectée. Pour une sauvegarde cohérente de **toute la base et des comptes**, même lorsque SQLite utilise son journal WAL :

```bash
docker compose exec app node scripts/backup.mjs
```

Le fichier est créé dans `/app/data/backups/`. Copiez-le régulièrement hors du serveur et prévoyez une rotation des sauvegardes. Copier seulement le fichier SQLite actif sans son journal ne garantit pas une copie à jour. Le script de sauvegarde utilise l’API de sauvegarde SQLite.

Un compte créé sur votre ordinateur ne migre pas automatiquement sur le serveur : exportez sa SCI en JSON, créez un compte sur le serveur en ligne, puis importez le fichier. Les mots de passe, sessions et fichiers justificatifs ne figurent pas dans les exports JSON de la SCI. Pour déplacer aussi les comptes et justificatifs, migrez la base SQLite complète, serveur arrêté ou à partir d’une sauvegarde cohérente.

## Vérifications

```powershell
npm.cmd test
npm.cmd run build
npm.cmd run test:e2e
```

Les tests du modèle et de l’API vérifient les centimes, dates, soldes, imports, exports, isolation des comptes, sessions, conflits et redémarrage SQLite. Les tests Playwright exercent le site et la connexion de deux navigateurs distincts. Sous Windows, si Chromium n’est pas installé pour Playwright :

```powershell
npx.cmd playwright install chromium
```

Sur Linux, les tests utilisent `/usr/bin/chromium` lorsqu’il existe. `CHROMIUM_PATH` permet de définir un autre emplacement. Les tests navigateur utilisent leurs propres ports 5190 / 3012 et une base dans `.artifacts/e2e-data`, distincte de la base de développement.

`npm run build` produit les fichiers dans `dist/`. En production, `npm start` lance le serveur HTTP sur le port 3000, destiné à être placé derrière un reverse proxy HTTPS. `npm run preview` montre les fichiers statiques seulement : il ne lance pas l’API et ne remplace pas le démarrage complet.

## Structure

- `src/app.js`, `src/finance-ui.js`, `src/style.css` : interface, périodicités, pointage et prévisions.
- `src/model.js` : règles financières, validation, exports.
- `src/api.js` : échanges avec le serveur.
- `server/` : comptes, sessions, SQLite, justificatifs privés et serveur de production.
- `scripts/dev.mjs` : démarrage sous Windows et Linux.
- `scripts/backup.mjs` : sauvegarde cohérente de SQLite.
- `Dockerfile`, `compose.yaml`, `Caddyfile` : installation sur un serveur avec HTTPS.
- `tests/` : modèle, API et tests dans Chromium.
