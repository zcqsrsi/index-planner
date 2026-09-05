// "Today's threads" — the dashboard briefing. A curated daily program:
// stalest open threads first (spread across projects), then what's due or
// overdue, then a quiet count of the rest. Capped, never a full list.

import { todayStr, isOverdue, isToday, ageDays } from '../ui/components.js';
import { iterTasks } from './model.js';

const PRIORITY_RANK = { urgent: 0, high: 1, normal: 2, low: 3 };

// One thread per project per pass, so the stale bucket doesn't become one
// project's wall of shame.
function roundRobin(items, cap) {
  const byProject = new Map();
  for (const it of items) {
    if (!byProject.has(it.project.id)) byProject.set(it.project.id, []);
    byProject.get(it.project.id).push(it);
  }
  const out = [];
  let added = true;
  while (out.length < cap && added) {
    added = false;
    for (const list of byProject.values()) {
      if (list.length && out.length < cap) { out.push(list.shift()); added = true; }
    }
  }
  return out;
}

export function buildBriefing(projects, settings = {}) {
  const staleAfter = settings.staleDays ?? 3;
  const all = [];
  for (const p of projects) {
    for (const { task, section } of iterTasks(p)) {
      all.push({ task, section, project: p });
    }
  }
  const open = all.filter(x => x.task.status === 'todo' || x.task.status === 'in-progress');

  const overdue = open
    .filter(x => isOverdue(x.task.dueDate))
    .sort((a, b) => a.task.dueDate < b.task.dueDate ? -1
      : a.task.dueDate > b.task.dueDate ? 1
      : PRIORITY_RANK[a.task.priority] - PRIORITY_RANK[b.task.priority]);
  const dueToday = open
    .filter(x => isToday(x.task.dueDate))
    .sort((a, b) => PRIORITY_RANK[a.task.priority] - PRIORITY_RANK[b.task.priority]);
  // Stale pool: open and aging, not already in the due/overdue buckets.
  const stale = open
    .filter(x => (!x.task.dueDate || x.task.dueDate > todayStr())
      && ageDays(x.task.createdAt) >= staleAfter)
    .sort((a, b) => a.task.createdAt - b.task.createdAt);

  const picked = roundRobin(stale, 3);
  for (const x of [...overdue, ...dueToday]) {
    if (picked.length >= 6) break;
    if (!picked.includes(x) && !picked.some(y => y.task.id === x.task.id)) picked.push(x);
  }

  return {
    items: picked,
    remaining: open.length - picked.length,
    openCount: open.length,
    staleCount: stale.length,
  };
}