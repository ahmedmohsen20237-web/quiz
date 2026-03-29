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
