/* ============================================================
   main.js — منصة الوسام التعليمية
   Merged bundle: firebase → app → admin → quiz
   Order matters: each module depends on the one above it.
============================================================ */
/* ================================================================
   MODULE 1: firebase.js — Firebase Init, Auth & DB Helpers
================================================================ */
/**
 * firebase.js — Firebase initialization, Authentication & Database
 * منصة الوسام التعليمية — Production Security Layer
 *
 * SECURITY: Firebase config is public (safe by design with Security Rules).
 * All admin writes are protected server-side via Firebase Security Rules.
 * No passwords are stored in frontend code.
 */

/* ============================================================
   FIREBASE CONFIGURATION
   (apiKey is safe to expose — access is controlled by Security Rules)
============================================================ */
const FIREBASE_CONFIG = {
  apiKey:            "AIzaSyAek8K6nHzxAUiGM6ZvLfeFmzDsFjt1ABE",
  authDomain:        "my-quiz-platform-c1a08.firebaseapp.com",
  databaseURL:       "https://my-quiz-platform-c1a08-default-rtdb.europe-west1.firebasedatabase.app",
  projectId:         "my-quiz-platform-c1a08",
  storageBucket:     "my-quiz-platform-c1a08.firebasestorage.app",
  messagingSenderId: "361533364886",
  appId:             "1:361533364886:web:60875464941f706277c0b7",
  measurementId:     "G-NLKH56HPQ3"
};

/* Initialize Firebase App */
firebase.initializeApp(FIREBASE_CONFIG);

/** Realtime Database reference */
const db   = firebase.database();
/** Firebase Auth reference */
const auth = firebase.auth();

/* ============================================================
   AUTHENTICATION STATE
============================================================ */
let currentUser    = null;
let isAdminMode    = false;
let authListeners  = [];

/**
 * Register a callback to be called when auth state changes.
 * @param {Function} cb - Callback(user, isAdmin)
 */
function onAuthStateChange(cb) {
  authListeners.push(cb);
}

/* Firebase Auth Observer */
auth.onAuthStateChanged(async user => {
  currentUser = user;
  if (user) {
    isAdminMode = true;
    sessionStorage.setItem('adminMode', '1');
    document.body.classList.add('admin-mode');
  } else {
    isAdminMode = false;
    sessionStorage.removeItem('adminMode');
    document.body.classList.remove('admin-mode');
  }
  authListeners.forEach(cb => cb(user, isAdminMode));
});

/* ============================================================
   AUTH FUNCTIONS
============================================================ */

/**
 * Sign in admin with email/password via Firebase Auth.
 * @param {string} email
 * @param {string} password
 * @returns {Promise<firebase.auth.UserCredential>}
 */
async function adminSignIn(email, password) {
  try {
    const credential = await auth.signInWithEmailAndPassword(email, password);
    return credential;
  } catch (err) {
    throw translateAuthError(err);
  }
}

/**
 * Sign out the currently authenticated admin.
 */
async function adminSignOut() {
  try {
    await auth.signOut();
  } catch (err) {
    console.error('Sign out error:', err);
    throw err;
  }
}

/**
 * Translate Firebase Auth error codes to Arabic messages.
 * @param {Error} err
 * @returns {Error}
 */
function translateAuthError(err) {
  const map = {
    'auth/invalid-email':        'البريد الإلكتروني غير صالح',
    'auth/user-not-found':       'المستخدم غير موجود',
    'auth/wrong-password':       'كلمة المرور غير صحيحة',
    'auth/invalid-credential':   'بيانات الاعتماد غير صحيحة',
    'auth/too-many-requests':    'تم تجاوز عدد المحاولات. حاول لاحقاً',
    'auth/network-request-failed': 'خطأ في الشبكة. تحقق من اتصالك',
    'auth/user-disabled':        'تم تعطيل هذا الحساب',
  };
  const msg = map[err.code] || 'حدث خطأ في المصادقة';
  const translated = new Error(msg);
  translated.code  = err.code;
  return translated;
}

/* ============================================================
   DATABASE HELPERS — with auth guards
============================================================ */

/**
 * Write a new quiz to Firebase (admin only, enforced by Security Rules).
 * @param {Object} testData
 * @returns {Promise<string>} - Firebase push key
 */
async function dbSaveQuiz(testData) {
  if (!currentUser) throw new Error('يجب تسجيل الدخول كأدمن لحفظ الاختبارات');
  const ref = await db.ref('quizzes').push(testData);
  return ref.key;
}

/**
 * Delete a quiz by Firebase ID (admin only).
 * @param {string} firebaseId
 */
async function dbDeleteQuiz(firebaseId) {
  if (!currentUser) throw new Error('يجب تسجيل الدخول كأدمن للحذف');
  await db.ref('quizzes/' + firebaseId).remove();
}

/**
 * Listen for realtime quiz updates.
 * @param {Function} callback - (tests: Array) => void
 * @param {Function} errCallback - (error) => void
 */
function dbListenQuizzes(callback, errCallback) {
  db.ref('quizzes').on('value',
    snapshot => {
      const data = snapshot.val();
      const tests = data
        ? Object.entries(data).map(([fid, qd]) => ({ ...qd, firebaseId: fid, id: fid }))
        : [];
      callback(tests);
    },
    err => {
      console.error('Firebase DB error:', err);
      errCallback && errCallback(err);
    }
  );
}

/**
 * Save analytics event to Firebase (no auth needed for reads, auth for writes).
 * @param {string} quizId
 * @param {Object} data
 */
async function dbSaveAnalytics(quizId, data) {
  try {
    const uid = currentUser ? currentUser.uid : 'anonymous_' + Date.now();
    await db.ref(`analytics/${quizId}/${uid}`).set({ ...data, timestamp: Date.now() });
  } catch (err) {
    // Analytics failures are non-critical — log and continue
    console.warn('Analytics save failed:', err);
  }
}


/* ================================================================
   MODULE 2: app.js — State, Navigation, Utilities, Theme
================================================================ */
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
-e 

/* ================================================================
   MODULE 3: admin.js — Auth UI, Builder, Parser, Manage
================================================================ */
/**
 * admin.js — Admin Authentication, Builder, Parser, Manage
 * منصة الوسام التعليمية — Production Grade
 *
 * Security: All writes go through Firebase Auth.
 * No passwords stored in frontend — Firebase Auth handles credentials.
 */

/* ============================================================
   ADMIN UI STATE MANAGEMENT
============================================================ */
function applyAdminUI(user, isAdmin) {
  const bar      = document.getElementById('admin-mode-bar');
  const loginBtn = document.getElementById('admin-login-btn');
  const lockIcon = document.getElementById('admin-lock-icon');
  const addBtn   = document.getElementById('nav-admin-btn');

  // Show/hide all admin-only-inline elements (e.g. delete buttons on cards)
  document.querySelectorAll('.admin-only-inline').forEach(el => {
    el.style.display = isAdmin ? '' : 'none';
  });

  if (isAdmin) {
    document.body.classList.add('admin-mode');
    bar?.classList.add('visible');
    loginBtn?.classList.add('active-admin');
    if (lockIcon) lockIcon.className = 'fa-solid fa-unlock';
    if (loginBtn) loginBtn.title     = 'وضع الأدمن مفعّل — انقر للخروج';
    if (addBtn)   addBtn.style.display = 'flex';
    safeSetText('admin-user-email', user?.email || '');
  } else {
    document.body.classList.remove('admin-mode');
    bar?.classList.remove('visible');
    loginBtn?.classList.remove('active-admin');
    if (lockIcon) lockIcon.className = 'fa-solid fa-lock';
    if (loginBtn) loginBtn.title     = 'دخول الأدمن';
    if (addBtn)   addBtn.style.display = 'none';
  }
}

/* ============================================================
   ADMIN LOGIN MODAL
============================================================ */
function openAdminLoginModal() {
  if (isAdminMode) {
    // Already logged in — offer logout
    if (confirm('هل تريد تسجيل الخروج من وضع الأدمن؟')) logoutAdmin();
    return;
  }
  safeSetValue('admin-email-input', '');
  safeSetValue('admin-password-input', '');
  const errEl = document.getElementById('admin-login-error');
  if (errEl) { errEl.style.display = 'none'; errEl.textContent = ''; }
  openModal('admin-login-modal');
  setTimeout(() => document.getElementById('admin-email-input')?.focus(), 120);
}

function handleAdminLogin() {
  openAdminLoginModal();
}

async function verifyAdminLogin() {
  const email    = document.getElementById('admin-email-input')?.value.trim();
  const password = document.getElementById('admin-password-input')?.value;
  const errEl    = document.getElementById('admin-login-error');
  const btn      = document.getElementById('admin-login-submit-btn');

  if (!email || !password) {
    showLoginError('يرجى إدخال البريد الإلكتروني وكلمة المرور');
    return;
  }

  // Loading state
  if (btn) { btn.disabled = true; btn.textContent = 'جارٍ التحقق...'; }

  try {
    await adminSignIn(email, password);
    closeModal('admin-login-modal');
    showToast('✅ مرحباً بك في وضع الأدمن', 'success');
  } catch (err) {
    showLoginError(err.message || 'فشل تسجيل الدخول');
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = 'دخول'; }
  }
}

function showLoginError(msg) {
  const errEl = document.getElementById('admin-login-error');
  if (errEl) {
    errEl.textContent    = '❌ ' + msg;
    errEl.style.display  = 'block';
  }
}

async function logoutAdmin() {
  try {
    await adminSignOut();
    showPage('home');
    showToast('🔒 تم تسجيل الخروج من وضع الأدمن', 'info');
  } catch (err) {
    showToast('فشل تسجيل الخروج', 'error');
  }
}

// Allow Enter key in login modal
document.addEventListener('keydown', e => {
  const modal = document.getElementById('admin-login-modal');
  if (e.key === 'Enter' && modal?.classList.contains('open')) {
    verifyAdminLogin();
  }
});

/* ============================================================
   ADMIN SETTINGS
============================================================ */
function loadAdminSettings() {
  const s = AppState.adminSettings;
  const catEl = document.getElementById('setting-categorized-errors');
  const notEl = document.getElementById('setting-show-notes-live');
  if (catEl) catEl.checked = !!s.categorizedErrors;
  if (notEl) notEl.checked = s.showNotesLive !== false;
}

function saveAdminSettings() {
  AppState.adminSettings.categorizedErrors = document.getElementById('setting-categorized-errors')?.checked || false;
  AppState.adminSettings.showNotesLive     = document.getElementById('setting-show-notes-live')?.checked !== false;
  localStorage.setItem('adminSettings', JSON.stringify(AppState.adminSettings));
  showToast('تم حفظ الإعدادات ✓', 'success');
}

/* ============================================================
   ADMIN TAB SWITCHING
============================================================ */
function switchAdminTab(tab, ev) {
  document.querySelectorAll('.admin-tab').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.admin-tab-content').forEach(c => c.classList.remove('active'));
  if (ev?.currentTarget) ev.currentTarget.classList.add('active');
  document.getElementById('admin-' + tab)?.classList.add('active');
  if (tab === 'manage')   renderManageList();
  if (tab === 'settings') loadAdminSettings();
}

/* ============================================================
   MANAGE LIST — Admin view of all quizzes
============================================================ */
function renderManageList() {
  const container = document.getElementById('manage-list');
  if (!container) return;
  const { tests, scores } = AppState;

  if (!tests.length) {
    container.innerHTML = `<div class="empty-state"><div class="icon">📭</div><p>لا توجد اختبارات بعد</p></div>`;
    return;
  }

  const wrapper = document.createElement('div');
  wrapper.style.cssText = 'display:flex;flex-direction:column;gap:8px;';
  tests.forEach(t => {
    const sc   = scores[t.id];
    const item = document.createElement('div');
    item.className = 'manage-item';
    item.innerHTML = `
      <div class="manage-item-info">
        <div class="manage-item-name">${escapeHtml(t.name)}</div>
        <div class="manage-item-meta">${t.questions?.length || 0} سؤال • ${t.timeLimit || 0} دقيقة${sc !== undefined ? ' • آخر درجة: ' + sc + '%' : ''}</div>
      </div>
      <div class="manage-item-actions">
        <button onclick="startQuiz('${t.firebaseId}')" class="btn btn-primary" style="font-size:0.8rem;padding:8px 12px">▶️ تشغيل</button>
        <button onclick="requestDeleteTest('${t.firebaseId}')" class="btn btn-secondary" style="font-size:0.8rem;padding:8px 12px;color:var(--red)">🗑️ حذف</button>
      </div>
    `;
    wrapper.appendChild(item);
  });
  container.innerHTML = '';
  container.appendChild(wrapper);
}

/* ============================================================
   QUESTION BUILDER — Manual quiz creation
============================================================ */
function addQuestionBuilder(data) {
  AppState.builderQuestions.push(data || {
    text: '', choices: ['', '', '', ''], correct: 0,
    correctAnswers: [0], multiCorrect: false, note: ''
  });
  renderBuilder();
}

function renderBuilder() {
  const container = document.getElementById('questions-builder');
  if (!container) return;
  const letters = ['أ', 'ب', 'ج', 'د'];
  const frag    = document.createDocumentFragment();

  AppState.builderQuestions.forEach((q, qi) => {
    const item     = document.createElement('div');
    item.className = 'q-builder-item';
    const isMulti  = q.multiCorrect;
    let choicesHtml = '';

    q.choices.forEach((c, ci) => {
      const iType    = isMulti ? 'checkbox' : 'radio';
      const iClass   = isMulti ? 'choice-checkbox' : 'choice-radio';
      const isChecked = isMulti
        ? (Array.isArray(q.correctAnswers) && q.correctAnswers.includes(ci))
        : (q.correct === ci);
      choicesHtml += `
        <div class="choice-builder-row">
          <input type="${iType}" class="${iClass}" name="correct-${qi}"
            ${isChecked ? 'checked' : ''}
            onchange="builderSetCorrect(${qi},${ci},this.checked,${isMulti})"/>
          <input class="form-input" placeholder="${letters[ci] || ci + 1}..."
            value="${escapeHtml(c || '')}"
            oninput="AppState.builderQuestions[${qi}].choices[${ci}]=this.value;updateAnswerMapForQuestion(${qi})"
            style="flex:1"/>
        </div>`;
    });

    item.innerHTML = `
      <div class="q-builder-header">
        <span class="q-builder-num">سؤال ${qi + 1}</span>
        <button class="q-del-btn" onclick="deleteBuilderQ(${qi})">حذف</button>
      </div>
      <input class="form-input" placeholder="نص السؤال..."
        value="${escapeHtml(q.text || '')}"
        oninput="AppState.builderQuestions[${qi}].text=this.value;updateAnswerMapForQuestion(${qi})"
        style="margin-bottom:9px"/>
      <label class="multi-correct-toggle">
        <input type="checkbox" ${isMulti ? 'checked' : ''}
          onchange="builderToggleMulti(${qi},this.checked)">
        إجابات صحيحة متعددة (يختار الطالب إجابة واحدة)
      </label>
      <div class="choices-builder" id="choices-builder-${qi}">${choicesHtml}</div>
      <textarea class="q-note-input"
        placeholder="ملاحظة المعلم للطلاب (تظهر بعد الانتهاء من الاختبار)..."
        oninput="AppState.builderQuestions[${qi}].note=this.value"
      >${escapeHtml(q.note || '')}</textarea>
    `;
    frag.appendChild(item);
  });

  container.innerHTML = '';
  container.appendChild(frag);
  renderAnswerMap();
}

function builderToggleMulti(qi, isMulti) {
  AppState.builderQuestions[qi].multiCorrect   = isMulti;
  AppState.builderQuestions[qi].correctAnswers = [AppState.builderQuestions[qi].correct || 0];
  renderBuilder();
}

function builderSetCorrect(qi, ci, checked, isMulti) {
  const q = AppState.builderQuestions[qi];
  if (isMulti) {
    if (!Array.isArray(q.correctAnswers)) q.correctAnswers = [];
    if (checked) { if (!q.correctAnswers.includes(ci)) q.correctAnswers.push(ci); }
    else {
      q.correctAnswers = q.correctAnswers.filter(x => x !== ci);
      if (!q.correctAnswers.length) q.correctAnswers = [ci];
    }
    q.correct = q.correctAnswers[0];
  } else {
    q.correct = ci; q.correctAnswers = [ci];
  }
  updateAnswerMapForQuestion(qi);
}

function updateAnswerMapForQuestion(qi) {
  const q   = AppState.builderQuestions[qi];
  if (!q) return;
  const row = document.querySelector(`.answer-map-row[data-qidx="${qi}"]`);
  if (row) {
    const sel = row.querySelector('.answer-map-select');
    if (sel && q.correct !== undefined) {
      sel.value = q.correct;
      if (q.correct >= 0) sel.classList.add('matched');
    }
  } else {
    renderAnswerMap();
  }
}

function deleteBuilderQ(i) {
  AppState.builderQuestions.splice(i, 1);
  renderBuilder();
}

/* ============================================================
   ANSWER MAP — Visual quick-reference for teachers
============================================================ */
function renderAnswerMap() {
  const section = document.getElementById('answer-map-section');
  const grid    = document.getElementById('answer-map-grid');
  if (!section || !grid) return;
  const letters = ['أ', 'ب', 'ج', 'د', 'هـ', 'و'];

  if (!AppState.builderQuestions.length) {
    section.style.display = 'none';
    return;
  }
  section.style.display = 'block';
  const frag = document.createDocumentFragment();

  AppState.builderQuestions.forEach((q, qi) => {
    const row = document.createElement('div');
    row.className    = 'answer-map-row';
    row.dataset.qidx = qi;
    let optionsHtml  = '';
    q.choices.forEach((c, ci) => {
      optionsHtml += `<option value="${ci}" ${q.correct === ci ? 'selected' : ''}>${letters[ci] || ci + 1}</option>`;
    });
    row.innerHTML = `
      <div class="answer-map-qnum">${qi + 1}</div>
      <div class="answer-map-qtext">${escapeHtml(q.text || '(بدون نص بعد)')}</div>
      <select class="answer-map-select ${q.correct >= 0 ? 'matched' : ''}"
        onchange="AppState.builderQuestions[${qi}].correct=parseInt(this.value);
                  AppState.builderQuestions[${qi}].correctAnswers=[parseInt(this.value)];
                  syncBuilderRadio(${qi})">${optionsHtml}</select>
    `;
    frag.appendChild(row);
  });
  grid.innerHTML = '';
  grid.appendChild(frag);
}

function syncBuilderRadio(qi) {
  const correct = AppState.builderQuestions[qi].correct;
  document.querySelectorAll(`input[name="correct-${qi}"]`).forEach((r, ci) => {
    r.checked = (ci === correct);
  });
  renderAnswerMap();
}

/* ============================================================
   SAVE QUIZ — Builder save (auth-guarded via firebase.js)
============================================================ */
async function saveTest() {
  if (!isAdminMode) { showToast('يجب تسجيل الدخول كأدمن', 'error'); return; }
  const name = document.getElementById('new-test-name')?.value.trim();
  if (!name) { showToast('أدخل اسم الاختبار', 'error'); return; }
  if (!AppState.builderQuestions.length) { showToast('أضف سؤالاً على الأقل', 'error'); return; }
  if (!AppState.builderQuestions.every(q => q.text.trim() && q.choices.every(c => c.trim()))) {
    showToast('أكمل جميع الأسئلة والخيارات', 'error'); return;
  }

  const testData = {
    name,
    subject:   document.getElementById('new-test-subject')?.value.trim() || '',
    timeLimit: parseInt(document.getElementById('new-test-time')?.value) || 0,
    questions: AppState.builderQuestions.map(q => ({
      text:           q.text,
      choices:        [...q.choices],
      correctAnswers: q.correctAnswers?.length ? q.correctAnswers : [q.correct],
      correct:        q.correctAnswers?.length ? q.correctAnswers[0] : q.correct,
      multiCorrect:   q.multiCorrect || false,
      note:           q.note || ''
    })),
    createdAt: Date.now()
  };

  const btn = document.getElementById('save-test-btn');
  if (btn) { btn.disabled = true; btn.textContent = 'جارٍ الحفظ...'; }

  try {
    await dbSaveQuiz(testData);
    showToast('تم حفظ الاختبار ✓', 'success');
    // Reset form
    safeSetValue('new-test-name',    '');
    safeSetValue('new-test-subject', '');
    safeSetValue('new-test-time',    '10');
    AppState.builderQuestions = [];
    renderBuilder();
    setTimeout(() => showPage('home'), 900);
  } catch (err) {
    showToast(err.message || 'حدث خطأ أثناء الحفظ', 'error');
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = '💾 حفظ الاختبار'; }
  }
}

/* ============================================================
   SMART TEXT PARSER — Paste & Parse quiz text
============================================================ */
function smartParseText(raw) {
  let txt = raw
    .replace(/\r\n|\r/g, '\n')
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    .replace(/[أإآ]/g, 'أ')
    .replace(/ﻻ/g, 'لا')
    .replace(/[١٢٣٤٥٦٧٨٩٠]/g, d => '٠١٢٣٤٥٦٧٨٩'.indexOf(d))
    .replace(/\t/g, ' ')
    .replace(/ {2,}/g, ' ');

  const lines = txt.split('\n').map(l => l.trim());
  const RX_Q  = /^(?:س(?:ؤال)?\s*\d*\s*[:.)]\s*|Q\s*\d*\s*[:.)]\s*|\d+\s*[.)]\s*(?!\s*[أبجدهوABCDa-f]\s*[.)]))(.+)/i;
  const RX_C  = /^(?:([أبجدهوABCDEFa-f])\s*[.):\-]\s*|(\d+)\s*[.)\-]\s*([أبجدهو])\s*[.):\-]?\s*|[•▪▸\-*]\s*)(.+)/i;
  const questions = [];
  let current = null;

  function pushCurrent() {
    if (current && current.text.trim() && current.choices.length >= 2) questions.push(current);
    current = null;
  }

  lines.forEach(line => {
    if (!line) return;
    const qMatch = line.match(RX_Q);
    const cMatch = line.match(RX_C);
    const qText  = qMatch ? qMatch[1].trim() : (line.endsWith('؟') || line.endsWith('?')) ? line : null;
    const cText  = cMatch ? cMatch[cMatch.length - 1].trim() : null;

    if (qText && !cText) {
      pushCurrent();
      current = { text: qText, choices: [], correctAnswers: [0], note: '' };
    } else if (cText && current) {
      current.choices.push(cText);
    } else if (cText && !current && questions.length) {
      questions[questions.length - 1].choices.push(cText);
    } else if (current) {
      if (current.choices.length === 0) current.text += ' ' + line;
      else if (line.length < 120 && !line.match(RX_Q)) current.choices[current.choices.length - 1] += ' ' + line;
    } else if (line.endsWith('؟') || line.endsWith('?')) {
      pushCurrent();
      current = { text: line, choices: [], correctAnswers: [0], note: '' };
    }
  });
  pushCurrent();

  return questions
    .filter(q => q.choices.length >= 2)
    .map(q => ({
      ...q,
      text:    q.text.trim(),
      choices: q.choices.map(c => c.trim()).filter(c => c.length > 0)
    }));
}

function parseQuestions() {
  const raw = document.getElementById('parse-input')?.value.trim();
  if (!raw) { showToast('الصق نصاً أولاً', 'error'); return; }

  AppState.parsedQuestions = smartParseText(raw);
  if (!AppState.parsedQuestions.length) {
    showToast('لم يتم التعرف على أسئلة. تأكد من الصيغة', 'error'); return;
  }

  // Apply bulk answer mapping if provided
  const bulk = document.getElementById('bulk-answers-input')?.value.trim();
  if (bulk) applyBulkAnswers(bulk);

  renderParsedQuestions();
  showToast(`تم التعرف على ${AppState.parsedQuestions.length} سؤال ✓`, 'success');
}

/**
 * Smart answer mapping: supports "A B D", "1 2 4", "أ ب د", comma or space separated.
 * Maps letter/number to choice index for each question.
 */
function applyBulkAnswers(bulk) {
  // Support both comma and space as separators
  const rawParts = bulk.replace(/،/g, ',').split(/[\s,]+/).map(p => p.trim()).filter(Boolean);
  const LETTER_MAP = {
    'أ':1, 'ا':1, 'A':1, 'a':1, '1':1,
    'ب':2, 'B':2, 'b':2, '2':2,
    'ج':3, 'C':3, 'c':3, '3':3,
    'د':4, 'D':4, 'd':4, '4':4,
    'ه':5, 'هـ':5, 'E':5, 'e':5, '5':5,
    'و':6, 'F':6, 'f':6, '6':6
  };

  rawParts.forEach((part, i) => {
    if (i >= AppState.parsedQuestions.length) return;
    const mapped = LETTER_MAP[part] || parseInt(part);
    if (mapped && mapped >= 1) {
      const idx = mapped - 1;
      AppState.parsedQuestions[i].correctAnswers = [idx];
      AppState.parsedQuestions[i].correct        = idx;
    }
  });
  showToast('تم تعيين الإجابات تلقائياً ✓', 'success');
}

function renderParsedQuestions() {
  const preview = document.getElementById('parse-preview');
  const list    = document.getElementById('parse-questions-list');
  if (!preview || !list) return;
  const letters = ['أ', 'ب', 'ج', 'د', 'هـ', 'و'];

  preview.style.display = 'block';
  safeSetText('parse-preview-title',
    `✅ تم التحليل — حدد الإجابة الصحيحة لكل سؤال (${AppState.parsedQuestions.length} سؤال)`);

  const frag = document.createDocumentFragment();
  AppState.parsedQuestions.forEach((q, qi) => {
    const item = document.createElement('div');
    item.className = 'parsed-q-item';
    let choicesHtml = '';

    q.choices.forEach((c, ci) => {
      const checked = (q.correctAnswers || [q.correct || 0]).includes(ci) ? 'checked' : '';
      choicesHtml += `
        <label class="parsed-choice-row">
          <input type="checkbox" data-qi="${qi}" data-ci="${ci}" ${checked}
            onchange="toggleParsedCorrect(${qi},${ci},this.checked)">
          <span>${letters[ci] || ci + 1}. ${escapeHtml(c)}</span>
        </label>`;
    });

    item.innerHTML = `
      <div class="parsed-q-text">${qi + 1}. ${escapeHtml(q.text)}</div>
      <div class="parsed-choices">${choicesHtml}</div>
      <textarea class="parsed-note-input"
        placeholder="ملاحظة المعلم (تظهر للطالب بعد الانتهاء)..."
        oninput="AppState.parsedQuestions[${qi}].note=this.value"
      >${escapeHtml(q.note || '')}</textarea>
    `;
    frag.appendChild(item);
  });
  list.innerHTML = '';
  list.appendChild(frag);
}

function toggleParsedCorrect(qi, ci, checked) {
  const q = AppState.parsedQuestions[qi];
  if (!q) return;
  if (!Array.isArray(q.correctAnswers)) q.correctAnswers = [q.correct || 0];
  if (checked) {
    if (!q.correctAnswers.includes(ci)) q.correctAnswers.push(ci);
  } else {
    q.correctAnswers = q.correctAnswers.filter(x => x !== ci);
    if (!q.correctAnswers.length) q.correctAnswers = [ci];
  }
  q.correct = q.correctAnswers[0];
}

/* ============================================================
   SAVE PARSED TEST (auth-guarded via firebase.js)
============================================================ */
async function saveParsedTest() {
  if (!isAdminMode) { showToast('يجب تسجيل الدخول كأدمن', 'error'); return; }
  const name = document.getElementById('parse-test-name')?.value.trim();
  if (!name)                          { showToast('أدخل اسم الاختبار', 'error'); return; }
  if (!AppState.parsedQuestions.length) { showToast('لا توجد أسئلة محللة', 'error'); return; }

  const testData = {
    name,
    subject:   document.getElementById('parse-test-subject')?.value.trim() || '',
    timeLimit: parseInt(document.getElementById('parse-test-time')?.value) || 0,
    questions: AppState.parsedQuestions.map(q => ({
      text:           q.text,
      choices:        [...q.choices],
      correctAnswers: q.correctAnswers || [q.correct || 0],
      correct:        (q.correctAnswers || [q.correct || 0])[0],
      multiCorrect:   (q.correctAnswers || []).length > 1,
      note:           q.note || ''
    })),
    createdAt: Date.now()
  };

  const btn = document.getElementById('save-parsed-btn');
  if (btn) { btn.disabled = true; btn.textContent = 'جارٍ الحفظ...'; }

  try {
    await dbSaveQuiz(testData);
    showToast(`تم حفظ "${name}" بـ ${testData.questions.length} سؤال ✓`, 'success');
    // Reset parser
    safeSetValue('parse-input',        '');
    safeSetValue('bulk-answers-input', '');
    safeSetValue('parse-test-name',    '');
    safeSetValue('parse-test-subject', '');
    const preview = document.getElementById('parse-preview');
    if (preview) preview.style.display = 'none';
    AppState.parsedQuestions = [];
    setTimeout(() => showPage('home'), 900);
  } catch (err) {
    showToast(err.message || 'حدث خطأ أثناء الحفظ', 'error');
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = '💾 حفظ الاختبار'; }
  }
}
-e 

/* ================================================================
   MODULE 4: quiz.js — Quiz Engine, Errors, Tools, Pomodoro
================================================================ */
/**
 * quiz.js — Quiz Engine
 * منصة الوسام التعليمية — Production Grade
 *
 * CRITICAL DESIGN PRINCIPLE:
 * "Multi-correct, single-choice UX"
 * - A question MAY have multiple correct answers in the database
 * - BUT the student sees standard single-choice radio UX (no hint that multiple answers exist)
 * - If student picks ANY ONE of the correct answers → marked CORRECT ✅
 * - No "select all that apply" UI — ever
 *
 * Smart Error Recovery:
 * - Tracks wrong answers with timestamps and attempt counts
 * - Prioritizes frequently-wrong questions in practice sessions
 * - Surfaces weak areas in analytics
 */

/* ============================================================
   ANSWER EVALUATION — The Core Logic
============================================================ */

/**
 * Get all correct answer indices for a question.
 * @param {Object} q - Question object
 * @returns {number[]} - Array of correct choice indices
 */
function getCorrectAnswers(q) {
  if (Array.isArray(q.correctAnswers) && q.correctAnswers.length) return q.correctAnswers;
  if (typeof q.correct === 'number') return [q.correct];
  return [0];
}

/**
 * Determine if a user's answer is correct.
 *
 * KEY RULE: Even if q.correctAnswers = [1, 4],
 *   - userAnswer = 1 → ✅ correct
 *   - userAnswer = 4 → ✅ correct
 *   - userAnswer = 2 → ❌ wrong
 *
 * We NEVER require the student to pick ALL correct answers.
 * Selecting ANY one correct answer is sufficient.
 *
 * @param {Object} q           - Question object
 * @param {number|number[]} ua - User's answer (always a single number from UI)
 * @returns {boolean}
 */
function isAnswerCorrect(q, ua) {
  const correct = getCorrectAnswers(q);
  if (ua === null || ua === undefined || ua === -1) return false;
  // Single answer (the only mode shown to students)
  const answer = Array.isArray(ua) ? ua[0] : ua;
  return correct.includes(answer);
}

/* ============================================================
   QUIZ START
============================================================ */

/**
 * Start a quiz by Firebase ID.
 * @param {string} firebaseId
 */
function startQuiz(firebaseId) {
  const test = AppState.tests.find(t => t.firebaseId === firebaseId);
  if (!test?.questions?.length) {
    showToast('هذا الاختبار لا يحتوي على أسئلة!', 'error');
    return;
  }

  // Check for saved progress
  const savedProgress = AppState.progress[firebaseId];
  if (savedProgress && savedProgress.answers?.some(a => a !== null)) {
    if (confirm('لديك تقدم محفوظ لهذا الاختبار. هل تريد الاستمرار من حيث توقفت؟')) {
      resumeQuiz(test, savedProgress);
      return;
    }
  }

  initQuizSession(test);
}

/**
 * Start a custom practice quiz (error drills).
 * @param {Object[]} questions
 * @param {string} title
 */
function startCustomQuiz(questions, title) {
  if (!questions.length) { showToast('لا توجد أسئلة', 'error'); return; }
  const test = {
    id: '__practice__', firebaseId: '__practice__',
    name: title, subject: 'تدريب الأخطاء', timeLimit: 0, questions
  };
  initQuizSession(test);
}

function initQuizSession(test) {
  AppState.currentTest  = test;
  AppState.currentQ     = 0;
  AppState.userAnswers  = new Array(test.questions.length).fill(null);
  AppState.answered     = false;
  AppState.elapsedSecs  = 0;

  showPage('quiz');
  safeSetText('quiz-title',    test.name);
  safeSetText('quiz-subtitle', (test.subject ? escapeHtml(test.subject) : '') + ' • ' + test.questions.length + ' سؤال');
  startTimer();
  renderQuestion();
}

function resumeQuiz(test, saved) {
  AppState.currentTest  = test;
  AppState.currentQ     = saved.currentQ || 0;
  AppState.userAnswers  = saved.answers  || new Array(test.questions.length).fill(null);
  AppState.answered     = AppState.userAnswers[AppState.currentQ] !== null;
  AppState.elapsedSecs  = saved.elapsed  || 0;

  showPage('quiz');
  safeSetText('quiz-title',    test.name);
  safeSetText('quiz-subtitle', (test.subject ? escapeHtml(test.subject) : '') + ' • ' + test.questions.length + ' سؤال');
  startTimer();
  renderQuestion();
  showToast('استُؤنف الاختبار ✓', 'info');
}

/* ============================================================
   TIMER
============================================================ */
function startTimer() {
  clearInterval(AppState.timerInterval);
  const limit = (AppState.currentTest.timeLimit || 0) * 60;
  const pill  = document.getElementById('timer-pill');

  AppState.timerInterval = setInterval(() => {
    AppState.elapsedSecs++;

    // Auto-save progress every 30 seconds
    if (AppState.elapsedSecs % 30 === 0) saveProgress();

    if (limit > 0) {
      const rem = limit - AppState.elapsedSecs;
      if (rem <= 0) { clearInterval(AppState.timerInterval); finishQuiz(); return; }
      if (pill) {
        pill.className = 'timer-pill' + (rem <= 60 ? ' danger' : rem <= 120 ? ' warning' : '');
        pill.innerHTML = `⏱️ <span>${fmtTime(rem)}</span>`;
      }
    } else {
      if (pill) pill.innerHTML = `⏱️ <span>${fmtTime(AppState.elapsedSecs)}</span>`;
    }
  }, 1000);
}

/* ============================================================
   PROGRESS AUTO-SAVE (LocalStorage)
============================================================ */
function saveProgress() {
  const { currentTest, currentQ, userAnswers, elapsedSecs } = AppState;
  if (!currentTest || currentTest.id === '__practice__') return;
  AppState.progress[currentTest.id] = { currentQ, answers: [...userAnswers], elapsed: elapsedSecs };
  localStorage.setItem('quizProgress', JSON.stringify(AppState.progress));
}

function clearProgress(testId) {
  delete AppState.progress[testId];
  localStorage.setItem('quizProgress', JSON.stringify(AppState.progress));
}

/* ============================================================
   RENDER QUESTION — SINGLE-CHOICE UX ALWAYS
   (Even for multi-correct questions — students never know)
============================================================ */
function renderQuestion() {
  const { currentTest, currentQ, userAnswers } = AppState;
  const q   = currentTest.questions[currentQ];
  const pct = (currentQ / currentTest.questions.length) * 100;

  // Progress & header
  const progressFill = document.getElementById('q-progress-fill');
  if (progressFill) progressFill.style.width = pct + '%';
  safeSetText('q-counter', (currentQ + 1) + ' / ' + currentTest.questions.length);
  safeSetText('q-num',     'السؤال ' + (currentQ + 1));
  safeSetText('q-text',    q.text);

  // CRITICAL: Hide ALL multi-answer UI — students ALWAYS get standard single-choice
  const multiNote      = document.getElementById('multi-answer-note');
  const submitMultiBtn = document.getElementById('quiz-submit-multi');
  if (multiNote)      multiNote.className      = 'multi-answer-note'; // always hidden from student
  if (submitMultiBtn) submitMultiBtn.className = 'quiz-submit-multi'; // always hidden

  // Hide teacher note
  const noteBox = document.getElementById('teacher-note-box');
  if (noteBox) noteBox.className = 'teacher-note-box';

  // Render choices — always single-click selection (radio UX)
  const letters   = ['أ', 'ب', 'ج', 'د', 'هـ', 'و'];
  const container = document.getElementById('choices-container');
  if (!container) return;
  const frag = document.createDocumentFragment();

  q.choices.forEach((c, i) => {
    const div     = document.createElement('div');
    div.className = 'choice';
    div.id        = 'choice-' + i;
    // Single-choice click for ALL questions (multi-correct is invisible to student)
    div.onclick   = () => selectAnswer(i);
    div.innerHTML = `<div class="choice-letter">${letters[i] || (i + 1)}</div><div class="choice-text">${escapeHtml(c)}</div>`;
    frag.appendChild(div);
  });
  container.innerHTML = '';
  container.appendChild(frag);

  // Next/skip buttons
  const nextBtn = document.getElementById('next-btn');
  if (nextBtn) {
    nextBtn.disabled    = true;
    nextBtn.textContent = currentQ === currentTest.questions.length - 1 ? 'إنهاء ✓' : 'التالي ←';
  }
  const skipBtn = document.getElementById('skip-btn');
  if (skipBtn) skipBtn.style.display = '';

  AppState.answered = false;

  // Restore previous answer if user navigated back
  const prevAnswer = userAnswers[currentQ];
  if (prevAnswer !== null && prevAnswer !== undefined) {
    restoreAnswer(prevAnswer);
  }
}

/**
 * Restore previously selected answer when re-visiting a question.
 * @param {number} answer
 */
function restoreAnswer(answer) {
  const idx = Array.isArray(answer) ? answer[0] : answer;
  if (idx === -1) return; // was skipped

  document.getElementById('choice-' + idx)?.classList.add('selected');
  document.querySelectorAll('.choice').forEach(el => el.classList.add('disabled'));
  const nextBtn = document.getElementById('next-btn');
  if (nextBtn) nextBtn.disabled = false;
  const skipBtn = document.getElementById('skip-btn');
  if (skipBtn) skipBtn.style.display = 'none';
  AppState.answered = true;
  maybeShowTeacherNote(AppState.currentTest.questions[AppState.currentQ]);
}

/* ============================================================
   ANSWER SELECTION — Single Choice (the only UI mode)
============================================================ */

/**
 * Called when student clicks any choice.
 * Works for BOTH single-correct and multi-correct questions.
 * Student always picks exactly one answer.
 *
 * @param {number} i - Choice index (0-based)
 */
function selectAnswer(i) {
  if (AppState.answered) return;
  AppState.answered         = true;
  AppState.userAnswers[AppState.currentQ] = i;

  // Visual feedback
  document.querySelectorAll('.choice').forEach(el => el.classList.add('disabled'));
  document.getElementById('choice-' + i)?.classList.add('selected');

  const nextBtn = document.getElementById('next-btn');
  if (nextBtn) nextBtn.disabled = false;
  const skipBtn = document.getElementById('skip-btn');
  if (skipBtn) skipBtn.style.display = 'none';

  // Save progress
  saveProgress();
  maybeShowTeacherNote(AppState.currentTest.questions[AppState.currentQ]);
}

/* ============================================================
   TEACHER NOTES — Shown after answering if setting enabled
============================================================ */
function maybeShowTeacherNote(q) {
  if (!q.note?.trim()) return;
  if (AppState.adminSettings.showNotesLive !== false) {
    safeSetText('teacher-note-text', q.note);
    const box = document.getElementById('teacher-note-box');
    if (box) box.className = 'teacher-note-box visible';
  }
}

/* ============================================================
   NAVIGATION
============================================================ */
function skipQuestion() {
  AppState.userAnswers[AppState.currentQ] = -1;
  saveProgress();
  nextQuestion();
}

function nextQuestion() {
  const { currentQ, currentTest } = AppState;
  if (currentQ < currentTest.questions.length - 1) {
    AppState.currentQ++;
    AppState.answered = false;
    renderQuestion();
  } else {
    finishQuiz();
  }
}

function confirmLeaveQuiz() {
  openModal('leave-modal');
}

function leaveQuiz() {
  clearInterval(AppState.timerInterval);
  closeModal('leave-modal');
  // Don't clear progress — allow resuming
  showPage('home');
}

/* ============================================================
   FINISH QUIZ & RESULTS
============================================================ */
function finishQuiz() {
  clearInterval(AppState.timerInterval);
  const { currentTest, userAnswers, elapsedSecs } = AppState;
  const qs        = currentTest.questions;
  let correct     = 0, skipped = 0;
  const wrongList = [];

  qs.forEach((q, i) => {
    const ua = userAnswers[i];
    if (ua === -1 || ua === null) {
      skipped++;
    } else if (isAnswerCorrect(q, ua)) {
      correct++;
    } else {
      wrongList.push({
        testName: currentTest.name,
        testId:   currentTest.id,
        qIndex:   i,
        q,
        userAnswer: ua,
        timestamp:  Date.now(),
        attempts:   getErrorAttemptCount(currentTest.id, i) + 1
      });
    }
  });

  const pct = Math.round(correct / qs.length * 100);

  // Save score
  if (currentTest.id !== '__practice__') {
    AppState.scores[currentTest.id] = pct;
    localStorage.setItem('quizScores', JSON.stringify(AppState.scores));
    clearProgress(currentTest.id);
    // Save analytics to Firebase
    dbSaveAnalytics(currentTest.id, {
      score: pct, correct, wrong: qs.length - correct - skipped,
      skipped, total: qs.length, elapsed: elapsedSecs
    });
  }

  // Smart Error Tracking
  updateErrorTracking(wrongList, pct);
  showResults(pct, correct, skipped, qs.length, elapsedSecs);
}

/* ============================================================
   SMART ERROR RECOVERY SYSTEM
============================================================ */

/**
 * Returns how many times a question has been wrong.
 * Used to weight difficult questions in practice sessions.
 */
function getErrorAttemptCount(testId, qIndex) {
  const existing = AppState.errors.find(e => e.testId === testId && e.qIndex === qIndex);
  return existing?.attempts || 0;
}

/**
 * Update error tracking with smart prioritization.
 * - Removes errors that were answered correctly this round
 * - Increments attempt count for persistent errors (weak areas)
 * - Prioritizes high-attempt errors in practice (sorted by attempts desc)
 */
function updateErrorTracking(wrongList, score) {
  const { currentTest } = AppState;

  if (AppState.adminSettings.categorizedErrors) {
    // Per-quiz error tracking
    const catKey  = 'quizErrors_' + (currentTest.id || 'general');
    let catErrors = JSON.parse(localStorage.getItem(catKey) || '[]');

    wrongList.forEach(w => {
      const existing = catErrors.findIndex(e => e.testId === w.testId && e.qIndex === w.qIndex);
      if (existing >= 0) {
        catErrors[existing] = { ...catErrors[existing], ...w, attempts: (catErrors[existing].attempts || 1) + 1 };
      } else {
        catErrors.push(w);
      }
    });

    // Remove errors answered correctly this round
    AppState.userAnswers.forEach((ua, i) => {
      if (ua !== null && ua !== -1 && isAnswerCorrect(currentTest.questions[i], ua)) {
        catErrors = catErrors.filter(e => !(e.testId === currentTest.id && e.qIndex === i));
      }
    });

    localStorage.setItem(catKey, JSON.stringify(catErrors));
  }

  // Global error list (always maintained)
  wrongList.forEach(w => {
    const existing = AppState.errors.findIndex(e => e.testId === w.testId && e.qIndex === w.qIndex);
    if (existing >= 0) {
      AppState.errors[existing] = { ...AppState.errors[existing], ...w, attempts: (AppState.errors[existing].attempts || 1) + 1 };
    } else {
      AppState.errors.push(w);
    }
  });

  // Remove errors that were corrected
  AppState.userAnswers.forEach((ua, i) => {
    if (ua !== null && ua !== -1 && isAnswerCorrect(currentTest.questions[i], ua)) {
      AppState.errors = AppState.errors.filter(e => !(e.testId === currentTest.id && e.qIndex === i));
    }
  });

  // Sort by attempts descending (most difficult first)
  AppState.errors.sort((a, b) => (b.attempts || 1) - (a.attempts || 1));

  localStorage.setItem('quizErrors', JSON.stringify(AppState.errors));
}

/* ============================================================
   RESULTS PAGE
============================================================ */
function showResults(pct, correct, skipped, total, elapsed) {
  showPage('results');
  const wrong    = total - correct - skipped;
  const icon     = pct >= 90 ? '🏆' : pct >= 70 ? '🎉' : pct >= 50 ? '📚' : '💪';
  const grade    = pct >= 90 ? 'ممتاز' : pct >= 80 ? 'جيد جداً' : pct >= 70 ? 'جيد' : pct >= 60 ? 'مقبول' : 'راجع المادة';
  const gColor   = pct >= 70 ? 'var(--green)' : pct >= 50 ? 'var(--accent)' : 'var(--red)';
  const arcColor = pct >= 70 ? '#10b981' : pct >= 50 ? '#fbbf24' : '#ef4444';

  safeSetText('results-icon',  icon);
  safeSetText('results-score', pct + '%');
  safeSetText('score-pct',     pct + '%');
  safeSetText('results-label', AppState.currentTest.name);
  const gradeEl = document.getElementById('results-grade');
  if (gradeEl) {
    gradeEl.textContent = grade;
    gradeEl.style.cssText = `background:${gColor}22;color:${gColor};border:1px solid ${gColor}44`;
  }
  safeSetText('r-correct',  correct);
  safeSetText('r-wrong',    wrong);
  safeSetText('r-skipped',  skipped);
  safeSetText('r-time',     fmtTime(elapsed));

  // Arc animation
  const arc    = document.getElementById('score-arc');
  const circum = 326.7;
  if (arc) {
    arc.style.stroke = arcColor;
    setTimeout(() => { arc.style.strokeDashoffset = circum - (circum * pct / 100); }, 100);
  }

  renderBreakdownDots();
  renderReviewList();
}

function renderBreakdownDots() {
  const { currentTest, userAnswers } = AppState;
  const qs    = currentTest.questions;
  const bdGrid = document.getElementById('breakdown-grid');
  if (!bdGrid) return;
  const frag  = document.createDocumentFragment();

  qs.forEach((q, i) => {
    const ua  = userAnswers[i];
    const dot = document.createElement('div');
    let cls = 's', sym = '⏭';
    if (ua !== null && ua !== -1 && isAnswerCorrect(q, ua))  { cls = 'c'; sym = i + 1; }
    else if (ua !== null && ua !== -1)                        { cls = 'w'; sym = i + 1; }
    dot.className   = `breakdown-dot ${cls}`;
    dot.title       = `سؤال ${i + 1}`;
    dot.textContent = sym;
    frag.appendChild(dot);
  });
  bdGrid.innerHTML = '';
  bdGrid.appendChild(frag);
}

function renderReviewList() {
  const { currentTest, userAnswers } = AppState;
  const qs      = currentTest.questions;
  const letters = ['أ', 'ب', 'ج', 'د', 'هـ', 'و'];
  const rvList  = document.getElementById('review-list');
  if (!rvList) return;
  const frag = document.createDocumentFragment();

  qs.forEach((q, i) => {
    const ua             = userAnswers[i];
    const correctAnswers = getCorrectAnswers(q);
    const isCorrect      = ua !== null && ua !== -1 && isAnswerCorrect(q, ua);
    const item           = document.createElement('div');
    item.className       = `review-item ${isCorrect ? 'r-correct' : 'r-wrong'}`;

    let choicesHtml = '';
    q.choices.forEach((c, ci) => {
      const isCorrectChoice = correctAnswers.includes(ci);
      const isUserChoice    = ua === ci;
      let cls2 = '';
      if (isCorrectChoice)              cls2 = 'r-answer';
      else if (isUserChoice && !isCorrectChoice) cls2 = 'r-user-wrong';
      if (cls2) {
        choicesHtml += `<div class="review-choice ${cls2}">${isCorrectChoice ? '✅' : '❌'} ${letters[ci] || ci + 1}. ${escapeHtml(c)}</div>`;
      }
    });

    const noteHtml = q.note
      ? `<div class="review-note"><span>💡 ملاحظة المعلم</span>${escapeHtml(q.note)}</div>`
      : '';

    item.innerHTML = `
      <div class="review-q">${i + 1}. ${escapeHtml(q.text)}</div>
      <div class="review-choices">${choicesHtml}</div>
      ${noteHtml}
    `;
    frag.appendChild(item);
  });
  rvList.innerHTML = '';
  rvList.appendChild(frag);
}

function retryQuiz() {
  const { currentTest } = AppState;
  if (currentTest.firebaseId !== '__practice__') startQuiz(currentTest.firebaseId);
  else startCustomQuiz(currentTest.questions, currentTest.name);
}

/* ============================================================
   ERRORS PAGE — Smart practice sessions
============================================================ */
function renderErrors() {
  const container = document.getElementById('errors-container');
  const panel     = document.getElementById('practice-panel');
  const { errors, adminSettings } = AppState;

  if (!errors.length) {
    if (panel) panel.style.display = 'none';
    if (container) container.innerHTML = `<div class="empty-state"><div class="icon">🎉</div><p>لا توجد أخطاء مسجّلة — أحسنت!</p></div>`;
    return;
  }

  if (panel) panel.style.display = 'block';
  const size   = parseInt(document.getElementById('practice-size')?.value) || 10;
  const splits = Math.ceil(errors.length / size);
  safeSetText('practice-splits-info',
    `${errors.length} خطأ مسجّل • سيتم تقسيمها إلى ${splits} جلسة (${size} سؤال لكل جلسة)`);

  const grouped = {};
  errors.forEach(e => {
    const key = adminSettings.categorizedErrors ? (e.testId || 'general') : 'all';
    if (!grouped[key]) grouped[key] = { name: e.testName || 'الكل', items: [] };
    grouped[key].items.push(e);
  });

  const letters = ['أ', 'ب', 'ج', 'د', 'هـ', 'و'];
  const frag    = document.createDocumentFragment();

  Object.entries(grouped).forEach(([key, g]) => {
    const folder = document.createElement('div');
    folder.className = 'errors-folder';
    const bodyId     = 'errfolder_' + key.replace(/[^a-z0-9]/gi, '_');

    let itemsHtml = '';
    g.items.forEach((e, idx) => {
      const ua          = e.userAnswer;
      const correctIdxs = getCorrectAnswers(e.q);
      const correctText = correctIdxs.map(ci => `${letters[ci] || ci + 1}. ${escapeHtml(e.q.choices[ci] || '—')}`).join(' ، ');
      const uaText      = ua >= 0
        ? `${letters[ua] || '?'}. ${escapeHtml(e.q.choices[ua] || '—')}`
        : null;
      const attemptsTag = (e.attempts > 1)
        ? `<span class="error-attempts">🔁 ${e.attempts} محاولات</span>`
        : '';

      itemsHtml += `
        <div class="error-item">
          <div class="error-q-num">${idx + 1}</div>
          <div class="error-content">
            <div class="error-q">${escapeHtml(e.q.text)}</div>
            <div class="error-answers">
              ${uaText ? `<span class="error-wrong">❌ إجابتك: ${uaText}</span>` : '<span class="error-wrong">⏭️ تم التخطي</span>'}
              <span class="error-correct">✅ الصحيح: ${correctText}</span>
              ${attemptsTag}
            </div>
          </div>
        </div>`;
    });

    folder.innerHTML = `
      <div class="folder-top" onclick="const b=document.getElementById('${bodyId}');b.style.display=b.style.display==='none'?'block':'none'">
        <div class="folder-top-left"><span>📁</span><span class="folder-title">${escapeHtml(g.name)}</span></div>
        <div class="folder-actions">
          <button class="folder-retake-btn" onclick="event.stopPropagation();retakeErrorsForQuiz('${key}')">🔁 إعادة التدريب</button>
          <span class="folder-count">${g.items.length} خطأ</span>
        </div>
      </div>
      <div class="folder-body" id="${bodyId}">${itemsHtml}</div>
    `;
    frag.appendChild(folder);
  });

  if (container) {
    container.innerHTML = '';
    container.appendChild(frag);
  }
}

function retakeErrorsForQuiz(key) {
  const subset = key === 'all' ? AppState.errors : AppState.errors.filter(e => e.testId === key);
  if (!subset.length) { showToast('لا توجد أخطاء لهذا الاختبار', 'error'); return; }
  // Prioritize high-attempt (difficult) questions first
  const sorted = [...subset].sort((a, b) => (b.attempts || 1) - (a.attempts || 1));
  const qs     = sorted.map(e => ({ ...e.q }));
  const name   = sorted[0]?.testName || 'تدريب الأخطاء';
  startCustomQuiz(qs, `تدريب أخطاء: ${name}`);
}

function startPracticeSession(all = false) {
  const { errors } = AppState;
  if (!errors.length) { showToast('لا توجد أخطاء للتدريب', 'error'); return; }

  // Sort by attempts to prioritize weak areas
  const sorted    = [...errors].sort((a, b) => (b.attempts || 1) - (a.attempts || 1));
  const questions = sorted.map(e => ({ ...e.q }));

  if (all) { startCustomQuiz(questions, 'تدريب الأخطاء — كل الأسئلة'); return; }

  const size   = parseInt(document.getElementById('practice-size')?.value) || 10;
  const splits = [];
  for (let i = 0; i < questions.length; i += size) splits.push(questions.slice(i, i + size));

  if (splits.length === 1) { startCustomQuiz(splits[0], 'تدريب الأخطاء — جلسة 1'); return; }

  safeSetText('practice-modal-desc',
    `${questions.length} سؤال مقسّم على ${splits.length} جلسات (${size} سؤال لكل جلسة) — مرتبة حسب الصعوبة`);

  let listHtml = '';
  splits.forEach((chunk, i) => {
    const hardCount = chunk.filter(q => {
      const e = errors.find(e2 => e2.q.text === q.text);
      return (e?.attempts || 1) > 1;
    }).length;
    listHtml += `
      <div class="manage-item">
        <div class="manage-item-info">
          <div class="manage-item-name">الجلسة ${i + 1}</div>
          <div class="manage-item-meta">${chunk.length} سؤال${hardCount ? ` • ${hardCount} أسئلة صعبة 🔥` : ''}</div>
        </div>
        <button class="btn btn-primary" style="font-size:0.82rem;padding:8px 14px"
          onclick="closeModal('practice-modal');startCustomQuiz(window.practiceChunks[${i}],'تدريب الأخطاء — جلسة ${i + 1}')">
          ▶ ابدأ
        </button>
      </div>`;
  });

  const listEl = document.getElementById('practice-sessions-list');
  if (listEl) listEl.innerHTML = listHtml;
  window.practiceChunks = splits;
  openModal('practice-modal');
}

/* ============================================================
   POMODORO TIMER
============================================================ */
function updatePomoSettings() {
  const p = AppState.pomodoro;
  if (p.running) return;
  p.focusMins     = parseInt(document.getElementById('pomo-focus-input')?.value)    || 25;
  p.breakMins     = parseInt(document.getElementById('pomo-break-input')?.value)    || 5;
  p.totalSessions = parseInt(document.getElementById('pomo-sessions-input')?.value) || 4;
  p.remaining     = p.focusMins * 60;
  p.phase         = 'focus';
  updatePomoDisplay();
}

function togglePomodoro() {
  const p = AppState.pomodoro;
  if (p.running) {
    clearInterval(p.interval); p.running = false;
    safeSetText('pomo-start-btn',    '▶ ابدأ');
    safeSetText('pomo-status-text',  'متوقف مؤقتاً');
  } else {
    p.running = true;
    safeSetText('pomo-start-btn', '⏸ إيقاف');
    p.interval = setInterval(tickPomo, 1000);
  }
}

function tickPomo() {
  const p = AppState.pomodoro;
  p.remaining--;
  if (p.remaining <= 0) {
    if (p.phase === 'focus') {
      p.completedSessions++; p.phase = 'break';
      p.remaining = p.breakMins * 60;
      showToast('🍅 وقت الاستراحة!', 'info');
    } else {
      p.phase = 'focus'; p.remaining = p.focusMins * 60;
      p.currentSession = Math.min(p.currentSession + 1, p.totalSessions);
      if (p.completedSessions >= p.totalSessions) {
        showToast('🏆 انتهت جميع الجلسات! أحسنت', 'success'); resetPomodoro(); return;
      }
      showToast('✏️ وقت التركيز!', 'info');
    }
  }
  updatePomoDisplay();
}

function skipPomoPhase() { AppState.pomodoro.remaining = 0; tickPomo(); }

function resetPomodoro() {
  const p = AppState.pomodoro;
  clearInterval(p.interval); p.running = false; p.phase = 'focus';
  p.currentSession = 1; p.completedSessions = 0;
  p.remaining = p.focusMins * 60;
  safeSetText('pomo-start-btn', '▶ ابدأ');
  updatePomoDisplay();
}

function updatePomoDisplay() {
  const p       = AppState.pomodoro;
  const isFocus = p.phase === 'focus';
  const total   = (isFocus ? p.focusMins : p.breakMins) * 60;
  const circum  = 188.5;
  const offset  = circum - (circum * p.remaining / total);

  safeSetText('pomo-display', fmtTime(p.remaining));
  const dispEl = document.getElementById('pomo-display');
  if (dispEl) dispEl.className = 'pomo-time ' + (isFocus ? 'focus' : 'break');

  const lblEl = document.getElementById('pomo-label');
  if (lblEl) { lblEl.textContent = isFocus ? 'تركيز' : 'استراحة'; lblEl.className = 'pomo-label ' + (isFocus ? 'focus' : 'break'); }

  const ring = document.getElementById('pomo-ring-fill');
  if (ring) { ring.style.strokeDashoffset = offset; ring.className = 'pomo-ring-fill ' + (isFocus ? 'focus-ring' : 'break-ring'); }

  safeSetText('pomo-sessions-inner', p.currentSession + '/' + p.totalSessions);
  safeSetText('pomo-status-text', p.running ? (isFocus ? '⏳ جلسة تركيز جارية...' : '☕ استرح قليلاً...') : 'ابدأ جلسة دراسة منتجة');

  let dotsHtml = '';
  for (let i = 0; i < p.totalSessions; i++) dotsHtml += `<div class="pomo-dot ${i < p.completedSessions ? 'done' : ''}"></div>`;
  const dotsEl = document.getElementById('pomo-dots');
  if (dotsEl) dotsEl.innerHTML = dotsHtml;
}

/* ============================================================
   STUDY TOOLS
============================================================ */
function initToolsPage() {
  const tg = JSON.parse(localStorage.getItem('toolGoal') || 'null');
  if (tg) {
    safeSetValue('tool-goal-name',   tg.name   || '');
    safeSetValue('tool-goal-target', tg.target || 20);
    safeSetValue('tool-goal-done',   tg.done   || 0);
    updateToolGoal();
  }
  updateCdDisplay(); updateQtDisplay();
}

function toggleCountdown() {
  const cd = AppState.tools.cd;
  if (cd.running) {
    clearInterval(cd.interval); cd.running = false;
    safeSetText('cd-start-btn', '▶ ابدأ');
    safeSetText('cd-label', 'متوقف');
  } else {
    if (!cd.remaining) {
      const m = parseInt(document.getElementById('cd-mins')?.value) || 0;
      const s = parseInt(document.getElementById('cd-secs')?.value) || 0;
      cd.total = cd.remaining = m * 60 + s;
      if (!cd.remaining) { showToast('حدد وقتاً أولاً', 'error'); return; }
    }
    cd.running = true;
    safeSetText('cd-start-btn', '⏸ إيقاف');
    safeSetText('cd-label', 'يعدّ...');
    cd.interval = setInterval(() => {
      cd.remaining--; updateCdDisplay();
      if (cd.remaining <= 0) {
        clearInterval(cd.interval); cd.running = false;
        safeSetText('cd-start-btn', '▶ ابدأ');
        safeSetText('cd-label', '✅ انتهى الوقت!');
        showToast('⏰ انتهى الوقت!', 'info');
      }
    }, 1000);
  }
}

function updateCdDisplay() {
  const rem = AppState.tools.cd.remaining;
  const el  = document.getElementById('cd-display');
  if (!el) return;
  el.textContent = fmtTime(rem);
  el.className   = 'tool-timer-val' + (rem <= 10 && rem > 0 ? ' danger' : rem <= 30 ? ' warning' : (AppState.tools.cd.running ? ' running' : ''));
}

function resetCountdown() {
  const cd = AppState.tools.cd;
  clearInterval(cd.interval); cd.running = false; cd.remaining = 0;
  safeSetText('cd-start-btn', '▶ ابدأ');
  safeSetText('cd-label', 'جاهز للبدء');
  updateCdDisplay();
}

function toggleStopwatch() {
  const sw = AppState.tools.sw;
  if (sw.running) {
    clearInterval(sw.interval); sw.running = false;
    safeSetText('sw-start-btn', '▶ ابدأ');
    safeSetText('sw-label', 'متوقفة');
    const lapBtn = document.getElementById('sw-lap-btn');
    if (lapBtn) lapBtn.disabled = true;
  } else {
    sw.running = true;
    safeSetText('sw-start-btn', '⏸ إيقاف');
    safeSetText('sw-label', 'تعمل...');
    const lapBtn = document.getElementById('sw-lap-btn');
    if (lapBtn) lapBtn.disabled = false;
    sw.interval = setInterval(() => {
      sw.elapsed++;
      safeSetText('sw-display', fmtTime(sw.elapsed));
    }, 1000);
  }
}

function lapStopwatch() {
  const sw     = AppState.tools.sw;
  const lapsEl = document.getElementById('sw-laps');
  if (!lapsEl) return;
  sw.laps.push(sw.elapsed);
  const div = document.createElement('div');
  div.style.cssText = 'background:var(--surface2);border-radius:6px;padding:4px 10px;font-size:0.78rem;color:var(--text3);display:flex;justify-content:space-between';
  div.innerHTML = `<span>لفة ${sw.laps.length}</span><span style="color:var(--accent);font-weight:700">${fmtTime(sw.elapsed)}</span>`;
  lapsEl.appendChild(div); lapsEl.scrollTop = lapsEl.scrollHeight;
}

function resetStopwatch() {
  const sw = AppState.tools.sw;
  clearInterval(sw.interval); sw.running = false; sw.elapsed = 0; sw.laps = [];
  safeSetText('sw-display',   '00:00');
  safeSetText('sw-start-btn', '▶ ابدأ');
  safeSetText('sw-label',     'متوقفة');
  const lapBtn = document.getElementById('sw-lap-btn');
  if (lapBtn) lapBtn.disabled = true;
  const lapsEl = document.getElementById('sw-laps');
  if (lapsEl) lapsEl.innerHTML = '';
}

function updateToolGoal() {
  const target = parseInt(document.getElementById('tool-goal-target')?.value) || 1;
  const done   = parseInt(document.getElementById('tool-goal-done')?.value)   || 0;
  const pct    = Math.min(100, Math.round(done / target * 100));
  safeSetText('tool-goal-pct', pct + '%');
  safeSetText('tool-goal-sub', `${done} من ${target}`);
  const barEl = document.getElementById('tool-goal-bar');
  if (barEl) barEl.style.width = pct + '%';
  const pctEl = document.getElementById('tool-goal-pct');
  if (pctEl) pctEl.style.color = pct >= 100 ? 'var(--green)' : pct >= 60 ? 'var(--accent)' : 'var(--blue)';
}

function incrementGoalDone() {
  const inp = document.getElementById('tool-goal-done');
  if (inp) { inp.value = (parseInt(inp.value) || 0) + 1; updateToolGoal(); }
}

function saveToolGoal() {
  const tg = {
    name:   document.getElementById('tool-goal-name')?.value.trim(),
    target: parseInt(document.getElementById('tool-goal-target')?.value) || 20,
    done:   parseInt(document.getElementById('tool-goal-done')?.value)   || 0
  };
  localStorage.setItem('toolGoal', JSON.stringify(tg));
  showToast('تم حفظ الهدف ✓', 'success');
}

function toggleQTimer() {
  const qt = AppState.tools.qt;
  if (qt.running) {
    clearInterval(qt.interval); qt.running = false;
    safeSetText('qt-start-btn', '▶ ابدأ');
    const nextBtn = document.getElementById('qt-next-btn');
    if (nextBtn) nextBtn.disabled = true;
  } else {
    if (!qt.qIdx) {
      qt.perQ      = parseInt(document.getElementById('qt-secs')?.value)  || 30;
      qt.total     = parseInt(document.getElementById('qt-count')?.value) || 10;
      qt.qIdx      = 1; qt.remaining = qt.perQ;
    }
    qt.running = true;
    safeSetText('qt-start-btn', '⏸ إيقاف');
    const nextBtn = document.getElementById('qt-next-btn');
    if (nextBtn) nextBtn.disabled = false;
    qt.interval = setInterval(() => { qt.remaining--; updateQtDisplay(); if (qt.remaining <= 0) nextQTimer(); }, 1000);
  }
}

function nextQTimer() {
  const qt = AppState.tools.qt;
  qt.qIdx++;
  if (qt.qIdx > qt.total) {
    clearInterval(qt.interval); qt.running = false; qt.qIdx = 0;
    safeSetText('qt-start-btn', '▶ ابدأ');
    const nextBtn = document.getElementById('qt-next-btn');
    if (nextBtn) nextBtn.disabled = true;
    safeSetText('qt-label', '✅ انتهت الأسئلة!');
    showToast('✅ انتهت جميع الأسئلة!', 'success'); return;
  }
  qt.remaining = qt.perQ;
  showToast(`➡️ السؤال ${qt.qIdx}`, 'info'); updateQtDisplay();
}

function updateQtDisplay() {
  const qt  = AppState.tools.qt;
  const rem = qt.remaining, tot = qt.perQ || 1, pct = Math.max(0, rem / tot * 100);
  const el  = document.getElementById('qt-display');
  if (el) {
    el.textContent = fmtTime(rem);
    el.className   = 'tool-timer-val' + (rem <= 5 ? ' danger' : rem <= 10 ? ' warning' : '');
  }
  safeSetText('qt-label', qt.qIdx ? `سؤال ${qt.qIdx} / ${qt.total}` : 'جاهز');
  const barEl = document.getElementById('qt-bar');
  if (barEl) barEl.style.width = pct + '%';
}

function resetQTimer() {
  const qt = AppState.tools.qt;
  clearInterval(qt.interval); qt.running = false; qt.qIdx = 0; qt.remaining = 0;
  safeSetText('qt-start-btn', '▶ ابدأ');
  const nextBtn = document.getElementById('qt-next-btn');
  if (nextBtn) nextBtn.disabled = true;
  updateQtDisplay();
}
