import test from 'node:test';
import assert from 'node:assert/strict';
import { createInitialState, normalizeState, validateTask, filterTasks, getStats, isOverdue, nextStatus, formatDate } from '../src/model.js';

test('le modèle de démonstration contient des tâches valides dans chaque colonne', () => {
  const state = createInitialState();
  assert.equal(state.version, 1);
  assert.equal(state.tasks.length, 9);
  assert.equal(new Set(state.tasks.map((task) => task.id)).size, 9);
  assert.deepEqual([...new Set(state.tasks.map((task) => task.status))].sort(), ['doing', 'done', 'todo']);
  for (const task of state.tasks) assert.deepEqual(validateTask(task).errors, {});
  assert.deepEqual(normalizeState(JSON.stringify(state)), state);
});

test('la restauration conserve un tableau vide et récupère les données corrompues', () => {
  assert.deepEqual(normalizeState({ version: 1, tasks: [] }), { version: 1, tasks: [] });
  for (const input of [null, undefined, '{', 'null', {}, { tasks: null }]) {
    assert.equal(normalizeState(input).tasks.length, 9);
  }
});

test('la restauration élimine les entrées invalides et répare les champs sans perdre les titres', () => {
  const state = normalizeState({ tasks: [null, 4, {}, { title: '  Bonjour  ', id: 'duplicate', status: 'nonsense', project: 'other', priority: 'oops', dueDate: '2026-02-30' }, { title: 'Deuxième', id: 'duplicate' }] });
  assert.equal(state.tasks.length, 2);
  assert.equal(state.tasks[0].title, 'Bonjour');
  assert.equal(state.tasks[0].status, 'todo');
  assert.equal(state.tasks[0].project, 'website');
  assert.equal(state.tasks[0].priority, 'medium');
  assert.equal(state.tasks[0].dueDate, '');
  assert.notEqual(state.tasks[0].id, state.tasks[1].id);
  for (const task of state.tasks) assert.deepEqual(validateTask(task).errors, {});
});

test('la validation nettoie le texte et refuse les titres vides ou trop longs', () => {
  const { value, errors } = validateTask({ title: '  Mon projet  ', description: '  Une idée.  ' });
  assert.deepEqual(errors, {});
  assert.equal(value.title, 'Mon projet');
  assert.equal(value.description, 'Une idée.');
  assert.ok(validateTask({ title: '  ' }).errors.title);
  assert.ok(validateTask({ title: 'a'.repeat(121) }).errors.title);
  assert.ok(validateTask({ title: 'Projet', description: 'a'.repeat(3001) }).errors.description);
  assert.ok(validateTask(null).errors.title);
});

test('la validation refuse les dates impossibles et accepte les années bissextiles', () => {
  for (const dueDate of ['2026-02-29', '2026-02-30', '2026-13-01', '2026-00-01', '2026-01-00', 'not-a-date']) {
    assert.ok(validateTask({ title: 'Projet', dueDate }).errors.dueDate, dueDate);
  }
  assert.deepEqual(validateTask({ title: 'Projet', dueDate: '2028-02-29' }).errors, {});
});

test('la recherche ignore accents et casse et combine les filtres', () => {
  const tasks = [
    { title: 'Créer le prototype', description: 'Étudier les retours', project: 'website', priority: 'high' },
    { title: 'Écrire', description: '', project: 'ideas', priority: 'low' },
  ];
  assert.deepEqual(filterTasks(tasks, { query: 'CREER' }), [tasks[0]]);
  assert.deepEqual(filterTasks(tasks, { query: 'etudier' }), [tasks[0]]);
  assert.deepEqual(filterTasks(tasks, { query: 'boite a idees' }), [tasks[1]]);
  assert.deepEqual(filterTasks(tasks, { query: 'creer', project: 'website', priority: 'high' }), [tasks[0]]);
  assert.deepEqual(filterTasks(tasks, { query: 'creer', project: 'ideas' }), []);
  assert.deepEqual(filterTasks(tasks, { priority: 'low' }), [tasks[1]]);
  assert.equal(tasks.length, 2);
});

test('les statistiques distinguent retard, échéance du jour et tâches terminées', () => {
  const today = '2026-10-23';
  const tasks = [
    { status: 'todo', dueDate: '2026-10-22' },
    { status: 'doing', dueDate: today },
    { status: 'done', dueDate: '2026-10-01' },
    { status: 'todo', dueDate: '' },
  ];
  assert.deepEqual(getStats(tasks, today), { total: 4, done: 1, doing: 1, todo: 2, overdue: 1, progress: 25 });
  assert.equal(isOverdue(tasks[0], today), true);
  assert.equal(isOverdue(tasks[1], today), false);
  assert.equal(isOverdue(tasks[2], today), false);
  assert.equal(isOverdue({ status: 'todo', dueDate: 'invalid' }, today), false);
  assert.deepEqual(getStats([], today), { total: 0, done: 0, doing: 0, todo: 0, overdue: 0, progress: 0 });
});

test('le déplacement et les dates ont des résultats utilisables', () => {
  assert.equal(nextStatus('todo'), 'doing');
  assert.equal(nextStatus('doing'), 'done');
  assert.equal(nextStatus('done'), 'todo');
  assert.equal(nextStatus('unknown'), 'todo');
  assert.match(formatDate('2026-10-24'), /24 oct/);
  assert.equal(formatDate('2026-02-30'), '');
});
