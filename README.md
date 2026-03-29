# 🏆 منصة الوسام التعليمية

> **Al-Wisam Educational Quiz Platform** — A production-grade, Firebase-powered quiz platform built with vanilla HTML, CSS, and JavaScript.

---

## 📋 Table of Contents

- [Features](#features)
- [Project Structure](#project-structure)
- [Quick Start](#quick-start)
- [Firebase Setup](#firebase-setup)
- [Security Rules](#security-rules)
- [Admin Guide](#admin-guide)
- [Quiz Logic](#quiz-logic)
- [Deployment](#deployment)

---

## ✨ Features

| Feature | Description |
|---|---|
| 🔐 **Firebase Auth** | Admin login via Email/Password — no passwords in code |
| 🧠 **Smart Quiz Engine** | Multi-correct questions with single-choice UX |
| 🤖 **Smart Parser** | Paste any text → auto-detect questions & choices |
| ✍️ **Bulk Answer Input** | Map answers with `ج ب أ` or `C B A` or `3 2 1` |
| 🔁 **Error Recovery** | Tracks wrong answers, prioritizes weak areas in practice |
| 💾 **Progress Save** | Auto-saves every 30s, resume from where you left off |
| 🍅 **Pomodoro Timer** | Focus sessions with configurable work/break cycles |
| 🛠️ **Study Tools** | Countdown, stopwatch, question timer, goal tracker |
| 🌙 **Dark / Light Mode** | Persisted in localStorage |
| 📊 **Basic Analytics** | Scores saved to Firebase per quiz |

---

## 📁 Project Structure

```
waseem-platform/
├── index.html          # Main HTML — all pages (SPA)
├── css/
│   └── style.css       # All styles — glassmorphism dark/light theme
├── js/
│   └── main.js         # Merged JS bundle (4 modules in order):
│                       #   1. Firebase init, auth & DB helpers
│                       #   2. App state, navigation, utilities
│                       #   3. Admin UI, builder, parser, manage
│                       #   4. Quiz engine, errors, tools, pomodoro
├── .gitignore
└── README.md
```

> **Why one JS file?** This is a zero-build-tool project. One file = one HTTP request, easier deployment to GitHub Pages or any static host.

---

## 🚀 Quick Start

### Option A — Open Locally
```bash
git clone https://github.com/YOUR_USERNAME/waseem-platform.git
cd waseem-platform
# Open index.html in your browser
open index.html   # macOS
start index.html  # Windows
```

> ⚠️ Some browsers block Firebase connections when opening `file://` directly.  
> Use a local server for best results:
```bash
npx serve .          # Node.js
python -m http.server # Python 3
```

### Option B — Deploy to GitHub Pages (recommended)
See [Deployment](#deployment) section below.

---

## 🔥 Firebase Setup

This project uses your existing Firebase project. The config is already in `js/main.js`.

### Step 1 — Enable Firebase Authentication

1. Go to [Firebase Console](https://console.firebase.google.com) → your project
2. **Authentication** → **Sign-in method** → Enable **Email/Password**
3. **Authentication** → **Users** → **Add user**
   - Enter the admin email and a strong password
   - This is the only credential that grants admin access

### Step 2 — Apply Security Rules

Go to **Realtime Database** → **Rules** and paste:

```json
{
  "rules": {
    "quizzes": {
      ".read": true,
      ".write": "auth != null"
    },
    "analytics": {
      ".read": "auth != null",
      ".write": true
    }
  }
}
```

Click **Publish**. This ensures:
- ✅ Anyone can **read** quizzes (students)
- 🔐 Only **authenticated admins** can write/delete quizzes
- 📊 Anyone can write analytics (score tracking)

---

## 🔐 Security Rules (Details)

| Path | Read | Write | Why |
|---|---|---|---|
| `/quizzes` | Public | Auth only | Students read; only admin edits |
| `/analytics` | Auth only | Public | Score tracking; admin reviews |

**What was removed from the original code:**
- ❌ `const ADMIN_KEY = "7788"` — hardcoded password (anyone with DevTools could see it)
- ✅ Replaced with Firebase Authentication — verified server-side by Google

---

## 👨‍🏫 Admin Guide

### Logging In
1. Click the 🔒 lock icon in the top navigation
2. Enter your admin **email** and **password** (set in Firebase Console)
3. Firebase verifies credentials server-side — no password stored in the app

### Adding a Quiz

**Method 1 — Manual Builder (➕ إضافة اختبار)**
- Fill in quiz name, subject, time limit
- Click "إضافة سؤال يدوياً" for each question
- Toggle "إجابات صحيحة متعددة" to mark a question as multi-correct
- Use the Answer Map at the bottom to quickly set correct answers

**Method 2 — Smart Import (🤖 استيراد ذكي)**
- Paste raw text with questions and choices
- Supported formats:
  ```
  س1: ما هو أكبر كوكب؟
  أ) الأرض   ب) المريخ   ج) المشتري   د) زحل
  
  Q2: What is 2+2?
  A) 3   B) 4   C) 5   D) 6
  ```
- Optionally fill "الإجابات الصحيحة" field with space or comma-separated answers:
  ```
  ج ب أ د         (Arabic letters)
  C B A D         (English letters)
  3 2 1 4         (Numbers = choice index)
  ج, ب, أ, د      (commas also work)
  ```
- Click "تحليل النص" → review parsed questions → mark correct answers → save

### Teacher Settings
- **تتبع الأخطاء حسب الاختبار** — Group errors by quiz for targeted practice
- **عرض ملاحظات المعلم فور الإجابة** — Show teacher notes immediately after each answer

---

## 🧠 Quiz Logic

### Multi-Correct, Single-Choice UX

This is the most critical design principle of this platform:

```
A question MAY store multiple correct answers in the database.
BUT students ALWAYS see standard single-choice radio UI.
Students NEVER know if multiple correct answers exist.

If correctAnswers = [1, 4]:
  Student picks answer 1 → ✅ CORRECT
  Student picks answer 4 → ✅ CORRECT
  Student picks answer 2 → ❌ WRONG

There is NO "select all that apply" mode for students.
```

This is intentional — it tests knowledge without revealing that multiple options are valid.

### Error Recovery System

Wrong answers are tracked with:
- `attempts` — how many times this question was answered wrong
- Errors sorted by `attempts` (descending) in practice sessions
- High-attempt questions appear first → focuses on weakest areas

### Progress Auto-Save

- Saves every 30 seconds to `localStorage`
- On quiz re-entry, prompts: "استمر من حيث توقفت؟"
- Practice sessions (error drills) do not save progress

---

## 🌐 Deployment

### GitHub Pages (Free, Recommended)

```bash
# 1. Create a repo on GitHub, then:
git init
git add .
git commit -m "initial commit"
git branch -M main
git remote add origin https://github.com/YOUR_USERNAME/waseem-platform.git
git push -u origin main

# 2. In GitHub → Settings → Pages
#    Source: Deploy from branch → main → / (root)
#    Your site: https://YOUR_USERNAME.github.io/waseem-platform/
```

### Firebase Hosting (Also Free)

```bash
npm install -g firebase-tools
firebase login
firebase init hosting   # select your project, public dir = "."
firebase deploy
```

### Any Static Host

Just upload the folder to:
- Netlify (drag & drop)
- Vercel (`vercel deploy`)
- Cloudflare Pages
- Any web server

---

## 🛠️ Tech Stack

| Layer | Technology |
|---|---|
| Frontend | Vanilla HTML5, CSS3, JavaScript (ES2020+) |
| Database | Firebase Realtime Database |
| Auth | Firebase Authentication (Email/Password) |
| Fonts | Google Fonts (Cairo, Tajawal) |
| Icons | Font Awesome 6 |
| Hosting | GitHub Pages / Firebase Hosting |
| Build tools | **None** — zero dependencies |

---

## 📄 License

All rights reserved — تطوير تقني: أحمد محسن
