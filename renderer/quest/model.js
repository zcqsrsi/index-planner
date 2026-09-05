// Shared model for the merged Projects journal: factories, status sets, and
// the arithmetic of progress / age / staleness. Used by the projects view,
// dashboard briefing, quick-add, and settings. A project IS a notebook now
// (phase 9) — objectives group sub-objectives (sections), tasks live on a
// sub-objective or float on the project itself.

import { ageDays } from '../ui/components.js';

// crypto.getRandomValues — replaces the ad-hoc Math.random id strings so
// prefixes are consistent and collisions are vanishingly unlikely.
export function makeId(prefix) {
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  const hex = [...bytes].map(b => b.toString(16).padStart(2, '0')).join('');
  return `${prefix}_${hex.slice(0, 13)}`;
}

export const TASK_STATUSES = ['todo', 'in-progress', 'done', 'scrapped'];
export const TASK_STATUS_LABELS = {
  todo: 'To do', 'in-progress': 'In progress', done: 'Done', scrapped: 'Scrapped',
};
export const OBJECTIVE_STATUSES = ['active', 'done', 'scrapped'];
export const QUEST_STATUSES = ['active', 'paused', 'done', 'scrapped', 'archived'];
export const QUEST_STATUS_LABELS = {
  active: 'Active', paused: 'Paused', done: 'Done', scrapped: 'Scrapped', archived: 'Archived',
};
export const PRIORITIES = ['low', 'normal', 'high', 'urgent'];

// A new project is a new notebook with the hunt fields on it.
export function newProject(name) {
  return {
    id: makeId('nb'),
    name,
    color: PROJECT_COLORS[Math.floor(Math.random() * PROJECT_COLORS.length)],
    icon: null,
    createdAt: Date.now(),
    kind: 'project',
    status: 'active',
    dueDate: null,
    description: '',
    groupId: null,
    objectives: [],
    floatingTasks: [],
    sections: [],
  };
}

export function newObjective(name) {
  return {
    id: makeId('obj'),
    name,
    status: 'active',
    importance: 'normal',
    createdAt: Date.now(),
    scrappedReason: null,
  };
}

export function newTask(title) {
  return {
    id: makeId('t'),
    title,
    status: 'todo',
    priority: 'normal',
    dueDate: null,
    resolvedAt: null,
    scrappedReason: '',
    tags: [],
    flavorText: null,
    flavorCustom: false,
    flavorSeed: 0,
  };
}

export function newGroup(name) {
  return {
    id: makeId('grp'),
    name,
    color: PROJECT_COLORS[Math.floor(Math.random() * PROJECT_COLORS.length)],
    parentId: null,
  };
}

export const PROJECT_COLORS = [
  '#eb8163', '#8abec0', '#a3be8c', '#d08770', '#b48ead', '#ebcb8b', '#88c0d0', '#bf616a',
];

export function findObjective(project, objectiveId) {
  return (project.objectives || []).find(o => o.id === objectiveId) || null;
}

// Every task with its sub-objective (section, null when afloat) and project
// attached — the shape used by the dashboard briefing, quick-add, and the
// projects view. Sections first, then the floating loose ends.
export function iterTasks(project) {
  const out = [];
  for (const section of project.sections || []) {
    for (const task of section.tasks || []) {
      out.push({ task, section, project });
    }
  }
  for (const task of project.floatingTasks || []) {
    out.push({ task, section: null, project });
  }
  return out;
}

export function iterAllTasks(projects) {
  const out = [];
  for (const project of projects) out.push(...iterTasks(project));
  return out;
}

const OPEN = new Set(['todo', 'in-progress']);

// Done ÷ (done + open). Scrapped resolves a task without counting as
// progress — a half-scrapped project isn't half done.
export function progressOf(tasks) {
  let done = 0, open = 0, scrapped = 0;
  for (const t of tasks) {
    if (t.status === 'done') done++;
    else if (t.status === 'scrapped') scrapped++;
    else open++;
  }
  const total = done + open;
  return {
    done, open, scrapped,
    total,
    pct: total ? Math.round((done / total) * 100) : 0,
  };
}

export function isStale(task, staleDays = 3) {
  return OPEN.has(task.status) && ageDays(task.createdAt) >= staleDays;
}