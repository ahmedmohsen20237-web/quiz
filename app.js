/* ============================================================
   app.js — منصة الوسام التعليمية
   جميع الميزات: تغيير الإجابة، التنقل الحر، مراجعة نهائية،
   تعديل الاختبارات، ملاحظات المعلم أثناء السؤال
============================================================ */

/* ── Firebase ── */
const FIREBASE_CONFIG = {
  apiKey:            "AIzaSyAek8K6nHzxAUiGM6ZvLfeFmzDsFjt1ABE",
  authDomain:        "my-quiz-platform-c1a08.firebaseapp.com",
  databaseURL:       "https://my-quiz-platform-c1a08-default-rtdb.europe-west1.firebasedatabase.app",
  projectId:         "my-quiz-platform-c1a08",
  storageBucket:     "my-quiz-platform-c1a08.firebasestorage.app",
  messagingSenderId: "361533364886",
  appId:             "1:361533364886:web:60875464941f706277c0b7"
};
firebase.initializeApp(FIREBASE_CONFIG);
const db   = firebase.database();
const auth = firebase.auth();

/* ── Auth State ── */
let currentUser   = null;
let isAdminMode   = false;
let authListeners = [];

function onAuthStateChange(cb) { authListeners.push(cb); }

auth.onAuthStateChanged(user => {
  currentUser = user;
  isAdminMode = !!user;
  if (user) {
    sessionStorage.setItem('adminMode','1');
    document.body.classList.add('admin-mode');
  } else {
    sessionStorage.removeItem('adminMode');
    document.body.classList.remove('admin-mode');
  }
  authListeners.forEach(cb => cb(user, isAdminMode));
});

/* ── Auth Functions ── */
async function adminSignIn(email, pw) {
  try { return await auth.signInWithEmailAndPassword(email, pw); }
  catch(e) { throw translateAuthError(e); }
}
async function adminSignOut() { await auth.signOut(); }

function translateAuthError(e) {
  const m = {
    'auth/invalid-email':'البريد الإلكتروني غير صالح',
    'auth/user-not-found':'المستخدم غير موجود',
    'auth/wrong-password':'كلمة المرور غير صحيحة',
    'auth/invalid-credential':'بيانات الاعتماد غير صحيحة',
    'auth/too-many-requests':'تم تجاوز عدد المحاولات',
    'auth/network-request-failed':'خطأ في الشبكة',
    'auth/user-disabled':'تم تعطيل هذا الحساب'
  };
  const err = new Error(m[e.code] || 'حدث خطأ في المصادقة');
  err.code = e.code; return err;
}

/* ── DB Helpers ── */
async function dbSaveQuiz(data) {
  if (!currentUser) throw new Error('يجب تسجيل الدخول كأدمن');
  const ref = await db.ref('quizzes').push(data);
  return ref.key;
}
async function dbUpdateQuiz(id, data) {
  if (!currentUser) throw new Error('يجب تسجيل الدخول كأدمن');
  await db.ref('quizzes/' + id).set(data);
}
async function dbDeleteQuiz(id) {
  if (!currentUser) throw new Error('يجب تسجيل الدخول كأدمن');
  await db.ref('quizzes/' + id).remove();
}
function dbListenQuizzes(cb, errCb) {
  db.ref('quizzes').on('value', snap => {
    const d = snap.val();
    cb(d ? Object.entries(d).map(([fid,qd])=>({...qd,firebaseId:fid,id:fid})) : []);
  }, e => { console.error(e); errCb && errCb(e); });
}
async function dbSaveAnalytics(qid, data) {
  try {
    const uid = currentUser ? currentUser.uid : 'anon_'+Date.now();
    await db.ref(`analytics/${qid}/${uid}`).set({...data, timestamp:Date.now()});
  } catch(e) { console.warn('Analytics:', e); }
}

/* ============================================================
   STATE
============================================================ */
const AppState = {
  tests:         [],
  errors:        JSON.parse(localStorage.getItem('quizErrors')    || '[]'),
  goal:          JSON.parse(localStorage.getItem('quizGoal')      || 'null'),
  scores:        JSON.parse(localStorage.getItem('quizScores')    || '{}'),
  adminSettings: JSON.parse(localStorage.getItem('adminSettings') || '{"categorizedErrors":false,"showNotesLive":true}'),
  progress:      JSON.parse(localStorage.getItem('quizProgress')  || '{}'),

  /* Quiz session */
  currentTest:   null,
  currentQ:      0,
  userAnswers:   [],  /* null=لم يُجب، -1=تخطي، رقم=إجابة */
  timerInterval: null,
  elapsedSecs:   0,

  /* Admin */
  builderQuestions: [],
  parsedQuestions:  [],
  editingQuizId:    null,
  editQuestions:    [],
  pendingDeleteId:  null,
  deleteMode:       'test',

  /* Pomodoro */
  pomodoro: { running:false, phase:'focus', focusMins:25, breakMins:5, totalSessions:4, currentSession:1, completedSessions:0, remaining:25*60, interval:null },

  /* Tools */
  tools: {
    cd: { running:false, interval:null, remaining:0, total:0 },
    sw: { running:false, interval:null, elapsed:0, laps:[] },
    qt: { running:false, interval:null, remaining:0, qIdx:0, total:0, perQ:0 }
  }
};

/* ============================================================
   UTILITIES
============================================================ */
function escapeHtml(s) {
  if (!s && s!==0) return '';
  return String(s).replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
}
function fmtTime(s) { const t=Math.max(0,s); return String(Math.floor(t/60)).padStart(2,'0')+':'+String(t%60).padStart(2,'0'); }
function $id(id) { return document.getElementById(id); }
function setText(id,v) { const e=$id(id); if(e) e.textContent=v; }
function setVal(id,v)  { const e=$id(id); if(e) e.value=v; }
function openModal(id)  { const e=$id(id); if(e) e.classList.add('open'); }
function closeModal(id) {
  const e=$id(id);
  if(e){ e.classList.add('closing'); setTimeout(()=>e.classList.remove('open','closing'),200); }
}
function persistAll() {
  localStorage.setItem('quizScores', JSON.stringify(AppState.scores));
  localStorage.setItem('quizErrors', JSON.stringify(AppState.errors));
}

/* ── Toast ── */
const TICONS = { success:'✅', error:'❌', info:'ℹ️', warning:'⚠️' };
function showToast(msg, type='success', dur=3500) {
  const tc=$id('toast-container'); if(!tc) return;
  const t=document.createElement('div');
  t.className='toast '+type;
  t.innerHTML=`<span class="toast-icon">${TICONS[type]||''}</span><span>${escapeHtml(msg)}</span>`;
  tc.appendChild(t);
  setTimeout(()=>{ t.style.animation='toastOut .3s ease forwards'; setTimeout(()=>t.remove(),300); },dur);
}

/* ── Loading ── */
function showLoadingScreen() { const e=$id('loading-screen'); if(e) e.classList.remove('hidden','fade-out'); }
function hideLoadingScreen() { const e=$id('loading-screen'); if(e){ e.classList.add('fade-out'); setTimeout(()=>e.classList.add('hidden'),600); } }

/* ── Theme ── */
function initTheme() { applyTheme(localStorage.getItem('sitetheme')||'dark'); }
function applyTheme(t) {
  const icon=$id('theme-icon');
  if(t==='light') { document.body.classList.add('light-mode'); if(icon) icon.className='fa-solid fa-moon'; }
  else            { document.body.classList.remove('light-mode'); if(icon) icon.className='fa-solid fa-sun'; }
  localStorage.setItem('sitetheme',t);
}
function toggleTheme() { applyTheme(document.body.classList.contains('light-mode')?'dark':'light'); }

/* ── Modal backdrop ── */
document.addEventListener('click', e => {
  if(e.target.classList.contains('modal-overlay') && e.target.classList.contains('open') && e.target.id!=='admin-login-modal')
    closeModal(e.target.id);
});

/* ============================================================
   NAVIGATION
============================================================ */
function showPage(name) {
  if(name==='admin' && !isAdminMode) { openAdminLoginModal(); return; }
  document.querySelectorAll('.page').forEach(p=>p.classList.remove('active'));
  const t=$id('page-'+name); if(!t) return;
  t.classList.add('active');
  const inits = { home:renderHome, errors:renderErrors, admin:()=>{renderManageList();loadAdminSettings();}, tools:initToolsPage, results:()=>{} };
  if(inits[name]) inits[name]();
  window.scrollTo({top:0,behavior:'smooth'});
}

/* ============================================================
   HOME
============================================================ */
function renderHome() {
  const {tests,scores,errors,goal} = AppState;
  const done=Object.keys(scores).length;
  const vals=Object.values(scores);
  const avg=vals.length?Math.round(vals.reduce((a,b)=>a+b,0)/vals.length):null;
  setText('stat-total', tests.length);
  setText('stat-done',  done);
  setText('stat-avg',   avg!==null?avg+'%':'—');
  setText('stat-errors',errors.length);
  renderGoal(done);
  renderTestsGrid();
}
function renderGoal(done) {
  const g=AppState.goal; if(!g) return;
  const pct=g.target?Math.min(100,Math.round(done/g.target*100)):0;
  setText('goal-title',    g.name||'هدفي');
  setText('goal-desc',     pct+'% من الهدف مكتمل');
  setText('goal-done-lbl', done+' مكتمل');
  setText('goal-target-lbl','الهدف: '+(g.target||'—'));
  const b=$id('goal-bar'); if(b) b.style.width=pct+'%';
}
function renderTestsGrid() {
  const {tests,scores}=AppState;
  const grid=$id('tests-grid'); if(!grid) return;
  const frag=document.createDocumentFragment();
  if(!tests.length) {
    const e=document.createElement('div'); e.className='quizzes-empty';
    e.innerHTML='<div class="empty-icon">📭</div><h3>لا توجد اختبارات بعد</h3><p>أضف اختباراً جديداً من لوحة الإدارة</p>';
    frag.appendChild(e);
  }
  tests.forEach((t,idx)=>{
    const sc=scores[t.id];
    let badge='<span class="test-badge badge-new">جديد</span>';
    let bar='';
    if(sc!==undefined) {
      badge=sc>=70?'<span class="test-badge badge-done">مكتمل ✓</span>':'<span class="test-badge badge-retry">راجع أخطاءك</span>';
      const cls=sc>=80?'fill-green':sc>=60?'fill-yellow':'fill-red';
      bar=`<div class="test-score-bar"><div class="test-score-fill ${cls}" style="width:${sc}%"></div></div>`;
    }
    const card=document.createElement('div');
    card.className='test-card'; card.onclick=()=>startQuiz(t.firebaseId);
    card.innerHTML=`
      <button class="test-card-del admin-only-inline" onclick="event.stopPropagation();requestDeleteTest('${t.firebaseId}')">🗑️ حذف</button>
      <div class="test-card-top"><div class="test-num">${idx+1}</div>${badge}</div>
      <div class="test-title">${escapeHtml(t.name)}</div>
      <div class="test-meta">
        <span>📝 ${t.questions?.length||0} سؤال</span>
        <span>⏱️ ${t.timeLimit?t.timeLimit+' دقيقة':'بلا حد'}</span>
        ${t.subject?`<span>📚 ${escapeHtml(t.subject)}</span>`:''}
        ${sc!==undefined?`<span style="color:${sc>=70?'var(--green)':sc>=50?'var(--accent)':'var(--red)'}">🎯 ${sc}%</span>`:''}
      </div>${bar}`;
    frag.appendChild(card);
  });
  if(isAdminMode) {
    const a=document.createElement('div'); a.className='add-card'; a.onclick=()=>showPage('admin');
    a.innerHTML='<span style="font-size:1.4rem">➕</span><span>أضف اختباراً جديداً</span>';
    frag.appendChild(a);
  }
  grid.innerHTML=''; grid.appendChild(frag);
}

/* ── Goal ── */
function openGoalModal() {
  const g=AppState.goal;
  if(g){ setVal('goal-name-input',g.name||''); setVal('goal-target-input',g.target||''); }
  openModal('goal-modal');
}
function saveGoal() {
  const name=$id('goal-name-input')?.value.trim();
  const target=parseInt($id('goal-target-input')?.value)||0;
  AppState.goal={name:name||'هدفي',target};
  localStorage.setItem('quizGoal',JSON.stringify(AppState.goal));
  closeModal('goal-modal'); renderHome(); showToast('تم حفظ هدفك ✓');
}

/* ── Delete ── */
function requestDeleteTest(fid) {
  if(!isAdminMode){ showToast('يجب تسجيل الدخول كأدمن','error'); return; }
  const t=AppState.tests.find(x=>x.firebaseId===fid); if(!t) return;
  AppState.pendingDeleteId=fid; AppState.deleteMode='test';
  setText('delete-modal-name',t.name); openModal('delete-modal');
}
function clearErrors() {
  if(!AppState.errors.length) return;
  AppState.deleteMode='errors';
  setText('delete-modal-name','جميع الأخطاء المسجّلة'); openModal('delete-modal');
}
async function confirmDeleteTest() {
  closeModal('delete-modal');
  if(AppState.deleteMode==='test' && AppState.pendingDeleteId) {
    try {
      await dbDeleteQuiz(AppState.pendingDeleteId);
      delete AppState.scores[AppState.pendingDeleteId];
      AppState.errors=AppState.errors.filter(e=>e.testId!==AppState.pendingDeleteId);
      persistAll(); showToast('تم حذف الاختبار نهائياً');
    } catch(e){ showToast(e.message||'فشل الحذف','error'); }
  } else if(AppState.deleteMode==='errors') {
    AppState.errors=[]; localStorage.setItem('quizErrors','[]');
    renderErrors(); renderHome(); showToast('تم مسح مجلد الأخطاء');
  }
  AppState.pendingDeleteId=null;
}

/* ── Firebase Listener ── */
function attachFirebaseListener() {
  showLoadingScreen();
  dbListenQuizzes(tests=>{
    AppState.tests=tests; renderHome();
    const ap=$id('page-admin'), mt=$id('admin-manage');
    if(ap?.classList.contains('active') && mt?.classList.contains('active')) renderManageList();
    hideLoadingScreen();
  }, ()=>{ showToast('خطأ في الاتصال بقاعدة البيانات','error'); hideLoadingScreen(); });
}

/* ── Init ── */
function initApp() {
  initTheme(); updatePomoSettings(); attachFirebaseListener();
  onAuthStateChange((user,isAdmin)=>{
    applyAdminUI(user,isAdmin);
    if($id('page-home')?.classList.contains('active')) renderHome();
  });
}
document.addEventListener('DOMContentLoaded', initApp);

/* ============================================================
   ADMIN AUTH
============================================================ */
function applyAdminUI(user,isAdmin) {
  const bar=$id('admin-mode-bar'), lb=$id('admin-login-btn'), li=$id('admin-lock-icon'), ab=$id('nav-admin-btn');
  document.querySelectorAll('.admin-only-inline').forEach(e=>e.style.display=isAdmin?'':'none');
  if(isAdmin) {
    document.body.classList.add('admin-mode');
    bar?.classList.add('visible'); lb?.classList.add('active-admin');
    if(li) li.className='fa-solid fa-unlock'; if(lb) lb.title='وضع الأدمن — انقر للخروج';
    if(ab) ab.style.display='flex'; setText('admin-user-email',user?.email||'');
  } else {
    document.body.classList.remove('admin-mode');
    bar?.classList.remove('visible'); lb?.classList.remove('active-admin');
    if(li) li.className='fa-solid fa-lock'; if(lb) lb.title='دخول الأدمن';
    if(ab) ab.style.display='none';
  }
}
function openAdminLoginModal() {
  if(isAdminMode){ if(confirm('هل تريد تسجيل الخروج؟')) logoutAdmin(); return; }
  setVal('admin-email-input',''); setVal('admin-password-input','');
  const e=$id('admin-login-error'); if(e){ e.style.display='none'; e.textContent=''; }
  openModal('admin-login-modal'); setTimeout(()=>$id('admin-email-input')?.focus(),120);
}
function handleAdminLogin() { openAdminLoginModal(); }
async function verifyAdminLogin() {
  const email=$id('admin-email-input')?.value.trim();
  const pw=$id('admin-password-input')?.value;
  const btn=$id('admin-login-submit-btn');
  if(!email||!pw){ showLoginError('يرجى إدخال البريد وكلمة المرور'); return; }
  if(btn){ btn.disabled=true; btn.textContent='جارٍ التحقق...'; }
  try {
    await adminSignIn(email,pw);
    closeModal('admin-login-modal'); showToast('✅ مرحباً في وضع الأدمن');
  } catch(e){ showLoginError(e.message||'فشل تسجيل الدخول'); }
  finally{ if(btn){ btn.disabled=false; btn.textContent='دخول'; } }
}
function showLoginError(msg) {
  const e=$id('admin-login-error'); if(e){ e.textContent='❌ '+msg; e.style.display='block'; }
}
async function logoutAdmin() {
  try{ await adminSignOut(); showPage('home'); showToast('🔒 تم تسجيل الخروج','info'); }
  catch(e){ showToast('فشل تسجيل الخروج','error'); }
}
document.addEventListener('keydown',e=>{
  const m=$id('admin-login-modal');
  if(e.key==='Enter' && m?.classList.contains('open')) verifyAdminLogin();
});

/* ── Admin Settings ── */
function loadAdminSettings() {
  const s=AppState.adminSettings;
  const c=$id('setting-categorized-errors'), n=$id('setting-show-notes-live');
  if(c) c.checked=!!s.categorizedErrors;
  if(n) n.checked=s.showNotesLive!==false;
}
function saveAdminSettings() {
  AppState.adminSettings.categorizedErrors=$id('setting-categorized-errors')?.checked||false;
  AppState.adminSettings.showNotesLive=$id('setting-show-notes-live')?.checked!==false;
  localStorage.setItem('adminSettings',JSON.stringify(AppState.adminSettings));
  showToast('تم حفظ الإعدادات ✓');
}
function switchAdminTab(tab,ev) {
  document.querySelectorAll('.admin-tab').forEach(t=>t.classList.remove('active'));
  document.querySelectorAll('.admin-tab-content').forEach(c=>c.classList.remove('active'));
  if(ev?.currentTarget) ev.currentTarget.classList.add('active');
  $id('admin-'+tab)?.classList.add('active');
  if(tab==='manage') renderManageList();
  if(tab==='settings') loadAdminSettings();
}

/* ── Manage List ── */
function renderManageList() {
  const c=$id('manage-list'); if(!c) return;
  const {tests,scores}=AppState;
  if(!tests.length){ c.innerHTML='<div class="empty-state"><div class="icon">📭</div><p>لا توجد اختبارات بعد</p></div>'; return; }
  const w=document.createElement('div'); w.style.cssText='display:flex;flex-direction:column;gap:8px;';
  tests.forEach(t=>{
    const sc=scores[t.id];
    const item=document.createElement('div'); item.className='manage-item';
    item.innerHTML=`
      <div class="manage-item-info">
        <div class="manage-item-name">${escapeHtml(t.name)}</div>
        <div class="manage-item-meta">${t.questions?.length||0} سؤال • ${t.timeLimit||0} دقيقة${sc!==undefined?' • آخر درجة: '+sc+'%':''}</div>
      </div>
      <div class="manage-item-actions">
        <button onclick="startQuiz('${t.firebaseId}')" class="btn btn-primary" style="font-size:0.8rem;padding:8px 12px">▶️ تشغيل</button>
        <button onclick="openEditQuiz('${t.firebaseId}')" class="btn btn-secondary" style="font-size:0.8rem;padding:8px 12px;color:var(--accent)">✏️ تعديل</button>
        <button onclick="requestDeleteTest('${t.firebaseId}')" class="btn btn-secondary" style="font-size:0.8rem;padding:8px 12px;color:var(--red)">🗑️ حذف</button>
      </div>`;
    w.appendChild(item);
  });
  c.innerHTML=''; c.appendChild(w);
}

/* ============================================================
   QUIZ BUILDER (إضافة/تعديل)
============================================================ */
function addQuestionBuilder(data) {
  AppState.builderQuestions.push(data||{text:'',choices:['','','',''],correct:0,correctAnswers:[0],multiCorrect:false,note:''});
  renderBuilder();
}
function renderBuilderTo(questions, containerId) {
  const container=$id(containerId); if(!container) return;
  const letters=['أ','ب','ج','د'];
  const frag=document.createDocumentFragment();
  questions.forEach((q,qi)=>{
    const item=document.createElement('div'); item.className='q-builder-item';
    const isMulti=q.multiCorrect;
    let ch='';
    q.choices.forEach((c,ci)=>{
      const iType=isMulti?'checkbox':'radio', iClass=isMulti?'choice-checkbox':'choice-radio';
      const checked=isMulti?(Array.isArray(q.correctAnswers)&&q.correctAnswers.includes(ci)):(q.correct===ci);
      ch+=`<div class="choice-builder-row">
        <input type="${iType}" class="${iClass}" name="bq-correct-${containerId}-${qi}" ${checked?'checked':''}
          onchange="builderSetCorrect('${containerId}',${qi},${ci},this.checked,${isMulti})"/>
        <input class="form-input" placeholder="${letters[ci]||ci+1}..." value="${escapeHtml(c||'')}"
          oninput="getBuilderQuestions('${containerId}')[${qi}].choices[${ci}]=this.value;updateAnswerMapIfExists()"
          style="flex:1"/>
      </div>`;
    });
    item.innerHTML=`
      <div class="q-builder-header">
        <span class="q-builder-num">سؤال ${qi+1} ${isMulti?'<span class="multi-badge">متعدد الإجابات</span>':''}</span>
        <div class="q-builder-actions">
          <button class="q-multi-btn ${isMulti?'active':''}" onclick="toggleBuilderMulti('${containerId}',${qi})" title="تفعيل/إلغاء تعدد الإجابات الصحيحة">
            ${isMulti?'☑️ متعدد':'☐ إجابة واحدة'}
          </button>
          <button class="q-del-btn" onclick="deleteBuilderQ('${containerId}',${qi})">حذف</button>
        </div>
      </div>
      <input class="form-input" placeholder="نص السؤال..." value="${escapeHtml(q.text||'')}"
        oninput="getBuilderQuestions('${containerId}')[${qi}].text=this.value;updateAnswerMapIfExists()"
        style="margin-bottom:9px"/>
      <div class="choices-builder" id="${containerId}-choices-${qi}">${ch}</div>
      <textarea class="q-note-input" placeholder="ملاحظة المعلم (تظهر للطالب أثناء السؤال إن فعّلتها)..."
        oninput="getBuilderQuestions('${containerId}')[${qi}].note=this.value"
      >${escapeHtml(q.note||'')}</textarea>`;
    frag.appendChild(item);
  });
  container.innerHTML=''; container.appendChild(frag);
  if(containerId==='questions-builder') renderAnswerMap();
}
function renderBuilder() { renderBuilderTo(AppState.builderQuestions,'questions-builder'); }

/* helper: الحصول على مصفوفة الأسئلة حسب الـ containerId */
function getBuilderQuestions(cid) {
  return cid==='edit-questions-builder' ? AppState.editQuestions : AppState.builderQuestions;
}
function updateAnswerMapIfExists() { if($id('answer-map-section')) renderAnswerMap(); }

/* تبديل تعدد الإجابات */
function toggleBuilderMulti(cid, qi) {
  const qs=getBuilderQuestions(cid);
  qs[qi].multiCorrect=!qs[qi].multiCorrect;
  qs[qi].correctAnswers=[qs[qi].correct||0];
  renderBuilderTo(qs, cid);
}

function builderSetCorrect(cid, qi, ci, checked, isMulti) {
  const qs=getBuilderQuestions(cid); const q=qs[qi];
  if(isMulti) {
    if(!Array.isArray(q.correctAnswers)) q.correctAnswers=[];
    if(checked){ if(!q.correctAnswers.includes(ci)) q.correctAnswers.push(ci); }
    else{ q.correctAnswers=q.correctAnswers.filter(x=>x!==ci); if(!q.correctAnswers.length) q.correctAnswers=[ci]; }
    q.correct=q.correctAnswers[0];
  } else { q.correct=ci; q.correctAnswers=[ci]; }
  if(cid==='questions-builder') updateAnswerMapIfExists();
}
function deleteBuilderQ(cid, i) {
  const qs=getBuilderQuestions(cid); qs.splice(i,1); renderBuilderTo(qs,cid);
}

/* Answer Map */
function renderAnswerMap() {
  const sec=$id('answer-map-section'), grid=$id('answer-map-grid');
  if(!sec||!grid) return;
  const qs=AppState.builderQuestions;
  if(!qs.length){ sec.style.display='none'; return; }
  sec.style.display='block';
  const letters=['أ','ب','ج','د','هـ','و'];
  const frag=document.createDocumentFragment();
  qs.forEach((q,qi)=>{
    const row=document.createElement('div'); row.className='answer-map-row'; row.dataset.qidx=qi;
    let opts=''; q.choices.forEach((c,ci)=>{ opts+=`<option value="${ci}" ${q.correct===ci?'selected':''}>${letters[ci]||ci+1}</option>`; });
    row.innerHTML=`<div class="answer-map-qnum">${qi+1}</div>
      <div class="answer-map-qtext">${escapeHtml(q.text||'(بدون نص)')}</div>
      <select class="answer-map-select ${q.correct>=0?'matched':''}"
        onchange="AppState.builderQuestions[${qi}].correct=parseInt(this.value);AppState.builderQuestions[${qi}].correctAnswers=[parseInt(this.value)]">${opts}</select>`;
    frag.appendChild(row);
  });
  grid.innerHTML=''; grid.appendChild(frag);
}

/* ── حفظ اختبار جديد ── */
async function saveTest() {
  if(!isAdminMode){ showToast('يجب تسجيل الدخول كأدمن','error'); return; }
  const name=$id('new-test-name')?.value.trim();
  if(!name){ showToast('أدخل اسم الاختبار','error'); return; }
  if(!AppState.builderQuestions.length){ showToast('أضف سؤالاً على الأقل','error'); return; }
  if(!AppState.builderQuestions.every(q=>q.text.trim()&&q.choices.every(c=>c.trim()))){
    showToast('أكمل جميع الأسئلة والخيارات','error'); return;
  }
  const data={
    name, subject:$id('new-test-subject')?.value.trim()||'',
    timeLimit:parseInt($id('new-test-time')?.value)||0,
    questions:AppState.builderQuestions.map(q=>({
      text:q.text, choices:[...q.choices],
      correctAnswers:q.correctAnswers?.length?q.correctAnswers:[q.correct],
      correct:q.correctAnswers?.length?q.correctAnswers[0]:q.correct,
      multiCorrect:q.multiCorrect||false, note:q.note||''
    })), createdAt:Date.now()
  };
  const btn=$id('save-test-btn');
  if(btn){ btn.disabled=true; btn.textContent='جارٍ الحفظ...'; }
  try {
    await dbSaveQuiz(data); showToast('تم حفظ الاختبار ✓');
    setVal('new-test-name',''); setVal('new-test-subject',''); setVal('new-test-time','10');
    AppState.builderQuestions=[]; renderBuilder();
    setTimeout(()=>showPage('home'),900);
  } catch(e){ showToast(e.message||'حدث خطأ','error'); }
  finally{ if(btn){ btn.disabled=false; btn.textContent='💾 حفظ الاختبار'; } }
}

/* ============================================================
   تعديل الاختبارات المحفوظة
============================================================ */
function openEditQuiz(fid) {
  const test=AppState.tests.find(t=>t.firebaseId===fid); if(!test) return;
  AppState.editingQuizId=fid;
  AppState.editQuestions=test.questions.map(q=>({...q, choices:[...q.choices], correctAnswers:[...(q.correctAnswers||[q.correct||0])]}));
  setVal('edit-test-name',    test.name||'');
  setVal('edit-test-subject', test.subject||'');
  setVal('edit-test-time',    test.timeLimit||0);
  renderBuilderTo(AppState.editQuestions, 'edit-questions-builder');
  openModal('edit-quiz-modal');
}
function addEditQuestion() {
  AppState.editQuestions.push({text:'',choices:['','','',''],correct:0,correctAnswers:[0],multiCorrect:false,note:''});
  renderBuilderTo(AppState.editQuestions,'edit-questions-builder');
}
async function saveEditedQuiz() {
  if(!isAdminMode){ showToast('يجب تسجيل الدخول كأدمن','error'); return; }
  const name=$id('edit-test-name')?.value.trim();
  if(!name){ showToast('أدخل اسم الاختبار','error'); return; }
  if(!AppState.editQuestions.length){ showToast('أضف سؤالاً على الأقل','error'); return; }
  const oldTest=AppState.tests.find(t=>t.firebaseId===AppState.editingQuizId);
  const data={
    name, subject:$id('edit-test-subject')?.value.trim()||'',
    timeLimit:parseInt($id('edit-test-time')?.value)||0,
    questions:AppState.editQuestions.map(q=>({
      text:q.text, choices:[...q.choices],
      correctAnswers:q.correctAnswers?.length?q.correctAnswers:[q.correct],
      correct:q.correctAnswers?.length?q.correctAnswers[0]:q.correct,
      multiCorrect:q.multiCorrect||false, note:q.note||''
    })),
    createdAt:oldTest?.createdAt||Date.now(), updatedAt:Date.now()
  };
  const btn=$id('save-edit-btn');
  if(btn){ btn.disabled=true; btn.textContent='جارٍ الحفظ...'; }
  try {
    await dbUpdateQuiz(AppState.editingQuizId, data);
    closeModal('edit-quiz-modal'); showToast('تم حفظ التعديلات ✓');
    AppState.editingQuizId=null; AppState.editQuestions=[];
  } catch(e){ showToast(e.message||'حدث خطأ','error'); }
  finally{ if(btn){ btn.disabled=false; btn.textContent='💾 حفظ التعديلات'; } }
}

/* ============================================================
   SMART PARSER
============================================================ */
function smartParseText(raw) {
  let txt=raw.replace(/\r\n|\r/g,'\n').replace(/[\u200B-\u200D\uFEFF]/g,'')
    .replace(/[أإآ]/g,'أ').replace(/ﻻ/g,'لا')
    .replace(/[١٢٣٤٥٦٧٨٩٠]/g,d=>'٠١٢٣٤٥٦٧٨٩'.indexOf(d))
    .replace(/\t/g,' ').replace(/ {2,}/g,' ');
  const lines=txt.split('\n').map(l=>l.trim());
  const RX_Q=/^(?:س(?:ؤال)?\s*\d*\s*[:.)]\s*|Q\s*\d*\s*[:.)]\s*|\d+\s*[.)]\s*(?!\s*[أبجدهوABCDa-f]\s*[.)]))(.+)/i;
  const RX_C=/^(?:([أبجدهوABCDEFa-f])\s*[.):\-]\s*|(\d+)\s*[.)\-]\s*([أبجدهو])\s*[.):\-]?\s*|[•▪▸\-*]\s*)(.+)/i;
  const qs=[]; let cur=null;
  function push(){ if(cur&&cur.text.trim()&&cur.choices.length>=2) qs.push(cur); cur=null; }
  lines.forEach(l=>{
    if(!l) return;
    const qm=l.match(RX_Q), cm=l.match(RX_C);
    const qt=qm?qm[1].trim():(l.endsWith('؟')||l.endsWith('?'))?l:null;
    const ct=cm?cm[cm.length-1].trim():null;
    if(qt&&!ct){ push(); cur={text:qt,choices:[],correctAnswers:[0],note:''}; }
    else if(ct&&cur) cur.choices.push(ct);
    else if(ct&&!cur&&qs.length) qs[qs.length-1].choices.push(ct);
    else if(cur){ if(!cur.choices.length) cur.text+=' '+l; else if(l.length<120&&!l.match(RX_Q)) cur.choices[cur.choices.length-1]+=' '+l; }
    else if(l.endsWith('؟')||l.endsWith('?')){ push(); cur={text:l,choices:[],correctAnswers:[0],note:''}; }
  });
  push();
  return qs.filter(q=>q.choices.length>=2).map(q=>({...q,text:q.text.trim(),choices:q.choices.map(c=>c.trim()).filter(c=>c)}));
}
function applyBulkAnswers(bulk) {
  const parts=bulk.replace(/،/g,',').split(/[\s,]+/).map(p=>p.trim()).filter(Boolean);
  const M={'أ':1,'ا':1,'A':1,'a':1,'1':1,'ب':2,'B':2,'b':2,'2':2,'ج':3,'C':3,'c':3,'3':3,'د':4,'D':4,'d':4,'4':4,'ه':5,'هـ':5,'E':5,'e':5,'5':5,'و':6,'F':6,'f':6,'6':6};
  parts.forEach((p,i)=>{
    if(i>=AppState.parsedQuestions.length) return;
    const idx=(M[p]||parseInt(p)||1)-1;
    if(idx>=0){ AppState.parsedQuestions[i].correctAnswers=[idx]; AppState.parsedQuestions[i].correct=idx; }
  });
  showToast('تم تعيين الإجابات تلقائياً ✓');
}
function parseQuestions() {
  const raw=$id('parse-input')?.value.trim();
  if(!raw){ showToast('الصق نصاً أولاً','error'); return; }
  AppState.parsedQuestions=smartParseText(raw);
  if(!AppState.parsedQuestions.length){ showToast('لم يتم التعرف على أسئلة','error'); return; }
  const bulk=$id('bulk-answers-input')?.value.trim();
  if(bulk) applyBulkAnswers(bulk);
  renderParsedQuestions(); showToast(`تم التعرف على ${AppState.parsedQuestions.length} سؤال ✓`);
}
function renderParsedQuestions() {
  const pr=$id('parse-preview'), list=$id('parse-questions-list');
  if(!pr||!list) return;
  const letters=['أ','ب','ج','د','هـ','و'];
  pr.style.display='block';
  setText('parse-preview-title',`✅ تم التحليل — حدد الإجابة الصحيحة لكل سؤال (${AppState.parsedQuestions.length} سؤال)`);
  const frag=document.createDocumentFragment();
  AppState.parsedQuestions.forEach((q,qi)=>{
    const item=document.createElement('div'); item.className='parsed-q-item';
    let ch='';
    q.choices.forEach((c,ci)=>{
      const checked=(q.correctAnswers||[q.correct||0]).includes(ci)?'checked':'';
      ch+=`<label class="parsed-choice-row"><input type="checkbox" ${checked} onchange="toggleParsedCorrect(${qi},${ci},this.checked)"><span>${letters[ci]||ci+1}. ${escapeHtml(c)}</span></label>`;
    });
    item.innerHTML=`<div class="parsed-q-text">${qi+1}. ${escapeHtml(q.text)}</div><div class="parsed-choices">${ch}</div>
      <textarea class="parsed-note-input" placeholder="ملاحظة المعلم..." oninput="AppState.parsedQuestions[${qi}].note=this.value">${escapeHtml(q.note||'')}</textarea>`;
    frag.appendChild(item);
  });
  list.innerHTML=''; list.appendChild(frag);
}
function toggleParsedCorrect(qi,ci,checked) {
  const q=AppState.parsedQuestions[qi]; if(!q) return;
  if(!Array.isArray(q.correctAnswers)) q.correctAnswers=[q.correct||0];
  if(checked){ if(!q.correctAnswers.includes(ci)) q.correctAnswers.push(ci); }
  else{ q.correctAnswers=q.correctAnswers.filter(x=>x!==ci); if(!q.correctAnswers.length) q.correctAnswers=[ci]; }
  q.correct=q.correctAnswers[0];
}
async function saveParsedTest() {
  if(!isAdminMode){ showToast('يجب تسجيل الدخول كأدمن','error'); return; }
  const name=$id('parse-test-name')?.value.trim();
  if(!name){ showToast('أدخل اسم الاختبار','error'); return; }
  if(!AppState.parsedQuestions.length){ showToast('لا توجد أسئلة','error'); return; }
  const data={
    name, subject:$id('parse-test-subject')?.value.trim()||'',
    timeLimit:parseInt($id('parse-test-time')?.value)||0,
    questions:AppState.parsedQuestions.map(q=>({
      text:q.text, choices:[...q.choices],
      correctAnswers:q.correctAnswers||[q.correct||0],
      correct:(q.correctAnswers||[q.correct||0])[0],
      multiCorrect:(q.correctAnswers||[]).length>1, note:q.note||''
    })), createdAt:Date.now()
  };
  const btn=$id('save-parsed-btn');
  if(btn){ btn.disabled=true; btn.textContent='جارٍ الحفظ...'; }
  try {
    await dbSaveQuiz(data); showToast(`تم حفظ "${name}" ✓`);
    setVal('parse-input',''); setVal('bulk-answers-input',''); setVal('parse-test-name',''); setVal('parse-test-subject','');
    const pr=$id('parse-preview'); if(pr) pr.style.display='none';
    AppState.parsedQuestions=[]; setTimeout(()=>showPage('home'),900);
  } catch(e){ showToast(e.message||'حدث خطأ','error'); }
  finally{ if(btn){ btn.disabled=false; btn.textContent='💾 حفظ الاختبار'; } }
}

/* ============================================================
   QUIZ ENGINE
   - الطالب يختار إجابة واحدة فقط (حتى لو المعلم حدد إجابات متعددة)
   - أي إجابة صحيحة تُعتبر صحيحة
   - يمكن تغيير الإجابة في أي وقت قبل الانتقال
   - التنقل الحر بين الأسئلة
   - ملاحظة المعلم تظهر مع السؤال مباشرة
============================================================ */
function getCorrectAnswers(q) {
  if(Array.isArray(q.correctAnswers)&&q.correctAnswers.length) return q.correctAnswers;
  if(typeof q.correct==='number') return [q.correct];
  return [0];
}
function isAnswerCorrect(q,ua) {
  const correct=getCorrectAnswers(q);
  if(ua===null||ua===undefined||ua===-1) return false;
  const a=Array.isArray(ua)?ua[0]:ua;
  return correct.includes(a);
}

/* ── بدء الاختبار ── */
function startQuiz(fid) {
  const test=AppState.tests.find(t=>t.firebaseId===fid);
  if(!test?.questions?.length){ showToast('هذا الاختبار لا يحتوي على أسئلة!','error'); return; }
  const saved=AppState.progress[fid];
  if(saved&&saved.answers?.some(a=>a!==null)) {
    if(confirm('لديك تقدم محفوظ. هل تريد الاستمرار من حيث توقفت؟')){ resumeQuiz(test,saved); return; }
  }
  initQuizSession(test);
}
function startCustomQuiz(questions,title) {
  if(!questions.length){ showToast('لا توجد أسئلة','error'); return; }
  initQuizSession({id:'__practice__',firebaseId:'__practice__',name:title,subject:'تدريب الأخطاء',timeLimit:0,questions});
}
function initQuizSession(test) {
  AppState.currentTest=test; AppState.currentQ=0;
  AppState.userAnswers=new Array(test.questions.length).fill(null);
  AppState.elapsedSecs=0;
  showPage('quiz');
  setText('quiz-title',    test.name);
  setText('quiz-subtitle', (test.subject?escapeHtml(test.subject):'')+' • '+test.questions.length+' سؤال');
  startTimer(); renderQuestion(); renderNavStrip();
}
function resumeQuiz(test,saved) {
  AppState.currentTest=test; AppState.currentQ=saved.currentQ||0;
  AppState.userAnswers=saved.answers||new Array(test.questions.length).fill(null);
  AppState.elapsedSecs=saved.elapsed||0;
  showPage('quiz');
  setText('quiz-title',    test.name);
  setText('quiz-subtitle', (test.subject?escapeHtml(test.subject):'')+' • '+test.questions.length+' سؤال');
  startTimer(); renderQuestion(); renderNavStrip();
  showToast('استُؤنف الاختبار ✓','info');
}

/* ── Timer ── */
function startTimer() {
  clearInterval(AppState.timerInterval);
  const limit=(AppState.currentTest.timeLimit||0)*60;
  const pill=$id('timer-pill');
  AppState.timerInterval=setInterval(()=>{
    AppState.elapsedSecs++;
    if(AppState.elapsedSecs%30===0) saveProgress();
    if(limit>0) {
      const rem=limit-AppState.elapsedSecs;
      if(rem<=0){ clearInterval(AppState.timerInterval); submitQuiz(); return; }
      if(pill){ pill.className='timer-pill'+(rem<=60?' danger':rem<=120?' warning':''); pill.innerHTML=`⏱️ <span>${fmtTime(rem)}</span>`; }
    } else {
      if(pill) pill.innerHTML=`⏱️ <span>${fmtTime(AppState.elapsedSecs)}</span>`;
    }
  },1000);
}

/* ── Progress Save ── */
function saveProgress() {
  const {currentTest,currentQ,userAnswers,elapsedSecs}=AppState;
  if(!currentTest||currentTest.id==='__practice__') return;
  AppState.progress[currentTest.id]={currentQ,answers:[...userAnswers],elapsed:elapsedSecs};
  localStorage.setItem('quizProgress',JSON.stringify(AppState.progress));
}
function clearProgress(tid) { delete AppState.progress[tid]; localStorage.setItem('quizProgress',JSON.stringify(AppState.progress)); }

/* ── شريط التنقل ── */
function renderNavStrip() {
  const strip=$id('q-nav-strip'); if(!strip) return;
  const {currentTest,currentQ,userAnswers}=AppState;
  strip.innerHTML='';
  currentTest.questions.forEach((_,i)=>{
    const d=document.createElement('div');
    const ua=userAnswers[i];
    let cls='unanswered';
    if(i===currentQ) cls='current';
    else if(ua===-1) cls='skipped';
    else if(ua!==null) cls='answered';
    d.className='q-nav-dot '+cls;
    d.textContent=i+1;
    d.title=`السؤال ${i+1}`;
    d.onclick=()=>jumpToQuestion(i);
    strip.appendChild(d);
  });
}

/* ── الانتقال المباشر لسؤال معين ── */
function jumpToQuestion(i) {
  AppState.currentQ=i; renderQuestion(); renderNavStrip();
}

/* ── عرض السؤال ── */
function renderQuestion() {
  const {currentTest,currentQ,userAnswers}=AppState;
  const q=currentTest.questions[currentQ];
  const pct=(currentQ/currentTest.questions.length)*100;
  const pf=$id('q-progress-fill'); if(pf) pf.style.width=pct+'%';
  setText('q-counter',(currentQ+1)+' / '+currentTest.questions.length);
  setText('q-num','السؤال '+(currentQ+1));
  setText('q-text',q.text);

  /* ملاحظة المعلم تظهر أعلى الخيارات مباشرة إن وجدت والإعداد مفعّل */
  const notePre=$id('teacher-note-pre');
  if(notePre) {
    if(q.note&&q.note.trim()&&AppState.adminSettings.showNotesLive!==false) {
      notePre.textContent=q.note; notePre.style.display='flex';
    } else {
      notePre.style.display='none';
    }
  }
  /* إخفاء مربع الملاحظة السفلي (غير مستخدم الآن) */
  const nb=$id('teacher-note-box'); if(nb) nb.style.display='none';

  /* بناء الخيارات — يمكن تغيير الإجابة دائماً */
  const letters=['أ','ب','ج','د','هـ','و'];
  const container=$id('choices-container'); if(!container) return;
  const frag=document.createDocumentFragment();
  const ua=userAnswers[currentQ];
  q.choices.forEach((c,i)=>{
    const div=document.createElement('div');
    div.className='choice'+(ua===i?' selected':'');
    div.id='choice-'+i;
    div.onclick=()=>selectAnswer(i);
    div.innerHTML=`<div class="choice-letter">${letters[i]||(i+1)}</div><div class="choice-text">${escapeHtml(c)}</div>`;
    frag.appendChild(div);
  });
  container.innerHTML=''; container.appendChild(frag);

  /* أزرار التنقل */
  const prevBtn=$id('prev-btn'), nextBtn=$id('next-btn'), skipBtn=$id('skip-btn');
  if(prevBtn) prevBtn.disabled=(currentQ===0);
  if(nextBtn) nextBtn.textContent=currentQ===currentTest.questions.length-1?'إنهاء ✓':'التالي ←';
  if(skipBtn) skipBtn.style.display=ua!==null?'none':'';
}

/* ── اختيار الإجابة — يمكن التغيير دائماً ── */
function selectAnswer(i) {
  AppState.userAnswers[AppState.currentQ]=i;
  /* تحديث الخيارات بصرياً */
  document.querySelectorAll('.choice').forEach((el,ci)=>{
    el.classList.toggle('selected', ci===i);
  });
  /* إخفاء زر التخطي بعد الاختيار */
  const sb=$id('skip-btn'); if(sb) sb.style.display='none';
  saveProgress(); renderNavStrip();
}

/* ── التنقل ── */
function prevQuestion() {
  if(AppState.currentQ>0){ AppState.currentQ--; renderQuestion(); renderNavStrip(); }
}
function nextQuestion() {
  const {currentQ,currentTest}=AppState;
  if(currentQ<currentTest.questions.length-1){ AppState.currentQ++; renderQuestion(); renderNavStrip(); }
  else openFinalReview();
}
function skipQuestion() {
  AppState.userAnswers[AppState.currentQ]=-1;
  saveProgress(); renderNavStrip(); nextQuestion();
}
function confirmLeaveQuiz() { openModal('leave-modal'); }
function leaveQuiz() { clearInterval(AppState.timerInterval); closeModal('leave-modal'); showPage('home'); }

/* ── مراجعة نهائية قبل التسليم ── */
function openFinalReview() {
  const {currentTest,userAnswers}=AppState;
  const qs=currentTest.questions;
  const answered=userAnswers.filter(a=>a!==null&&a!==-1).length;
  const skipped=userAnswers.filter(a=>a===-1).length;
  const unanswered=userAnswers.filter(a=>a===null).length;

  setText('final-review-summary',
    `إجمالي الأسئلة: ${qs.length} • أجبت على: ${answered} • تخطيت: ${skipped} • لم تجب على: ${unanswered}`);

  const letters=['أ','ب','ج','د','هـ','و'];
  const list=$id('final-review-list'); if(!list) return;
  list.innerHTML='';
  qs.forEach((q,i)=>{
    const ua=userAnswers[i];
    const item=document.createElement('div');
    const isAnswered=ua!==null&&ua!==-1;
    const isSkipped=ua===-1;
    item.className='final-review-item'+(isAnswered?' answered':isSkipped?' skipped':'');
    item.onclick=()=>{ closeModal('final-review-modal'); jumpToQuestion(i); };
    const ansText=isAnswered?`${letters[ua]||ua+1}. ${escapeHtml(q.choices[ua]||'')}`:isSkipped?'تم التخطي':'لم تُجب بعد';
    item.innerHTML=`
      <div class="fri-num">السؤال ${i+1}</div>
      <div class="fri-q">${escapeHtml(q.text)}</div>
      <div class="fri-ans ${isAnswered?'has-answer':isSkipped?'no-answer':'no-answer'}">${escapeHtml(ansText)}</div>`;
    list.appendChild(item);
  });
  openModal('final-review-modal');
}

/* ── تسليم الاختبار النهائي ── */
function submitQuiz() {
  closeModal('final-review-modal');
  clearInterval(AppState.timerInterval);
  const {currentTest,userAnswers,elapsedSecs}=AppState;
  const qs=currentTest.questions;
  let correct=0,skipped=0; const wrongList=[];
  qs.forEach((q,i)=>{
    const ua=userAnswers[i];
    if(ua===-1||ua===null) skipped++;
    else if(isAnswerCorrect(q,ua)) correct++;
    else wrongList.push({testName:currentTest.name,testId:currentTest.id,qIndex:i,q,userAnswer:ua,timestamp:Date.now(),attempts:getErrorAttemptCount(currentTest.id,i)+1});
  });
  const pct=Math.round(correct/qs.length*100);
  if(currentTest.id!=='__practice__') {
    AppState.scores[currentTest.id]=pct;
    localStorage.setItem('quizScores',JSON.stringify(AppState.scores));
    clearProgress(currentTest.id);
    dbSaveAnalytics(currentTest.id,{score:pct,correct,wrong:qs.length-correct-skipped,skipped,total:qs.length,elapsed:elapsedSecs});
  }
  updateErrorTracking(wrongList);
  showResults(pct,correct,skipped,qs.length,elapsedSecs);
}

/* ── Smart Error Tracking ── */
function getErrorAttemptCount(testId,qIndex) {
  return AppState.errors.find(e=>e.testId===testId&&e.qIndex===qIndex)?.attempts||0;
}
function updateErrorTracking(wrongList) {
  const {currentTest}=AppState;
  if(AppState.adminSettings.categorizedErrors) {
    const key='quizErrors_'+(currentTest.id||'general');
    let cat=JSON.parse(localStorage.getItem(key)||'[]');
    wrongList.forEach(w=>{ const idx=cat.findIndex(e=>e.testId===w.testId&&e.qIndex===w.qIndex); if(idx>=0) cat[idx]={...cat[idx],...w,attempts:(cat[idx].attempts||1)+1}; else cat.push(w); });
    AppState.userAnswers.forEach((ua,i)=>{ if(ua!==null&&ua!==-1&&isAnswerCorrect(currentTest.questions[i],ua)) cat=cat.filter(e=>!(e.testId===currentTest.id&&e.qIndex===i)); });
    localStorage.setItem(key,JSON.stringify(cat));
  }
  wrongList.forEach(w=>{ const idx=AppState.errors.findIndex(e=>e.testId===w.testId&&e.qIndex===w.qIndex); if(idx>=0) AppState.errors[idx]={...AppState.errors[idx],...w,attempts:(AppState.errors[idx].attempts||1)+1}; else AppState.errors.push(w); });
  AppState.userAnswers.forEach((ua,i)=>{ if(ua!==null&&ua!==-1&&isAnswerCorrect(currentTest.questions[i],ua)) AppState.errors=AppState.errors.filter(e=>!(e.testId===currentTest.id&&e.qIndex===i)); });
  AppState.errors.sort((a,b)=>(b.attempts||1)-(a.attempts||1));
  localStorage.setItem('quizErrors',JSON.stringify(AppState.errors));
}

/* ── Results ── */
function showResults(pct,correct,skipped,total,elapsed) {
  showPage('results');
  const wrong=total-correct-skipped;
  const icon=pct>=90?'🏆':pct>=70?'🎉':pct>=50?'📚':'💪';
  const grade=pct>=90?'ممتاز':pct>=80?'جيد جداً':pct>=70?'جيد':pct>=60?'مقبول':'راجع المادة';
  const gColor=pct>=70?'var(--green)':pct>=50?'var(--accent)':'var(--red)';
  const arcColor=pct>=70?'#10b981':pct>=50?'#fbbf24':'#ef4444';
  setText('results-icon',icon); setText('results-score',pct+'%'); setText('score-pct',pct+'%');
  setText('results-label',AppState.currentTest.name);
  const ge=$id('results-grade'); if(ge){ ge.textContent=grade; ge.style.cssText=`background:${gColor}22;color:${gColor};border:1px solid ${gColor}44`; }
  setText('r-correct',correct); setText('r-wrong',wrong); setText('r-skipped',skipped); setText('r-time',fmtTime(elapsed));
  const arc=$id('score-arc'); if(arc){ arc.style.stroke=arcColor; setTimeout(()=>{ arc.style.strokeDashoffset=326.7-(326.7*pct/100); },100); }
  renderBreakdownDots(); renderReviewList();
}
function renderBreakdownDots() {
  const {currentTest,userAnswers}=AppState;
  const grid=$id('breakdown-grid'); if(!grid) return;
  const frag=document.createDocumentFragment();
  currentTest.questions.forEach((q,i)=>{
    const ua=userAnswers[i]; const dot=document.createElement('div');
    let cls='s',sym='⏭';
    if(ua!==null&&ua!==-1&&isAnswerCorrect(q,ua)){ cls='c';sym=i+1; }
    else if(ua!==null&&ua!==-1){ cls='w';sym=i+1; }
    dot.className='breakdown-dot '+cls; dot.title='سؤال '+(i+1); dot.textContent=sym;
    frag.appendChild(dot);
  });
  grid.innerHTML=''; grid.appendChild(frag);
}
function renderReviewList() {
  const {currentTest,userAnswers}=AppState;
  const qs=currentTest.questions, letters=['أ','ب','ج','د','هـ','و'];
  const rvList=$id('review-list'); if(!rvList) return;
  const frag=document.createDocumentFragment();
  qs.forEach((q,i)=>{
    const ua=userAnswers[i], correct=getCorrectAnswers(q);
    const isCorrect=ua!==null&&ua!==-1&&isAnswerCorrect(q,ua);
    const item=document.createElement('div'); item.className='review-item '+(isCorrect?'r-correct':'r-wrong');
    let ch='';
    q.choices.forEach((c,ci)=>{
      const isCor=correct.includes(ci), isUser=ua===ci;
      let cls2=''; if(isCor) cls2='r-answer'; else if(isUser&&!isCor) cls2='r-user-wrong';
      if(cls2) ch+=`<div class="review-choice ${cls2}">${isCor?'✅':'❌'} ${letters[ci]||ci+1}. ${escapeHtml(c)}</div>`;
    });
    const noteHtml=q.note?`<div class="review-note"><span>💡 ملاحظة المعلم</span>${escapeHtml(q.note)}</div>`:'';
    item.innerHTML=`<div class="review-q">${i+1}. ${escapeHtml(q.text)}</div><div class="review-choices">${ch}</div>${noteHtml}`;
    frag.appendChild(item);
  });
  rvList.innerHTML=''; rvList.appendChild(frag);
}
function retryQuiz() {
  const {currentTest}=AppState;
  if(currentTest.firebaseId!=='__practice__') startQuiz(currentTest.firebaseId);
  else startCustomQuiz(currentTest.questions,currentTest.name);
}

/* ── Errors Page ── */
function renderErrors() {
  const container=$id('errors-container'), panel=$id('practice-panel');
  const {errors,adminSettings}=AppState;
  if(!errors.length){ if(panel) panel.style.display='none'; if(container) container.innerHTML='<div class="empty-state"><div class="icon">🎉</div><p>لا توجد أخطاء مسجّلة — أحسنت!</p></div>'; return; }
  if(panel) panel.style.display='block';
  const size=parseInt($id('practice-size')?.value)||10;
  setText('practice-splits-info',`${errors.length} خطأ مسجّل • ${Math.ceil(errors.length/size)} جلسة (${size} سؤال لكل جلسة)`);
  const grouped={};
  errors.forEach(e=>{ const k=adminSettings.categorizedErrors?(e.testId||'general'):'all'; if(!grouped[k]) grouped[k]={name:e.testName||'الكل',items:[]}; grouped[k].items.push(e); });
  const letters=['أ','ب','ج','د','هـ','و'];
  const frag=document.createDocumentFragment();
  Object.entries(grouped).forEach(([key,g])=>{
    const folder=document.createElement('div'); folder.className='errors-folder';
    const bid='errfolder_'+key.replace(/[^a-z0-9]/gi,'_');
    let ih='';
    g.items.forEach((e,idx)=>{
      const ua=e.userAnswer, ci=getCorrectAnswers(e.q);
      const cText=ci.map(c=>`${letters[c]||c+1}. ${escapeHtml(e.q.choices[c]||'—')}`).join(' ، ');
      const uText=ua>=0?`${letters[ua]||'?'}. ${escapeHtml(e.q.choices[ua]||'—')}`:null;
      const at=(e.attempts>1)?`<span class="error-attempts">🔁 ${e.attempts} محاولات</span>`:'';
      ih+=`<div class="error-item"><div class="error-q-num">${idx+1}</div><div class="error-content"><div class="error-q">${escapeHtml(e.q.text)}</div><div class="error-answers">${uText?`<span class="error-wrong">❌ إجابتك: ${uText}</span>`:'<span class="error-wrong">⏭️ تخطي</span>'}<span class="error-correct">✅ الصحيح: ${cText}</span>${at}</div></div></div>`;
    });
    folder.innerHTML=`
      <div class="folder-top" onclick="const b=document.getElementById('${bid}');b.style.display=b.style.display==='none'?'flex':'none'">
        <div class="folder-top-left"><span>📁</span><span class="folder-title">${escapeHtml(g.name)}</span></div>
        <div class="folder-actions"><button class="folder-retake-btn" onclick="event.stopPropagation();retakeErrorsForQuiz('${key}')">🔁 إعادة التدريب</button><span class="folder-count">${g.items.length} خطأ</span></div>
      </div>
      <div class="folder-body" id="${bid}" style="display:none">${ih}</div>`;
    frag.appendChild(folder);
  });
  if(container){ container.innerHTML=''; container.appendChild(frag); }
}
function retakeErrorsForQuiz(key) {
  const sub=key==='all'?AppState.errors:AppState.errors.filter(e=>e.testId===key);
  if(!sub.length){ showToast('لا توجد أخطاء','error'); return; }
  const sorted=[...sub].sort((a,b)=>(b.attempts||1)-(a.attempts||1));
  startCustomQuiz(sorted.map(e=>({...e.q})),`تدريب أخطاء: ${sorted[0]?.testName||'عام'}`);
}
function startPracticeSession(all=false) {
  const {errors}=AppState;
  if(!errors.length){ showToast('لا توجد أخطاء','error'); return; }
  const sorted=[...errors].sort((a,b)=>(b.attempts||1)-(a.attempts||1));
  const questions=sorted.map(e=>({...e.q}));
  if(all){ startCustomQuiz(questions,'تدريب الأخطاء — كل الأسئلة'); return; }
  const size=parseInt($id('practice-size')?.value)||10;
  const splits=[]; for(let i=0;i<questions.length;i+=size) splits.push(questions.slice(i,i+size));
  if(splits.length===1){ startCustomQuiz(splits[0],'تدريب الأخطاء — جلسة 1'); return; }
  setText('practice-modal-desc',`${questions.length} سؤال مقسّم على ${splits.length} جلسات (${size} سؤال لكل جلسة) — مرتبة حسب الصعوبة`);
  let lh='';
  splits.forEach((chunk,i)=>{ lh+=`<div class="manage-item"><div class="manage-item-info"><div class="manage-item-name">الجلسة ${i+1}</div><div class="manage-item-meta">${chunk.length} سؤال</div></div><button class="btn btn-primary" style="font-size:0.82rem;padding:8px 14px" onclick="closeModal('practice-modal');startCustomQuiz(window.__pChunks[${i}],'تدريب الأخطاء — جلسة ${i+1}')">▶ ابدأ</button></div>`; });
  const le=$id('practice-sessions-list'); if(le) le.innerHTML=lh;
  window.__pChunks=splits; openModal('practice-modal');
}

/* ============================================================
   POMODORO
============================================================ */
function updatePomoSettings() {
  const p=AppState.pomodoro; if(p.running) return;
  p.focusMins=parseInt($id('pomo-focus-input')?.value)||25;
  p.breakMins=parseInt($id('pomo-break-input')?.value)||5;
  p.totalSessions=parseInt($id('pomo-sessions-input')?.value)||4;
  p.remaining=p.focusMins*60; p.phase='focus'; updatePomoDisplay();
}
function togglePomodoro() {
  const p=AppState.pomodoro;
  if(p.running){ clearInterval(p.interval); p.running=false; setText('pomo-start-btn','▶ ابدأ'); setText('pomo-status-text','متوقف مؤقتاً'); }
  else{ p.running=true; setText('pomo-start-btn','⏸ إيقاف'); p.interval=setInterval(tickPomo,1000); }
}
function tickPomo() {
  const p=AppState.pomodoro; p.remaining--;
  if(p.remaining<=0) {
    if(p.phase==='focus'){ p.completedSessions++; p.phase='break'; p.remaining=p.breakMins*60; showToast('🍅 وقت الاستراحة!','info'); }
    else{ p.phase='focus'; p.remaining=p.focusMins*60; p.currentSession=Math.min(p.currentSession+1,p.totalSessions); if(p.completedSessions>=p.totalSessions){ showToast('🏆 انتهت جميع الجلسات! أحسنت','success'); resetPomodoro(); return; } showToast('✏️ وقت التركيز!','info'); }
  }
  updatePomoDisplay();
}
function skipPomoPhase(){ AppState.pomodoro.remaining=0; tickPomo(); }
function resetPomodoro() {
  const p=AppState.pomodoro; clearInterval(p.interval); p.running=false; p.phase='focus';
  p.currentSession=1; p.completedSessions=0; p.remaining=p.focusMins*60;
  setText('pomo-start-btn','▶ ابدأ'); updatePomoDisplay();
}
function updatePomoDisplay() {
  const p=AppState.pomodoro; const f=p.phase==='focus';
  const total=(f?p.focusMins:p.breakMins)*60, off=188.5-(188.5*p.remaining/total);
  setText('pomo-display',fmtTime(p.remaining));
  const de=$id('pomo-display'); if(de) de.className='pomo-time '+(f?'focus':'break');
  const le=$id('pomo-label'); if(le){ le.textContent=f?'تركيز':'استراحة'; le.className='pomo-label '+(f?'focus':'break'); }
  const re=$id('pomo-ring-fill'); if(re){ re.style.strokeDashoffset=off; re.className='pomo-ring-fill '+(f?'focus-ring':'break-ring'); }
  setText('pomo-sessions-inner',p.currentSession+'/'+p.totalSessions);
  setText('pomo-status-text',p.running?(f?'⏳ جلسة تركيز جارية...':'☕ استرح قليلاً...'):'ابدأ جلسة دراسة منتجة');
  let dots=''; for(let i=0;i<p.totalSessions;i++) dots+=`<div class="pomo-dot ${i<p.completedSessions?'done':''}"></div>`;
  const de2=$id('pomo-dots'); if(de2) de2.innerHTML=dots;
}

/* ============================================================
   TOOLS
============================================================ */
function initToolsPage() {
  const tg=JSON.parse(localStorage.getItem('toolGoal')||'null');
  if(tg){ setVal('tool-goal-name',tg.name||''); setVal('tool-goal-target',tg.target||20); setVal('tool-goal-done',tg.done||0); updateToolGoal(); }
  updateCdDisplay(); updateQtDisplay();
}
function toggleCountdown() {
  const cd=AppState.tools.cd;
  if(cd.running){ clearInterval(cd.interval); cd.running=false; setText('cd-start-btn','▶ ابدأ'); setText('cd-label','متوقف'); }
  else {
    if(!cd.remaining){ const m=parseInt($id('cd-mins')?.value)||0,s=parseInt($id('cd-secs')?.value)||0; cd.total=cd.remaining=m*60+s; if(!cd.remaining){ showToast('حدد وقتاً أولاً','error'); return; } }
    cd.running=true; setText('cd-start-btn','⏸ إيقاف'); setText('cd-label','يعدّ...');
    cd.interval=setInterval(()=>{ cd.remaining--; updateCdDisplay(); if(cd.remaining<=0){ clearInterval(cd.interval); cd.running=false; setText('cd-start-btn','▶ ابدأ'); setText('cd-label','✅ انتهى الوقت!'); showToast('⏰ انتهى الوقت!','info'); } },1000);
  }
}
function updateCdDisplay(){ const r=AppState.tools.cd.remaining,e=$id('cd-display'); if(!e) return; e.textContent=fmtTime(r); e.className='tool-timer-val'+(r<=10&&r>0?' danger':r<=30?' warning':AppState.tools.cd.running?' running':''); }
function resetCountdown(){ const cd=AppState.tools.cd; clearInterval(cd.interval); cd.running=false; cd.remaining=0; setText('cd-start-btn','▶ ابدأ'); setText('cd-label','جاهز للبدء'); updateCdDisplay(); }
function toggleStopwatch() {
  const sw=AppState.tools.sw;
  if(sw.running){ clearInterval(sw.interval); sw.running=false; setText('sw-start-btn','▶ ابدأ'); setText('sw-label','متوقفة'); const lb=$id('sw-lap-btn'); if(lb) lb.disabled=true; }
  else{ sw.running=true; setText('sw-start-btn','⏸ إيقاف'); setText('sw-label','تعمل...'); const lb=$id('sw-lap-btn'); if(lb) lb.disabled=false; sw.interval=setInterval(()=>{ sw.elapsed++; setText('sw-display',fmtTime(sw.elapsed)); },1000); }
}
function lapStopwatch(){ const sw=AppState.tools.sw,le=$id('sw-laps'); if(!le) return; sw.laps.push(sw.elapsed); const d=document.createElement('div'); d.style.cssText='background:var(--surface2);border-radius:6px;padding:4px 10px;font-size:0.78rem;color:var(--text3);display:flex;justify-content:space-between'; d.innerHTML=`<span>لفة ${sw.laps.length}</span><span style="color:var(--accent);font-weight:700">${fmtTime(sw.elapsed)}</span>`; le.appendChild(d); le.scrollTop=le.scrollHeight; }
function resetStopwatch(){ const sw=AppState.tools.sw; clearInterval(sw.interval); sw.running=false; sw.elapsed=0; sw.laps=[]; setText('sw-display','00:00'); setText('sw-start-btn','▶ ابدأ'); setText('sw-label','متوقفة'); const lb=$id('sw-lap-btn'); if(lb) lb.disabled=true; const le=$id('sw-laps'); if(le) le.innerHTML=''; }
function updateToolGoal(){ const t=parseInt($id('tool-goal-target')?.value)||1,d=parseInt($id('tool-goal-done')?.value)||0,p=Math.min(100,Math.round(d/t*100)); setText('tool-goal-pct',p+'%'); setText('tool-goal-sub',`${d} من ${t}`); const b=$id('tool-goal-bar'); if(b) b.style.width=p+'%'; const pe=$id('tool-goal-pct'); if(pe) pe.style.color=p>=100?'var(--green)':p>=60?'var(--accent)':'var(--blue)'; }
function incrementGoalDone(){ const i=$id('tool-goal-done'); if(i){ i.value=(parseInt(i.value)||0)+1; updateToolGoal(); } }
function saveToolGoal(){ localStorage.setItem('toolGoal',JSON.stringify({name:$id('tool-goal-name')?.value.trim(),target:parseInt($id('tool-goal-target')?.value)||20,done:parseInt($id('tool-goal-done')?.value)||0})); showToast('تم حفظ الهدف ✓'); }
function toggleQTimer() {
  const qt=AppState.tools.qt;
  if(qt.running){ clearInterval(qt.interval); qt.running=false; setText('qt-start-btn','▶ ابدأ'); const nb=$id('qt-next-btn'); if(nb) nb.disabled=true; }
  else{ if(!qt.qIdx){ qt.perQ=parseInt($id('qt-secs')?.value)||30; qt.total=parseInt($id('qt-count')?.value)||10; qt.qIdx=1; qt.remaining=qt.perQ; } qt.running=true; setText('qt-start-btn','⏸ إيقاف'); const nb=$id('qt-next-btn'); if(nb) nb.disabled=false; qt.interval=setInterval(()=>{ qt.remaining--; updateQtDisplay(); if(qt.remaining<=0) nextQTimer(); },1000); }
}
function nextQTimer(){ const qt=AppState.tools.qt; qt.qIdx++; if(qt.qIdx>qt.total){ clearInterval(qt.interval); qt.running=false; qt.qIdx=0; setText('qt-start-btn','▶ ابدأ'); const nb=$id('qt-next-btn'); if(nb) nb.disabled=true; setText('qt-label','✅ انتهت الأسئلة!'); showToast('✅ انتهت جميع الأسئلة!','success'); return; } qt.remaining=qt.perQ; showToast(`➡️ السؤال ${qt.qIdx}`,'info'); updateQtDisplay(); }
function updateQtDisplay(){ const qt=AppState.tools.qt,r=qt.remaining,t=qt.perQ||1,p=Math.max(0,r/t*100),e=$id('qt-display'); if(e){ e.textContent=fmtTime(r); e.className='tool-timer-val'+(r<=5?' danger':r<=10?' warning':''); } setText('qt-label',qt.qIdx?`سؤال ${qt.qIdx} / ${qt.total}`:'جاهز'); const b=$id('qt-bar'); if(b) b.style.width=p+'%'; }
function resetQTimer(){ const qt=AppState.tools.qt; clearInterval(qt.interval); qt.running=false; qt.qIdx=0; qt.remaining=0; setText('qt-start-btn','▶ ابدأ'); const nb=$id('qt-next-btn'); if(nb) nb.disabled=true; updateQtDisplay(); }
