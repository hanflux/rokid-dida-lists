// Task grouping for the glasses.
//
// The display is a single green channel: colour cannot carry meaning, so
// every group and every flag is a text label the wearer reads, backed by an
// icon where one helps. The groups mirror what a wearer actually asks for:
// what is late, what is today, what is tomorrow, what is later.

const DAY_MS = 24 * 60 * 60 * 1000;

const PRIORITY_LABEL = { 0: '', 1: '低', 3: '中', 5: '高' };

/**
 * TickTick due dates look like `2026-03-01T00:58:20.000+0800`.
 *
 * The calendar date in that string is already the wearer's own local date —
 * Dida365 sends the offset the account is set to. Converting it to an
 * instant and then back to "today" in the device time zone shifts every task
 * across a day boundary whenever the glasses run in a different zone than
 * the account (the AIX preview host runs UTC, for instance). So we compare
 * the calendar parts directly and never convert.
 */
export function parseDateParts(value) {
  if (typeof value !== 'string' || value === '') {
    return null;
  }
  const m = value.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/);
  if (!m) {
    return null;
  }
  return {
    year: Number(m[1]),
    month: Number(m[2]),
    day: Number(m[3]),
    hour: Number(m[4]),
    minute: Number(m[5]),
  };
}

/** Days since the epoch for a calendar date, ignoring any time offset. */
function dayNumber(year, month, day) {
  return Math.floor(Date.UTC(year, month - 1, day) / DAY_MS);
}

/** The calendar day the device is on, in the device's own time zone. */
export function todayNumber(now = Date.now()) {
  const d = new Date(now);
  return dayNumber(d.getFullYear(), d.getMonth() + 1, d.getDate());
}

export function formatDue(task) {
  const parts = parseDateParts(task.dueDate);
  if (!parts) {
    return '';
  }
  const date = `${parts.month}/${parts.day}`;
  if (task.isAllDay) {
    return date;
  }
  return `${date} ${String(parts.hour).padStart(2, '0')}:${String(parts.minute).padStart(2, '0')}`;
}

/** A short flag string: priority and overdue/today markers. */
export function taskFlags(task, now) {
  const flags = [];
  const p = PRIORITY_LABEL[task.priority];
  if (p) {
    flags.push(`${p}优`);
  }
  const parts = parseDateParts(task.dueDate);
  if (parts) {
    const due = dayNumber(parts.year, parts.month, parts.day);
    if (due < todayNumber(now)) {
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
  const today = todayNumber(now);
  const tomorrow = today + 1;

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
      const parts = parseDateParts(task.dueDate);
      let group;
      if (!parts) {
        group = groups.someday;
      } else {
        const due = dayNumber(parts.year, parts.month, parts.day);
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
        day: parts ? dayNumber(parts.year, parts.month, parts.day) : null,
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
      if (a.day != null && b.day != null) {
        return a.day - b.day;
      }
      if (a.day != null) {
        return -1;
      }
      if (b.day != null) {
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
