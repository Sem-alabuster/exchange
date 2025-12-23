/* CryptoEx - client-side auth + local storage (no server) */
(function () {
  const USERS_KEY = "cryptoex_users_v1";
  const SESSION_KEY = "cryptoex_session_v1";
  const PROFILE_KEY = "cryptoex_profile_v1";
  const HISTORY_KEY = "cryptoex_history_v1";
  const REF_LOG_KEY = "cryptoex_ref_log_v1";
  const INCOMING_REF_KEY = "cryptoex_incoming_ref_v1";

  function safeJsonParse(s, fallback) {
    try { return JSON.parse(s); } catch { return fallback; }
  }

  function getUsers() {
    return safeJsonParse(localStorage.getItem(USERS_KEY) || "[]", []);
  }
  function setUsers(users) {
    localStorage.setItem(USERS_KEY, JSON.stringify(users));
  }

  function isValidEmail(email) {
    // Simple but strict enough for UI validation
    return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(String(email || "").trim());
  }

  async function sha256Hex(text) {
    if (!window.crypto || !crypto.subtle) {
      // Fallback (not cryptographically strong, but avoids breaking old browsers)
      let h = 0;
      for (let i = 0; i < text.length; i++) h = (h * 31 + text.charCodeAt(i)) >>> 0;
      return "fallback_" + h.toString(16);
    }
    const enc = new TextEncoder().encode(text);
    const buf = await crypto.subtle.digest("SHA-256", enc);
    return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, "0")).join("");
  }

  function toast(message) {
    const t = document.createElement("div");
    t.className = "cryptoex-toast";
    t.textContent = message;

    Object.assign(t.style, {
      position: "fixed",
      right: "20px",
      top: "20px",
      background: "#C8F169",       // lime
      color: "#0b2a12",
      padding: "12px 14px",
      borderRadius: "14px",
      boxShadow: "0 12px 35px rgba(0,0,0,.12)",
      fontWeight: "700",
      zIndex: 9999,
      maxWidth: "320px",
      lineHeight: "1.2"
    });

    document.body.appendChild(t);
    setTimeout(() => { t.style.opacity = "0"; t.style.transition = "opacity .25s ease"; }, 2200);
    setTimeout(() => { t.remove(); }, 2600);
  }

  function getSessionEmail() {
    return localStorage.getItem(SESSION_KEY) || "";
  }

  function setSessionEmail(email) {
    localStorage.setItem(SESSION_KEY, email);
  }

  function clearSession() {
    localStorage.removeItem(SESSION_KEY);
  }

  function getProfile() {
    return safeJsonParse(localStorage.getItem(PROFILE_KEY) || "{}", {});
  }
  function setProfile(profile) {
    localStorage.setItem(PROFILE_KEY, JSON.stringify(profile));
  }

  function getHistory() {
    return safeJsonParse(localStorage.getItem(HISTORY_KEY) || "[]", []);
  }
  function setHistory(h) {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(h));
  }


  function getRefLog() {
    return safeJsonParse(localStorage.getItem(REF_LOG_KEY) || "{}", {});
  }
  function setRefLog(obj) {
    localStorage.setItem(REF_LOG_KEY, JSON.stringify(obj));
  }
  function getIncomingRef() {
    return String(localStorage.getItem(INCOMING_REF_KEY) || "").trim();
  }
  function setIncomingRef(code) {
    localStorage.setItem(INCOMING_REF_KEY, String(code || "").trim());
  }
  function clearIncomingRef() {
    localStorage.removeItem(INCOMING_REF_KEY);
  }

  function ensureUserRefCode(users, email) {
    const idx = users.findIndex(u => (u.email || "").toLowerCase() === String(email || "").toLowerCase());
    if (idx < 0) return null;
    if (!users[idx].refCode) {
      users[idx].refCode = generateRefCode();
      setUsers(users);
    }
    return users[idx].refCode;
  }

  function generateRefCode() {
    const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    let s = "";
    for (let i = 0; i < 8; i++) s += alphabet[Math.floor(Math.random() * alphabet.length)];
    return s;
  }

  function recordRefClick(code) {
    const c = String(code || "").trim();
    if (!c) return;
    const log = getRefLog();
    if (!log[c]) log[c] = { clicks: [], regs: [] };
    log[c].clicks.unshift({ ts: Date.now(), path: location.pathname || "" });
    // keep last 500
    log[c].clicks = (log[c].clicks || []).slice(0, 500);
    setRefLog(log);
  }

  function recordRefReg(code, email) {
    const c = String(code || "").trim();
    if (!c) return;
    const log = getRefLog();
    if (!log[c]) log[c] = { clicks: [], regs: [] };
    log[c].regs.unshift({ ts: Date.now(), email: String(email || "").trim() });
    log[c].regs = (log[c].regs || []).slice(0, 500);
    setRefLog(log);
  }

  function initRefFromUrl() {
    try {
      const params = new URLSearchParams(location.search || "");
      const code = params.get("ref");
      if (code) {
        // Save last incoming ref and record click
        setIncomingRef(code);
        // Don't count click for your own ref if logged in
        const me = getCurrentUser();
        if (me) {
          const users = getUsers();
          const myCode = ensureUserRefCode(users, me.email);
          if (myCode && String(myCode) === String(code)) return;
        }
        recordRefClick(code);
      }
    } catch {}
  }

  function buildRefLink(code) {
    const c = String(code || "").trim();
    if (!c) return "";
    // When opened via file:// origin is "null"
    if (!location.origin || location.origin === "null") {
      return `index.html?ref=${encodeURIComponent(c)}`;
    }
    try {
      const u = new URL("./index.html", location.href);
      u.searchParams.set("ref", c);
      return u.toString();
    } catch {
      return `index.html?ref=${encodeURIComponent(c)}`;
    }
  }
  function getCurrentUser() {
    const email = getSessionEmail();
    if (!email) return null;
    const users = getUsers();
    const u = users.find(x => x.email.toLowerCase() === email.toLowerCase());
    if (u && !u.refCode) {
      u.refCode = generateRefCode();
      setUsers(users);
    }
    return u ? { email: u.email, refCode: u.refCode || "" } : null;
  }

  async function register(email, password) {
    const e = String(email || "").trim();
    const p = String(password || "");

    if (!isValidEmail(e)) {
      return { ok: false, message: "Введите корректный email, например name@gmail.com" };
    }
    if (p.length < 8) {
      return { ok: false, message: "Пароль должен быть не меньше 8 символов" };
    }

    const users = getUsers();
    if (users.some(u => u.email.toLowerCase() === e.toLowerCase())) {
      return { ok: false, message: "Такой email уже зарегистрирован" };
    }

    const passHash = await sha256Hex(p);
    const refCode = generateRefCode();
    const incomingRef = getIncomingRef();
    users.push({ email: e, passHash, refCode, referredBy: incomingRef || "" });
    if (incomingRef) {
      recordRefReg(incomingRef, e);
      clearIncomingRef();
    }
    setUsers(users);

    // init profile
    const profile = getProfile();
    if (!profile[e]) profile[e] = { email: e, lastName: "", firstName: "", middleName: "", telegram: "", phone: "" };
    setProfile(profile);

    setSessionEmail(e);
    return { ok: true };
  }

  async function login(email, password) {
    const e = String(email || "").trim();
    const p = String(password || "");

    if (!isValidEmail(e)) return { ok: false, message: "Введите корректный email, например name@gmail.com" };
    if (p.length < 8) return { ok: false, message: "Пароль должен быть не меньше 8 символов" };

    const users = getUsers();
    const u = users.find(x => x.email.toLowerCase() === e.toLowerCase());
    if (!u) return { ok: false, message: "Пользователь не найден" };

    const passHash = await sha256Hex(p);
    if (passHash !== u.passHash) return { ok: false, message: "Неверный пароль" };

    setSessionEmail(u.email);
    // Ensure refCode exists for old accounts
    const users2 = getUsers();
    ensureUserRefCode(users2, u.email);
    return { ok: true };
  }

  async function changePassword(oldPassword, newPassword) {
    const email = getSessionEmail();
    if (!email) return { ok: false, message: "Вы не авторизованы" };

    const oldP = String(oldPassword || "");
    const newP = String(newPassword || "");
    if (newP.length < 8) return { ok: false, message: "Новый пароль должен быть не меньше 8 символов" };

    const users = getUsers();
    const idx = users.findIndex(x => x.email.toLowerCase() === email.toLowerCase());
    if (idx < 0) return { ok: false, message: "Пользователь не найден" };

    const oldHash = await sha256Hex(oldP);
    if (oldHash !== users[idx].passHash) return { ok: false, message: "Текущий пароль неверный" };

    users[idx].passHash = await sha256Hex(newP);
    setUsers(users);
    return { ok: true };
  }

  function updateProfile(fields) {
    const email = getSessionEmail();
    if (!email) return { ok: false, message: "Вы не авторизованы" };

    const profile = getProfile();
    if (!profile[email]) profile[email] = { email };

    profile[email] = { ...profile[email], ...fields, email };
    setProfile(profile);
    return { ok: true };
  }

  function getMyProfile() {
    const email = getSessionEmail();
    if (!email) return null;
    const profile = getProfile();
    return profile[email] || { email };
  }

  function logout() {
    clearSession();
  }

  function addExchange(record) {
    const email = getSessionEmail();
    if (!email) return { ok: false, message: "not-auth" };
    const h = getHistory();
    h.unshift({ ...record, email });
    setHistory(h);
    return { ok: true };
  }

  function getMyHistory() {
    const email = getSessionEmail();
    if (!email) return [];
    return getHistory().filter(x => (x.email || "").toLowerCase() === email.toLowerCase());
  }

  function requireAuth(redirectTo = "./login.html") {
    if (!getCurrentUser()) {
      window.location.href = redirectTo;
      return false;
    }
    return true;
  }

  function initUserMenu() {
    const btn = document.getElementById("userMenuBtn");
    const menu = document.getElementById("userMenu");
    if (!btn || !menu) return;

    const loggedOut = document.getElementById("userMenuLoggedOut");
    const loggedIn = document.getElementById("userMenuLoggedIn");
    const logoutBtn = document.getElementById("logoutBtn");

    // Force menu closed on load
    menu.setAttribute("hidden", "hidden");

    function refresh() {
      const user = getCurrentUser();
      if (user) {
        if (loggedOut) loggedOut.style.display = "none";
        if (loggedIn) loggedIn.style.display = "block";
      } else {
        if (loggedOut) loggedOut.style.display = "block";
        if (loggedIn) loggedIn.style.display = "none";
      }
    }

    refresh();

    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const isHidden = menu.hasAttribute("hidden");
      document.querySelectorAll(".dropdown").forEach(d => d.setAttribute("hidden", "hidden"));
      if (isHidden) menu.removeAttribute("hidden");
      else menu.setAttribute("hidden", "hidden");
    });

    document.addEventListener("click", () => {
      menu.setAttribute("hidden", "hidden");
    });

    if (logoutBtn) {
      logoutBtn.addEventListener("click", () => {
        logout();
        refresh();
        menu.setAttribute("hidden", "hidden");
        toast("Вы вышли из аккаунта");
        // If we are on account page - go home
        if (location.pathname.endsWith("account.html")) location.href = "./index.html";
      });
    }
  }


  function getMyRefCode() {
    const user = getCurrentUser();
    if (!user) return "";

    const users = getUsers();
    let code = ensureUserRefCode(users, user.email);

    if (!code) {
      // If user record is missing in the users list (old data), create/update it
      const refCode = generateRefCode();
      const existing = users.find(u => u.email === user.email);
      if (existing) {
        existing.refCode = existing.refCode || refCode;
        code = existing.refCode;
      } else {
        users.push({ ...user, refCode });
        code = refCode;
      }
      setUsers(users);
    }

    const updated = users.find(u => u.email === user.email);
    // Keep session in sync (store current email)
    if (updated) setSessionEmail(updated.email);
    return code || "";
  }

  function getRefStatsFor(code) {
    const c = String(code || "").trim();
    if (!c) return { clicks: [], regs: [] };
    const log = getRefLog();
    const entry = log[c] || { clicks: [], regs: [] };
    return { clicks: entry.clicks || [], regs: entry.regs || [] };
  }

  function getMyRefSummary() {
    const code = getMyRefCode();
    const stats = getRefStatsFor(code);
    return {
      refCode: code,
      refLink: buildRefLink(code),
      clicksCount: (stats.clicks || []).length,
      regsCount: (stats.regs || []).length,
      clicksRecent: (stats.clicks || []).slice(0, 10),
      regsRecent: (stats.regs || []).slice(0, 10),
    };
  }
  window.CryptoExAuth = {
    isValidEmail,
    register,
    login,
    logout,
    toast,
    requireAuth,
    getCurrentUser,
    getMyProfile,
    updateProfile,
    changePassword,
    addExchange,
    getMyHistory,
    getMyRefSummary,
  };

  // Track referral clicks on every page
  initRefFromUrl();

  document.addEventListener("DOMContentLoaded", () => {
    initUserMenu();
  });
})();
