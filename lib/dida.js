import wx from 'wx';
import { PRESET_TOKEN } from './secret.js';

// Dida365 (滴答清单) Open API client, called straight from the glasses.
//
// The glasses reach the internet on their own: with Wi-Fi off the Rokid AI
// app proxies the request over the phone's connection, and Dida365 answers
// CORS with `*`, so no server of ours is involved.
//
// Endpoints (all under /open/v1):
//   GET    /project                  -> [{id, name, kind, ...}]
//   GET    /project/{id}/data        -> {tasks: [...], columns: [...]}
//   GET    /project/inbox/data       -> {tasks: [...]}   (the Inbox)
//   POST   /task                     -> create
//   POST   /project/{p}/task/{t}/complete
//   DELETE /project/{p}/task/{t}
export const API_BASE = 'https://api.dida365.com/open/v1';

const TOKEN_KEY = 'dida.token';
const TIMEOUT_MS = 15000;

/**
 * Lists that are noise rather than work.
 *
 * `👋欢迎` is the list Dida365 itself seeds with onboarding tasks (feature
 * blurbs, "advanced membership", …) — 11 of them, none of them real work.
 * Hidden by default; the wearer can still show it.
 */
const HIDDEN_LISTS = ['👋欢迎'];

/** Hidden list names, persisted so the wearer can change them. */
const FILTER_KEY = 'dida.hiddenLists';

export function getHiddenLists() {
  try {
    const stored = wx.getStorageSync(FILTER_KEY);
    if (Array.isArray(stored)) {
      return stored;
    }
  } catch (error) {
    console.warn('hidden list read failed', error);
  }
  return HIDDEN_LISTS.slice();
}

export function setHiddenLists(names) {
  wx.setStorageSync(FILTER_KEY, names);
}

/** True when a list should be shown on the glasses. */
export function isListVisible(bucketName) {
  return !getHiddenLists().includes(bucketName);
}

export function getToken() {
  try {
    const stored = wx.getStorageSync(TOKEN_KEY);
    if (stored) {
      return stored;
    }
  } catch (error) {
    console.error('token read failed', error);
  }
  // Fall back to the token baked into the build. The glasses have no
  // keyboard, so a fresh install would otherwise have nothing to talk to.
  return PRESET_TOKEN;
}

export function setToken(token) {
  wx.setStorageSync(TOKEN_KEY, token);
}

export function hasToken() {
  return Boolean(getToken());
}

function request(method, path, body) {
  return new Promise((resolve, reject) => {
    const token = getToken();
    if (!token) {
      reject(new Error('NO_TOKEN'));
      return;
    }
    wx.request({
      url: API_BASE + path,
      method,
      // AIUI's wx.request defaults to `arraybuffer`; without this the JSON
      // body comes back as binary and every parse fails.
      responseType: 'json',
      header: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      data: body,
      timeout: TIMEOUT_MS,
      success(res) {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve(res.data);
          return;
        }
        // 401 -> the token was refused or revoked.
        const message =
          (res.data && (res.data.errorMessage || res.data.errorCode)) ||
          `HTTP ${res.statusCode}`;
        reject(new Error(message));
      },
      fail(err) {
        reject(new Error((err && err.errMsg) || 'NETWORK'));
      },
    });
  });
}

/** The task list's own name, or the Inbox. */
export async function fetchProjects() {
  const projects = await request('GET', '/project');
  return Array.isArray(projects) ? projects : [];
}

/** Every pending task of every list plus the Inbox, flattened. */
export async function fetchAllTasks(options = {}) {
  const includeHidden = Boolean(options.includeHidden);
  const projects = await fetchProjects();
  const buckets = [];

  const inbox = await request('GET', '/project/inbox/data');
  buckets.push({ id: 'inbox', name: '收集箱', tasks: inbox.tasks || [] });

  for (const project of projects) {
    if (!includeHidden && !isListVisible(project.name)) {
      continue;
    }
    // The API is happy with a handful of parallel reads; the Inbox is
    // already fetched above so it is not repeated here.
    let data;
    try {
      data = await request('GET', `/project/${project.id}/data`);
    } catch (error) {
      console.warn('project read failed', project.name, error);
      continue;
    }
    buckets.push({
      id: project.id,
      name: project.name,
      tasks: data.tasks || [],
    });
  }
  return buckets;
}

/** Mark one task done. */
export async function completeTask(projectId, taskId) {
  return request('POST', `/project/${projectId}/task/${taskId}/complete`);
}
