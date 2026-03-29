/**
 * app.js — Core Application: State, Navigation, Utilities, Theme
 * منصة الوسام التعليمية — Production Grade
 */

/* ============================================================
   APPLICATION STATE
============================================================ */
const AppState = {
  tests:          [],
  errors:         JSON.parse(localStorage.getItem('quizErrors')  || '[]'),
  goal:           JSON.parse(localStorage.getItem('quizGoal')    || 'null'),
  scores:         JSON.parse(localStorage.getItem('quizScores')  || '{}'),
  adminSettings:  JSON.parse(localStorage.getItem('adminSettings') || '{"categorizedErrors":false,"showNotesLive":true}'),
  progress:       JSON.parse(localStorage.getItem('quizProgress') || '{}'),

  // Quiz session state
  currentTest:    null,
  currentQ:       0,
  userAnswers:    [],
  answered:       false,
  timerInterval:  null,
  elapsedSecs:    0,

  // Admin builder state
  builderQuestions: [],
  parsedQuestions:  [],
  pendingDeleteId:  null,
  deleteMode:       'test',

  // Pomodoro state
  pomodoro: {
    running: false, phase: 'focus', focusMins: 25, breakMins: 5,
    totalSessions: 4, currentSession: 1, completedSessions: 0,
    remaining: 25 * 60, interval: null
  },

  // Tools state
  tools: {
    cd: { running: false, interval: null, remaining: 0, total: 0 },
    sw: { running: false, interval: null, elapsed: 0, laps: [] },
    qt: { running: false, interval: null, remaining: 0, qIdx: 0, total: 0, perQ: 0 }
  }
};

/* ============================================================
   HTML SANITIZATION UTILITY
============================================================ */
function escapeHtml(str) {
  if (!str && str !== 0) return '';
  return String(str).replace(/[&<>"']/g, m => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[m]));
}

/* ============================================================
   THEME MANAGEMENT
============================================================ */
function initTheme() {
  const saved = localStorage.getItem('sitetheme') || 'dark';
  applyTheme(saved);
}

function applyTheme(t) {
  const icon = document.getElementById('theme-icon');
  if (t === 'light') {
    document.body.classList.add('light-mode');
    if (icon) icon.className = 'fa-solid fa-moon';
    localStorage.setItem('sitetheme', 'light');
  } else {
    document.body.classList.remove('light-mode');
    if (icon) icon.className = 'fa-solid fa-sun';
    localStorage.setItem('sitetheme', 'dark');
  }
}

function toggleTheme() {
  applyTheme(document.body.classList.contains('light-mode') ? 'dark' : 'light');
}

/* ============================================================
   TOAST NOTIFICATIONS
============================================================ */
const TOAST_ICONS = { success: '✅', error: '❌', info: 'ℹ️', warning: '⚠️' };

function showToast(msg, type = 'success', duration = 3500) {
  const tc = document.getElementById('toast-container');
  if (!tc) return;
  const t  = document.createElement('div');
  t.className = `toast ${type}`;
  t.innerHTML = `<span class="toast-icon">${TOAST_ICONS[type] || ''}</span><span>${escapeHtml(msg)}</span>`;
  tc.appendChild(t);
  // Animate out
  setTimeout(() => {
    t.style.animation = 'toastOut .3s ease forwards';
    setTimeout(() => t.remove(), 300);
  }, duration);
}

/* ============================================================
   LOADING SCREEN
============================================================ */
function showLoadingScreen() {
  const el = document.getElementById('loading-screen');
  if (el) el.classList.remove('hidden');
}

function hideLoadingScreen() {
  const el = document.getElementById('loading-screen');
  if (el) {
    el.classList.add('fade-out');
    setTimeout(() => el.classList.add('hidden'), 600);
  }
}

/* ============================================================
   NAVIGATION
============================================================ */
function showPage(name) {
  // Guard admin-only pages
  if (name === 'admin' && !isAdminMode) {
    openAdminLoginModal();
    return;
  }

  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  const target = document.getElementById('page-' + name);
  if (!target) return;
  target.classList.add('active');

  // Page-specific initialization
  const pageInits = {
    home:    renderHome,
    errors:  renderErrors,
    admin:   () => { renderManageList(); loadAdminSettings(); },
    tools:   initToolsPage,
    results: () => {} // results rendered by finishQuiz
  };
  if (pageInits[name]) pageInits[name]();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function closeModal(id) {
  const el = document.getElementById(id);
  if (el) {
    el.classList.add('closing');
    setTimeout(() => {
      el.classList.remove('open', 'closing');
    }, 200);
  }
}

// Close modals on backdrop click
document.addEventListener('click', e => {
  if (e.target.classList.contains('modal-overlay') && e.target.classList.contains('open')) {
    const modalId = e.target.id;
    // Don't close login modal by clicking outside
    if (modalId !== 'admin-login-modal') {
      closeModal(modalId);
    }
  }
});

/* ============================================================
   HOME PAGE RENDERING
============================================================ */
function renderHome() {
  const { tests, scores, errors, goal } = AppState;
  const done = Object.keys(scores).length;
  const vals = Object.values(scores);
  const avg  = vals.length ? Math.round(vals.reduce((a, b) => a + b, 0) / vals.length) : null;

  safeSetText('stat-total',  tests.length);
  safeSetText('stat-done',   done);
  safeSetText('stat-avg',    avg !== null ? avg + '%' : '—');
  safeSetText('stat-errors', errors.length);

  renderGoal(done);
  renderTestsGrid();
}

function safeSetText(id, val) {
  const el = document.getElementById(id);
  if (el) el.textContent = val;
}

function renderGoal(done) {
  const { goal } = AppState;
  if (!goal) return;
  const pct = goal.target ? Math.min(100, Math.round(done / goal.target * 100)) : 0;
  safeSetText('goal-title',      goal.name || 'هدفي');
  safeSetText('goal-desc',       `${pct}% من الهدف مكتمل`);
  safeSetText('goal-done-lbl',   done + ' مكتمل');
  safeSetText('goal-target-lbl', 'الهدف: ' + (goal.target || '—'));
  const bar = document.getElementById('goal-bar');
  if (bar) bar.style.width = pct + '%';
}

function renderTestsGrid() {
  const { tests, scores } = AppState;
  const grid = document.getElementById('tests-grid');
  if (!grid) return;
  const fragment = document.createDocumentFragment();

  if (!tests.length) {
    const empty = document.createElement('div');
    empty.className = 'quizzes-empty';
    empty.innerHTML = `<div class="empty-icon">📭</div><h3>لا توجد اختبارات بعد</h3><p>أضف اختباراً جديداً من لوحة الإدارة</p>`;
    fragment.appendChild(empty);
  }

  tests.forEach((t, idx) => {
    const sc  = scores[t.id];
    let badge = '<span class="test-badge badge-new">جديد</span>';
    let scoreBarHtml = '';
    if (sc !== undefined) {
      badge = sc >= 70
        ? '<span class="test-badge badge-done">مكتمل ✓</span>'
        : '<span class="test-badge badge-retry">راجع أخطاءك</span>';
      const cls = sc >= 80 ? 'fill-green' : sc >= 60 ? 'fill-yellow' : 'fill-red';
      scoreBarHtml = `<div class="test-score-bar"><div class="test-score-fill ${cls}" style="width:${sc}%"></div></div>`;
    }
    const qCount = t.questions ? t.questions.length : 0;
    const time   = t.timeLimit ? t.timeLimit + ' دقيقة' : 'بلا حد';
    const card   = document.createElement('div');
    card.className = 'test-card';
    card.onclick   = () => startQuiz(t.firebaseId);
    card.innerHTML = `
      <button class="test-card-del admin-only-inline" onclick="event.stopPropagation();requestDeleteTest('${t.firebaseId}')">🗑️ حذف</button>
      <div class="test-card-top"><div class="test-num">${idx + 1}</div>${badge}</div>
      <div class="test-title">${escapeHtml(t.name)}</div>
      <div class="test-meta">
        <span>📝 ${qCount} سؤال</span><span>⏱️ ${time}</span>
        ${t.subject ? `<span>📚 ${escapeHtml(t.subject)}</span>` : ''}
        ${sc !== undefined ? `<span style="color:${sc >= 70 ? 'var(--green)' : sc >= 50 ? 'var(--accent)' : 'var(--red)'}">🎯 ${sc}%</span>` : ''}
      </div>${scoreBarHtml}
    `;
    fragment.appendChild(card);
  });

  // Admin "add" shortcut card
  if (isAdminMode) {
    const add = document.createElement('div');
    add.className = 'add-card';
    add.onclick = () => showPage('admin');
    add.innerHTML = `<span style="font-size:1.4rem">➕</span><span>أضف اختباراً جديداً</span>`;
    fragment.appendChild(add);
  }

  grid.innerHTML = '';
  grid.appendChild(fragment);
}

/* ============================================================
   GOAL MANAGEMENT
============================================================ */
function openGoalModal() {
  const { goal } = AppState;
  if (goal) {
    safeSetValue('goal-name-input',   goal.name   || '');
    safeSetValue('goal-target-input', goal.target || '');
  }
  openModal('goal-modal');
}

function saveGoal() {
  const name   = document.getElementById('goal-name-input')?.value.trim();
  const target = parseInt(document.getElementById('goal-target-input')?.value) || 0;
  AppState.goal = { name: name || 'هدفي', target };
  localStorage.setItem('quizGoal', JSON.stringify(AppState.goal));
  closeModal('goal-modal');
  renderHome();
  showToast('تم حفظ هدفك ✓', 'success');
}

/* ============================================================
   UTILITIES
============================================================ */
function fmtTime(s) {
  const sec = Math.max(0, s);
  return String(Math.floor(sec / 60)).padStart(2, '0') + ':' + String(sec % 60).padStart(2, '0');
}

function safeSetValue(id, val) {
  const el = document.getElementById(id);
  if (el) el.value = val;
}

function openModal(id) {
  const el = document.getElementById(id);
  if (el) el.classList.add('open');
}

function persistScoresAndErrors() {
  localStorage.setItem('quizScores', JSON.stringify(AppState.scores));
  localStorage.setItem('quizErrors', JSON.stringify(AppState.errors));
}

/* ============================================================
   FIREBASE REALTIME LISTENER
============================================================ */
function attachFirebaseListener() {
  showLoadingScreen();
  dbListenQuizzes(
    tests => {
      AppState.tests = tests;
      renderHome();
      // If admin manage tab is open, refresh it
      const adminPage = document.getElementById('page-admin');
      const manageTab = document.getElementById('admin-manage');
      if (adminPage?.classList.contains('active') && manageTab?.classList.contains('active')) {
        renderManageList();
      }
      hideLoadingScreen();
    },
    err => {
      showToast('خطأ في الاتصال بقاعدة البيانات', 'error');
      hideLoadingScreen();
    }
  );
}

/* ============================================================
   DELETE OPERATIONS (Auth-guarded)
============================================================ */
function requestDeleteTest(firebaseId) {
  if (!isAdminMode) { showToast('يجب تسجيل الدخول كأدمن', 'error'); return; }
  const test = AppState.tests.find(t => t.firebaseId === firebaseId);
  if (!test) return;
  AppState.pendingDeleteId = firebaseId;
  AppState.deleteMode = 'test';
  safeSetText('delete-modal-name', test.name);
  openModal('delete-modal');
}

function clearErrors() {
  if (!AppState.errors.length) return;
  AppState.deleteMode = 'errors';
  safeSetText('delete-modal-name', 'جميع الأخطاء المسجّلة');
  openModal('delete-modal');
}

async function confirmDeleteTest() {
  closeModal('delete-modal');
  if (AppState.deleteMode === 'test' && AppState.pendingDeleteId) {
    try {
      await dbDeleteQuiz(AppState.pendingDeleteId);
      delete AppState.scores[AppState.pendingDeleteId];
      AppState.errors = AppState.errors.filter(e => e.testId !== AppState.pendingDeleteId);
      persistScoresAndErrors();
      showToast('تم حذف الاختبار نهائياً', 'success');
    } catch (err) {
      showToast(err.message || 'فشل الحذف', 'error');
    }
  } else if (AppState.deleteMode === 'errors') {
    AppState.errors = [];
    localStorage.setItem('quizErrors', JSON.stringify([]));
    renderErrors();
    renderHome();
    showToast('تم مسح مجلد الأخطاء', 'success');
  }
  AppState.pendingDeleteId = null;
}

/* ============================================================
   APPLICATION INITIALIZATION
============================================================ */
function initApp() {
  initTheme();
  updatePomoSettings();
  attachFirebaseListener();

  // Register auth state listener
  onAuthStateChange((user, isAdmin) => {
    applyAdminUI(user, isAdmin);
    if (document.getElementById('page-home')?.classList.contains('active')) {
      renderHome();
    }
  });
}

// Boot on DOM ready
document.addEventListener('DOMContentLoaded', initApp);
