// Task grouping for the glasses.
//
// The display is a single green channel: colour cannot carry meaning, so
// every group and every flag is a text label the wearer reads, backed by an
// icon where one helps. The groups mirror what a wearer actually asks for:
// what is late, what is today, what is tomorrow, what is later.

const DAY_MS = 24 * 60 * 60 * 1000;

const PRIORITY_LABEL = { 0: '', 1: '低', 3: '中', 5: '高' };

/** TickTick dates look like `2026-03-01T00:58:20.000+0000`. */
export function parseDate(value) {
  if (typeof value !== 'string' || value === '') {
    return null;
  }
  // `+0000` is not ISO 8601 for every engine.
  const ms = Date.parse(value.replace(/([+-]\d{2})(\d{2})$/, '$1:$2'));
  return Number.isNaN(ms) ? null : ms;
}

/** Midnight of the day `ms` falls in, in the device's own time zone. */
function startOfDay(ms) {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

export function formatDue(task) {
  const at = parseDate(task.dueDate);
  if (at == null) {
    return '';
  }
  const d = new Date(at);
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  if (task.isAllDay) {
    return `${d.getMonth() + 1}/${d.getDate()}`;
  }
  return `${d.getMonth() + 1}/${d.getDate()} ${hh}:${mm}`;
}

/** A short flag string: priority and overdue/today markers. */
export function taskFlags(task, now) {
  const flags = [];
  const p = PRIORITY_LABEL[task.priority];
  if (p) {
    flags.push(`${p}优`);
  }
  const at = parseDate(task.dueDate);
  if (at != null) {
    const today = startOfDay(now);
    const due = startOfDay(at);
    if (due < today) {
      flags.push('逾期');
    }
  }
  const items = task.items || [];
  if (items.length) {
    const done = items.filter((i) => i.status !== 0).length;
    flags.push(`${done}/${items.length}`);
  }
  return flags;
}

/**
 * Group pending tasks into the wearer's buckets.
 * Returns an array of {key, label, tasks} in display order.
 */
export function groupTasks(buckets, now = Date.now()) {
  const today = startOfDay(now);
  const tomorrow = today + DAY_MS;

  const groups = {
    overdue: { key: 'overdue', label: '逾期', tasks: [] },
    today: { key: 'today', label: '今天', tasks: [] },
    tomorrow: { key: 'tomorrow', label: '明天', tasks: [] },
    later: { key: 'later', label: '以后', tasks: [] },
    someday: { key: 'someday', label: '无期限', tasks: [] },
  };

  for (const bucket of buckets) {
    for (const task of bucket.tasks || []) {
      if (task.status !== 0) {
        continue; // only pending tasks
      }
      const at = parseDate(task.dueDate);
      let group;
      if (at == null) {
        group = groups.someday;
      } else {
        const due = startOfDay(at);
        if (due < today) {
          group = groups.overdue;
        } else if (due === today) {
          group = groups.today;
        } else if (due === tomorrow) {
          group = groups.tomorrow;
        } else {
          group = groups.later;
        }
      }
      group.tasks.push({
        id: task.id,
        projectId: bucket.id,
        listName: bucket.name,
        title: task.title || '(无标题)',
        due: formatDue(task),
        flags: taskFlags(task, now),
      });
    }
  }

  // Within a group: the ones with a due date first (earliest first), then
  // the ones without one.
  const order = ['overdue', 'today', 'tomorrow', 'later', 'someday'];
  for (const key of order) {
    groups[key].tasks.sort((a, b) => {
      if (a.due && b.due) {
        return a.due < b.due ? -1 : a.due > b.due ? 1 : 0;
      }
      if (a.due) {
        return -1;
      }
      if (b.due) {
        return 1;
      }
      return 0;
    });
  }

  return order.map((key) => groups[key]).filter((g) => g.tasks.length > 0);
}

/** A one-line summary for the speech readout. */
export function summarize(groups) {
  if (!groups.length) {
    return '没有待办任务';
  }
  const total = groups.reduce((sum, g) => sum + g.tasks.length, 0);
  const parts = groups.map((g) => `${g.label}${g.tasks.length}个`);
  const first = groups[0].tasks[0];
  let line = `共${total}个待办，${parts.join('，')}`;
  if (first) {
    line += `。最急的是：${first.title}`;
  }
  return line;
}
