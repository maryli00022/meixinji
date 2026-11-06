(async () => {
  if (window.__xxjOAuthBootstrap) {
    try {
      await window.__xxjOAuthBootstrap;
    } catch (err) {
      console.warn("[auth] oauth bootstrap failed:", err);
    }
  }
  try {
    await window.XXJ_DB.ready;
  } catch (err) {
    console.error("XXJ_DB.ready failed:", err);
  }

  /** 换项目时只改此处 */
  const SB_DEFAULT = Object.freeze({
    url: "https://mjzkdcolyziugzcwwiyk.supabase.co",
    key: "sb_publishable_7_K7cdbk3FcMmnn4KThJsQ_IGLDDpeo"
  });

  const K = window.XXJ_DB.K;
  const TOKEN_KEY = K.TOKEN;
  const SESSION_KEY = K.SUPABASE_SESSION;

  const overlay = document.getElementById("auth-overlay");
  const form = document.getElementById("auth-form");
  const usernameInput = document.getElementById("auth-username");
  const passwordInput = document.getElementById("auth-password");
  const passwordLabelText = document.getElementById("auth-password-label-text");
  const passwordConfirmInput = document.getElementById("auth-password-confirm");
  const activationCodeInput = document.getElementById("auth-activation-code");
  const switchModeBtn = document.getElementById("auth-switch-mode");
  const logoutBtn = document.getElementById("auth-logout");
  const submitBtn = document.getElementById("auth-submit");
  const discordBtn = document.getElementById("auth-discord");
  const actDiscordBtn = document.getElementById("act-discord");
  const msg = document.getElementById("auth-msg");

  const activationEl = document.getElementById("activation");
  const actQq = document.getElementById("act-qq");
  const actClaimBtn = document.getElementById("act-claim-btn");
  const actResult = document.getElementById("act-result");
  const actCode = document.getElementById("act-code");
  const actCopyBtn = document.getElementById("act-copy");
  const actMsg = document.getElementById("act-msg");
  const actBackBtn = document.getElementById("act-back");

  let mode = "login";
  const PENDING_ACTIVATION_CODE_KEY = "xxj_pending_activation_code_v1";
  const DISCORD_OAUTH_PENDING_KEY = "xxj_discord_oauth_pending_v1";
  const OAUTH_CODE_KEY = "xxj_oauth_code_v1";
  const OAUTH_ERROR_KEY = "xxj_oauth_error_v1";
  const OAUTH_ACCESS_KEY = "xxj_oauth_access_v1";
  const OAUTH_REFRESH_KEY = "xxj_oauth_refresh_v1";
  let _sbClient = null;
  let _sbCacheKey = "";
  let _authStateSubscribed = false;
  let _backgroundRestoreTimer = 0;

  function getCreateClient() {
    const g = globalThis.supabase;
    return g && typeof g.createClient === "function" ? g.createClient : null;
  }

  function getSupabaseClient() {
    const createClient = getCreateClient();
    if (!createClient) return null;
    const url = SB_DEFAULT?.url;
    const key = SB_DEFAULT?.key;
    if (!url || !key) return null;
    const cacheKey = `${url}\n${key}`;
    if (_sbClient && _sbCacheKey === cacheKey) return _sbClient;
    _sbClient = createClient(url, key, {
      auth: {
        storage: localStorage,
        storageKey: "sb-mjzkdcolyziugzcwwiyk-auth-token",
        persistSession: false,
        autoRefreshToken: true,
        detectSessionInUrl: true,
        flowType: "pkce"
      }
    });
    _sbCacheKey = cacheKey;
    ensureAuthStateListener(_sbClient);
    return _sbClient;
  }

  function qqToEmail(qq) {
    return `${qq}@qq-xxj.invalid`;
  }

  async function persistSupabaseSession(session) {
    if (!session?.access_token || !session?.refresh_token) return;
    window.XXJ_DB.setKv(SESSION_KEY, {
      access_token: session.access_token,
      refresh_token: session.refresh_token,
      expires_at: session.expires_at
    });
    window.XXJ_DB.setKv(TOKEN_KEY, session.access_token);
    if (typeof window.XXJ_DB.flushAllKvNow === "function") {
      await window.XXJ_DB.flushAllKvNow();
    }
  }

  function clearSupabaseSessionKv() {
    window.XXJ_DB.delKv(SESSION_KEY);
    window.XXJ_DB.delKv(TOKEN_KEY);
  }

  function readStoredSessionPayload() {
    const raw = window.XXJ_DB.getKv(SESSION_KEY);
    if (!raw) return null;
    try {
      let p = raw;
      if (typeof p === "string") {
        p = JSON.parse(p);
        if (typeof p === "string") p = JSON.parse(p);
      }
      if (!p || typeof p !== "object" || !p.access_token || !p.refresh_token) return null;
      return p;
    } catch {
      return null;
    }
  }

  /** 网络抖动等暂态错误：保留本地会话，不逼用户重登 */
  function isTransientAuthError(error) {
    if (!error) return true;
    const m = String(error.message || error).toLowerCase();
    if (/fetch|network|timeout|timed out|failed to fetch|aborted|econnrefused|offline/i.test(m)) {
      return true;
    }
    const status = Number(error.status ?? error.statusCode);
    if (status === 408 || status === 429 || status >= 500) return true;
    return false;
  }

  /** 刷新令牌已失效等：才清除本地会话 */
  function isHardAuthSessionError(error) {
    if (!error) return false;
    if (isTransientAuthError(error)) return false;
    const m = String(error.message || error).toLowerCase();
    if (
      /invalid.*refresh|refresh_token|invalid_grant|session.*not.*found|user.*not.*found|jwt.*expired|token.*revoked|invalid.*credentials/i.test(
        m
      )
    ) {
      return true;
    }
    const status = Number(error.status ?? error.statusCode);
    return status === 401 || status === 403;
  }

  function ensureAuthStateListener(client) {
    if (!client || _authStateSubscribed) return;
    _authStateSubscribed = true;
    client.auth.onAuthStateChange((_event, session) => {
      if (session) void persistSupabaseSession(session);
    });
  }

  function delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  function getOAuthRedirectTo() {
    const u = new URL(window.location.href);
    u.hash = "";
    u.search = "";
    const path = u.pathname || "/";
    return `${u.origin}${path.endsWith("/") ? path : path + "/"}`;
  }

  const SB_AUTH_STORAGE_KEY = "sb-mjzkdcolyziugzcwwiyk-auth-token";
  const PKCE_VERIFIER_BACKUP_KEY = "xxj_pkce_verifier_backup_v1";
  const PKCE_VERIFIER_COOKIE = "xxj_pkce_v";

  function base64UrlEncode(bytes) {
    let bin = "";
    const arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    for (let i = 0; i < arr.length; i++) bin += String.fromCharCode(arr[i]);
    return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
  }

  function generateCodeVerifier() {
    const arr = new Uint8Array(32);
    crypto.getRandomValues(arr);
    return base64UrlEncode(arr);
  }

  async function generateCodeChallenge(verifier) {
    const data = new TextEncoder().encode(verifier);
    const hash = await crypto.subtle.digest("SHA-256", data);
    return base64UrlEncode(new Uint8Array(hash));
  }

  function persistPkceVerifier(verifier) {
    try {
      sessionStorage.setItem(PKCE_VERIFIER_BACKUP_KEY, verifier);
    } catch {
      /* ignore */
    }
    try {
      localStorage.setItem(PKCE_VERIFIER_BACKUP_KEY, verifier);
    } catch {
      /* ignore */
    }
    try {
      const secure = location.protocol === "https:" ? "; Secure" : "";
      document.cookie = `${PKCE_VERIFIER_COOKIE}=${encodeURIComponent(verifier)}; path=/; max-age=900; SameSite=Lax${secure}`;
    } catch {
      /* ignore */
    }
  }

  function readPkceVerifierFromCookie() {
    try {
      const parts = String(document.cookie || "").split(";");
      for (const part of parts) {
        const p = part.trim();
        if (p.startsWith(`${PKCE_VERIFIER_COOKIE}=`)) {
          return decodeURIComponent(p.slice(PKCE_VERIFIER_COOKIE.length + 1));
        }
      }
    } catch {
      /* ignore */
    }
    return "";
  }

  function readPkceVerifier() {
    try {
      const backup = sessionStorage.getItem(PKCE_VERIFIER_BACKUP_KEY);
      if (backup) return backup;
      const lsBackup = localStorage.getItem(PKCE_VERIFIER_BACKUP_KEY);
      if (lsBackup) return lsBackup;
      const cookieBackup = readPkceVerifierFromCookie();
      if (cookieBackup) return cookieBackup;
      const direct = localStorage.getItem(`${SB_AUTH_STORAGE_KEY}-code-verifier`);
      if (direct) return direct;
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k && k.includes("code-verifier")) {
          const v = localStorage.getItem(k);
          if (v) return v;
        }
      }
    } catch {
      /* ignore */
    }
    return "";
  }

  function clearPkceVerifierBackup() {
    try {
      sessionStorage.removeItem(PKCE_VERIFIER_BACKUP_KEY);
      localStorage.removeItem(PKCE_VERIFIER_BACKUP_KEY);
      localStorage.removeItem(`${SB_AUTH_STORAGE_KEY}-code-verifier`);
      document.cookie = `${PKCE_VERIFIER_COOKIE}=; path=/; max-age=0`;
    } catch {
      /* ignore */
    }
  }

  async function buildManualDiscordOAuthUrl() {
    const verifier = generateCodeVerifier();
    const challenge = await generateCodeChallenge(verifier);
    persistPkceVerifier(verifier);
    const params = new URLSearchParams({
      provider: "discord",
      redirect_to: getOAuthRedirectTo(),
      scopes: "identify email",
      code_challenge: challenge,
      code_challenge_method: "s256"
    });
    return `${SB_DEFAULT.url}/auth/v1/authorize?${params.toString()}`;
  }

  async function manualPkceTokenExchange(code) {
    const verifier = readPkceVerifier();
    if (!verifier) return { session: null, error: new Error("pkce_verifier_missing") };
    try {
      const res = await fetch(`${SB_DEFAULT.url}/auth/v1/token?grant_type=pkce`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          apikey: SB_DEFAULT.key,
          Authorization: `Bearer ${SB_DEFAULT.key}`
        },
        body: JSON.stringify({
          auth_code: code,
          code_verifier: verifier
        })
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        const msg = body?.error_description || body?.msg || body?.error || `token ${res.status}`;
        return { session: null, error: new Error(String(msg)) };
      }
      const client = getSupabaseClient();
      if (!client || !body?.access_token || !body?.refresh_token) {
        return { session: null, error: new Error("token_response_invalid") };
      }
      const { data, error } = await client.auth.setSession({
        access_token: body.access_token,
        refresh_token: body.refresh_token
      });
      if (error || !data?.session) {
        return { session: null, error: error || new Error("no_session") };
      }
      try {
        clearPkceVerifierBackup();
      } catch {
        /* ignore */
      }
      return { session: data.session, error: null };
    } catch (err) {
      return { session: null, error: err instanceof Error ? err : new Error(String(err)) };
    }
  }

  function getOAuthCallbackParams() {
    const q = new URLSearchParams(window.location.search);
    const hashRaw = window.location.hash.replace(/^#/, "");
    const h = new URLSearchParams(hashRaw.includes("=") ? hashRaw : "");
    let code = q.get("code") || h.get("code");
    let accessToken = h.get("access_token") || q.get("access_token");
    let refreshToken = h.get("refresh_token") || q.get("refresh_token");
    let error = q.get("error") || h.get("error");
    let errorDescription = q.get("error_description") || h.get("error_description");
    try {
      if (!code) code = sessionStorage.getItem(OAUTH_CODE_KEY);
      if (!accessToken) accessToken = sessionStorage.getItem(OAUTH_ACCESS_KEY);
      if (!refreshToken) refreshToken = sessionStorage.getItem(OAUTH_REFRESH_KEY);
      if (!error) error = sessionStorage.getItem(OAUTH_ERROR_KEY);
    } catch {
      /* ignore */
    }
    return { code, accessToken, refreshToken, error, errorDescription };
  }

  function clearOAuthSnapshot() {
    clearOAuthParamsFromUrl();
    clearPkceVerifierBackup();
    try {
      sessionStorage.removeItem(OAUTH_CODE_KEY);
      sessionStorage.removeItem(OAUTH_ERROR_KEY);
      sessionStorage.removeItem(OAUTH_ACCESS_KEY);
      sessionStorage.removeItem(OAUTH_REFRESH_KEY);
    } catch {
      /* ignore */
    }
    document.documentElement.classList.remove("xxj-oauth-return");
  }

  function clearOAuthParamsFromUrl() {
    const path = window.location.pathname || "/";
    history.replaceState(null, "", path);
  }

  function hasOAuthCallbackInUrl() {
    if (document.documentElement.classList.contains("xxj-oauth-return")) return true;
    if (typeof window.__xxjHasOAuthReturnInUrl === "function" && window.__xxjHasOAuthReturnInUrl()) {
      return true;
    }
    const { code, accessToken, refreshToken, error } = getOAuthCallbackParams();
    return Boolean(code || error || (accessToken && refreshToken));
  }

  async function waitForSupabaseSdk(maxMs = 12000) {
    const start = Date.now();
    while (Date.now() - start < maxMs) {
      if (getCreateClient()) return true;
      await delay(80);
    }
    return false;
  }

  async function waitForSupabaseClient(maxMs = 12000) {
    const ok = await waitForSupabaseSdk(maxMs);
    if (!ok) return null;
    return getSupabaseClient();
  }

  async function readClientSession(client) {
    if (!client) return null;
    try {
      const { data, error } = await client.auth.getSession();
      if (error || !data?.session) return null;
      return data.session;
    } catch {
      return null;
    }
  }

  /** 等 SDK detectSessionInUrl 或换码完成，避免抢先清 URL 导致 PKCE 中断 */
  async function waitForClientSession(client, maxMs = 6000) {
    const start = Date.now();
    while (Date.now() - start < maxMs) {
      const session = await readClientSession(client);
      if (session) return session;
      await delay(120);
    }
    return null;
  }

  /**
   * Discord OAuth 跳回：换 session 并落盘（PKCE code / hash token / SDK 自动解析）。
   * @returns {Promise<{ session: object|null, error: Error|null }>}
   */
  async function completeOAuthRedirectIfPresent() {
    const { code, accessToken, refreshToken, error, errorDescription } = getOAuthCallbackParams();
    const pending = isDiscordOAuthPending();
    if (!code && !error && !(accessToken && refreshToken) && !pending) {
      return { session: null, error: null };
    }

    if (!(await waitForSupabaseSdk())) {
      return { session: null, error: new Error("Supabase 未就绪") };
    }

    const client = getSupabaseClient();
    if (!client) return { session: null, error: new Error("Supabase 未就绪") };

    if (error) {
      clearOAuthSnapshot();
      forceHideActivationScreen();
      return {
        session: null,
        error: new Error(decodeURIComponent(String(errorDescription || error).replace(/\+/g, " ")))
      };
    }

    ensureAuthStateListener(client);

    try {
      if (code) {
        let session = await waitForClientSession(client, 2800);
        if (session) {
          clearOAuthSnapshot();
          await persistSupabaseSession(session);
          return { session, error: null };
        }

        let lastErr = null;
        for (let attempt = 0; attempt < 3; attempt++) {
          const { data, error: exErr } = await client.auth.exchangeCodeForSession(code);
          if (!exErr && data?.session) {
            clearOAuthSnapshot();
            await persistSupabaseSession(data.session);
            return { session: data.session, error: null };
          }
          lastErr = exErr;
          session = await waitForClientSession(client, attempt === 0 ? 2200 : 1400);
          if (session) {
            clearOAuthSnapshot();
            await persistSupabaseSession(session);
            return { session, error: null };
          }
          const manual = await manualPkceTokenExchange(code);
          if (manual.session) {
            clearOAuthSnapshot();
            await persistSupabaseSession(manual.session);
            return { session: manual.session, error: null };
          }
          if (manual.error && manual.error.message !== "pkce_verifier_missing") {
            lastErr = manual.error;
          }
          if (attempt < 2) await delay(350 * (attempt + 1));
        }

        return { session: null, error: lastErr || new Error("Discord 登录未完成") };
      }

      if (accessToken && refreshToken) {
        const { data, error: sessErr } = await client.auth.setSession({
          access_token: accessToken,
          refresh_token: refreshToken
        });
        clearOAuthSnapshot();
        if (sessErr || !data?.session) {
          return { session: null, error: sessErr || new Error("no_session") };
        }
        await persistSupabaseSession(data.session);
        return { session: data.session, error: null };
      }

      if (pending) {
        const autoSession = await waitForClientSession(client, 4000);
        if (autoSession) {
          clearOAuthSnapshot();
          await persistSupabaseSession(autoSession);
          return { session: autoSession, error: null };
        }
      }

      return { session: null, error: new Error("Discord 登录未完成") };
    } catch (err) {
      return { session: null, error: err instanceof Error ? err : new Error(String(err)) };
    }
  }

  /** Discord 授权跳回：加载主应用并自动关掉开屏 */
  function autoEnterAfterOAuth() {
    if (typeof window.__xxjScheduleMainApp === "function") {
      window.__xxjScheduleMainApp();
    }

    const attemptDismiss = () => {
      if (typeof window.__xxjBootSplashTryArm === "function") window.__xxjBootSplashTryArm();
      if (!window.__xxjBootSplashArmed && typeof window.__xxjBootSplashArm === "function") {
        window.__xxjBootSplashArm();
      }
      if (window.__xxjBootSplashArmed && typeof window.__xxjBootSplashDismiss === "function") {
        window.__xxjBootSplashDismiss();
        return true;
      }
      if (typeof window.__xxjBootSplashDismissCore === "function" && window.__xxjBootSplashArmed) {
        window.__xxjBootSplashDismissCore();
        return true;
      }
      return false;
    };

    if (attemptDismiss()) return;

    window.addEventListener(
      "xxj-app-interactive",
      () => {
        window.setTimeout(attemptDismiss, 60);
      },
      { once: true }
    );

    let tries = 0;
    const timer = window.setInterval(() => {
      tries += 1;
      if (attemptDismiss() || tries >= 90) window.clearInterval(timer);
    }, 200);
  }

  function setDiscordButtonsBusy(busy) {
    for (const btn of [discordBtn, actDiscordBtn]) {
      if (!btn) continue;
      btn.disabled = busy;
      btn.textContent = busy ? "跳转 Discord…" : "用 Discord 登录";
    }
  }

  async function startDiscordOAuth() {
    markDiscordOAuthPending();
    forceHideActivationScreen();
    setDiscordButtonsBusy(true);
    setMsg("正在跳转 Discord…");
    try {
      const url = await buildManualDiscordOAuthUrl();
      window.location.assign(url);
    } catch (err) {
      clearDiscordOAuthPending();
      setDiscordButtonsBusy(false);
      setMsg(err?.message || "无法打开 Discord 登录", "error");
    }
  }

  async function finishOAuthLogin(session) {
    clearDiscordOAuthPending();
    clearOAuthSnapshot();
    forceHideActivationScreen();
    if (session) await persistSupabaseSession(session);
    applyUnlockedFromStoredSession();
    document.documentElement.classList.remove("xxj-oauth-return");
    overlay?.classList.remove("show");
    autoEnterAfterOAuth();
    if (session?.user) {
      const name =
        session.user.user_metadata?.full_name ||
        session.user.user_metadata?.name ||
        session.user.user_metadata?.preferred_username ||
        "Discord";
      setMsg(`欢迎，${name}`, "ok");
    }
  }

  async function handleOAuthReturn() {
    let oauth = await completeOAuthRedirectIfPresent();
    if (!oauth.session && isDiscordOAuthPending()) {
      await delay(800);
      oauth = await completeOAuthRedirectIfPresent();
    }
    if (oauth.session) {
      await finishOAuthLogin(oauth.session);
      return true;
    }
    clearDiscordOAuthPending();
    clearOAuthSnapshot();
    setMode("login");
    logoutBtn.hidden = true;
    showLoginOverlay();
    if (oauth.error) {
      setMsg(formatOAuthErr(oauth.error.message || "Discord 登录失败"), "error");
    } else {
      setMsg("Discord 登录未完成，请重试", "error");
    }
    return false;
  }

  /**
   * @returns {Promise<{ session: import('@supabase/supabase-js').Session|null, error: Error|null }>}
   */
  async function restoreSupabaseSessionIfAny() {
    const client = getSupabaseClient();
    if (!client) return { session: null, error: new Error("no_client") };
    ensureAuthStateListener(client);
    const p = readStoredSessionPayload();
    if (!p) return { session: null, error: null };
    try {
      const { data, error } = await client.auth.setSession({
        access_token: p.access_token,
        refresh_token: p.refresh_token
      });
      if (error || !data.session) {
        return { session: null, error: error || new Error("no_session") };
      }
      await persistSupabaseSession(data.session);
      return { session: data.session, error: null };
    } catch (err) {
      return { session: null, error: err instanceof Error ? err : new Error(String(err)) };
    }
  }

  function applyUnlockedFromStoredSession() {
    setLocked(false);
    logoutBtn.hidden = false;
    window.dispatchEvent(new CustomEvent("rp-auth-changed"));
  }

  function scheduleBackgroundSessionRestore() {
    if (_backgroundRestoreTimer) return;
    _backgroundRestoreTimer = window.setTimeout(async () => {
      _backgroundRestoreTimer = 0;
      if (!readStoredSessionPayload()) return;
      const { session, error } = await restoreSupabaseSessionIfAny();
      if (session) {
        applyUnlockedFromStoredSession();
        return;
      }
      if (error && isHardAuthSessionError(error)) {
        clearSupabaseSessionKv();
        setLocked(true);
        logoutBtn.hidden = true;
        window.dispatchEvent(new CustomEvent("rp-auth-changed"));
        return;
      }
      if (readStoredSessionPayload()) scheduleBackgroundSessionRestore();
    }, 2500);
  }

  function setMsg(text, type = "") {
    msg.textContent = text || "";
    msg.classList.remove("error", "ok");
    if (type) msg.classList.add(type);
  }

  function formatOAuthErr(raw) {
    const s = String(raw || "").trim();
    if (!s) return "Discord 登录失败";
    const lower = s.toLowerCase();
    if (lower === "server_error") {
      return (
        "Discord 服务端错误：Supabase 处理授权回调失败。请检查 Discord 开发者后台 OAuth2 重定向是否包含 " +
        "https://mjzkdcolyziugzcwwiyk.supabase.co/auth/v1/callback ，" +
        "以及 Supabase → Auth → Providers → Discord 是否填写了正确的 Client ID 与 Secret。"
      );
    }
    if (lower.includes("error getting user email") || lower.includes("email from external")) {
      return "Discord 账号未绑定或未验证邮箱，请先在 Discord 设置里添加并验证邮箱后再试";
    }
    if (lower.includes("pkce_verifier_missing")) {
      return "登录校验信息读取失败，请刷新后重试；若用桌面图标打开，请改浏览器地址栏直接访问";
    }
    if (lower.includes("oauth_code_missing")) {
      return "授权跳回未携带登录码，请在 Supabase Redirect URLs 添加 https://xixixitextxin.pages.dev/**";
    }
    if (lower.includes("redirect") && lower.includes("mismatch")) {
      return "回调地址不匹配，请检查 Supabase Redirect URLs 与 Discord OAuth2 重定向设置";
    }
    if (lower.startsWith("server_error:")) {
      return formatOAuthErr(s.split(":").slice(1).join(":").trim()) || formatOAuthErr("server_error");
    }
    return s;
  }

  function setLocked(locked) {
    document.body.classList.toggle("is-locked", locked);
    overlay.classList.toggle("show", locked);
  }

  function normalizeActivationCodeInput(raw) {
    return String(raw ?? "")
      .trim()
      .replace(/\s+/g, "");
  }

  function syncAuthModeUi() {
    const reg = mode !== "login";
    form?.classList.toggle("auth-form--register", reg);
    overlay?.classList.toggle("auth-overlay--register", reg);
    submitBtn.textContent = reg ? "注册并登录" : "登录";
    switchModeBtn.textContent = reg ? "已有账号？去登录" : "没有账号？去注册";
    if (passwordLabelText) passwordLabelText.textContent = reg ? "登录密码" : "密码";
    if (passwordInput) {
      passwordInput.placeholder = reg ? "6 位以上，自行设置" : "输入密码";
      passwordInput.autocomplete = reg ? "new-password" : "current-password";
    }
    if (activationCodeInput) activationCodeInput.required = reg;
    if (passwordConfirmInput) {
      passwordConfirmInput.required = reg;
      if (!reg) passwordConfirmInput.value = "";
    }
    if (reg && activationCodeInput && !String(activationCodeInput.value || "").trim()) {
      try {
        const c = sessionStorage.getItem(PENDING_ACTIVATION_CODE_KEY);
        if (c) activationCodeInput.value = c;
      } catch {
        /* ignore */
      }
    }
  }

  function setMode(nextMode) {
    mode = nextMode;
    setMsg("");
    syncAuthModeUi();
  }

  function showActivationScreen() {
    if (!activationEl) return;
    activationEl.hidden = false;
    document.body.classList.add("activation-open");
    overlay.classList.remove("show");
  }

  function hideActivationScreen() {
    if (!activationEl) return;
    activationEl.hidden = true;
    document.body.classList.remove("activation-open");
    if (document.body.classList.contains("is-locked")) {
      overlay.classList.add("show");
    }
  }

  function clearActivationHash() {
    if (location.hash === "#activation") {
      history.replaceState(null, "", location.pathname + location.search);
    }
  }

  function markDiscordOAuthPending() {
    try {
      sessionStorage.setItem(DISCORD_OAUTH_PENDING_KEY, "1");
    } catch {
      /* ignore */
    }
  }

  function clearDiscordOAuthPending() {
    try {
      sessionStorage.removeItem(DISCORD_OAUTH_PENDING_KEY);
    } catch {
      /* ignore */
    }
    document.documentElement.classList.remove("xxj-oauth-return");
  }

  function isDiscordOAuthPending() {
    const { code, accessToken, refreshToken, error } = getOAuthCallbackParams();
    if (code || error || (accessToken && refreshToken)) return true;
    try {
      if (document.documentElement.classList.contains("xxj-oauth-return")) return true;
      if (sessionStorage.getItem(OAUTH_CODE_KEY)) return true;
    } catch {
      /* ignore */
    }
    return false;
  }

  function forceHideActivationScreen() {
    clearActivationHash();
    hideActivationScreen();
  }

  function isOAuthReturnContext() {
    return hasOAuthCallbackInUrl() || isDiscordOAuthPending();
  }

  function showLoginOverlay() {
    forceHideActivationScreen();
    setLocked(true);
    overlay?.classList.add("show");
  }

  function syncActivationFromHash() {
    if (!activationEl) return;
    if (!document.body.classList.contains("is-locked") || readStoredSessionPayload()) {
      document.documentElement.classList.remove("xxj-oauth-return");
      forceHideActivationScreen();
      return;
    }
    if (isOAuthReturnContext()) return;
    if (location.hash === "#activation" && document.body.classList.contains("is-locked")) {
      showActivationScreen();
      return;
    }
    forceHideActivationScreen();
  }

  function setActMsg(text, kind) {
    if (!actMsg) return;
    actMsg.textContent = text || "";
    actMsg.classList.toggle("is-err", kind === "error");
  }

  async function bootAuth() {
    if (!SB_DEFAULT?.url || !SB_DEFAULT?.key) {
      setLocked(true);
      setMsg("缺少 Supabase 配置：请在 auth.js 中填写 SB_DEFAULT 的 url 与 key。", "error");
      return;
    }

    if (window.__xxjOAuthBootstrapErr && !window.__xxjOAuthBootstrapOk) {
      clearDiscordOAuthPending();
      clearOAuthSnapshot();
      setMode("login");
      logoutBtn.hidden = true;
      showLoginOverlay();
      setMsg(formatOAuthErr(window.__xxjOAuthBootstrapErr), "error");
      return;
    }

    const hadOAuthBootstrap = Boolean(window.__xxjOAuthBootstrapOk);
    if (readStoredSessionPayload()) {
      const sdkOk = await waitForSupabaseSdk(12000);
      if (sdkOk) {
        const restored = await restoreSupabaseSessionIfAny();
        if (restored.session) {
          clearDiscordOAuthPending();
          clearOAuthSnapshot();
          applyUnlockedFromStoredSession();
          if (hadOAuthBootstrap) autoEnterAfterOAuth();
          return;
        }
        if (restored.error && isHardAuthSessionError(restored.error)) {
          clearSupabaseSessionKv();
        } else if (readStoredSessionPayload()) {
          clearDiscordOAuthPending();
          clearOAuthSnapshot();
          applyUnlockedFromStoredSession();
          if (hadOAuthBootstrap) autoEnterAfterOAuth();
          return;
        }
      } else if (readStoredSessionPayload()) {
        clearDiscordOAuthPending();
        clearOAuthSnapshot();
        applyUnlockedFromStoredSession();
        if (hadOAuthBootstrap) autoEnterAfterOAuth();
        return;
      }
    }

    if (isOAuthReturnContext()) {
      forceHideActivationScreen();
      const ok = await handleOAuthReturn();
      if (ok) return;
    } else if (!(await waitForSupabaseSdk(8000))) {
      setLocked(true);
      setMsg("未加载 Supabase SDK，请检查网络后刷新页面。", "error");
      return;
    }

    const stored = readStoredSessionPayload();
    if (!stored) {
      clearSupabaseSessionKv();
      setMode("login");
      logoutBtn.hidden = true;
      showLoginOverlay();
      return;
    }

    let session = null;
    let lastError = null;
    for (let attempt = 0; attempt < 3; attempt++) {
      const result = await restoreSupabaseSessionIfAny();
      session = result.session;
      lastError = result.error;
      if (session) break;
      if (lastError && isHardAuthSessionError(lastError)) break;
      if (attempt < 2) await delay(350 * (attempt + 1));
    }

    if (session) {
      applyUnlockedFromStoredSession();
      return;
    }

    if (lastError && isHardAuthSessionError(lastError)) {
      clearSupabaseSessionKv();
      clearActivationHash();
      hideActivationScreen();
      setMode("login");
      logoutBtn.hidden = true;
      setLocked(true);
      setMsg("登录已过期，请重新登录。", "error");
      return;
    }

    // 有本地会话但暂时连不上：先放行桌面，后台再试恢复
    applyUnlockedFromStoredSession();
    scheduleBackgroundSessionRestore();
  }

  document.addEventListener("rp-open-auth-overlay", async () => {
    clearActivationHash();
    hideActivationScreen();
    setLocked(true);
    setMsg("");
    const { session } = await restoreSupabaseSessionIfAny();
    if (session || readStoredSessionPayload()) {
      logoutBtn.hidden = false;
    } else {
      setMode("login");
      logoutBtn.hidden = true;
    }
    window.dispatchEvent(new CustomEvent("rp-auth-changed"));
  });

  window.addEventListener("online", () => {
    if (readStoredSessionPayload()) scheduleBackgroundSessionRestore();
  });

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState !== "visible") return;
    if (!readStoredSessionPayload()) return;
    if (!document.body.classList.contains("is-locked")) {
      void restoreSupabaseSessionIfAny();
      return;
    }
    scheduleBackgroundSessionRestore();
  });

  switchModeBtn.addEventListener("click", () => {
    setMode(mode === "login" ? "register" : "login");
  });

  for (const btn of [discordBtn, actDiscordBtn]) {
    btn?.addEventListener("click", () => {
      void startDiscordOAuth();
    });
  }

  logoutBtn.addEventListener("click", async () => {
    const client = getSupabaseClient();
    try {
      await client?.auth.signOut();
    } catch {
      /* ignore */
    }
    clearSupabaseSessionKv();
    setLocked(true);
    logoutBtn.hidden = true;
    setMode("login");
    setMsg("已退出登录");
    clearActivationHash();
    hideActivationScreen();
    window.dispatchEvent(new CustomEvent("rp-auth-changed"));
  });

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const rawId = usernameInput.value.trim();
    const password = passwordInput.value;
    if (!rawId || !password) {
      setMsg("请输入 QQ 号和密码", "error");
      return;
    }
    if (!/^\d{5,12}$/.test(rawId)) {
      setMsg("请填写有效的 QQ 号", "error");
      return;
    }
    const client = getSupabaseClient();
    if (!client) {
      setMsg("Supabase 未就绪", "error");
      return;
    }
    const email = qqToEmail(rawId);
    submitBtn.disabled = true;
    setMsg("处理中...");
    try {
      if (mode === "login") {
        const { data, error } = await client.auth.signInWithPassword({ email, password });
        if (error) throw new Error(error.message || "登录失败");
        await persistSupabaseSession(data.session);
      } else {
        const actCode = normalizeActivationCodeInput(activationCodeInput?.value);
        if (!actCode) {
          throw new Error("请填写领取到的激活码。");
        }
        const confirm = passwordConfirmInput?.value ?? "";
        if (!confirm) {
          throw new Error("请再次输入登录密码确认。");
        }
        if (password !== confirm) {
          throw new Error("两次输入的密码不一致。");
        }
        const { data: boundCode, error: errBound } = await client.rpc("xxj_activation_claim_by_qq", {
          qq_input: rawId
        });
        if (errBound) throw new Error(errBound.message || "校验激活码失败");
        const serverCode = normalizeActivationCodeInput(boundCode);
        if (!serverCode) {
          throw new Error("请先为该 QQ 领取激活码，再注册。");
        }
        if (serverCode !== actCode) {
          throw new Error("激活码不正确，请填写领码页显示的那一串。");
        }
        const { data, error } = await client.auth.signUp({
          email,
          password,
          options: { data: { qq: rawId } }
        });
        if (error) throw new Error(error.message || "注册失败");
        if (!data.session) {
          throw new Error(
            "注册未返回会话：请在 Supabase Authentication 中关闭「Confirm email / 邮箱确认」，或完成邮箱验证后再试。"
          );
        }
        await persistSupabaseSession(data.session);
        try {
          sessionStorage.removeItem(PENDING_ACTIVATION_CODE_KEY);
        } catch {
          /* ignore */
        }
      }
      setLocked(false);
      logoutBtn.hidden = false;
      setMsg("登录成功", "ok");
      clearActivationHash();
      hideActivationScreen();
      window.dispatchEvent(new CustomEvent("rp-auth-changed"));
    } catch (error) {
      setMsg(error.message || "操作失败", "error");
    } finally {
      submitBtn.disabled = false;
    }
  });

  window.addEventListener("hashchange", () => {
    if (isOAuthReturnContext()) {
      showLoginOverlay();
      return;
    }
    syncActivationFromHash();
  });

  actBackBtn?.addEventListener("click", () => {
    clearActivationHash();
    hideActivationScreen();
    setMode("register");
    setLocked(true);
  });

  actClaimBtn?.addEventListener("click", async () => {
    const qq = String(actQq?.value || "").trim();
    if (!/^\d{5,12}$/.test(qq)) {
      setActMsg("请填写有效的 QQ 号", "error");
      return;
    }
    const client = getSupabaseClient();
    if (!client) {
      setActMsg("Supabase 未就绪", "error");
      return;
    }
    actClaimBtn.disabled = true;
    setActMsg("领取中…");
    if (actResult) actResult.hidden = true;
    try {
      const { data, error } = await client.rpc("xxj_activation_claim_by_qq", { qq_input: qq });
      if (error) {
        const m = error.message || "";
        if (/invalid_qq|P0001/i.test(m) || m.toLowerCase().includes("invalid_qq")) {
          setActMsg("QQ 号格式无效", "error");
        } else {
          setActMsg(m || "领取失败", "error");
        }
        return;
      }
      if (!data) {
        setActMsg("码池已空或暂无可用码。", "error");
        return;
      }
      if (actCode) actCode.textContent = String(data);
      try {
        const c = normalizeActivationCodeInput(String(data));
        if (c) sessionStorage.setItem(PENDING_ACTIVATION_CODE_KEY, c);
      } catch {
        /* ignore */
      }
      if (actResult) actResult.hidden = false;
      setActMsg("领码成功，请返回登录页注册：填 QQ、激活码和登录密码。");
    } finally {
      actClaimBtn.disabled = false;
    }
  });

  actCopyBtn?.addEventListener("click", async () => {
    const t = String(actCode?.textContent || "").trim();
    if (!t) return;
    try {
      await navigator.clipboard.writeText(t);
      setActMsg("已复制到剪贴板");
    } catch {
      setActMsg("复制失败", "error");
    }
  });

  setMode("login");
  window.__xxjAuthBootPromise = bootAuth().finally(() => {
    syncActivationFromHash();
  });
})();
