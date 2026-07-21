(() => {
  'use strict';

  const STORAGE_KEY = 'encouraging-todo:v1';

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
    return {
      tasks: Array.isArray(raw.tasks) ? raw.tasks : [],
      doneDates: raw.doneDates && typeof raw.doneDates === 'object' ? raw.doneDates : {},
      streak: typeof raw.streak === 'number' ? raw.streak : 0,
      lastStreakDate: typeof raw.lastStreakDate === 'string' ? raw.lastStreakDate : null,
      phraseBag: Array.isArray(raw.phraseBag) ? raw.phraseBag : []
    };
  }

  let state = loadState();

  function saveState() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
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
        // no-op
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
    const today = todayStr();
    const gap = daysBetween(state.lastStreakDate, today);
    if (gap <= 1) return state.streak;
    return 0;
  }

  // --- DOM ---

  const activeList = document.getElementById('activeList');
  const doneList = document.getElementById('doneList');
  const doneSection = document.getElementById('doneSection');
  const doneToggle = document.getElementById('doneToggle');
  const doneToggleLabel = document.getElementById('doneToggleLabel');
  const emptyState = document.getElementById('emptyState');
  const addForm = document.getElementById('addForm');
  const taskInput = document.getElementById('taskInput');
  const doneTodayCountEl = document.getElementById('doneTodayCount');
  const streakCountEl = document.getElementById('streakCount');
  const streakLabelEl = document.getElementById('streakLabel');
  const taglineEl = document.getElementById('tagline');
  const toastEl = document.getElementById('toast');

  let doneExpanded = false;
  let toastTimer = null;

  function render() {
    const today = todayStr();
    const active = state.tasks.filter(t => !t.done);
    const done = state.tasks.filter(t => t.done);

    activeList.innerHTML = '';
    active.forEach(t => activeList.appendChild(renderTask(t)));

    doneList.innerHTML = '';
    done
      .slice()
      .sort((a, b) => (b.doneAt || '').localeCompare(a.doneAt || ''))
      .forEach(t => doneList.appendChild(renderTask(t)));

    emptyState.hidden = state.tasks.length > 0;
    doneSection.hidden = done.length === 0;
    doneToggleLabel.textContent = `Completed (${done.length})`;
    doneList.hidden = !doneExpanded;
    doneToggle.setAttribute('aria-expanded', String(doneExpanded));

    doneTodayCountEl.textContent = state.doneDates[today] || 0;
    const streak = currentStreakDisplay();
    streakCountEl.textContent = streak;
    streakLabelEl.textContent = streak === 1 ? 'day streak' : 'day streak';
  }

  function renderTask(task) {
    const li = document.createElement('li');
    li.className = 'task-item' + (task.done ? ' done' : '');
    li.dataset.id = task.id;

    const checkBtn = document.createElement('button');
    checkBtn.className = 'check-btn';
    checkBtn.setAttribute('aria-label', task.done ? 'Mark as not done' : 'Mark as done');
    checkBtn.innerHTML = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>';
    checkBtn.addEventListener('click', () => toggleTask(task.id));

    const text = document.createElement('span');
    text.className = 'task-text';
    text.textContent = task.text;

    const deleteBtn = document.createElement('button');
    deleteBtn.className = 'delete-btn';
    deleteBtn.setAttribute('aria-label', 'Delete task');
    deleteBtn.innerHTML = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>';
    deleteBtn.addEventListener('click', () => deleteTask(task.id));

    li.appendChild(checkBtn);
    li.appendChild(text);
    li.appendChild(deleteBtn);
    return li;
  }

  function addTask(text) {
    const trimmed = text.trim();
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
      showToast(nextPhrase());
    } else {
      revertCompletion(task.doneAt);
      task.done = false;
      task.doneAt = null;
      saveState();
      render();
    }
  }

  function deleteTask(id) {
    const idx = state.tasks.findIndex(t => t.id === id);
    if (idx === -1) return;
    const li = document.querySelector(`.task-item[data-id="${id}"]`);
    const task = state.tasks[idx];
    const finish = () => {
      state.tasks.splice(idx, 1);
      saveState();
      render();
    };
    if (li) {
      li.classList.add('leaving');
      li.addEventListener('animationend', finish, { once: true });
    } else {
      finish();
    }
  }

  function showToast(msg) {
    clearTimeout(toastTimer);
    toastEl.textContent = msg;
    toastEl.classList.add('show');
    toastTimer = setTimeout(() => {
      toastEl.classList.remove('show');
    }, 2600);
  }

  addForm.addEventListener('submit', e => {
    e.preventDefault();
    addTask(taskInput.value);
    taskInput.value = '';
    taskInput.focus();
  });

  doneToggle.addEventListener('click', () => {
    doneExpanded = !doneExpanded;
    render();
  });

  taglineEl.textContent = TAGLINES[Math.floor(Math.random() * TAGLINES.length)];

  render();

  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('sw.js').catch(() => {});
    });
  }
})();
