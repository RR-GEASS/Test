import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

const taskCards = (page) => page.getByTestId('task-card');
const taskCard = (page, title) => taskCards(page).filter({ hasText: title });

async function createTask(page, title, options = {}) {
  await page.getByRole('button', { name: 'Nouvelle tâche', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel(/^Titre/).fill(title);
  if (options.description) await dialog.getByLabel('Description', { exact: true }).fill(options.description);
  if (options.project) await dialog.getByLabel('Projet', { exact: true }).selectOption(options.project);
  if (options.priority) await dialog.getByLabel('Priorité', { exact: true }).selectOption(options.priority);
  if (options.status) await dialog.getByLabel('Statut', { exact: true }).selectOption(options.status);
  if (options.dueDate) await dialog.getByLabel('Échéance', { exact: true }).fill(options.dueDate);
  await dialog.getByRole('button', { name: 'Créer la tâche', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await expect(taskCard(page, title)).toHaveCount(1);
}

async function openActions(page, title) {
  await taskCard(page, title).getByRole('button', { name: `Actions pour ${title}`, exact: true }).click();
}

test.beforeEach(async ({ page }) => {
  await page.goto('/');
});

test('le tableau présente des tâches dans ses trois colonnes', async ({ page }) => {
  await expect(page.getByRole('heading', { name: /^Tous les projets/ })).toBeVisible();
  for (const status of ['todo', 'doing', 'done']) {
    const column = page.locator(`section[data-status="${status}"]`);
    await expect(column).toBeVisible();
    expect(await column.getByTestId('task-card').count()).toBeGreaterThan(0);
  }
  await expect(page.getByRole('button', { name: 'Nouvelle tâche', exact: true })).toBeVisible();
});

test('un titre est obligatoire et une tâche créée reste après rechargement', async ({ page }) => {
  const before = await taskCards(page).count();
  await page.getByRole('button', { name: 'Nouvelle tâche', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('button', { name: 'Créer la tâche', exact: true }).click();
  await expect(dialog).toBeVisible();
  await expect(taskCards(page)).toHaveCount(before);
  await dialog.getByLabel(/^Titre/).fill('Préparer ma démonstration');
  await dialog.getByLabel('Description', { exact: true }).fill('Vérifier la sauvegarde automatique.');
  await dialog.getByLabel('Priorité', { exact: true }).selectOption('high');
  await dialog.getByRole('button', { name: 'Créer la tâche', exact: true }).click();
  await expect(taskCard(page, 'Préparer ma démonstration')).toBeVisible();
  await page.reload();
  await expect(taskCard(page, 'Préparer ma démonstration')).toHaveCount(1);
  await expect(taskCard(page, 'Préparer ma démonstration')).toContainText('Vérifier la sauvegarde automatique.');
});

test('une tâche peut être modifiée, déplacée puis supprimée', async ({ page }) => {
  await createTask(page, 'Ma tâche à modifier', { status: 'todo' });
  await openActions(page, 'Ma tâche à modifier');
  await page.getByRole('menuitem', { name: 'Modifier', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel(/^Titre/).fill('Ma tâche modifiée');
  await dialog.getByRole('button', { name: 'Enregistrer', exact: true }).click();
  await expect(taskCard(page, 'Ma tâche modifiée')).toHaveCount(1);
  await expect(taskCard(page, 'Ma tâche à modifier')).toHaveCount(0);

  await openActions(page, 'Ma tâche modifiée');
  await page.getByRole('menuitem', { name: 'Déplacer vers En cours', exact: true }).click();
  await expect(page.locator('section[data-status="doing"]').getByTestId('task-card').filter({ hasText: 'Ma tâche modifiée' })).toHaveCount(1);
  await page.reload();
  await expect(page.locator('section[data-status="doing"]').getByTestId('task-card').filter({ hasText: 'Ma tâche modifiée' })).toHaveCount(1);

  await openActions(page, 'Ma tâche modifiée');
  await page.getByRole('menuitem', { name: 'Supprimer', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Supprimer la tâche', exact: true }).click();
  await expect(taskCard(page, 'Ma tâche modifiée')).toHaveCount(0);
  await page.reload();
  await expect(taskCard(page, 'Ma tâche modifiée')).toHaveCount(0);
});

test('la recherche retrouve les tâches sans dépendre des accents', async ({ page }) => {
  await createTask(page, 'Étudier les possibilités');
  const search = page.getByPlaceholder('Rechercher une tâche…');
  await search.fill('etudier les possibilites');
  await expect(taskCards(page)).toHaveCount(1);
  await expect(taskCard(page, 'Étudier les possibilités')).toBeVisible();
  await search.fill('zzzaaaucuneresultat');
  await expect(taskCards(page)).toHaveCount(0);
  await search.fill('');
  expect(await taskCards(page).count()).toBeGreaterThan(1);
});

test('les filtres par priorité et projet se combinent', async ({ page }) => {
  await createTask(page, 'Urgent pour mon site', { project: 'website', priority: 'high' });
  await createTask(page, 'Idée à garder pour plus tard', { project: 'ideas', priority: 'low' });
  await page.getByLabel('Filtrer par priorité', { exact: true }).selectOption('high');
  await expect(taskCard(page, 'Urgent pour mon site')).toHaveCount(1);
  await expect(taskCard(page, 'Idée à garder pour plus tard')).toHaveCount(0);
  await page.locator('aside [data-project="ideas"]').click();
  await expect(taskCard(page, 'Urgent pour mon site')).toHaveCount(0);
  await page.getByLabel('Filtrer par priorité', { exact: true }).selectOption('all');
  await expect(taskCard(page, 'Idée à garder pour plus tard')).toHaveCount(1);
});

test('le glisser-déposer déplace une tâche et sauvegarde son nouveau statut', async ({ page }) => {
  const source = page.locator('section[data-status="todo"]').getByTestId('task-card').first();
  const title = await source.locator('.task-title').innerText();
  const destination = page.locator('section[data-status="doing"] .column-tasks');
  await source.dragTo(destination);
  await expect(page.locator('section[data-status="doing"]').getByTestId('task-card').filter({ hasText: title })).toHaveCount(1);
  await page.reload();
  await expect(page.locator('section[data-status="doing"]').getByTestId('task-card').filter({ hasText: title })).toHaveCount(1);
});

test('la vue liste conserve les tâches et le mode sombre reste après rechargement', async ({ page }) => {
  const before = await taskCards(page).count();
  await page.getByRole('button', { name: 'Vue liste', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Vue liste', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(taskCards(page)).toHaveCount(before);
  await page.getByRole('button', { name: 'Vue tableau', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Vue tableau', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(taskCards(page)).toHaveCount(before);
  await page.getByRole('button', { name: 'Passer au mode sombre', exact: true }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await expect(page.getByRole('button', { name: 'Passer au mode clair', exact: true })).toBeVisible();
});

test('le téléphone permet de créer une tâche sans débordement de page', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole('button', { name: 'Nouvelle tâche', exact: true })).toBeVisible();
  await createTask(page, 'Une tâche depuis mon téléphone');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

// These automated checks cover the selected states, not full WCAG conformance.
test.describe('contrôles automatiques d’accessibilité', () => {
  test.use({ reducedMotion: 'reduce' });

  async function audit(page, testInfo, state) {
    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
      .analyze();
    if (results.violations.length) {
      await testInfo.attach(`accessibilite-${state}`, {
        body: JSON.stringify(results.violations, null, 2),
        contentType: 'application/json',
      });
    }
    expect(results.violations, `Violations automatiques dans l’état ${state}`).toEqual([]);
  }

  for (const theme of ['clair', 'sombre']) {
    test(`tableau en mode ${theme}`, async ({ page }, testInfo) => {
      if (theme === 'sombre') await page.getByRole('button', { name: 'Passer au mode sombre', exact: true }).click();
      await audit(page, testInfo, `tableau-${theme}`);
    });

    test(`formulaire en mode ${theme}`, async ({ page }, testInfo) => {
      if (theme === 'sombre') await page.getByRole('button', { name: 'Passer au mode sombre', exact: true }).click();
      await page.getByRole('button', { name: 'Nouvelle tâche', exact: true }).click();
      await audit(page, testInfo, `formulaire-${theme}`);
    });
  }

  test('tableau et formulaire sur téléphone', async ({ page }, testInfo) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await audit(page, testInfo, 'tableau-mobile');
    await page.getByRole('button', { name: 'Nouvelle tâche', exact: true }).click();
    await audit(page, testInfo, 'formulaire-mobile');
  });
});
