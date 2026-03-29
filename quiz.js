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
