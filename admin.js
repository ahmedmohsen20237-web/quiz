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
