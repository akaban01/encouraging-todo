(() => {
  'use strict';

  const STORAGE_KEY = 'encouraging-todo:v1';

  const MAX_TASK_LEN = 200;
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
      .map(t => t.text.replace(/\n/g, ' '))
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
      .map(t => t.slice(0, MAX_TASK_LEN));
  }

  function clearShareHash() {
    history.replaceState(null, '', location.pathname + location.search);
  }

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
      .map(t => ({
        id: typeof t.id === 'string' && t.id ? t.id : uid(),
        text: t.text.slice(0, MAX_TASK_LEN),
        done: !!t.done,
        doneAt: typeof t.doneAt === 'string' ? t.doneAt : null
      }));
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

  let doneExpanded = false;
  let editingId = null;
  const pendingRemoval = new Set();
  let refocusId = null;
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
      const btn = findTaskEl(refocusId)?.querySelector('.task-text');
      refocusId = null;
      if (btn) btn.focus();
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

    li.appendChild(task.id === editingId ? renderEditor(task) : renderTaskText(task));

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

  function renderEditor(task) {
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'task-edit';
    input.value = task.text;
    input.maxLength = MAX_TASK_LEN;
    input.setAttribute('aria-label', 'Edit task');

    // Committing re-renders and tears this input out of the DOM, which fires
    // another blur; settle once and ignore the rest.
    let settled = false;
    const finish = keepEdit => {
      if (settled) return;
      settled = true;
      editingId = null;
      refocusId = task.id;
      const next = keepEdit ? input.value.trim().slice(0, MAX_TASK_LEN) : '';
      if (next && next !== task.text) {
        task.text = next;
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

  function addTask(text) {
    const trimmed = text.trim().slice(0, MAX_TASK_LEN);
    if (!trimmed) return;
    state.tasks.unshift({ id: uid(), text: trimmed, done: false, doneAt: null });
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
      incoming.forEach(text => {
        state.tasks.unshift({ id: uid(), text, done: false, doneAt: null });
      });
      saveState();
      render();
      showSnackbar(`Added ${incoming.length} ${incoming.length === 1 ? 'task' : 'tasks'}`);
    }
    closeImportBanner();
  });

  importDismissBtn.addEventListener('click', closeImportBanner);

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
    if (todayStr() !== renderedDay) render();
  }
  setInterval(checkDayRollover, 60000);
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) checkDayRollover();
  });

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
