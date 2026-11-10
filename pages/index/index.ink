<script type="application/json" def>
{
  "navigationBarTitleText": "滴答清单",
  "description": "直接读取滴答清单（Dida365）里的待办任务，按逾期、今天、明天、以后分组显示在眼镜绿屏上；支持刷新、查看详情与语音播报。",
  "schema": {
    "data": {
      "type": "object",
      "properties": {
        "phase": {
          "type": "string",
          "description": "页面状态：loading 表示正在拉取任务，ready 表示已有分组结果，no-token 表示缺少访问令牌，error 表示拉取失败。"
        },
        "errorMessage": {
          "type": "string",
          "description": "拉取失败时的错误提示文本，供用户口头播报。"
        },
        "groups": {
          "type": "array",
          "description": "按逾期、今天、明天、以后、无期限分组的任务列表，每个分组包含标题与任务条目。",
          "items": {
            "type": "object",
            "properties": {
              "id": { "type": "string", "description": "任务唯一标识。" },
              "title": { "type": "string", "description": "任务标题。" },
              "projectName": { "type": "string", "description": "所属清单名称。" }
            },
            "required": ["id", "title"]
          }
        },
        "total": {
          "type": "number",
          "description": "当前显示的任务总数。"
        },
        "summary": {
          "type": "string",
          "description": "任务数量概览，例如逾期 1 项、今天 2 项。"
        },
        "lastSync": {
          "type": "string",
          "description": "最近一次成功同步的时间文本。"
        }
      },
      "required": ["phase", "groups", "total", "summary"]
    }
  }
}
</script>

<script setup>
import wx from 'wx';
import {
  fetchAllTasks,
  fetchProjects,
  getToken,
  setToken,
  hasToken,
  getHiddenLists,
  setHiddenLists,
  plainListName,
} from '../../lib/dida.js';
import { groupTasks, summarize } from '../../lib/group.js';

export default {
  data: {
    phase: 'loading', // loading | ready | no-token | error
    errorMessage: '',
    groups: [],
    total: 0,
    summary: '',
    lastSync: '',
    expandedId: '',
    allLists: [],
    hiddenLists: [],
    showLists: false,
  },

  onLoad() {
    this.refresh();
  },

  onShow() {
    // The framework may replay onLoad; one refresh per display is enough.
    if (this.data.phase === 'ready' && !this.data.lastSync) {
      this.refresh();
    }
  },

  onUnload() {
    this.stopSpeaking();
  },

  async refresh() {
    if (!hasToken()) {
      this.setData({ phase: 'no-token' });
      return;
    }
    this.setData({ phase: 'loading', errorMessage: '' });
    try {
      const [buckets, projects] = await Promise.all([
        fetchAllTasks(),
        fetchProjects(),
      ]);
      const groups = groupTasks(buckets);
      const total = groups.reduce((sum, g) => sum + g.tasks.length, 0);
      const now = new Date();
      this.setData({
        phase: 'ready',
        groups,
        total,
        summary: summarize(groups),
        allLists: projects.map((p) => plainListName(p.name)),
        hiddenLists: getHiddenLists(),
        lastSync: `${now.getMonth() + 1}/${now.getDate()} ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`,
      });
      this.announce();
    } catch (error) {
      const message = (error && error.message) || '读取失败';
      if (message === 'NO_TOKEN') {
        this.setData({ phase: 'no-token' });
        return;
      }
      this.setData({ phase: 'error', errorMessage: message });
      this.speak(`读取滴答清单失败：${message}`);
    }
  },

  announce() {
    const { summary, total } = this.data;
    if (total === 0) {
      this.speak('滴答清单里没有待办任务');
      return;
    }
    this.speak(summary);
  },

  speak(text) {
    if (!text) {
      return;
    }
    try {
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.lang = 'zh-CN';
      speechSynthesis.speak(utterance, 'immediate');
    } catch (error) {
      console.warn('speak failed', error);
    }
  },

  stopSpeaking() {
    // `speak()` shares one runtime player; a fresh immediate utterance
    // replaces the queue, which is enough to silence a stale readout.
  },

  // --- interaction -------------------------------------------------------

  onKeyDown(event) {
    const code = event.code;
    if (code === 'ArrowDown') {
      this.scrollBy(120);
    } else if (code === 'ArrowUp') {
      this.scrollBy(-120);
    } else if (code === 'Enter') {
      this.toggleExpand();
    } else if (code === 'Tab') {
      event.preventDefault();
      this.toggleLists();
    } else if (code === 'Backspace') {
      event.preventDefault();
      this.refresh();
    }
  },

  scrollBy(delta) {
    const view = this.getPageViews ? this.getPageViews() : null;
    if (view && view.scrollTo) {
      view.scrollTo({ top: Math.max(0, (view.scrollTop || 0) + delta), animated: true });
    }
  },

  toggleExpand() {
    const groups = this.data.groups || [];
    const flat = [];
    for (const group of groups) {
      for (const task of group.tasks) {
        flat.push(task);
      }
    }
    if (!flat.length) {
      return;
    }
    const index = flat.findIndex((t) => t.id === this.data.expandedId);
    const next = flat[(index + 1) % flat.length];
    this.setData({ expandedId: next.id });
    const task = next;
    const parts = [`${task.title}`];
    if (task.due) {
      parts.push(`截止${task.due}`);
    }
    if (task.flags.length) {
      parts.push(task.flags.join('，'));
    }
    parts.push(`来自${task.listName}`);
    this.speak(parts.join('，'));
  },

  onTaskTap(event) {
    const id = event.currentTarget.dataset.id;
    this.setData({ expandedId: this.data.expandedId === id ? '' : id });
  },

  // --- list selection ----------------------------------------------------

  toggleLists() {
    this.setData({ showLists: !this.data.showLists });
  },

  onListTap(event) {
    const name = event.currentTarget.dataset.name;
    const hidden = this.data.hiddenLists || [];
    const next = hidden.includes(name)
      ? hidden.filter((n) => n !== name)
      : hidden.concat([name]);
    setHiddenLists(next);
    this.setData({ hiddenLists: next });
    this.refresh();
  },

  async onRefreshTap() {
    await this.refresh();
  },

  // --- voice -------------------------------------------------------------

  async startVoice() {
    try {
      const recognition = new SpeechRecognition();
      recognition.lang = 'zh-CN';
      recognition.continuous = false;
      recognition.interimResults = false;
      recognition.onresult = (event) => {
        const best = event.results[0][0];
        const text = (best && best.transcript) || '';
        this.handleVoice(text);
      };
      recognition.onerror = (event) => {
        console.warn('recognition error', event.error);
      };
      recognition.start();
      this.recognition = recognition;
      this.setData({ listening: true });
    } catch (error) {
      console.warn('recognition start failed', error);
      this.speak('无法启动语音识别');
    }
  },

  stopVoice() {
    if (this.recognition) {
      try {
        this.recognition.stop();
      } catch (error) {
        /* already stopped */
      }
      this.recognition = null;
    }
    this.setData({ listening: false });
  },

  handleVoice(text) {
    const t = (text || '').trim();
    if (!t) {
      return;
    }
    if (t.includes('刷新') || t.includes('更新') || t.includes('同步')) {
      this.refresh();
      return;
    }
    if (t.includes('今天')) {
      const today = (this.data.groups || []).find((g) => g.key === 'today');
      if (!today || !today.tasks.length) {
        this.speak('今天没有待办任务');
        return;
      }
      const lines = today.tasks
        .slice(0, 5)
        .map((task, i) => `第${i + 1}个，${task.title}`);
      this.speak(`今天有${today.tasks.length}个待办。${lines.join('。')}`);
      return;
    }
    if (t.includes('逾期') || t.includes('过期')) {
      const overdue = (this.data.groups || []).find((g) => g.key === 'overdue');
      if (!overdue || !overdue.tasks.length) {
        this.speak('没有逾期任务');
        return;
      }
      const lines = overdue.tasks
        .slice(0, 5)
        .map((task, i) => `第${i + 1}个，${task.title}`);
      this.speak(`有${overdue.tasks.length}个逾期任务。${lines.join('。')}`);
      return;
    }
    this.speak('可以说：刷新、今天什么、或者有逾期吗');
  },
};
</script>

<page>
  <view class="root">
    <view class="header">
      <text class="title">滴答清单</text>
      <text class="meta">{{lastSync}}</text>
    </view>

    <view class="state" ink:if="{{phase === 'loading'}}">
      <text class="state-text">读取中…</text>
    </view>

    <view class="state" ink:if="{{phase === 'no-token'}}">
      <text class="state-text">尚未连接滴答清单</text>
      <text class="state-hint">请在手机 Rokid AI App 的设置里填入访问令牌</text>
    </view>

    <view class="state" ink:if="{{phase === 'error'}}">
      <text class="state-text">读取失败</text>
      <text class="state-hint">{{errorMessage}}</text>
    </view>

    <view class="lists" ink:if="{{showLists}}">
      <view class="lists-head">
        <text class="lists-title">显示哪些清单</text>
        <text class="lists-hint">点击切换</text>
      </view>
      <view
        class="list-row"
        ink:for="{{allLists}}"
        ink:key="index"
        data-name="{{item}}"
        bindtap="onListTap"
      >
        <text class="list-mark">{{hiddenLists.indexOf(item) >= 0 ? '×' : '✓'}}</text>
        <text class="list-name">{{item}}</text>
      </view>
    </view>

    <scroll-view class="list" scroll-y="true" ink:if="{{phase === 'ready'}}">
      <view class="group" ink:for="{{groups}}" ink:for-item="group" ink:key="index">
        <view class="group-head">
          <text class="group-label">{{group.label}}</text>
          <text class="group-count">{{group.tasks.length}}</text>
        </view>
        <view
          class="task"
          ink:for="{{group.tasks}}"
          ink:for-item="task"
          ink:key="index"
          data-id="{{task.id}}"
          bindtap="onTaskTap"
        >
          <text class="task-title">{{task.title}}</text>
          <text class="task-meta" ink:if="{{task.due}}">{{task.due}}</text>
          <text class="task-meta" ink:for="{{task.flags}}" ink:for-item="flag" ink:key="index">{{flag}}</text>
          <text class="task-list">{{task.listName}}</text>
        </view>
      </view>
      <view class="empty" ink:if="{{total === 0}}">
        <text class="empty-text">没有待办任务</text>
      </view>
    </scroll-view>

    <view class="footer">
      <text class="hint">↑↓ 滚动 · Enter 朗读 · Tab 选清单 · 刷新</text>
    </view>
  </view>
</page>

<style>
  .root {
    min-height: 100%;
    padding: 16px 20px 12px;
    box-sizing: border-box;
    background: #000000;
    color: rgba(64, 255, 94, 0.72);
    display: flex;
    flex-direction: column;
  }

  .header {
    display: flex;
    flex-direction: row;
    justify-content: space-between;
    align-items: baseline;
    padding-bottom: 8px;
    margin-bottom: 8px;
    border-bottom: 1px solid rgba(64, 255, 94, 0.24);
  }

  .title {
    font-size: 20px;
    font-weight: 500;
    color: #40ff5e;
    letter-spacing: 0.01em;
  }

  .meta {
    font-size: 12px;
    color: rgba(64, 255, 94, 0.48);
  }

  .state {
    flex: 1;
    display: flex;
    flex-direction: column;
    justify-content: center;
    align-items: center;
  }

  .state-text {
    font-size: 18px;
    color: #40ff5e;
    margin-bottom: 6px;
  }

  .state-hint {
    font-size: 12px;
    color: rgba(64, 255, 94, 0.48);
    text-align: center;
  }

  .list {
    flex: 1;
    min-height: 0;
  }

  .lists {
    margin-bottom: 10px;
    padding: 8px 10px;
    border: 1px solid rgba(64, 255, 94, 0.24);
  }

  .lists-head {
    display: flex;
    flex-direction: row;
    justify-content: space-between;
    align-items: baseline;
    margin-bottom: 4px;
  }

  .lists-title {
    font-size: 13px;
    color: #40ff5e;
  }

  .lists-hint {
    font-size: 11px;
    color: rgba(64, 255, 94, 0.24);
  }

  .list-row {
    display: flex;
    flex-direction: row;
    align-items: baseline;
    padding: 3px 0;
  }

  .list-mark {
    font-size: 13px;
    color: #40ff5e;
    width: 16px;
  }

  .list-name {
    font-size: 13px;
    color: rgba(64, 255, 94, 0.72);
  }

  .group {
    margin-bottom: 12px;
  }

  .group-head {
    display: flex;
    flex-direction: row;
    align-items: baseline;
    padding: 4px 0;
    margin-bottom: 2px;
  }

  .group-label {
    font-size: 13px;
    font-weight: 500;
    color: rgba(64, 255, 94, 0.72);
  }

  .group-count {
    font-size: 12px;
    color: rgba(64, 255, 94, 0.48);
    margin-left: 6px;
  }

  .task {
    display: flex;
    flex-direction: row;
    flex-wrap: wrap;
    align-items: baseline;
    padding: 5px 0 5px 8px;
    border-left: 2px solid rgba(64, 255, 94, 0.24);
    margin-bottom: 3px;
  }

  .task-title {
    font-size: 14px;
    color: #40ff5e;
    margin-right: 8px;
  }

  .task-meta {
    font-size: 12px;
    color: rgba(64, 255, 94, 0.48);
    margin-right: 6px;
  }

  .task-list {
    font-size: 12px;
    color: rgba(64, 255, 94, 0.24);
  }

  .empty {
    padding: 24px 0;
    text-align: center;
  }

  .empty-text {
    font-size: 16px;
    color: rgba(64, 255, 94, 0.48);
  }

  .footer {
    padding-top: 8px;
    margin-top: 6px;
    border-top: 1px solid rgba(64, 255, 94, 0.12);
  }

  .hint {
    font-size: 11px;
    color: rgba(64, 255, 94, 0.24);
  }
</style>
