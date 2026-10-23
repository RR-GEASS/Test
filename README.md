# Atelier

Un petit espace de gestion de projets en français, créé pour une première découverte de Codex.

## Essayer l’application

Avec Node.js 22.12 ou une version plus récente :

```bash
cd /workspace/Test
npm ci --cache /workspace/.cache/npm
npm run dev -- --host 0.0.0.0 --port 5173
```

Le serveur Vite utilise le port **5173**. Pour une installation sur un autre ordinateur, placez-vous dans le dossier du projet et utilisez simplement `npm ci` puis `npm run dev`.

## Ce que vous pouvez faire

- Créer, modifier et supprimer des tâches.
- Déplacer les cartes entre « À faire », « En cours » et « Terminé » par glisser-déposer ou avec le menu de la carte, également utilisable au clavier et sur téléphone.
- Choisir un projet, une priorité et une échéance.
- Chercher dans les titres et descriptions, avec ou sans accents. Le raccourci `/` ouvre la recherche.
- Filtrer par projet et priorité, ou passer de la vue tableau à la vue liste.
- Suivre votre progression et activer le mode sombre.

Les neuf tâches de départ sont des exemples. Les tâches sont enregistrées automatiquement **dans le navigateur utilisé**, via `localStorage`. Elles ne sont pas envoyées à un serveur ni synchronisées entre appareils. Effacer les données du navigateur efface aussi les tâches. Le thème est également mémorisé.

## Vérifier le projet

```bash
npm test
npm run build
npm run test:e2e
```

Les tests du modèle vérifient les données, la restauration, les filtres, les dates et les statistiques. Les tests Playwright vérifient les interactions réelles dans Chromium, y compris sur un écran de téléphone, et recherchent les problèmes d’accessibilité détectables automatiquement avec axe. Le navigateur système `/usr/bin/chromium` est utilisé par défaut ; définissez `CHROMIUM_PATH` si son emplacement diffère.

`npm run build` crée une version statique dans `dist/`. `npm run preview` permet de la vérifier localement. Un déploiement public n’est pas inclus.

## Retrouver le code

- `src/app.js` : interface et interactions.
- `src/model.js` : tâches, validation, recherche et statistiques.
- `src/style.css` : apparence, petits écrans et thème sombre.
- `tests/` : tests du modèle et tests dans le navigateur.

Les polices sont incluses dans les dépendances : aucune requête à un service de polices externe n’est nécessaire au fonctionnement de l’application.
