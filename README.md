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

Les loyers indiqués dans les fiches ne créent pas automatiquement d’échéances ou de quittances. Chaque opération doit être saisie. Les opérations en attente et les règlements datés après la date d’arrêté ne gonflent pas la trésorerie.

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

Un compte créé sur votre ordinateur ne migre pas automatiquement sur le serveur : exportez sa SCI en JSON, créez un compte sur le serveur en ligne, puis importez le fichier. Les mots de passe et sessions ne figurent pas dans les exports JSON de la SCI.

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

- `src/app.js`, `src/style.css` : interface et interactions.
- `src/model.js` : règles financières, validation, exports.
- `src/api.js` : échanges avec le serveur.
- `server/` : comptes, sessions, SQLite et serveur de production.
- `scripts/dev.mjs` : démarrage sous Windows et Linux.
- `scripts/backup.mjs` : sauvegarde cohérente de SQLite.
- `Dockerfile`, `compose.yaml`, `Caddyfile` : installation sur un serveur avec HTTPS.
- `tests/` : modèle, API et tests dans Chromium.
