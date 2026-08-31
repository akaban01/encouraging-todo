(() => {
  'use strict';

  // Bump this on every release. sw.js carries the same value and derives its
  // cache name from it, so a bump also retires the previous cache — the two
  // are checked against each other in the tests.
  const APP_VERSION = '1.0.0';

  const STORAGE_KEY = 'encouraging-todo:v1';

  const MAX_TASK_LEN = 200;   // the visible label
  const MAX_URL_LEN = 2000;   // the link behind it, which can be far longer
  const MAX_LINE_LEN = MAX_TASK_LEN + MAX_URL_LEN + 1;
  const MAX_SHARED_TASKS = 200;
  // Completion history is only ever read for "today", so keep a generous
  // window and let anything older fall off instead of growing forever.
  const DONE_HISTORY_DAYS = 400;
  const CHEER_MS = 2600;
  const SNACKBAR_MS = 6000;
  const LEAVE_MS = 200; // must track the .leaving animation in styles.css

  const ENCOURAGEMENTS = [
    "🎉 that counts, seriously",
    "🌱 small win, still a win",
    "✨ look at you, done",
    "🧹 one less thing",
    "😌 nice, that's off your plate",
    "📈 progress, not perfection",
    "🙌 you showed up for that",
    "🤫 quietly getting it done",
    "💪 that's a real one",
    "🏆 quiet win, well earned",
    "🤝 quietly kept your word",
    "🚶 quietly moving forward",
    "✅ you did the thing",
    "🕊️ no fuss, just done",
    "☑️ quietly checked off",
    "🔥 that's momentum",
    "👣 step taken",
    "👍 good, that's handled",
    "🌟 you followed through",
    "📝 worth noting, that's done"
  ];

  // Clearing the last thing on the list deserves better than a generic cheer.
  const ALL_CLEAR = [
    "🌿 that's everything — go enjoy it",
    "🎈 list's empty. nicely done",
    "🛋️ all clear. resting counts too",
    "🌤️ nothing left. take the afternoon"
  ];

  const TAGLINES = [
    "one step at a time",
    "no rush, just today",
    "small steps count too",
    "here for whatever's next",
    "today is enough",
    "just the next small thing"
  ];

  const todayStr = (d = new Date()) => {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  };

  const daysBetween = (a, b) => {
    const da = new Date(a + 'T00:00:00');
    const db = new Date(b + 'T00:00:00');
    return Math.round((db - da) / 86400000);
  };

  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

  const pick = arr => arr[Math.floor(Math.random() * arr.length)];

  function bytesToBase64Url(bytes) {
    let bin = '';
    bytes.forEach(b => { bin += String.fromCharCode(b); });
    return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }

  function base64UrlToBytes(b64) {
    let padded = b64.replace(/-/g, '+').replace(/_/g, '/');
    while (padded.length % 4) padded += '=';
    const bin = atob(padded);
    return Uint8Array.from(bin, c => c.charCodeAt(0));
  }

  // encodeURIComponent escapes plenty of characters that are actually legal
  // as-is inside a fragment (RFC 3986 pchar), so put them back verbatim.
  const FRAGMENT_SAFE = {
    '%24': '$', '%26': '&', '%2B': '+', '%2C': ',', '%2F': '/',
    '%3A': ':', '%3B': ';', '%3D': '=', '%3F': '?', '%40': '@'
  };

  // Percent-encoding keeps plain ASCII at one character per character, but a
  // space costs three (%20) and every task separator another three (%0A).
  // Both are far more common than "_" and "~", so trade the rare pair for the
  // common pair and pay the three characters only on the rare one.
  function encodeShareText(str) {
    return encodeURIComponent(str)
      .replace(/%(?:24|26|2B|2C|2F|3A|3B|3D|3F|40)/g, m => FRAGMENT_SAFE[m])
      .replace(/_/g, '%5F')
      .replace(/~/g, '%7E')
      .replace(/%20/g, '_')
      .replace(/%0A/g, '~');
  }

  function decodeShareText(str) {
    return decodeURIComponent(str.replace(/~/g, '%0A').replace(/_/g, '%20'));
  }

  async function deflateToBase64Url(str) {
    try {
      const stream = new Blob([new TextEncoder().encode(str)]).stream()
        .pipeThrough(new CompressionStream('deflate-raw'));
      const buf = await new Response(stream).arrayBuffer();
      return bytesToBase64Url(new Uint8Array(buf));
    } catch {
      return null; // no CompressionStream here; the plain encoding still works
    }
  }

  async function inflateFromBase64Url(b64) {
    const stream = new Blob([base64UrlToBytes(b64)]).stream()
      .pipeThrough(new DecompressionStream('deflate-raw'));
    return new Response(stream).text();
  }

  async function buildShareUrl() {
    const text = state.tasks
      .filter(t => !t.done)
      .map(t => rawForm(t).replace(/\n/g, ' '))
      .join('\n');

    let hash = `s=${encodeShareText(text)}`;
    const deflated = await deflateToBase64Url(text);
    // Compression wins on long lists and loses on short ones, so just take
    // whichever came out shorter.
    if (deflated && deflated.length + 2 < hash.length) hash = `z=${deflated}`;

    const url = new URL(location.href);
    url.hash = hash;
    return url.toString();
  }

  const SHARE_HASH = /^#(?:s|z|share)=/;

  async function parseSharedTasks() {
    const hash = location.hash;
    let text = null;
    try {
      let match;
      if ((match = /^#s=(.*)$/.exec(hash))) {
        text = decodeShareText(match[1]);
      } else if ((match = /^#z=(.+)$/.exec(hash))) {
        text = await inflateFromBase64Url(match[1]);
      } else if ((match = /^#share=(.+)$/.exec(hash))) {
        // Links shared before this encoding existed: base64url-encoded JSON.
        const texts = JSON.parse(new TextDecoder().decode(base64UrlToBytes(match[1])));
        if (!Array.isArray(texts)) return null;
        text = texts.filter(t => typeof t === 'string').join('\n');
      }
    } catch {
      return null;
    }
    if (text === null) return null;
    return text
      .split('\n')
      .map(t => t.trim())
      .filter(Boolean)
      .slice(0, MAX_SHARED_TASKS)
      .map(t => t.slice(0, MAX_LINE_LEN));
  }

  function clearShareHash() {
    history.replaceState(null, '', location.pathname + location.search);
  }

  // --- Links ---

  // A pasted product link is unreadable in a list, so a task keeps the link
  // separately and shows a short label instead. Anything typed before or
  // after the link becomes that label; with nothing else to go on, one is
  // derived from the link itself.
  const URL_IN_TEXT = /\bhttps?:\/\/[^\s<>"']+/i;

  const decodeSegment = seg => {
    try {
      return decodeURIComponent(seg);
    } catch {
      return seg;
    }
  };

  // Closest thing to the page's title without fetching it: most link paths
  // carry a human-readable slug, so prefer a wordy segment over an opaque id.
  function labelFromUrl(parsed) {
    const segments = parsed.pathname
      .split('/')
      .filter(Boolean)
      .map(decodeSegment)
      .filter(s => !s.includes('='));   // tracking fragments that leaked into the path

    // The most word-like segment is nearly always the readable slug; product
    // ids and reference codes carry few real words, so they lose.
    const wordCount = s => s.split(/[-_+]+/).filter(w => /^[a-z]{2,}$/i.test(w)).length;
    const best = segments
      .map(s => ({ s, n: wordCount(s) }))
      .filter(x => x.n > 0)
      .sort((a, b) => b.n - a.n || b.s.length - a.s.length)[0];

    if (!best) return parsed.hostname.replace(/^www\./, '');
    return best.s
      .replace(/\.[a-z0-9]{1,5}$/i, '')   // drop a file extension
      .replace(/[-_+]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, MAX_TASK_LEN);
  }

  // Splits typed text into the label to show and the link to open. Only http
  // and https are honoured — javascript: and data: are not links you would
  // want a list item to fire.
  function splitLink(raw) {
    const plain = { text: raw.trim().slice(0, MAX_TASK_LEN), url: null };
    const match = URL_IN_TEXT.exec(raw);
    if (!match) return plain;

    // Trailing punctuation usually belongs to the sentence, not the link.
    const candidate = match[0].replace(/[.,;:!?)\]}>'"]+$/, '');
    let parsed;
    try {
      parsed = new URL(candidate);
    } catch {
      return plain;
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return plain;
    if (parsed.href.length > MAX_URL_LEN) return plain;

    const rest = (raw.slice(0, match.index) + ' ' + raw.slice(match.index + candidate.length))
      .replace(/\s+/g, ' ')
      .trim();
    return {
      text: (rest || labelFromUrl(parsed)).slice(0, MAX_TASK_LEN),
      url: parsed.href
    };
  }

  const linkHost = url => {
    try {
      return new URL(url).hostname.replace(/^www\./, '');
    } catch {
      return '';
    }
  };

  // What the user typed, and what goes into a share link or the edit field.
  const rawForm = task => (task.url ? `${task.text} ${task.url}` : task.text);

  // Anything older than the retention window is dead weight in localStorage.
  function pruneDoneDates(doneDates) {
    const cutoff = todayStr(new Date(Date.now() - DONE_HISTORY_DAYS * 86400000));
    Object.keys(doneDates).forEach(date => {
      if (date < cutoff) delete doneDates[date];
    });
    return doneDates;
  }

  function loadState() {
    let raw;
    try {
      raw = JSON.parse(localStorage.getItem(STORAGE_KEY));
    } catch {
      raw = null;
    }
    if (!raw || typeof raw !== 'object') {
      raw = {};
    }
    const tasks = (Array.isArray(raw.tasks) ? raw.tasks : [])
      .filter(t => t && typeof t.text === 'string')
      .map(t => {
        // Tasks stored before links existed keep their URL inline; split it
        // out so they start showing a label too.
        const split =
          typeof t.url === 'string' && t.url
            ? { text: t.text.slice(0, MAX_TASK_LEN), url: t.url }
            : splitLink(t.text);
        const url =
          typeof split.url === 'string' && /^https?:\/\//i.test(split.url)
            ? split.url.slice(0, MAX_URL_LEN)
            : null;
        return {
          id: typeof t.id === 'string' && t.id ? t.id : uid(),
          text: split.text,
          url,
          done: !!t.done,
          doneAt: typeof t.doneAt === 'string' ? t.doneAt : null
        };
      });
    return {
      tasks,
      doneDates: pruneDoneDates(
        raw.doneDates && typeof raw.doneDates === 'object' ? raw.doneDates : {}
      ),
      streak: typeof raw.streak === 'number' ? raw.streak : 0,
      lastStreakDate: typeof raw.lastStreakDate === 'string' ? raw.lastStreakDate : null,
      phraseBag: Array.isArray(raw.phraseBag) ? raw.phraseBag : []
    };
  }

  let state = loadState();
  let warnedAboutStorage = false;

  function saveState() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch {
      // Private browsing or a full quota. The app keeps working in memory —
      // just say so once so the loss isn't a silent surprise later.
      if (!warnedAboutStorage) {
        warnedAboutStorage = true;
        showSnackbar("Couldn't save — this list may not stick around");
      }
    }
  }

  function nextPhrase() {
    if (state.phraseBag.length === 0) {
      state.phraseBag = shuffle([...ENCOURAGEMENTS]);
    }
    return state.phraseBag.pop();
  }

  function shuffle(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }

  function recordCompletion() {
    const today = todayStr();
    const wasFirstToday = !state.doneDates[today];
    state.doneDates[today] = (state.doneDates[today] || 0) + 1;

    if (wasFirstToday) {
      if (state.lastStreakDate && daysBetween(state.lastStreakDate, today) === 1) {
        state.streak += 1;
      } else if (state.lastStreakDate === today) {
        // Re-checking something already counted today: streak stands.
      } else {
        state.streak = 1;
      }
      state.lastStreakDate = today;
    }
  }

  function revertCompletion(doneAtDate) {
    if (doneAtDate && state.doneDates[doneAtDate]) {
      state.doneDates[doneAtDate] = Math.max(0, state.doneDates[doneAtDate] - 1);
      if (state.doneDates[doneAtDate] === 0) delete state.doneDates[doneAtDate];
    }
  }

  // Streak is "alive" only if today or yesterday has a completion.
  function currentStreakDisplay() {
    if (!state.lastStreakDate) return 0;
    const gap = daysBetween(state.lastStreakDate, todayStr());
    return gap <= 1 ? state.streak : 0;
  }

  // --- DOM ---

  const activeList = document.getElementById('activeList');
  const doneList = document.getElementById('doneList');
  const doneSection = document.getElementById('doneSection');
  const doneToggle = document.getElementById('doneToggle');
  const doneToggleLabel = document.getElementById('doneToggleLabel');
  const clearDoneBtn = document.getElementById('clearDoneBtn');
  const emptyState = document.getElementById('emptyState');
  const addForm = document.getElementById('addForm');
  const taskInput = document.getElementById('taskInput');
  const addBtn = document.getElementById('addBtn');
  const doneTodayCountEl = document.getElementById('doneTodayCount');
  const streakCountEl = document.getElementById('streakCount');
  const taglineEl = document.getElementById('tagline');
  const appVersionEl = document.getElementById('appVersion');
  const cheerEl = document.getElementById('cheer');
  const snackbarEl = document.getElementById('snackbar');
  const snackbarTextEl = document.getElementById('snackbarText');
  const snackbarActionBtn = document.getElementById('snackbarAction');
  const shareBtn = document.getElementById('shareBtn');
  const installBtn = document.getElementById('installBtn');
  const iosInstall = document.getElementById('iosInstall');
  const iosInstallDismiss = document.getElementById('iosInstallDismiss');
  const importBanner = document.getElementById('importBanner');
  const importBannerText = document.getElementById('importBannerText');
  const importAddBtn = document.getElementById('importAddBtn');
  const importDismissBtn = document.getElementById('importDismissBtn');
  const reorderStatus = document.getElementById('reorderStatus');

  let doneExpanded = false;
  let editingId = null;
  const pendingRemoval = new Set();
  let refocusId = null;
  let refocusSelector = '.task-text';
  let renderedDay = todayStr();
  let cheerTimer = null;
  let snackbarTimer = null;

  function render() {
    renderedDay = todayStr();
    const active = state.tasks.filter(t => !t.done);
    const done = state.tasks.filter(t => t.done);

    activeList.replaceChildren(...active.map(renderTask));

    doneList.replaceChildren(
      ...done
        .slice()
        .sort((a, b) => (b.doneAt || '').localeCompare(a.doneAt || ''))
        .map(renderTask)
    );

    if (state.tasks.length === 0) {
      emptyState.textContent = "Nothing on the list. That's alright too.";
      emptyState.hidden = false;
    } else if (active.length === 0) {
      emptyState.textContent = 'All caught up. Nothing left for now.';
      emptyState.hidden = false;
    } else {
      emptyState.hidden = true;
    }

    doneSection.hidden = done.length === 0;
    doneToggleLabel.textContent = `Completed (${done.length})`;
    doneList.hidden = !doneExpanded;
    doneToggle.setAttribute('aria-expanded', String(doneExpanded));
    clearDoneBtn.hidden = !doneExpanded;

    doneTodayCountEl.textContent = state.doneDates[renderedDay] || 0;
    streakCountEl.textContent = currentStreakDisplay();

    restoreFocus();
  }

  // The list is rebuilt wholesale on every render, so anything that was
  // focused has to be re-acquired by task id afterwards.
  function restoreFocus() {
    if (editingId) {
      const input = document.querySelector('.task-edit');
      if (input && document.activeElement !== input) {
        input.focus();
        input.setSelectionRange(input.value.length, input.value.length);
      }
      return;
    }
    if (refocusId) {
      const el = findTaskEl(refocusId)?.querySelector(refocusSelector);
      refocusId = null;
      refocusSelector = '.task-text';
      if (el) el.focus();
    }
  }

  const findTaskEl = id =>
    [...document.querySelectorAll('.task-item')].find(el => el.dataset.id === id) || null;

  function svgIcon(width, height, strokeWidth, inner) {
    return `<svg viewBox="0 0 24 24" width="${width}" height="${height}" fill="none" stroke="currentColor" stroke-width="${strokeWidth}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${inner}</svg>`;
  }

  // Screen-reader labels read better with the task itself in them, but a
  // 200-character task makes for a miserable announcement.
  const shortText = text => (text.length > 60 ? text.slice(0, 60) + '…' : text);

  function renderTask(task) {
    const li = document.createElement('li');
    li.className =
      'task-item' +
      (task.done ? ' done' : '') +
      (pendingRemoval.has(task.id) ? ' leaving' : '');
    li.dataset.id = task.id;

    // Completed rows get an inert spacer so their checkboxes stay in line
    // with the draggable ones above.
    li.appendChild(task.done ? renderHandleSpacer() : renderDragHandle(task));

    const checkBtn = document.createElement('button');
    checkBtn.type = 'button';
    checkBtn.className = 'check-btn';
    checkBtn.setAttribute(
      'aria-label',
      `${task.done ? 'Mark as not done' : 'Mark as done'}: ${shortText(task.text)}`
    );
    checkBtn.innerHTML = svgIcon(14, 14, 3, '<polyline points="20 6 9 17 4 12"></polyline>');
    checkBtn.addEventListener('click', () => toggleTask(task.id));
    li.appendChild(checkBtn);

    if (task.id === editingId) {
      li.appendChild(renderEditor(task));
    } else if (task.url) {
      li.appendChild(renderTaskLink(task));
      li.appendChild(renderEditBtn(task));
    } else {
      li.appendChild(renderTaskText(task));
    }

    const deleteBtn = document.createElement('button');
    deleteBtn.type = 'button';
    deleteBtn.className = 'delete-btn';
    deleteBtn.setAttribute('aria-label', `Delete: ${shortText(task.text)}`);
    deleteBtn.innerHTML = svgIcon(
      18, 18, 2,
      '<line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line>'
    );
    deleteBtn.addEventListener('click', () => deleteTask(task.id));
    li.appendChild(deleteBtn);

    return li;
  }

  // A button rather than a span so the edit affordance is reachable by
  // keyboard, not just by mouse.
  function renderTaskText(task) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'task-text';
    btn.textContent = task.text;
    btn.setAttribute('aria-label', `Edit: ${shortText(task.text)}`);
    btn.addEventListener('click', () => startEditing(task.id));
    return btn;
  }

  // The label is the link, so tapping the row's text opens it — which is the
  // point of putting a link on a shopping-list item.
  function renderTaskLink(task) {
    const wrap = document.createElement('a');
    wrap.className = 'task-text task-link';
    wrap.href = task.url;
    wrap.target = '_blank';
    // Without this an opened tab can reach back through window.opener.
    wrap.rel = 'noopener noreferrer';
    wrap.title = task.url;

    const label = document.createElement('span');
    label.className = 'task-link-label';
    label.textContent = task.text;
    wrap.appendChild(label);

    // Showing the destination means nobody has to tap to find out where a
    // link goes.
    const host = linkHost(task.url);
    if (host) {
      const hostEl = document.createElement('span');
      hostEl.className = 'task-link-host';
      hostEl.textContent = host;
      wrap.appendChild(hostEl);
    }
    wrap.setAttribute(
      'aria-label',
      `${shortText(task.text)} — opens ${host || 'a link'} in a new tab`
    );
    return wrap;
  }

  // Linked rows need their own edit affordance, since their text now opens
  // the link instead of starting an edit.
  function renderEditBtn(task) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'edit-btn';
    btn.setAttribute('aria-label', `Edit: ${shortText(task.text)}`);
    btn.innerHTML = svgIcon(
      16, 16, 2,
      '<path d="M12 20h9"></path><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"></path>'
    );
    btn.addEventListener('click', () => startEditing(task.id));
    return btn;
  }

  function renderHandleSpacer() {
    const span = document.createElement('span');
    span.className = 'drag-handle-spacer';
    span.setAttribute('aria-hidden', 'true');
    return span;
  }

  function renderDragHandle(task) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'drag-handle';
    btn.setAttribute(
      'aria-label',
      `Reorder: ${shortText(task.text)}. Press the up and down arrow keys to move it.`
    );
    btn.innerHTML = svgIcon(
      16, 16, 2,
      '<line x1="4" y1="9" x2="20" y2="9"></line><line x1="4" y1="15" x2="20" y2="15"></line>'
    );
    btn.addEventListener('pointerdown', e => startDrag(e, task, btn));
    btn.addEventListener('keydown', e => moveByKeyboard(e, task));
    return btn;
  }

  function renderEditor(task) {
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'task-edit';
    input.value = rawForm(task);
    input.maxLength = MAX_LINE_LEN;
    input.setAttribute('aria-label', 'Edit task');

    // Committing re-renders and tears this input out of the DOM, which fires
    // another blur; settle once and ignore the rest.
    let settled = false;
    const finish = keepEdit => {
      if (settled) return;
      settled = true;
      editingId = null;
      refocusId = task.id;
      const next = keepEdit ? splitLink(input.value) : null;
      if (next && next.text && (next.text !== task.text || next.url !== task.url)) {
        task.text = next.text;
        task.url = next.url;
        saveState();
      }
      render();
    };

    input.addEventListener('keydown', e => {
      if (e.key === 'Enter') {
        e.preventDefault();
        finish(true);
      } else if (e.key === 'Escape') {
        e.preventDefault();
        finish(false);
      }
    });
    input.addEventListener('blur', () => finish(true));
    return input;
  }

  function startEditing(id) {
    editingId = id;
    render();
  }

  function addTask(raw) {
    const { text, url } = splitLink(raw);
    if (!text) return;
    state.tasks.unshift({ id: uid(), text, url, done: false, doneAt: null });
    saveState();
    render();
  }

  function toggleTask(id) {
    const task = state.tasks.find(t => t.id === id);
    if (!task) return;

    if (!task.done) {
      task.done = true;
      task.doneAt = todayStr();
      recordCompletion();
      saveState();
      render();
      const nothingLeft = !state.tasks.some(t => !t.done);
      showCheer(nothingLeft ? pick(ALL_CLEAR) : nextPhrase());
    } else {
      revertCompletion(task.doneAt);
      task.done = false;
      task.doneAt = null;
      saveState();
      render();
    }
  }

  function deleteTask(id) {
    if (pendingRemoval.has(id)) return;
    if (state.tasks.findIndex(t => t.id === id) === -1) return;
    pendingRemoval.add(id);

    // Look the task up again once the animation is over — the list may have
    // changed underneath us in the meantime.
    const finish = () => {
      // Set.delete answers "was this still pending?", so it doubles as the
      // guard against animationend and the timer both landing.
      if (!pendingRemoval.delete(id)) return;
      const idx = state.tasks.findIndex(t => t.id === id);
      if (idx === -1) return;
      const [removed] = state.tasks.splice(idx, 1);
      if (editingId === id) editingId = null;
      saveState();
      render();
      showSnackbar('Removed', 'Undo', () => {
        state.tasks.splice(Math.min(idx, state.tasks.length), 0, removed);
        saveState();
        render();
      });
    };

    const li = findTaskEl(id);
    if (!li) {
      finish();
      return;
    }
    li.classList.add('leaving');
    li.addEventListener('animationend', finish, { once: true });
    // Any re-render — a second delete finishing, say — replaces this node
    // before its animationend can fire, so back the event up with a timer.
    setTimeout(finish, LEAVE_MS + 60);
  }

  function clearCompleted() {
    // Ascending index order, so re-inserting in the same order on undo puts
    // every task back exactly where it was.
    const removed = state.tasks
      .map((task, index) => ({ task, index }))
      .filter(entry => entry.task.done);
    if (removed.length === 0) return;

    state.tasks = state.tasks.filter(t => !t.done);
    saveState();
    render();
    showSnackbar(`Cleared ${removed.length} completed`, 'Undo', () => {
      removed.forEach(({ task, index }) => {
        state.tasks.splice(Math.min(index, state.tasks.length), 0, task);
      });
      saveState();
      render();
    });
  }

  function showCheer(msg) {
    clearTimeout(cheerTimer);
    cheerEl.textContent = msg;
    cheerEl.classList.add('show');
    cheerTimer = setTimeout(() => cheerEl.classList.remove('show'), CHEER_MS);
  }

  let snackbarAction = null;

  function showSnackbar(msg, actionLabel, onAction) {
    clearTimeout(snackbarTimer);
    snackbarTextEl.textContent = msg;
    snackbarAction = onAction || null;
    snackbarActionBtn.hidden = !snackbarAction;
    if (snackbarAction) snackbarActionBtn.textContent = actionLabel;
    snackbarEl.classList.add('show');
    snackbarTimer = setTimeout(hideSnackbar, SNACKBAR_MS);
  }

  function hideSnackbar() {
    clearTimeout(snackbarTimer);
    snackbarEl.classList.remove('show');
    snackbarAction = null;
  }

  snackbarActionBtn.addEventListener('click', () => {
    const run = snackbarAction;
    hideSnackbar();
    if (run) run();
  });

  addForm.addEventListener('submit', e => {
    e.preventDefault();
    addTask(taskInput.value);
    taskInput.value = '';
    syncAddBtn();
    taskInput.focus();
  });

  const syncAddBtn = () => { addBtn.disabled = taskInput.value.trim() === ''; };
  taskInput.addEventListener('input', syncAddBtn);
  syncAddBtn();

  doneToggle.addEventListener('click', () => {
    doneExpanded = !doneExpanded;
    render();
  });

  clearDoneBtn.addEventListener('click', clearCompleted);

  shareBtn.addEventListener('click', async () => {
    if (!state.tasks.some(t => !t.done)) {
      showSnackbar('Nothing to share yet');
      return;
    }
    const url = await buildShareUrl();

    // On a phone the share sheet is the natural gesture; on a desktop a
    // silent clipboard copy beats a system dialog.
    if (navigator.share && matchMedia('(pointer: coarse)').matches) {
      try {
        await navigator.share({ title: 'Encouraging Todo', url });
        return;
      } catch (err) {
        if (err && err.name === 'AbortError') return;
      }
    }

    try {
      await navigator.clipboard.writeText(url);
      showSnackbar('🔗 Link copied');
    } catch {
      window.prompt('Copy your shareable link:', url);
    }
  });

  let pendingSharedTasks = null;

  function showImportBanner(texts) {
    pendingSharedTasks = texts;
    importBannerText.textContent =
      `Someone shared ${texts.length} ${texts.length === 1 ? 'task' : 'tasks'} with you.`;
    importBanner.hidden = false;
  }

  function closeImportBanner() {
    pendingSharedTasks = null;
    importBanner.hidden = true;
    clearShareHash();
  }

  importAddBtn.addEventListener('click', () => {
    const incoming = pendingSharedTasks;
    if (incoming) {
      // Spread rather than unshifting one at a time: shared order is the
      // sender's chosen order, and inserting them individually reverses it.
      state.tasks.unshift(
        ...incoming.map(line => {
          const { text, url } = splitLink(line);
          return { id: uid(), text, url, done: false, doneAt: null };
        })
      );
      saveState();
      render();
      showSnackbar(`Added ${incoming.length} ${incoming.length === 1 ? 'task' : 'tasks'}`);
    }
    closeImportBanner();
  });

  importDismissBtn.addEventListener('click', closeImportBanner);

  // --- Reordering ---

  // Dragging happens from a dedicated handle rather than the whole row: on
  // touch a vertical drag is also a scroll, and the only reliable way to opt
  // one thing out of the scroller is touch-action:none on that thing alone.
  //
  // The dragged row is taken out of flow (position:fixed) and follows the
  // pointer, while a placeholder of the same height travels between the
  // remaining rows to show where it will land. Nothing touches state until
  // the drop, so an abandoned drag costs nothing.
  let drag = null;
  let autoScrollTimer = null;
  let autoScrollDir = 0;

  const isDragging = () => drag !== null;
  const activeTasks = () => state.tasks.filter(t => !t.done);
  const activeOrder = () => activeTasks().map(t => t.id).join('\n');

  // Reordering by id, rather than by array index, leaves completed tasks
  // exactly where they are — their display order comes from doneAt, not from
  // their position, and delete-undo still needs those indices to mean
  // something.
  function moveTaskBefore(id, targetId) {
    const from = state.tasks.findIndex(t => t.id === id);
    if (from === -1) return;
    const [task] = state.tasks.splice(from, 1);

    let to;
    if (targetId === null) {
      // Dropped past the last active task: sit just after it, ahead of any
      // completed tasks trailing the array.
      const actives = state.tasks.filter(t => !t.done);
      const last = actives[actives.length - 1];
      to = last ? state.tasks.indexOf(last) + 1 : state.tasks.length;
    } else {
      to = state.tasks.findIndex(t => t.id === targetId);
      if (to === -1) to = state.tasks.length;
    }
    state.tasks.splice(to, 0, task);
  }

  function startDrag(e, task, handle) {
    if (e.button > 0) return;              // right/middle click is not a drag
    if (isDragging() || editingId || pendingRemoval.size > 0) return;

    const li = handle.closest('.task-item');
    if (!li) return;
    const rect = li.getBoundingClientRect();

    const placeholder = document.createElement('li');
    placeholder.className = 'task-placeholder';
    placeholder.style.height = `${rect.height}px`;

    drag = {
      id: task.id,
      li,
      placeholder,
      pointerId: e.pointerId,
      grabDy: e.clientY - rect.top,
      lastY: e.clientY,
      startY: e.clientY,
      moved: false
    };

    // Throws if the pointer is no longer active; the drag still works from the
    // window-level listeners either way.
    try {
      handle.setPointerCapture(e.pointerId);
    } catch {}
    e.preventDefault();                    // no text selection, no scroll

    li.style.width = `${rect.width}px`;
    li.style.left = `${rect.left}px`;
    li.style.top = `${rect.top}px`;
    li.classList.add('dragging');
    activeList.insertBefore(placeholder, li);
    document.body.classList.add('is-dragging');
  }

  function onDragMove(e) {
    if (!isDragging() || e.pointerId !== drag.pointerId) return;
    e.preventDefault();
    if (!drag.moved && Math.abs(e.clientY - drag.startY) > 3) drag.moved = true;
    drag.lastY = e.clientY;
    drag.li.style.top = `${e.clientY - drag.grabDy}px`;
    positionPlaceholder(e.clientY);
    updateAutoScroll(e.clientY);
  }

  function positionPlaceholder(pointerY) {
    const rows = [...activeList.children].filter(
      el => el !== drag.li && el !== drag.placeholder
    );
    const target = rows.find(row => {
      const r = row.getBoundingClientRect();
      return pointerY < r.top + r.height / 2;
    });
    if (target) {
      if (drag.placeholder.nextElementSibling !== target) {
        activeList.insertBefore(drag.placeholder, target);
      }
    } else if (activeList.lastElementChild !== drag.placeholder) {
      activeList.appendChild(drag.placeholder);
    }
  }

  // Whatever real row now follows the placeholder is what we land in front of;
  // null means the end of the list.
  function dropTargetId() {
    let next = drag.placeholder.nextElementSibling;
    while (next && next === drag.li) next = next.nextElementSibling;
    return next ? next.dataset.id : null;
  }

  function updateAutoScroll(pointerY) {
    const EDGE = 64;
    autoScrollDir = pointerY < EDGE ? -1 : pointerY > innerHeight - EDGE ? 1 : 0;
    if (autoScrollDir === 0) {
      stopAutoScroll();
      return;
    }
    if (autoScrollTimer) return;
    autoScrollTimer = setInterval(() => {
      scrollBy(0, autoScrollDir * 12);
      // The pointer may be holding still while the page moves under it, so
      // keep the placeholder honest.
      if (isDragging()) positionPlaceholder(drag.lastY);
    }, 16);
  }

  function stopAutoScroll() {
    clearInterval(autoScrollTimer);
    autoScrollTimer = null;
    autoScrollDir = 0;
  }

  function endDrag(commit) {
    if (!isDragging()) return;
    const { id, li, placeholder, moved } = drag;
    const targetId = commit && moved ? dropTargetId() : null;
    const shouldMove = commit && moved;

    stopAutoScroll();
    li.classList.remove('dragging');
    li.style.width = '';
    li.style.left = '';
    li.style.top = '';
    placeholder.remove();
    document.body.classList.remove('is-dragging');
    drag = null;

    // A click that never moved leaves the list untouched, so there is nothing
    // to save and no reason to rebuild every row.
    if (!shouldMove) return;

    const before = activeOrder();
    moveTaskBefore(id, targetId);
    if (activeOrder() === before) return;
    saveState();
    render();
  }

  addEventListener('pointermove', onDragMove, { passive: false });
  addEventListener('pointerup', () => endDrag(true));
  addEventListener('pointercancel', () => endDrag(false));
  addEventListener('keydown', e => {
    if (e.key === 'Escape' && isDragging()) endDrag(false);
  });

  // Dragging is unusable without a mouse or a steady hand, so the handle also
  // takes arrow keys.
  function moveByKeyboard(e, task) {
    const dir = e.key === 'ArrowUp' ? -1 : e.key === 'ArrowDown' ? 1 : 0;
    if (dir === 0) return;
    e.preventDefault();

    const actives = activeTasks();
    const from = actives.findIndex(t => t.id === task.id);
    const to = from + dir;
    if (from === -1 || to < 0 || to >= actives.length) return;

    // Moving down means landing in front of whatever follows the neighbour.
    const targetId = dir === -1 ? actives[to].id : (actives[to + 1]?.id ?? null);
    moveTaskBefore(task.id, targetId);
    saveState();

    refocusId = task.id;
    refocusSelector = '.drag-handle';
    render();
    reorderStatus.textContent =
      `${shortText(task.text)}: position ${to + 1} of ${actives.length}`;
  }

  // --- Install ---

  // Two entirely different worlds: Chromium browsers hand us a prompt event we
  // can fire from a click, while iOS Safari has no install API at all and can
  // only be walked through Add to Home Screen by hand.
  let installPrompt = null;
  let installMode = null; // 'prompt' | 'ios'

  const isStandalone = () =>
    matchMedia('(display-mode: standalone)').matches ||
    matchMedia('(display-mode: minimal-ui)').matches ||
    navigator.standalone === true;

  // iPadOS 13+ reports itself as a Mac, so touch points are the giveaway.
  const isIOS = () =>
    /iphone|ipad|ipod/i.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

  // Only Safari can add to the Home Screen; the other iOS browsers cannot,
  // so showing them these instructions would just be wrong.
  const isIOSSafari = () =>
    isIOS() && !/crios|fxios|edgios|opios|mercury/i.test(navigator.userAgent);

  function offerInstall(mode) {
    if (isStandalone()) return; // already installed — nothing to offer
    installMode = mode;
    installBtn.hidden = false;
    // Only the iOS button is a disclosure control; the Chromium one opens a
    // browser dialog, so disclosure semantics would misdescribe it.
    if (mode === 'ios') {
      installBtn.setAttribute('aria-controls', 'iosInstall');
      installBtn.setAttribute('aria-expanded', 'false');
    } else {
      installBtn.removeAttribute('aria-controls');
      installBtn.removeAttribute('aria-expanded');
    }
  }

  function withdrawInstall() {
    installMode = null;
    installPrompt = null;
    installBtn.hidden = true;
    closeIosInstall();
  }

  function closeIosInstall() {
    iosInstall.hidden = true;
    if (installBtn.hasAttribute('aria-expanded')) {
      installBtn.setAttribute('aria-expanded', 'false');
    }
  }

  function onInstallAvailable(e) {
    installPrompt = e;
    offerInstall('prompt');
  }

  addEventListener('beforeinstallprompt', e => {
    e.preventDefault();
    onInstallAvailable(e);
  });

  // The inline snippet in index.html may have caught it before this ran.
  if (window.__installPrompt) onInstallAvailable(window.__installPrompt);

  addEventListener('appinstalled', () => {
    window.__installPrompt = null;
    withdrawInstall();
    showCheer('🏠 installed — find it on your home screen');
  });

  installBtn.addEventListener('click', async () => {
    if (installMode === 'ios') {
      const opening = iosInstall.hidden;
      iosInstall.hidden = !opening;
      installBtn.setAttribute('aria-expanded', String(opening));
      return;
    }
    if (!installPrompt) return;

    // The event is single-use. Spend it and take the button away; if the user
    // declines, the browser offers a fresh one later and the button returns.
    const prompt = installPrompt;
    installPrompt = null;
    window.__installPrompt = null;
    installBtn.hidden = true;
    try {
      await prompt.prompt();
      await prompt.userChoice;
    } catch {
      // Already consumed, or the browser refused to show it. Nothing to add.
    }
  });

  iosInstallDismiss.addEventListener('click', () => {
    closeIosInstall();
    installBtn.focus();
  });

  if (isIOSSafari()) offerInstall('ios');

  // "Done today" and the streak both go stale if the app sits open past
  // midnight, so re-render when the date actually turns over.
  function checkDayRollover() {
    if (isDragging()) return; // a re-render would tear the dragged row away
    if (todayStr() !== renderedDay) render();
  }
  setInterval(checkDayRollover, 60000);
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) checkDayRollover();
  });

  // Worth showing: a service worker can serve a page from cache long after a
  // release, and this is how you tell which build you are actually looking at.
  appVersionEl.textContent = `v${APP_VERSION}`;

  taglineEl.textContent = pick(TAGLINES);

  parseSharedTasks().then(sharedTasks => {
    if (sharedTasks && sharedTasks.length > 0) {
      showImportBanner(sharedTasks);
    } else if (SHARE_HASH.test(location.hash)) {
      // A share link we couldn't read. Don't leave the broken hash sitting in
      // the address bar to be re-shared.
      clearShareHash();
      showSnackbar("That shared link couldn't be read");
    }
  });

  render();

  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('sw.js').catch(() => {});
    });
  }
})();
