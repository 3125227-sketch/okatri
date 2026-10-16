// ====== 設定：Supabase ＆ Gemini APIキー ======
const SUPABASE_URL = "https://dkbcnzrniknrvnflnytc.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_-R_mW2C1dAA-ODy1eg8L6g_lQ5h4DHQ";
const GEMINI_API_KEY = "AIzaSyBUpcoiqVlF5u_PhZR64ZblNk4HU326GFs";

// Supabaseクライアントの初期化
const isSupabaseReady = SUPABASE_URL && SUPABASE_URL.startsWith("http") && SUPABASE_ANON_KEY;
const db = isSupabaseReady ? supabase.createClient(SUPABASE_URL.trim(), SUPABASE_ANON_KEY.trim()) : null;

function generateUniqueId(prefix = 'id') {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return `${prefix}_${crypto.randomUUID()}`;
  }
  const timestamp = Date.now().toString(36);
  const perf = (performance.now() * 1000).toFixed(0).toString(36);
  const randomStr = Math.random().toString(36).substring(2, 10);
  return `${prefix}_${timestamp}_${perf}_${randomStr}`;
}

function parseArray(val) {
  if (Array.isArray(val)) return val;
  try { return JSON.parse(val || "[]"); } catch(e){ return []; }
}

function calculateDistance(lat1, lon1, lat2, lon2) {
  const R = 6371e3;
  const φ1 = lat1 * Math.PI / 180;
  const φ2 = lat2 * Math.PI / 180;
  const Δφ = (lat2 - lat1) * Math.PI / 180;
  const Δλ = (lon2 - lon1) * Math.PI / 180;

  const a = Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
            Math.cos(φ1) * Math.cos(φ2) *
            Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

function safeOnClick(id, handler) {
  const el = document.getElementById(id);
  if (el) el.onclick = handler;
}

function getInitialTimeSlot() {
  const h = new Date().getHours();
  return (h >= 3 && h < 18) ? "day" : "night";
}

function isInsideOkayama(lat, lng, address) {
  const inCoords = (lat >= 34.25 && lat <= 35.38 && lng >= 133.30 && lng <= 134.45);
  const inAddress = typeof address === 'string' && (
    address.includes("岡山") || address.includes("倉敷") || address.includes("津山") ||
    address.includes("玉野") || address.includes("笠岡") || address.includes("井原") ||
    address.includes("総社") || address.includes("高梁") || address.includes("新見") ||
    address.includes("備前") || address.includes("瀬戸内") || address.includes("赤磐") ||
    address.includes("真庭") || address.includes("美作") || address.includes("浅口")
  );
  return inCoords || inAddress;
}

async function geocodeAddress(address) {
  if (!address || address.trim() === "") return null;

  // ① 住所の整形（郵便番号の削除・全角数字ハイフンの半角化）
  let clean = address.trim();
  clean = clean.replace(/〒?\s*\d{3}-\d{4}/g, "").replace(/〒/g, "").trim();
  clean = clean.replace(/[Ａ-Ｚａ-ｚ０-９]/g, s => String.fromCharCode(s.charCodeAt(0) - 0xFEE0));
  clean = clean.replace(/[－―ー–—〜]/g, "-").trim();

  // ② 番地を取り除いた「町名レベル」の文字列を作成（例: 岡山市北区駅元町1-1 -> 岡山市北区駅元町）
  const noNumbers = clean.replace(/[\d-ー〜−]+.*$/, "").trim();

  // 検索クエリのフォールバック優先順位
  const candidateQueries = [];
  candidateQueries.push(clean); // 1. 入力されたままの住所
  if (noNumbers && noNumbers !== clean && noNumbers.length >= 3) {
    candidateQueries.push(noNumbers); // 2. 番地を除いた町名レベル
  }
  if (!clean.includes("岡山")) {
    candidateQueries.push(`岡山県 ${clean}`);
    if (noNumbers) candidateQueries.push(`岡山県 ${noNumbers}`);
  }

  const viewbox = "133.30,35.38,134.45,34.25";

  for (const q of candidateQueries) {
    if (!q || q.length < 2) continue;
    try {
      const url = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(q)}&bounded=1&viewbox=${viewbox}&countrycodes=jp&limit=5`;
      const res = await fetch(url);
      const data = await res.json();

      if (data && data.length > 0) {
        // 「北区」や「岡山市」全体の広域中心点 (administrative) ではなく、町名やスポット単位の結果を優先採用
        const match = data.find(item => {
          const lat = parseFloat(item.lat);
          const lng = parseFloat(item.lon);
          const inOkayama = (lat >= 34.2 && lat <= 35.4 && lng >= 133.2 && lng <= 134.5);
          // 行政区全体・都道府県全体などの大雑把なヒットを撥ねる
          const isTooBroad = (item.type === "administrative" || item.addresstype === "administrative" || item.type === "state");
          return inOkayama && !isTooBroad;
        });

        if (match) {
          return {
            lat: parseFloat(match.lat),
            lng: parseFloat(match.lon)
          };
        }
      }
    } catch (e) {
      console.warn("住所検索エラー:", e);
    }
  }

  return null;
}

// アプリステート
let currentUser = JSON.parse(localStorage.getItem("okatari_user")) || null;
let currentActiveTimeMode = getInitialTimeSlot();
let postsData = [];
let allUsersData = [];
let commentsData = [];
let pickupsData = [];
let announcementsData = [];
let aiMasterSpotsData = [];
let masterBadgesData = [];
let stampRalliesData = [];
let sharedRoutesData = []; // ★ 追加
let currentGeneratingRouteData = null; // ★ 追加
let notificationsData = [];
let appAboutData = null;
let mapInstance = null;
let mapMarkers = [];
let userCurrentLocationMarker = null;

// 複数画像ファイル管理
let currentUploadedFiles = [];
let currentUploadedImagesBase64 = [];
let currentUploadedBase64 = "";
let currentAvatarBase64 = "";
let currentLatitude = 34.6618;
let currentLongitude = 133.9350;
let routeFilterMode = "all";
let currentSortMode = "newest";
let currentProfileTab = "posts";
let currentModalUserIds = [];
let currentDmTargetUserId = null;
let currentReplyingCommentId = null;

// ページネーション管理
let currentPostPage = 0;
const POSTS_PER_PAGE = 20;
let hasMorePosts = true;
let isLoadingPosts = false;

// ====================================================
// 1. 初期化・データ取得
// ====================================================
async function initApp() {
  updateUserUI();
  setupNavigation();
  initOkayamaMap();
  setupEventListeners();
  updateTimeModeUI();

  if (db) {
    const safeFetch = async (queryPromise, defaultValue) => {
      try {
        const res = await queryPromise;
        if (res.error) return defaultValue;
        return res.data || defaultValue;
      } catch (err) {
        return defaultValue;
      }
    };

    try {
      const [users, comments, pickups, news, aiSpots, badges, about, rallies, routes] = await Promise.all([
        safeFetch(db.from("users_custom").select("*"), []),
        safeFetch(db.from("comments").select("*").order("created_at", { ascending: true }), []),
        safeFetch(db.from("pickups").select("*"), []),
        safeFetch(db.from("announcements").select("*").eq("active", true), []),
        safeFetch(db.from("ai_master_spots").select("*"), []),
        safeFetch(db.from("achievements_master").select("*"), []),
        safeFetch(db.from("app_about").select("*").eq("id", "about_main").maybeSingle(), null),
        safeFetch(db.from("stamp_rallies").select("*").eq("active", true), []),
        safeFetch(db.from("shared_routes").select("*").order("created_at", { ascending: false }), []) // ★ Supabaseからルート一覧を取得
      ]);

      if (users) allUsersData = users;
      if (comments) commentsData = comments;
      if (pickups) pickupsData = pickups;
      if (news && news.length > 0) announcementsData = news;
      if (aiSpots) aiMasterSpotsData = aiSpots;

      if (badges && badges.length > 0) {
        masterBadgesData = badges;
      } else {
        masterBadgesData = [
          { code: "OKATRI2026", title: "オカトリ開拓者", description: "オカトリの初期メンバーに贈られる栄誉バッジ", image_url: "https://images.unsplash.com/photo-1579783900882-c0d3dad7b119?auto=format&fit=crop&w=150&q=80" },
          { code: "KORAKUEN", title: "後楽園の達人", description: "日本三名園・岡山後楽園を深く知る旅人", image_url: "https://images.unsplash.com/photo-1503899036084-c55cdd92da26?auto=format&fit=crop&w=150&q=80" },
          { code: "KURASHIKI", title: "倉敷レトロマスター", description: "美観地区の白壁と歴史ある町並みを巡った証", image_url: "https://images.unsplash.com/photo-1493976040374-85c8e12f0c0e?auto=format&fit=crop&w=150&q=80" }
        ];
      }

      if (rallies && rallies.length > 0) {
        stampRalliesData = rallies.map(r => ({ ...r, spots: parseArray(r.spots) }));
      } else {
        stampRalliesData = [];
      }

      // ★ 共有ルートデータのセット
      if (routes && routes.length > 0) {
        sharedRoutesData = routes.map(r => ({ ...r, spots: parseArray(r.spots) }));
      }

      appAboutData = about;

      if (currentUser) {
        const me = allUsersData.find(u => u.user_id === currentUser.userId);
        if (me) {
          currentUser = {
            userId: me.user_id,
            username: me.user_id,
            nickname: me.nickname,
            bio: me.bio,
            email: me.email || "",
            avatar: me.avatar || "",
            is_admin: me.is_admin || false,
            following: parseArray(me.following),
            followers: parseArray(me.followers),
            bookmarks: parseArray(me.bookmarks),
            achievements: parseArray(me.achievements),
            featured_badges: parseArray(me.featured_badges),
            stamps: parseArray(me.stamps),
            blocked_users: parseArray(me.blocked_users),
            muted_users: parseArray(me.muted_users),
            notify_settings: me.notify_settings || { likes: true, comments: true, follows: true }
          };
          localStorage.setItem("okatari_user", JSON.stringify(currentUser));
          updateUserUI();
          fetchNotifications();
        }
      }
    } catch (e) {
      console.warn("初期化エラー:", e);
    }
  }

  await fetchPostsPaged(true);

  renderAnnouncements();
  renderPickups();
  renderRouteSpotCheckboxes();
  renderUserSearch(allUsersData);
  updateMapMarkers();
  renderMyProfileSpots();
  renderMyAchievements();
  renderPokedex();
  renderStampRallies();
  renderAboutPage();

  const urlParams = new URLSearchParams(window.location.search);
  const targetPostId = urlParams.get("post");
  if (targetPostId) {
    const targetPost = postsData.find(p => p.id === targetPostId);
    if (targetPost) setTimeout(() => openDetail(targetPost), 400);
  }
}

// ページネーション（20件取得）
async function fetchPostsPaged(reset = false) {
  if (isLoadingPosts || (!hasMorePosts && !reset)) return;
  isLoadingPosts = true;

  if (reset) {
    currentPostPage = 0;
    postsData = [];
    hasMorePosts = true;
  }

  const from = currentPostPage * POSTS_PER_PAGE;
  const to = from + POSTS_PER_PAGE - 1;

  if (db) {
    const { data, error } = await db
      .from("posts")
      .select("*")
      .order("created_at", { ascending: false })
      .range(from, to);

    if (!error && data) {
      if (data.length < POSTS_PER_PAGE) hasMorePosts = false;
      postsData = [...postsData, ...data];
      currentPostPage++;
      applySortAndRender();
      updateMapMarkers();
    }
  } else {
    hasMorePosts = false;
    applySortAndRender();
  }
  isLoadingPosts = false;
}

// ====================================================
// ★ 複数枚画像のStorageアップロード
// ====================================================
async function uploadMultipleImagesToStorage(base64Array) {
  if (!db || !base64Array || base64Array.length === 0) return [];
  const urls = [];

  for (let i = 0; i < base64Array.length; i++) {
    try {
      const b64 = base64Array[i];
      const byteString = atob(b64.split(',')[1]);
      const ab = new ArrayBuffer(byteString.length);
      const ia = new Uint8Array(ab);
      for (let j = 0; j < byteString.length; j++) ia[j] = byteString.charCodeAt(j);
      const blob = new Blob([ab], { type: 'image/jpeg' });

      const fileName = `${Date.now()}_${i}_${Math.random().toString(36).substring(2, 7)}.jpg`;
      const filePath = `spots/${fileName}`;

      const { error: uploadError } = await db.storage
        .from('post_images')
        .upload(filePath, blob, { contentType: 'image/jpeg', cacheControl: '3600', upsert: false });

      if (!uploadError) {
        const { data } = db.storage.from('post_images').getPublicUrl(filePath);
        urls.push(data.publicUrl);
      } else {
        urls.push(b64);
      }
    } catch (err) {
      urls.push(base64Array[i]);
    }
  }
  return urls;
}
// 台紙画像をSupabase Storageに保存する関数
async function uploadBgImageToStorage(file) {
  if (!db || !file) return "";
  try {
    const fileName = `rally_bg_${Date.now()}_${Math.random().toString(36).substring(2, 7)}.jpg`;
    const filePath = `rallies/${fileName}`;

    const { error: uploadError } = await db.storage
      .from('post_images')
      .upload(filePath, file, { contentType: file.type || 'image/jpeg', upsert: false });

    if (!uploadError) {
      const { data } = db.storage.from('post_images').getPublicUrl(filePath);
      return data.publicUrl;
    }
  } catch (err) {
    console.warn("台紙画像のアップロード失敗:", err);
  }
  return "";
}
// ====================================================
// ★ 通知の送信・取得
// ====================================================
async function sendNotification(toUserId, type, postId = null, postTitle = null) {
  if (!db || !currentUser || currentUser.userId === toUserId) return;

  const targetUser = allUsersData.find(u => u.user_id === toUserId);
  if (targetUser && targetUser.notify_settings) {
    const settings = typeof targetUser.notify_settings === 'string' ? JSON.parse(targetUser.notify_settings) : targetUser.notify_settings;
    if (type === 'like' && !settings.likes) return;
    if (type === 'comment' && !settings.comments) return;
    if (type === 'follow' && !settings.follows) return;
  }

  const newNotify = {
    id: generateUniqueId("notif"),
    to_user_id: toUserId,
    from_user_id: currentUser.userId,
    from_nickname: currentUser.nickname,
    type: type,
    post_id: postId,
    post_title: postTitle,
    is_read: false
  };

  await db.from("notifications").insert([newNotify]);
}

async function fetchNotifications() {
  if (!db || !currentUser) return;
  const { data } = await db
    .from("notifications")
    .select("*")
    .eq("to_user_id", currentUser.userId)
    .order("created_at", { ascending: false })
    .limit(30);

  if (data) {
    notificationsData = data;
    const unreadCount = data.filter(n => !n.is_read).length;
    
    const mBadge = document.getElementById("mobileNotifyCount");
    const sBadge = document.getElementById("sidebarNotifyCount");

    if (mBadge) {
      mBadge.textContent = unreadCount;
      mBadge.style.display = unreadCount > 0 ? "inline-block" : "none";
    }
    if (sBadge) {
      sBadge.textContent = unreadCount;
      sBadge.style.display = unreadCount > 0 ? "inline-block" : "none";
    }
  }
}

function renderNotificationsPage() {
  const container = document.getElementById("notifyPageListContainer");
  if (!container) return;
  container.innerHTML = "";

  if (!currentUser) {
    container.innerHTML = `<div class="empty-state">ログインすると通知が表示されます</div>`;
    return;
  }

  if (notificationsData.length === 0) {
    container.innerHTML = `<div class="empty-state">新しい通知はありません</div>`;
  } else {
    notificationsData.forEach(n => {
      const item = document.createElement("div");
      item.className = `notify-item ${n.is_read ? '' : 'unread'}`;
      let icon = '<i class="fa-solid fa-bell"></i>';
      let text = '';

      if (n.type === 'like') {
        icon = '<div class="notify-icon like"><i class="fa-solid fa-heart"></i></div>';
        text = `<b>${n.from_nickname}</b> さんがあなたの投稿「${n.post_title || 'スポット'}」にいいねしました`;
      } else if (n.type === 'comment') {
        icon = '<div class="notify-icon comment"><i class="fa-solid fa-comment"></i></div>';
        text = `<b>${n.from_nickname}</b> さんがあなたの投稿「${n.post_title || 'スポット'}」にコメントしました`;
      } else if (n.type === 'follow') {
        icon = '<div class="notify-icon follow"><i class="fa-solid fa-user-plus"></i></div>';
        text = `<b>${n.from_nickname}</b> さんにフォローされました`;
      }

      item.innerHTML = `
        ${icon}
        <div style="flex:1;">${text}</div>
      `;

      item.onclick = async () => {
        if (!n.is_read && db) {
          n.is_read = true;
          await db.from("notifications").update({ is_read: true }).eq("id", n.id);
          fetchNotifications();
        }
        if (n.post_id) {
          const p = postsData.find(x => x.id === n.post_id);
          if (p) openDetail(p);
        } else if (n.type === 'follow') {
          openUserProfile(n.from_user_id, n.from_nickname);
        }
      };

      container.appendChild(item);
    });
  }
}

// ====================================================
// 2. ナビゲーション
// ====================================================
function setupNavigation() {
  const navElements = document.querySelectorAll(".sidebar-item, .mobile-bottom-nav .nav-item, .drawer-item");
  const tabPanes = document.querySelectorAll(".tab-pane");
  const pageTitle = document.getElementById("pageTitle");

  navElements.forEach(item => {
    item.addEventListener("click", () => {
      const tabId = item.getAttribute("data-tab");
      if (!tabId) return;

      navElements.forEach(n => n.classList.remove("active"));
      document.querySelectorAll(`[data-tab="${tabId}"]`).forEach(el => el.classList.add("active"));
      tabPanes.forEach(p => p.classList.remove("active"));
      
      const targetPane = document.getElementById(tabId);
      if (targetPane) targetPane.classList.add("active");

      if (pageTitle) {
        const textLabel = item.textContent.replace(/^[^\w\u3000-\u30FF\u4E00-\u9FFF]+/, '').trim();
        pageTitle.textContent = textLabel || "OKATRI";
      }

      closeMobileDrawer();

      if (tabId === "tabArea" && mapInstance) {
        setTimeout(() => {
          mapInstance.invalidateSize();
          updateMapMarkers();
        }, 200);
      }
      if (tabId === "tabRoutes") renderRouteSpotCheckboxes();
      if (tabId === "tabAccounts") renderUserSearch(allUsersData);
      if (tabId === "tabAchievements") {
        renderPokedex();
        renderStampRallies();
      }
      if (tabId === "tabProfile") {
        renderMyProfileSpots();
        renderMyAchievements();
      }
      if (tabId === "tabNewsPage") renderAnnouncements();
      if (tabId === "tabAbout") renderAboutPage();
      if (tabId === "tabNotifications") {
        renderNotificationsPage();
      }
    });
  });

  const appMain = document.querySelector(".app-main");
  if (appMain) {
    appMain.addEventListener("scroll", () => {
      if (appMain.scrollTop + appMain.clientHeight >= appMain.scrollHeight - 300) {
        if (hasMorePosts && !isLoadingPosts) fetchPostsPaged();
      }
    });
  }

  safeOnClick("mobileNotifyBellBtn", () => {
    document.querySelectorAll('[data-tab="tabNotifications"]').forEach(el => el.click());
  });
  safeOnClick("closeNotifyModalBtn", () => document.getElementById("notifyModal").classList.remove("show"));

  safeOnClick("goNewsPageBtn", () => {
  const notifyModal = document.getElementById("notifyModal");
  if (notifyModal) {
    notifyModal.classList.add("show");
    const notifyTabOfficialBtn = document.getElementById('notifyTabOfficialBtn');
    if (notifyTabOfficialBtn) notifyTabOfficialBtn.click();
  }
});

  safeOnClick("claimCodeBtnNav", () => {
    if (!currentUser) { alert("ログインが必要です"); return; }
    document.getElementById("claimAchievementModal").classList.add("show");
  });

  safeOnClick("goToSettingsBtn", openSettingsPage);
  safeOnClick("drawerSettingsLink", openSettingsPage);
  safeOnClick("backFromSettingsBtn", () => {
    document.querySelectorAll('[data-tab="tabProfile"]').forEach(el => el.click());
  });
  safeOnClick("backFromDmBtn", () => {
    document.querySelectorAll('[data-tab="tabProfile"]').forEach(el => el.click());
  });

  safeOnClick("pTabMyPostsBtn", () => {
    currentProfileTab = "posts";
    document.getElementById("pTabMyPostsBtn").classList.add("active");
    document.getElementById("pTabBookmarksBtn").classList.remove("active");
    renderMyProfileSpots();
  });

  safeOnClick("pTabBookmarksBtn", () => {
    currentProfileTab = "bookmarks";
    document.getElementById("pTabBookmarksBtn").classList.add("active");
    document.getElementById("pTabMyPostsBtn").classList.remove("active");
    renderMyProfileSpots();
  });
}

function openSettingsPage() {
  if (!currentUser) return;
  const userIdEl = document.getElementById("settingsUserId");
  const nick = document.getElementById("settingsNickname");
  const bio = document.getElementById("settingsBio");
  const emailEl = document.getElementById("settingsEmail");
  const nLikes = document.getElementById("notifySettingLikes");
  const nCmts = document.getElementById("notifySettingComments");
  const nFollows = document.getElementById("notifySettingFollows");

  if (userIdEl) userIdEl.value = currentUser.userId || "";
  if (nick) nick.value = currentUser.nickname || "";
  if (bio) bio.value = currentUser.bio || "";
  if (emailEl) emailEl.value = currentUser.email || "";

  if (currentUser.notify_settings) {
    const s = currentUser.notify_settings;
    if (nLikes) nLikes.checked = s.likes !== false;
    if (nCmts) nCmts.checked = s.comments !== false;
    if (nFollows) nFollows.checked = s.follows !== false;
  }

  const preview = document.getElementById("settingsAvatarPreview");
  if (preview) preview.innerHTML = currentUser.avatar ? `<img src="${currentUser.avatar}">` : `<i class="fa-solid fa-user"></i>`;
  currentAvatarBase64 = currentUser.avatar || "";
  
  document.querySelectorAll(".tab-pane").forEach(p => p.classList.remove("active"));
  document.getElementById("tabSettings").classList.add("active");
  document.getElementById("pageTitle").textContent = "アカウント設定";
}

function openMobileDrawer() {
  document.getElementById("mobileDrawer").classList.add("show");
  document.getElementById("drawerOverlay").classList.add("show");
}
function closeMobileDrawer() {
  document.getElementById("mobileDrawer").classList.remove("show");
  document.getElementById("drawerOverlay").classList.remove("show");
}

function updateTimeModeUI() {
  const icon = document.getElementById("timeModeIcon");
  const label = document.getElementById("timeModeStatusLabel");
  const dayBtn = document.getElementById("setTimeDayBtn");
  const nightBtn = document.getElementById("setTimeNightBtn");

  if (currentActiveTimeMode === "day") {
    if (icon) icon.innerHTML = '<i class="fa-solid fa-sun" style="color:#d97706;"></i>';
    if (label) label.textContent = "朝・昼版 (3:00〜17:59)";
    if (dayBtn) dayBtn.classList.add("active");
    if (nightBtn) nightBtn.classList.remove("active");
  } else {
    if (icon) icon.innerHTML = '<i class="fa-solid fa-moon" style="color:#64748b;"></i>';
    if (label) label.textContent = "夜版 (18:00〜2:59)";
    if (nightBtn) nightBtn.classList.add("active");
    if (dayBtn) dayBtn.classList.remove("active");
  }
}

function setTimeMode(mode) {
  currentActiveTimeMode = mode;
  updateTimeModeUI();
  applySortAndRender();
  updateMapMarkers();
}

function isPostMatchTimeMode(post, mode) {
  // ★ 「いつでも」は朝・昼・夜関係なく常に表示
  if (post.time_slot === "all") return true;
  if (post.time_slot && post.time_slot !== "all") return post.time_slot === mode;
  const nightKeywords = ["夜", "夜景", "ディナー", "居酒屋", "バー", "ライトアップ", "夕日", "イルミネーション"];
  const text = `${post.title || ""} ${post.tags || ""} ${post.description || ""}`.toLowerCase();
  const isNightSpot = nightKeywords.some(kw => text.includes(kw));
  return mode === "night" ? isNightSpot : !isNightSpot;
}

// ====================================================
// 3. 「オカトリについて」
// ====================================================
function renderAboutPage() {
  const container = document.getElementById("aboutPageDynamicContent");
  if (!container) return;

  const data = appAboutData || {
    hero_title: "オカトリについて",
    hero_sub: "岡山県特化型 旅行・地域体験共有プラットフォーム",
    sections: [
      { title: "コンセプト", content: "オカトリは、岡山の隠れた魅力やローカルスポットを発見・共有するためのコミュニティプラットフォームです。" },
      { title: "主な機能", content: "・スポット投稿：写真と位置情報を共有\n・エリアマップ：地図から直感的にスポット探索\n・ルート作成：無駄のない巡回ルートを自動生成\n・アチーブメント＆スタンプラリー：現地訪問に応じたバッジ獲得" }
    ]
  };

  const sections = parseArray(data.sections);

  container.innerHTML = `
    <div class="about-hero">
      <h2 style="font-size:18px; font-weight:700; margin-bottom:4px;">${data.hero_title || 'オカトリについて'}</h2>
      <p style="font-size:12px; color:var(--text-secondary);">${data.hero_sub || ''}</p>
    </div>
    
    <div class="about-content-body">
      ${sections.map(sec => `
        <div class="about-section-item">
          <h3>${sec.title}</h3>
          <p style="white-space:pre-wrap;">${sec.content}</p>
        </div>
      `).join('')}
    </div>
  `;
}

// ====================================================
// 4. お知らせ欄
// ====================================================
function renderAnnouncements() {
  const modalContainer = document.getElementById("notifyPageOfficialListContainer") || document.getElementById("announcementListModal") || document.getElementById("notifyOfficialSection");
  if (!modalContainer) return;
  modalContainer.innerHTML = "";

  if (!announcementsData || announcementsData.length === 0) {
    modalContainer.innerHTML = `<div class="empty-state">現在お知らせはありません</div>`;
    return;
  }

  announcementsData.forEach(item => {
    const card = document.createElement("div");
    card.className = "clean-card-box";
    card.style.cursor = "pointer";
    card.style.marginBottom = "10px";
    const imgHtml = item.image_url ? `<img src="${item.image_url}" onerror="this.style.display='none'" style="width:100%; height:160px; object-fit:cover; border-radius:var(--radius-md); margin-bottom:10px;">` : '';
    card.innerHTML = `
      ${imgHtml}
      <div style="display:flex; align-items:center; gap:8px; margin-bottom:6px;">
        <span class="news-badge">${item.badge || 'INFO'}</span>
        <h3 style="font-size:14px; margin:0; font-weight:600;">${item.title}</h3>
      </div>
      <p style="font-size:12px; color:var(--text-secondary); line-height:1.5; margin:0;">${item.sub_text || ''}</p>
    `;
    card.onclick = () => openNewsDetail(item);
    modalContainer.appendChild(card);
  });
}

function openNewsDetail(item) {
  const content = document.getElementById("newsDetailContent");
  if (!content) return;
  const imgHtml = item.image_url ? `<img src="${item.image_url}" onerror="this.style.display='none'" style="width:100%; max-height:260px; object-fit:cover; border-radius:var(--radius-md); margin-bottom:14px;">` : '';
  content.innerHTML = `
    ${imgHtml}
    <div style="margin-bottom:8px;"><span class="news-badge">${item.badge || 'INFO'}</span></div>
    <h2 style="font-size:17px; font-weight:700; margin-bottom:12px;">${item.title}</h2>
    <div style="font-size:13px; color:var(--text-primary); line-height:1.7; white-space:pre-wrap;">${item.content || item.sub_text || '詳細情報はありません。'}</div>
  `;
  document.getElementById("newsDetailModal").classList.add("show");
}

// ====================================================
// 5. マップ ＆ 昼夜ピン切り替え
// ====================================================
function initOkayamaMap() {
  const el = document.getElementById("okayamaMap");
  if (!el || mapInstance) return;
  mapInstance = L.map("okayamaMap").setView([34.6618, 133.9350], 9);
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", { attribution: "© OpenStreetMap" }).addTo(mapInstance);
}

function isPreciseAddress(address) {
  if (!address || typeof address !== 'string') return false;
  const trimmed = address.trim();
  if (trimmed === "" || trimmed === "岡山県") return false;
  return trimmed.length >= 2;
}

function updateMapMarkers(filterQuery = "") {
  if (!mapInstance) return;

  mapMarkers.forEach(m => mapInstance.removeLayer(m));
  mapMarkers = [];

  const query = filterQuery.trim().toLowerCase();

  postsData.forEach(p => {
    // ブロック・ミュートしたユーザーの投稿は非表示
    if (currentUser) {
      if ((currentUser.blocked_users || []).includes(p.user_id)) return;
      if ((currentUser.muted_users || []).includes(p.user_id)) return;
    }

    if (!isPostMatchTimeMode(p, currentActiveTimeMode)) return;

    if (p.lat && p.lng && isPreciseAddress(p.address)) {
      if (query) {
        const matchTag = (p.tags || "").toLowerCase().includes(query);
        const matchTitle = (p.title || "").toLowerCase().includes(query);
        const matchArea = (p.area || "").toLowerCase().includes(query);
        const matchDesc = (p.description || "").toLowerCase().includes(query);
        if (!matchTag && !matchTitle && !matchArea && !matchDesc) return;
      }

      const lat = parseFloat(p.lat);
      const lng = parseFloat(p.lng);
      if (lat >= 34.0 && lat <= 35.6 && lng >= 133.0 && lng <= 134.8) {
        const marker = L.marker([lat, lng]).addTo(mapInstance);
        const mainImg = (p.images && p.images[0]) || p.image_url || 'https://via.placeholder.com/140x80?text=OKATRI';
        const popupHtml = `
          <div style="font-size:12px; min-width:140px; text-align:center;">
            <img src="${mainImg}" onerror="this.src='https://via.placeholder.com/140x80?text=OKATRI'" style="width:100%; height:80px; object-fit:cover; border-radius:4px; margin-bottom:6px;">
            <b style="font-size:13px;">${p.title}</b><br>
            <span style="color:var(--text-secondary); font-size:11px;">${p.address}</span><br>
            <button onclick="openDetailFromMap('${p.id}')" style="margin-top:6px; background:#0f172a; color:#fff; border:none; padding:4px 8px; border-radius:4px; font-size:11px; cursor:pointer;">詳細を見る</button>
          </div>
        `;
        marker.bindPopup(popupHtml);
        mapMarkers.push(marker);
      }
    }
  });

  pickupsData.forEach(pk => {
    if (pk.lat && pk.lng) {
      if (query) {
        const matchTitle = (pk.title || "").toLowerCase().includes(query);
        const matchArea = (pk.area || "").toLowerCase().includes(query);
        const matchDesc = (pk.desc || "").toLowerCase().includes(query);
        if (!matchTitle && !matchArea && !matchDesc) return;
      }
      const marker = L.marker([parseFloat(pk.lat), parseFloat(pk.lng)]).addTo(mapInstance);
      marker.bindPopup(`<b>🌟 ${pk.title}</b><br><span style="color:var(--brand-rose); font-size:11px;">@${pk.area}</span><br><span style="font-size:11px; color:#475569;">${pk.desc || ''}</span>`);
      mapMarkers.push(marker);
    }
  });
}

function renderPickups() {
  const list = document.getElementById("pickupList");
  if (!list) return;
  list.innerHTML = "";
  if (!pickupsData.length) { list.innerHTML = `<div class="empty-state">ピックアップ情報がありません</div>`; return; }
  pickupsData.forEach(item => {
    const card = document.createElement("div");
    card.className = "pickup-card";
    card.innerHTML = `
      <img src="${item.image_url || 'https://via.placeholder.com/64?text=PICKUP'}" onerror="this.src='https://via.placeholder.com/64?text=PICKUP'" alt="${item.title}">
      <div style="flex:1; min-width:0;">
        <div style="font-size:11px; color:var(--brand-rose); font-weight:600;">@${item.area}</div>
        <div style="font-size:13px; font-weight:600; margin:2px 0; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${item.title}</div>
        <div style="font-size:11px; color:var(--text-secondary); white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${item.desc || ''}</div>
      </div>
    `;
    list.appendChild(card);
  });
}

window.openDetailFromMap = function(postId) {
  const post = postsData.find(p => p.id === postId);
  if (post) openDetail(post);
};

// // ====================================================
// 6. 投稿一覧 ＆ 週間人気 ＆ フォロー中フィルター
// ====================================================
function applySortAndRender() {
  let list = [...postsData];

  // ブロック/ミュートされたユーザーの投稿を除外
  if (currentUser) {
    list = list.filter(p => !(currentUser.blocked_users || []).includes(p.user_id));
    list = list.filter(p => !(currentUser.muted_users || []).includes(p.user_id));
  }

  // 昼/夜フィルター
  list = list.filter(p => isPostMatchTimeMode(p, currentActiveTimeMode));

  // ソートモードによる分岐
  if (currentSortMode === "popular") {
    const oneWeekAgo = Date.now() - (7 * 24 * 60 * 60 * 1000);

    // ① 今週（7日以内）の投稿
    const thisWeekList = list.filter(p => {
      const postTime = p.created_at ? new Date(p.created_at).getTime() : Date.now();
      return postTime >= oneWeekAgo;
    });
    thisWeekList.sort((a, b) => parseArray(b.likes).length - parseArray(a.likes).length);

    // ② 過去（7日より前）の投稿
    const olderList = list.filter(p => {
      const postTime = p.created_at ? new Date(p.created_at).getTime() : Date.now();
      return postTime < oneWeekAgo;
    });
    olderList.sort((a, b) => parseArray(b.likes).length - parseArray(a.likes).length);

    // 今週の投稿 ➔ 過去の投稿 の順でシームレスに結合
    list = [...thisWeekList, ...olderList];
  } else if (currentSortMode === "following") {
    // ★ フォロー中のみ
    if (!currentUser || (currentUser.following || []).length === 0) {
      renderPosts([]);
      return;
    }
    list = list.filter(p => (currentUser.following || []).includes(p.user_id));
  }

  renderPosts(list);
}

function renderPosts(items) {
  const grid = document.getElementById("spotGrid");
  if (!grid) return;
  grid.innerHTML = "";
  if (!items || items.length === 0) {
    const label = currentActiveTimeMode === 'night' ? '夜版のおすすめスポット' : '朝・昼版のおすすめスポット';
    grid.innerHTML = `<div class="empty-state">${label}の投稿はまだありません。最初のスポットを投稿してみましょう。</div>`;
    return;
  }

  items.forEach(item => {
    const likes = parseArray(item.likes);
    const isLiked = currentUser && likes.includes(currentUser.userId);
    const isBookmarked = currentUser && currentUser.bookmarks && currentUser.bookmarks.includes(item.id);
    const tagsHtml = (item.tags || '').split(' ').filter(t => t.startsWith('#')).map(t => `<span class="tag-badge" onclick="event.stopPropagation(); filterByTag('${t}')">${t}</span>`).join('');

    const authorUser = allUsersData.find(u => u.user_id === item.user_id);
    const avatarHtml = authorUser && authorUser.avatar ? `<img src="${authorUser.avatar}" class="card-avatar-sm" alt="avatar">` : `<i class="fa-regular fa-user" style="font-size:11px; color:#94a3b8;"></i>`;
    const adminBadge = authorUser && authorUser.is_admin ? `<span class="admin-badge">OFFICIAL</span>` : '';

    // 複数画像のスライド（カルーセル）生成
    const imagesList = parseArray(item.images);
    const displayImages = imagesList.length > 0 ? imagesList : [item.image_url || 'https://images.unsplash.com/photo-1542051841857-5f90071e7989?auto=format&fit=crop&w=800&q=80'];

    let carouselHtml = '';
    if (displayImages.length > 1) {
      carouselHtml = `
        <div class="carousel-container">
          <div class="carousel-track">
            ${displayImages.map(img => `<div class="carousel-slide"><img src="${img}" onerror="this.src='https://via.placeholder.com/800x600?text=OKATRI'"></div>`).join('')}
          </div>
          <div class="carousel-dots">
            ${displayImages.map((_, idx) => `<span class="carousel-dot ${idx === 0 ? 'active' : ''}"></span>`).join('')}
          </div>
        </div>
      `;
    } else {
      carouselHtml = `
        <div class="card-img-wrap">
          <img src="${displayImages[0]}" onerror="this.src='https://via.placeholder.com/800x600?text=OKATRI'" class="card-img" alt="${item.title}">
        </div>
      `;
    }

    const card = document.createElement("div");
    card.className = "spot-card";
    card.innerHTML = `
      ${carouselHtml}
      <div class="card-body">
        <div class="card-area">@${item.area}</div>
        <div class="card-title">${item.title}</div>
        <div class="card-tags">${tagsHtml}</div>
        <div class="card-footer-row">
          <div class="card-author-row" onclick="event.stopPropagation(); openUserProfile('${item.user_id}', '${item.nickname}')">
            ${avatarHtml}
            <span>${item.nickname || '匿名'}</span>
            ${adminBadge}
          </div>
          <div class="card-actions-row">
            <span class="action-item like-btn" style="color:${isLiked ? '#f02868' : 'inherit'};">
              <i class="${isLiked ? 'fa-solid fa-heart' : 'fa-regular fa-heart'}"></i> ${likes.length}
            </span>
            <span class="action-item bm-btn" style="color:${isBookmarked ? '#f02868' : 'inherit'};">
              <i class="${isBookmarked ? 'fa-solid fa-bookmark' : 'fa-regular fa-bookmark'}"></i>
            </span>
          </div>
        </div>
      </div>
    `;

    card.onclick = () => openDetail(item);
    card.querySelector(".like-btn").onclick = (e) => { e.stopPropagation(); toggleLike(item.id); };
    card.querySelector(".bm-btn").onclick = (e) => { e.stopPropagation(); toggleBookmark(item.id); };

    grid.appendChild(card);
  });
}

function filterByTag(tag) {
  document.querySelectorAll('[data-tab="tabPosts"]').forEach(el => el.click());
  const searchInput = document.getElementById("searchInput");
  if (searchInput) searchInput.value = tag;
  applySortAndRender();
}

// ====================================================
// 7. アカウント検索
// ====================================================
function renderUserSearch(users, customQuery = null) {
  const container = document.getElementById("discoverUsersGrid") || document.getElementById("userSearchResultGrid");
  const searchInput = document.getElementById("userSearchInput");
  if (!container) return;
  const query = customQuery !== null ? customQuery.toLowerCase() : (searchInput ? searchInput.value.toLowerCase() : "");
  container.innerHTML = "";

  let filtered = users.filter(u => u.user_id !== "guest");
  if (currentUser) {
    filtered = filtered.filter(u => !(currentUser.blocked_users || []).includes(u.user_id));
  }

  if (query) {
    filtered = filtered.filter(u => 
      (u.nickname && u.nickname.toLowerCase().includes(query)) ||
      (u.user_id && u.user_id.toLowerCase().includes(query)) ||
      (u.bio && u.bio.toLowerCase().includes(query))
    );
  }

  if (filtered.length === 0) {
    container.innerHTML = `<div class="empty-state">該当するユーザーは見つかりませんでした</div>`;
    return;
  }

  filtered.forEach(u => {
    const card = document.createElement("div");
    card.className = "user-search-card";
    const avatarHtml = u.avatar ? `<img src="${u.avatar}">` : `<i class="fa-solid fa-user"></i>`;
    const adminBadge = u.is_admin ? `<span class="admin-badge">OFFICIAL</span>` : '';
    card.innerHTML = `
      <div class="user-search-avatar">${avatarHtml}</div>
      <div style="flex:1; min-width:0;">
        <div style="font-weight:600; font-size:13px; color:var(--text-primary);">${u.nickname} ${adminBadge}</div>
        <div style="font-size:11px; color:var(--text-muted);">@${u.user_id}</div>
        <div style="font-size:12px; color:var(--text-secondary); margin-top:2px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${u.bio || '岡山の旅を共有しています'}</div>
      </div>
    `;
    card.onclick = () => openUserProfile(u.user_id, u.nickname);
    container.appendChild(card);
  });
}

function renderDiscoverPosts(items) {
  const grid = document.getElementById("discoverPostsGrid");
  if (!grid) return;
  grid.innerHTML = "";
  if (items.length === 0) {
    grid.innerHTML = `<div class="empty-state">該当する投稿は見つかりませんでした</div>`;
    return;
  }
  items.forEach(p => {
    const card = document.createElement("div");
    card.className = "spot-card";
    const mainImg = (p.images && p.images[0]) || p.image_url;
    card.innerHTML = `
      <div class="card-img-wrap"><img src="${mainImg}" class="card-img" onerror="this.src='https://via.placeholder.com/800x600?text=OKATRI'"></div>
      <div class="card-body">
        <div class="card-area">@${p.area}</div>
        <div class="card-title">${p.title}</div>
      </div>
    `;
    card.onclick = () => openDetail(p);
    grid.appendChild(card);
  });
}

// 共有ルート一覧の描画
function renderDiscoverRoutes(query = "") {
  const list = document.getElementById("discoverRoutesList");
  if (!list) return;
  list.innerHTML = "";

  let filtered = sharedRoutesData;
  if (query) {
    filtered = filtered.filter(r => 
      (r.title && r.title.toLowerCase().includes(query)) ||
      (r.theme && r.theme.toLowerCase().includes(query)) ||
      (r.desc && r.desc.toLowerCase().includes(query))
    );
  }

  if (filtered.length === 0) {
    list.innerHTML = `<div class="empty-state">共有されたルートはまだありません</div>`;
    return;
  }

  filtered.forEach(r => {
    const card = document.createElement("div");
    card.className = "clean-card-box";
    card.style.cursor = "pointer";
    card.innerHTML = `
      <div style="font-size:11px; color:var(--primary-accent); font-weight:700;">${r.theme || '#モデルコース'}</div>
      <h3 style="font-size:15px; font-weight:700; margin:4px 0 6px;">${r.title}</h3>
      <p style="font-size:12px; color:var(--text-secondary); margin-bottom:10px; line-height:1.5;">${r.desc || ''}</p>
      <div style="font-size:11px; color:var(--text-muted); display:flex; justify-content:space-between; align-items:center;">
        <span>投稿者: ${r.author || '匿名'}</span>
        <span style="color:var(--primary-accent); font-weight:600;">詳細を見る <i class="fa-solid fa-chevron-right"></i></span>
      </div>
    `;
    card.onclick = () => openRouteDetail(r);
    list.appendChild(card);
  });
}

// ルート詳細モーダルを開く関数
function openRouteDetail(route) {
  const content = document.getElementById("routeDetailContent");
  if (!content) return;

  const spots = parseArray(route.spots);
  const isMine = currentUser && currentUser.userId === route.user_id;

  let spotsHtml = "";
  if (spots.length > 0) {
    spotsHtml = `
      <ul class="timeline" style="margin-top:14px; margin-bottom:16px;">
        ${spots.map(s => `
          <li>
            <b>${s.time ? s.time + ' ' : ''}${s.name}</b>${s.desc ? `<br><span style="color:var(--text-secondary); font-size:12px;">${s.desc}</span>` : ''}
          </li>
        `).join('')}
      </ul>
    `;
  }

  const mapUrl = route.map_url || route.mapUrl || '#';

  content.innerHTML = `
    <div style="font-size:11px; color:var(--primary-accent); font-weight:700; margin-bottom:4px;">${route.theme || '#モデルコース'}</div>
    <h2 style="font-size:17px; font-weight:700; margin-bottom:8px;">${route.title}</h2>
    <div style="font-size:12px; color:var(--text-muted); margin-bottom:12px;">作成者: @${route.author || '匿名'}</div>
    <p style="font-size:13px; color:var(--text-primary); line-height:1.6; margin-bottom:16px;">${route.desc || '説明文はありません。'}</p>

    <h3 class="sub-heading"><i class="fa-solid fa-route" style="color:var(--primary-accent);"></i> 巡回コース</h3>
    ${spotsHtml}

    <a href="${mapUrl}" target="_blank" class="btn-google-nav" style="margin-bottom:14px; text-decoration:none;">
      <i class="fa-solid fa-arrow-up-right-from-square"></i> Googleマップでナビ開始
    </a>

    ${isMine ? `
      <button id="deleteRouteBtn" class="btn-danger" style="width:100%; padding:9px; margin-top:10px;">
        <i class="fa-regular fa-trash-can"></i> このルートを削除する
      </button>
    ` : ''}
  `;

  if (isMine) {
    safeOnClick("deleteRouteBtn", async () => {
      if (!confirm("この共有ルートを削除しますか？")) return;
      sharedRoutesData = sharedRoutesData.filter(r => r.id !== route.id);
      renderDiscoverRoutes();
      document.getElementById("routeDetailModal").classList.remove("show");

      if (db) {
        await db.from("shared_routes").delete().eq("id", route.id);
      }
      alert("ルートを削除しました。");
    });
  }

  document.getElementById("routeDetailModal").classList.add("show");
}
// ====================================================
// 8. 相手プロフィール ＆ ブロック・ミュート
// ====================================================
function openUserProfile(userId, fallbackNickname) {
  const targetUser = allUsersData.find(u => u.user_id === userId) || { user_id: userId, nickname: fallbackNickname, bio: "岡山の旅を共有しています" };
  const modal = document.getElementById("userProfileModal");
  if (!modal) return;

  const adminBadge = targetUser.is_admin ? `<span class="admin-badge">OFFICIAL</span>` : '';
  const nickEl = document.getElementById("upModalNickname");
  const userEl = document.getElementById("upModalUsername");
  const bioEl = document.getElementById("upModalBio");
  if (nickEl) nickEl.innerHTML = `${targetUser.nickname} ${adminBadge}`;
  if (userEl) userEl.textContent = `@${targetUser.user_id}`;
  if (bioEl) bioEl.textContent = targetUser.bio || "自己紹介文はありません";
  // openUserProfile 関数内の bioEl の処理のすぐ下に追加
  const upBadgesBox = document.getElementById("upModalFeaturedBadges");
  if (upBadgesBox) {
    upBadgesBox.innerHTML = "";
    const featured = parseArray(targetUser.featured_badges || "[]");
    if (featured.length === 0) {
      upBadgesBox.innerHTML = `<span style="font-size:11px; color:#94a3b8;">セット中のバッジはありません</span>`;
    } else {
      featured.forEach(badgeTitle => {
        const found = (targetUser.achievements ? parseArray(targetUser.achievements) : []).find(a => a.title === badgeTitle) ||
                      masterBadgesData.find(b => b.title === badgeTitle) || { title: badgeTitle };
        const slot = document.createElement("div");
        slot.className = "featured-badge-slot filled";
        slot.innerHTML = found.image_url ? `<img src="${found.image_url}" title="${found.title}">` : `<i class="fa-solid fa-award"></i>`;
        slot.onclick = () => openAchievementDetailModal(found);
        upBadgesBox.appendChild(slot);
      });
    }
  }
  
  const avatarBox = document.getElementById("upModalAvatarBox");
  if (avatarBox) avatarBox.innerHTML = targetUser.avatar ? `<img src="${targetUser.avatar}">` : `<i class="fa-solid fa-user"></i>`;

  const following = parseArray(targetUser.following);
  const followers = parseArray(targetUser.followers);
  const fCount1 = document.querySelector("#upModalFollowingBtn b");
  const fCount2 = document.querySelector("#upModalFollowersBtn b");
  if (fCount1) fCount1.textContent = following.length;
  if (fCount2) fCount2.textContent = followers.length;

  safeOnClick("upModalFollowingBtn", () => openUserListModal(`${targetUser.nickname} のフォロー中`, following));
  safeOnClick("upModalFollowersBtn", () => openUserListModal(`${targetUser.nickname} のフォロワー`, followers));

  const isFollowing = currentUser && (currentUser.following || []).includes(userId);
  const fBtn = document.getElementById("upModalFollowBtn");
  const dmBtn = document.getElementById("upModalDmBtn");
  const blockBtn = document.getElementById("upModalBlockBtn");
  const isMe = currentUser && currentUser.userId === userId;

  if (isMe) {
    if (fBtn) fBtn.style.display = "none";
    if (dmBtn) dmBtn.style.display = "none";
    if (blockBtn) blockBtn.style.display = "none";
  } else {
    if (fBtn) {
      fBtn.style.display = "inline-flex";
      fBtn.innerHTML = isFollowing ? `<i class="fa-solid fa-check"></i> フォロー中` : `<i class="fa-solid fa-plus"></i> フォロー`;
      fBtn.onclick = () => toggleFollowUser(userId);
    }
    if (dmBtn) {
      dmBtn.style.display = "inline-flex";
      dmBtn.onclick = () => {
        modal.classList.remove("show");
        openDmChatPage(targetUser.user_id, targetUser.nickname);
      };
    }
    if (blockBtn) {
      blockBtn.style.display = "inline-flex";
      blockBtn.onclick = () => openBlockMuteMenu(targetUser);
    }
  }

  const userPosts = postsData.filter(p => p.user_id === userId);
  const grid = document.getElementById("upModalPostsGrid");
  if (grid) {
    grid.innerHTML = "";
    if (userPosts.length === 0) {
      grid.innerHTML = `<div class="empty-state">まだ投稿がありません</div>`;
    } else {
      userPosts.forEach(p => {
        const d = document.createElement("div");
        d.className = "spot-card";
        const mainImg = (p.images && p.images[0]) || p.image_url;
        d.innerHTML = `<div class="card-img-wrap"><img src="${mainImg}" class="card-img"></div><div class="card-body"><div class="card-title">${p.title}</div></div>`;
        d.onclick = () => { modal.classList.remove("show"); openDetail(p); };
        grid.appendChild(d);
      });
    }
  }

  modal.classList.add("show");
}

function openBlockMuteMenu(targetUser) {
  if (!currentUser) return;
  const isBlocked = (currentUser.blocked_users || []).includes(targetUser.user_id);
  const isMuted = (currentUser.muted_users || []).includes(targetUser.user_id);

  const action = prompt(`【ユーザー設定: @${targetUser.user_id}】\n1: ${isMuted ? 'ミュート解除' : 'ミュートする（投稿を非表示）'}\n2: ${isBlocked ? 'ブロック解除' : 'ブロックする（相互非表示）'}\n\n番号を入力してください (1 または 2):`);

  if (action === "1") {
    currentUser.muted_users = currentUser.muted_users || [];
    if (isMuted) {
      currentUser.muted_users = currentUser.muted_users.filter(id => id !== targetUser.user_id);
      alert(`@${targetUser.user_id} のミュートを解除しました。`);
    } else {
      currentUser.muted_users.push(targetUser.user_id);
      alert(`@${targetUser.user_id} をミュートしました。`);
    }
    saveUserBlockMute();
  } else if (action === "2") {
    currentUser.blocked_users = currentUser.blocked_users || [];
    if (isBlocked) {
      currentUser.blocked_users = currentUser.blocked_users.filter(id => id !== targetUser.user_id);
      alert(`@${targetUser.user_id} のブロックを解除しました。`);
    } else {
      currentUser.blocked_users.push(targetUser.user_id);
      alert(`@${targetUser.user_id} をブロックしました。`);
      document.getElementById("userProfileModal").classList.remove("show");
    }
    saveUserBlockMute();
  }
}

async function saveUserBlockMute() {
  localStorage.setItem("okatari_user", JSON.stringify(currentUser));
  applySortAndRender();
  updateMapMarkers();
  if (db) {
    await db.from("users_custom").update({
      blocked_users: currentUser.blocked_users,
      muted_users: currentUser.muted_users
    }).eq("user_id", currentUser.userId);
  }
}

async function openDmChatPage(targetUserId, targetNickname) {
  if (!currentUser) { alert("ログインが必要です"); return; }
  currentDmTargetUserId = targetUserId;
  const t = document.getElementById("dmPageTitle");
  if (t) t.innerHTML = `${targetNickname} (@${targetUserId})`;
  const list = document.getElementById("dmPageMessageList");
  if (list) list.innerHTML = `<div style="text-align:center; font-size:12px; color:#94a3b8;">メッセージを読み込み中...</div>`;
  
  document.querySelectorAll(".tab-pane").forEach(p => p.classList.remove("active"));
  document.getElementById("tabDm").classList.add("active");
  document.getElementById("pageTitle").textContent = "メッセージ";

  if (db && list) {
    const { data } = await db.from("messages")
      .select("*")
      .or(`and(from_user_id.eq.${currentUser.userId},to_user_id.eq.${targetUserId}),and(from_user_id.eq.${targetUserId},to_user_id.eq.${currentUser.userId})`)
      .order("created_at", { ascending: true });

    list.innerHTML = "";
    if (!data || data.length === 0) {
      list.innerHTML = `<div style="text-align:center; font-size:13px; color:#94a3b8; padding:32px 0;">まだメッセージはありません。</div>`;
    } else {
      data.forEach(m => {
        const bubble = document.createElement("div");
        bubble.className = `dm-bubble ${m.from_user_id === currentUser.userId ? 'mine' : 'theirs'}`;
        bubble.textContent = m.message;
        list.appendChild(bubble);
      });
      list.scrollTop = list.scrollHeight;
    }
  }
}

function openUserListModal(title, userIds) {
  const t = document.getElementById("userListModalTitle");
  if (t) t.textContent = title;
  currentModalUserIds = userIds || [];
  const s = document.getElementById("userListSearchInput");
  if (s) s.value = "";
  renderModalUserList(currentModalUserIds);
  document.getElementById("userListModal").classList.add("show");
}

function renderModalUserList(userIds) {
  const container = document.getElementById("userListContainer");
  const searchInput = document.getElementById("userListSearchInput");
  if (!container) return;
  const query = searchInput ? searchInput.value.toLowerCase() : "";
  container.innerHTML = "";

  let list = userIds.map(uid => allUsersData.find(x => x.user_id === uid) || { user_id: uid, nickname: "ユーザー" });

  if (query) {
    list = list.filter(u => 
      (u.nickname && u.nickname.toLowerCase().includes(query)) ||
      (u.user_id && u.user_id.toLowerCase().includes(query))
    );
  }

  if (list.length === 0) {
    container.innerHTML = `<div class="empty-state">該当するユーザーはいません</div>`;
  } else {
    list.forEach(u => {
      const row = document.createElement("div");
      row.className = "user-list-row";
      const avHtml = u.avatar ? `<img src="${u.avatar}">` : `<i class="fa-solid fa-user"></i>`;
      const adminBadge = u.is_admin ? `<span class="admin-badge">OFFICIAL</span>` : '';
      row.innerHTML = `
        <div class="user-list-avatar">${avHtml}</div>
        <div style="flex:1;">
          <div style="font-weight:600; font-size:13px; color:var(--text-primary);">${u.nickname} ${adminBadge}</div>
          <div style="font-size:11px; color:var(--text-muted);">@${u.user_id}</div>
        </div>
        <span style="font-size:11px; color:var(--text-secondary); font-weight:500;">プロフィール <i class="fa-solid fa-arrow-right"></i></span>
      `;
      row.onclick = () => {
        document.getElementById("userListModal").classList.remove("show");
        document.getElementById("userProfileModal").classList.remove("show");
        openUserProfile(u.user_id, u.nickname);
      };
      container.appendChild(row);
    });
  }
}

async function toggleFollowUser(targetUserId) {
  if (!currentUser) { alert("ログインが必要です"); return; }
  
  currentUser.following = currentUser.following || [];
  const myFollowingIdx = currentUser.following.indexOf(targetUserId);
  const isNowFollowing = myFollowingIdx < 0;

  if (isNowFollowing) {
    currentUser.following.push(targetUserId);
    sendNotification(targetUserId, 'follow');
  } else {
    currentUser.following.splice(myFollowingIdx, 1);
  }
  localStorage.setItem("okatari_user", JSON.stringify(currentUser));

  const targetUser = allUsersData.find(u => u.user_id === targetUserId);
  if (targetUser) {
    targetUser.followers = parseArray(targetUser.followers);
    const targetFollowerIdx = targetUser.followers.indexOf(currentUser.userId);
    if (isNowFollowing) {
      if (targetFollowerIdx < 0) targetUser.followers.push(currentUser.userId);
    } else {
      if (targetFollowerIdx >= 0) targetUser.followers.splice(targetFollowerIdx, 1);
    }
  }

  const meInAll = allUsersData.find(u => u.user_id === currentUser.userId);
  if (meInAll) meInAll.following = currentUser.following;

  updateUserUI();
  const fBtn = document.getElementById("upModalFollowBtn");
  if (fBtn) fBtn.innerHTML = isNowFollowing ? `<i class="fa-solid fa-check"></i> フォロー中` : `<i class="fa-solid fa-plus"></i> フォロー`;
  if (targetUser) {
    const fCountEl = document.querySelector("#upModalFollowersBtn b");
    if (fCountEl) fCountEl.textContent = targetUser.followers.length;
  }

  if (db) {
    await Promise.all([
      db.from("users_custom").update({ following: currentUser.following }).eq("user_id", currentUser.userId),
      targetUser ? db.from("users_custom").update({ followers: targetUser.followers }).eq("user_id", targetUserId) : Promise.resolve()
    ]);
  }
}

// ====================================================
// 9. マイページ
// ====================================================
function renderMyProfileSpots() {
  const grid = document.getElementById("myProfileSpotsGrid");
  const myPostsCountEl = document.getElementById("myPostsCount");
  const myBookmarksCountEl = document.getElementById("myBookmarksCount");
  if (!grid) return;
  grid.innerHTML = "";

  if (!currentUser) {
    grid.innerHTML = `<div class="empty-state">ログインすると一覧が表示されます</div>`;
    if (myPostsCountEl) myPostsCountEl.textContent = "0";
    if (myBookmarksCountEl) myBookmarksCountEl.textContent = "0";
    return;
  }

  const myPosts = postsData.filter(p => p.user_id === currentUser.userId);
  const myBookmarks = postsData.filter(p => (currentUser.bookmarks || []).includes(p.id));

  if (myPostsCountEl) myPostsCountEl.textContent = myPosts.length;
  if (myBookmarksCountEl) myBookmarksCountEl.textContent = myBookmarks.length;

  const targetList = currentProfileTab === "posts" ? myPosts : myBookmarks;

  if (targetList.length === 0) {
    const emptyMsg = currentProfileTab === "posts" 
      ? "まだ投稿がありません。" 
      : "保存済みのスポットはありません。";
    grid.innerHTML = `<div class="empty-state">${emptyMsg}</div>`;
    return;
  }

  targetList.forEach(p => {
    const card = document.createElement("div");
    card.className = "spot-card";
    const mainImg = (p.images && p.images[0]) || p.image_url;
    card.innerHTML = `
      <div class="card-img-wrap">
        <img src="${mainImg}" class="card-img" alt="${p.title}">
      </div>
      <div class="card-body">
        <div class="card-area">@${p.area}</div>
        <div class="card-title">${p.title}</div>
      </div>
    `;
    card.onclick = () => openDetail(p);
    grid.appendChild(card);
  });
}

function renderMyAchievements() {
  const featuredBox = document.getElementById("myFeaturedBadges");
  if (featuredBox) {
    featuredBox.innerHTML = "";
    const featured = (currentUser && currentUser.featured_badges) || [];
    for (let i = 0; i < 3; i++) {
      const badgeTitle = featured[i];
      const slot = document.createElement("div");
      if (badgeTitle) {
        const found = (currentUser.achievements || []).find(a => a.title === badgeTitle) || 
                      masterBadgesData.find(b => b.title === badgeTitle) || { title: badgeTitle, description: "獲得済みアチーブメント" };
        slot.className = "featured-badge-slot filled";
        slot.innerHTML = found.image_url ? `<img src="${found.image_url}" title="${found.title}">` : `<i class="fa-solid fa-award"></i>`;
        slot.onclick = () => openAchievementDetailModal(found);
      } else {
        slot.className = "featured-badge-slot";
        slot.innerHTML = `<i class="fa-solid fa-plus"></i>`;
        slot.onclick = () => {
          document.querySelectorAll('[data-tab="tabAchievements"]').forEach(el => el.click());
        };
      }
      featuredBox.appendChild(slot);
    }
  }
}

function openAchievementDetailModal(badge) {
  const content = document.getElementById("achDetailModalContent");
  if (!content) return;
  const isFeatured = currentUser && (currentUser.featured_badges || []).includes(badge.title);

  content.innerHTML = `
    <img src="${badge.image_url || 'https://via.placeholder.com/120?text=BADGE'}" onerror="this.src='https://via.placeholder.com/120?text=BADGE'" style="width:96px; height:96px; border-radius:50%; object-fit:cover; margin-bottom:12px; border:3px solid #fbcfe0; box-shadow:0 0 15px rgba(240,40,104,0.3);">
    <h3 style="font-size:16px; font-weight:700; margin-bottom:6px; color:var(--text-primary);">${badge.title}</h3>
    <p style="font-size:13px; color:var(--text-secondary); line-height:1.5; margin-bottom:12px;">${badge.description || '岡山を旅して獲得した特別なバッジです。'}</p>
    ${badge.date ? `<div style="font-size:11px; color:var(--primary-accent); font-weight:600; margin-bottom:16px;">獲得日: ${badge.date}</div>` : ''}
    
    <div style="display:flex; gap:8px;">
      <button id="toggleFeaturedModalBtn" class="btn-primary" style="flex:1;">
        ${isFeatured ? '★ マイページから外す' : '+ マイページにセット'}
      </button>
    </div>
  `;

  const btn = document.getElementById("toggleFeaturedModalBtn");
  if (btn) {
    btn.onclick = () => {
      toggleFeaturedBadge(badge.title);
      document.getElementById("achievementDetailModal").classList.remove("show");
    };
  }

  document.getElementById("achievementDetailModal").classList.add("show");
}

// ====================================================
// ★ 図鑑 ＆ GPSスタンプラリー
// ====================================================
function renderPokedex() {
  const grid = document.getElementById("pokedexGrid");
  const bar = document.getElementById("pokedexProgressBar");
  const text = document.getElementById("pokedexProgressText");
  const adminRallyArea = document.getElementById("adminCreateRallyArea");

  if (adminRallyArea) {
    adminRallyArea.style.display = (currentUser && currentUser.is_admin) ? "block" : "none";
  }

  if (!grid) return;
  grid.innerHTML = "";

  const myAchList = (currentUser && currentUser.achievements) || [];
  const total = masterBadgesData.length;
  const unlockedCount = masterBadgesData.filter(mb => myAchList.some(a => a.title === mb.title)).length;
  const pct = total > 0 ? Math.round((unlockedCount / total) * 100) : 0;

  if (bar) bar.style.width = `${pct}%`;
  if (text) text.textContent = `${unlockedCount} / ${total} (${pct}%)`;

  masterBadgesData.forEach(badge => {
    const unlocked = myAchList.find(a => a.title === badge.title);
    const isFeatured = currentUser && (currentUser.featured_badges || []).includes(badge.title);
    const card = document.createElement("div");
    card.className = `pokedex-card ${unlocked ? 'unlocked' : 'locked'}`;

    card.innerHTML = `
      <img src="${badge.image_url}" class="pokedex-img" alt="${badge.title}" onerror="this.src='https://via.placeholder.com/100?text=BADGE'">
      <div style="font-weight:700; font-size:12px; margin-bottom:4px; color:var(--text-primary);">${badge.title}</div>
      <div style="font-size:11px; color:var(--text-secondary); line-height:1.4;">${unlocked ? badge.description : '？？？（未獲得）'}</div>
      ${unlocked ? `<div style="margin-top:8px; font-size:10px; color:var(--primary-accent); font-weight:600;">獲得日: ${unlocked.date || '達成済み'}</div>` : ''}
      ${unlocked ? `<button class="btn-secondary" style="margin-top:8px; padding:4px 8px; font-size:10px; width:100%;">${isFeatured ? '★ セット中' : '+ マイページにセット'}</button>` : ''}
    `;

    if (unlocked) {
      card.onclick = () => openAchievementDetailModal({ ...badge, date: unlocked.date });
    } else {
      card.onclick = () => alert(`「${badge.title}」はまだ獲得していません。\nイベントコードを入力するか、指定の場所を巡って獲得しましょう！`);
    }

    grid.appendChild(card);
  });
}

async function toggleFeaturedBadge(badgeTitle) {
  if (!currentUser) return;
  currentUser.featured_badges = currentUser.featured_badges || [];
  const idx = currentUser.featured_badges.indexOf(badgeTitle);

  if (idx >= 0) {
    currentUser.featured_badges.splice(idx, 1);
    alert(`「${badgeTitle}」のセットを解除しました。`);
  } else {
    if (currentUser.featured_badges.length >= 3) {
      alert("マイページにセットできるバッジは最大3個までです。");
      return;
    }
    currentUser.featured_badges.push(badgeTitle);
    alert(`「${badgeTitle}」をマイページにセットしました！`);
  }

  localStorage.setItem("okatari_user", JSON.stringify(currentUser));
  renderPokedex();
  renderMyAchievements();

  if (db) {
    await db.from("users_custom").update({ featured_badges: currentUser.featured_badges }).eq("user_id", currentUser.userId);
  }
}

function renderStampRallies() {
  const container = document.getElementById("stampRallyContainer");
  if (!container) return;
  container.innerHTML = "";

  if (!stampRalliesData || stampRalliesData.length === 0) {
    container.innerHTML = `<div style="font-size:12px; color:#94a3b8; padding:8px 0;">現在開催中のスタンプ帳はありません</div>`;
    return;
  }

  const userStamps = (currentUser && currentUser.stamps) || [];

  stampRalliesData.forEach(rally => {
    const spots = parseArray(rally.spots);
    const clearedSpots = spots.filter(s => userStamps.includes(s.id));
    
    const card = document.createElement("div");
    card.className = "clean-card-box";
    card.style.cssText = "margin-bottom:10px; cursor:pointer; display:flex; justify-content:space-between; align-items:center;";
    card.innerHTML = `
      <div>
        <h4 style="font-size:14px; font-weight:700; margin:0 0 4px;">${rally.title}</h4>
        <div style="font-size:11px; color:var(--text-secondary);">${rally.description || rally.desc || ''}</div>
      </div>
      <span class="tech-badge" style="white-space:nowrap;">${clearedSpots.length} / ${spots.length} 達成</span>
    `;

    // クリックで台紙詳細モーダルを開く
    card.onclick = () => openStampRallyDetail(rally);
    container.appendChild(card);
  });
}

// スタンプ帳詳細（Supabaseの台紙画像を背景にセット）
let currentSelectedRally = null;
function openStampRallyDetail(rally) {
  currentSelectedRally = rally;
  const userStamps = (currentUser && currentUser.stamps) || [];
  const spots = parseArray(rally.spots);

  document.getElementById("stampDetailTitle").textContent = rally.title;
  document.getElementById("stampDetailDesc").textContent = rally.description || rally.desc || '';
  
  // 台紙画像の反映（Supabaseの `bg_image_url`、空ならデフォルト画像）
  const boardCanvas = document.getElementById("stampBoardCanvas");
  const defaultBg = "黒 白 モノクロ シンプル スタンプラリー イベント ポストカード (1).png";
  if (boardCanvas) {
    boardCanvas.style.backgroundImage = `url('${rally.bg_image_url || defaultBg}')`;
  }

  const grid = document.getElementById("stampCirclesGrid");
  if (grid) {
    grid.setAttribute("data-count", spots.length);
    grid.innerHTML = "";

    // 選択されたスポットの個数（1〜4個）だけ円を生成
    spots.forEach(spot => {
      const isCleared = userStamps.includes(spot.id);
      
      // 画像が見つからない場合の予備検索フォールバック
      let postImage = spot.image_url;
      if (!postImage) {
        const foundPost = postsData.find(p => p.title === spot.name || p.id === spot.id);
        if (foundPost) {
          postImage = (foundPost.images && foundPost.images[0]) || foundPost.image_url;
        }
      }
      if (!postImage) postImage = 'https://via.placeholder.com/100?text=SPOT';

      const circle = document.createElement("div");
      circle.className = `stamp-circle-slot ${isCleared ? 'cleared' : ''}`;
      circle.innerHTML = `
        <img src="${postImage}" class="stamp-circle-img" alt="${spot.name}" onerror="this.src='https://via.placeholder.com/100?text=SPOT'">
        <div class="stamp-circle-name">${spot.name}</div>
      `;
      grid.appendChild(circle);
    });
  }

  const checkInBtn = document.getElementById("detailCheckInBtn");
  if (checkInBtn) {
    checkInBtn.onclick = () => {
      handleGpsCheckIn(rally);
      setTimeout(() => openStampRallyDetail(rally), 1000);
    };
  }

  document.getElementById("stampRallyDetailModal").classList.add("show");
}

safeOnClick("closeStampDetailModalBtn", () => {
  document.getElementById("stampRallyDetailModal").classList.remove("show");
});

function handleGpsCheckIn(rally) {
  if (!currentUser) { alert("スタンプラリーの参加にはログインが必要です"); return; }
  if (!navigator.geolocation) { alert("GPS機能が利用できません"); return; }

  const btn = document.querySelector(`.checkin-rally-btn[data-rally="${rally.id}"]`);
  if (btn) btn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> 現在地判定中...`;

  navigator.geolocation.getCurrentPosition(async (pos) => {
    const userLat = pos.coords.latitude;
    const userLng = pos.coords.longitude;
    let newlyStamped = [];
    currentUser.stamps = currentUser.stamps || [];
    const spots = parseArray(rally.spots);

    spots.forEach(spot => {
      if (!currentUser.stamps.includes(spot.id)) {
        const dist = calculateDistance(userLat, userLng, spot.lat, spot.lng);
        if (dist <= (spot.radius_m || 600)) {
          currentUser.stamps.push(spot.id);
          newlyStamped.push(spot.name);
        }
      }
    });

    if (newlyStamped.length > 0) {
      alert(`🎉 チェックイン成功！\n【${newlyStamped.join('、')}】のスタンプを獲得しました！`);
      
      const allDone = spots.every(s => currentUser.stamps.includes(s.id));
      if (allDone) {
        currentUser.achievements = currentUser.achievements || [];
        const masterBadge = masterBadgesData.find(b => b.title === rally.reward_title) || {
          title: rally.reward_title,
          image_url: rally.reward_img || "https://images.unsplash.com/photo-1518709268805-4e9042af9f23?auto=format&fit=crop&w=150&q=80",
          description: `${rally.title}を全制覇した証`
        };

        if (!currentUser.achievements.some(a => a.title === masterBadge.title)) {
          const reward = {
            title: masterBadge.title,
            image_url: masterBadge.image_url,
            description: masterBadge.description,
            date: new Date().toLocaleDateString("ja-JP")
          };
          currentUser.achievements.push(reward);
          alert(`🏆 おめでとうございます！\nスタンプラリー完全制覇でアチーブメント「${masterBadge.title}」を獲得しました！`);
        }
      }

      localStorage.setItem("okatari_user", JSON.stringify(currentUser));
      renderStampRallies();
      renderMyAchievements();
      renderPokedex();

      if (db) {
        await db.from("users_custom").update({
          stamps: currentUser.stamps,
          achievements: currentUser.achievements
        }).eq("user_id", currentUser.userId);
      }
    } else {
      alert("チェックイン対象のスポットが近くに見つかりませんでした。\n指定スポットの近く（約500m以内）に移動してからお試しください。");
    }

    if (btn) btn.innerHTML = `<i class="fa-solid fa-location-crosshairs"></i> 現在地でチェックイン`;
  }, (err) => {
    alert("位置情報の取得に失敗しました。GPS設定をご確認ください。");
    if (btn) btn.innerHTML = `<i class="fa-solid fa-location-crosshairs"></i> 現在地でチェックイン`;
  }, { enableHighAccuracy: true, timeout: 8000 });
}

function openCreateRallyModal() {
  const badgeSelect = document.getElementById("rallyRewardBadgeSelect");
  const spotContainer = document.getElementById("rallySpotsCheckboxList");

  if (badgeSelect) {
    badgeSelect.innerHTML = masterBadgesData.map(b => `<option value="${b.title}">${b.title}</option>`).join('');
  }

  if (spotContainer) {
    spotContainer.innerHTML = "";
    if (postsData.length === 0) {
      spotContainer.innerHTML = `<div style="font-size:12px; color:#94a3b8;">選択可能な投稿スポットがありません</div>`;
    } else {
      postsData.forEach((p, idx) => {
        const div = document.createElement("div");
        div.className = "checkbox-item";
        const imgUrl = (p.images && p.images[0]) || p.image_url || '';
        div.innerHTML = `
          <input type="checkbox" id="rally_spot_${idx}" value="${p.id}" data-name="${p.title}" data-lat="${p.lat || 34.6618}" data-lng="${p.lng || 133.9350}" data-image="${imgUrl}">
          <label for="rally_spot_${idx}">${p.title} (@${p.area})</label>
        `;

        // ★ 選択数最大4箇所制限を付与
        const chk = div.querySelector("input");
        chk.onchange = () => {
          const checkedCount = document.querySelectorAll("#rallySpotsCheckboxList input:checked").length;
          if (checkedCount > 4) {
            chk.checked = false;
            alert("スタンプラリーのスポットは最大4箇所まで選択可能です。");
          }
        };

        spotContainer.appendChild(div);
      });
    }
  }

  document.getElementById("createRallyModal").classList.add("show");
}

function openEditPostModal(post) {
  document.getElementById("editPostId").value = post.id;
  document.getElementById("editPostTitle").value = post.title || "";
  document.getElementById("editPostArea").value = post.area || "岡山市";
  document.getElementById("editPostTimeSlot").value = post.time_slot || "all";
  document.getElementById("editPostTags").value = post.tags || "";
  document.getElementById("editPostAddress").value = post.address || "";
  document.getElementById("editPostExternalUrl").value = post.external_url || "";
  document.getElementById("editPostDescription").value = post.description || "";

  document.getElementById("detailModal").classList.remove("show");
  document.getElementById("editPostModal").classList.add("show");
}

// // // // ====================================================
// 10. 投稿詳細（★ ネイティブシェア ＆ コメントシート連動）
// ====================================================
let currentActiveDetailPost = null;

function openDetail(item) {
  currentActiveDetailPost = item;
  const content = document.getElementById("detailContent");
  if (!content) return;
  const isMine = currentUser && currentUser.userId === item.user_id;
  const isOfficial = currentUser && currentUser.is_admin;
  
  const postComments = commentsData.filter(c => c.post_id === item.id);
  const likes = parseArray(item.likes);
  const isLiked = currentUser && likes.includes(currentUser.userId);
  const isBookmarked = currentUser && currentUser.bookmarks && currentUser.bookmarks.includes(item.id);

  const authorUser = allUsersData.find(u => u.user_id === item.user_id);
  const adminBadge = authorUser && authorUser.is_admin ? `<span class="admin-badge">OFFICIAL</span>` : '';
  const tagsHtml = (item.tags || '').split(' ').filter(t => t.startsWith('#')).map(t => `<span class="tag-badge" onclick="filterByTag('${t}'); document.getElementById('detailModal').classList.remove('show');">${t}</span>`).join('');

  // 複数画像のスライド
  const imagesList = parseArray(item.images);
  const displayImages = imagesList.length > 0 ? imagesList : [item.image_url || 'https://images.unsplash.com/photo-1542051841857-5f90071e7989?auto=format&fit=crop&w=800&q=80'];

  let imageHtml = '';
  if (displayImages.length > 1) {
    imageHtml = `
      <div class="carousel-container" style="border-radius:var(--radius-md); margin-bottom:12px;">
        <div class="carousel-track">
          ${displayImages.map(img => `<div class="carousel-slide"><img src="${img}" onerror="this.src='https://via.placeholder.com/800x600?text=OKATRI'"></div>`).join('')}
        </div>
        <div class="carousel-dots">
          ${displayImages.map((_, idx) => `<span class="carousel-dot ${idx === 0 ? 'active' : ''}"></span>`).join('')}
        </div>
      </div>
    `;
  } else {
    imageHtml = `<img src="${displayImages[0]}" onerror="this.src='https://via.placeholder.com/800x600?text=OKATRI'" style="width:100%; aspect-ratio:3/4; object-fit:cover; border-radius:var(--radius-md); margin-bottom:12px; border:1px solid var(--border-subtle);">`;
  }

  content.innerHTML = `
    ${imageHtml}
    
    <!-- ★ 画像2枚目風アクションバー -->
    <div class="insta-action-bar">
      <div class="insta-action-left">
        <!-- いいね -->
        <button id="detailLikeBtn" class="insta-icon-btn ${isLiked ? 'liked' : ''}">
          <i class="${isLiked ? 'fa-solid fa-heart' : 'fa-regular fa-heart'}"></i>
        </button>
        <!-- いいねした人一覧 -->
        <span id="detailLikeCountBtn" class="action-count-clickable" title="いいねした人一覧">${likes.length}</span>

        <!-- ★ 吹き出しボタン（押すと下からコメントシートが出る） -->
        <button id="openCommentsSheetBtn" class="insta-icon-btn" title="コメントを開く">
          <i class="fa-regular fa-comment"></i>
        </button>
        <span class="action-count" id="detailCommentCount">${postComments.length}</span>

        <!-- ★ 紙飛行機ボタン（押すとOSの共有シートが出る） -->
        <button id="sharePostPlaneBtn" class="insta-icon-btn" title="共有">
          <i class="fa-regular fa-paper-plane"></i>
        </button>
      </div>

      <div class="insta-action-right">
        <button id="setStartSpotBtn" class="btn-secondary" style="font-size:11px; padding:5px 10px; border-radius:var(--radius-sm);">
          <i class="fa-solid fa-route"></i> 出発地
        </button>
        <button id="detailBmBtn" class="insta-icon-btn ${isBookmarked ? 'bookmarked' : ''}" title="保存">
          <i class="${isBookmarked ? 'fa-solid fa-bookmark' : 'fa-regular fa-bookmark'}"></i>
        </button>
      </div>
    </div>

    <!-- 投稿情報 -->
    <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:4px;">
      <span style="color:var(--primary-accent); font-weight:600; font-size:12px;">@${item.area}</span>
      ${!isMine && item.user_id ? `<button id="detailUserBtn" class="btn-secondary" style="padding:4px 10px; font-size:11px;"><i class="fa-regular fa-user"></i> ${item.nickname} ${adminBadge}</button>` : ''}
    </div>
    
    <h2 style="font-size:17px; font-weight:700; margin:4px 0 6px; color:var(--text-primary);">${item.title}</h2>
    <div style="margin-bottom:8px;">${tagsHtml}</div>
    <p style="font-size:13px; line-height:1.6; margin-bottom:12px; color:var(--text-primary);">${item.description || ''}</p>
    
    ${item.external_url ? `
      <div style="margin-bottom:12px;">
        <a href="${item.external_url}" target="_blank" style="display:inline-flex; align-items:center; gap:6px; background:#f1f5f9; color:var(--text-primary); text-decoration:none; padding:6px 12px; border-radius:var(--radius-md); font-size:12px; font-weight:500; border:1px solid var(--border-subtle);">
          <i class="fa-solid fa-arrow-up-right-from-square"></i> 関連リンクを開く
        </a>
      </div>
    ` : ''}

    <div style="font-size:12px; font-weight:500; margin-bottom:8px; color:var(--text-secondary);"><i class="fa-solid fa-location-dot" style="margin-right:4px;"></i> ${item.address || '岡山県'}</div>
    <iframe style="width:100%; height:130px; border-radius:var(--radius-md); border:1px solid var(--border-subtle); margin-bottom:14px;" 
      src="https://maps.google.co.jp/maps?output=embed&q=${encodeURIComponent(item.address || item.title)}">
    </iframe>

    <div style="display:flex; gap:8px; margin-bottom:14px;">
      ${isOfficial ? `<button id="adminPickupBtn" class="btn-admin-pickup"><i class="fa-solid fa-star"></i> ピックアップ</button>` : ''}
      ${isMine ? `<button id="openEditPostBtn" class="btn-secondary" style="color:var(--primary-accent);"><i class="fa-regular fa-pen-to-square"></i> 編集</button>` : ''}
      ${isMine ? `<button id="deletePostBtn" class="btn-danger"><i class="fa-regular fa-trash-can"></i> 削除</button>` : ''}
      ${!isMine ? `<button id="reportPostBtn" class="btn-report" title="通報"><i class="fa-regular fa-flag"></i></button>` : ''}
    </div>
  `;

  document.getElementById("detailModal").classList.add("show");

  // いいねしたユーザー一覧
  safeOnClick("detailLikeCountBtn", () => {
    if (likes.length === 0) { alert("まだいいねはありません"); return; }
    openUserListModal("いいねしたユーザー", likes);
  });

  // ★ 吹き出しボタンを押したら下からコメントシートを開く
  safeOnClick("openCommentsSheetBtn", () => openCommentsModal(item));

  // ★ 紙飛行機ボタンを押したらOSの「リンクを共有」画面を直接起動
  safeOnClick("sharePostPlaneBtn", async () => {
    const baseUrl = window.location.origin + window.location.pathname;
    const postUrl = `${baseUrl}?post=${encodeURIComponent(item.id)}`;
    const shareData = {
      title: `【OKATRI】${item.title}`,
      text: `岡山のスポット「${item.title}」(@${item.area}) #オカトリ #岡山旅行`,
      url: postUrl
    };

    if (navigator.share) {
      try {
        await navigator.share(shareData);
      } catch (err) {
        // キャンセル時は何もしない
      }
    } else {
      if (navigator.clipboard) navigator.clipboard.writeText(postUrl);
      alert(`投稿のURLをコピーしました！\n${postUrl}`);
    }
  });

  safeOnClick("openEditPostBtn", () => openEditPostModal(item));
  safeOnClick("detailLikeBtn", () => { toggleLike(item.id); openDetail(item); });
  safeOnClick("detailBmBtn", () => { toggleBookmark(item.id); openDetail(item); });

  safeOnClick("adminPickupBtn", async () => {
    if (!confirm(`「${item.title}」を公式ピックアップに登録しますか？`)) return;
    const newPickup = {
      id: generateUniqueId("pk"),
      title: item.title,
      area: item.area,
      desc: item.description ? item.description.substring(0, 60) : item.title,
      lat: item.lat || 34.6618,
      lng: item.lng || 133.9350,
      image_url: item.image_url
    };
    pickupsData.unshift(newPickup);
    renderPickups();
    updateMapMarkers();
    if (db) await db.from("pickups").insert([newPickup]);
    alert(`「${item.title}」をエリアマップのピックアップに追加しました！`);
  });

  safeOnClick("reportPostBtn", async () => {
    if (!currentUser) { alert("ログインが必要です"); return; }
    const reason = prompt("通報の理由を入力してください:");
    if (!reason || reason.trim() === "") return;
    if (db) {
      await db.from("reports").insert([{
        id: generateUniqueId("rep"),
        post_id: item.id,
        reporter_user_id: currentUser.userId,
        reason: reason.trim()
      }]);
    }
    alert("通報を受理しました。運営チームが確認いたします。");
  });

  safeOnClick("detailUserBtn", () => {
    document.getElementById("detailModal").classList.remove("show");
    openUserProfile(item.user_id, item.nickname);
  });

  safeOnClick("setStartSpotBtn", () => {
    document.getElementById("detailModal").classList.remove("show");
    document.querySelectorAll('[data-tab="tabRoutes"]').forEach(el => el.click());
    const select = document.getElementById("routeStartSelect");
    if (select) {
      const opt = document.createElement("option");
      opt.value = item.title;
      opt.textContent = `${item.title}`;
      select.appendChild(opt);
      select.value = item.title;
    }
  });

  safeOnClick("deletePostBtn", async () => {
    if (!confirm("この投稿を削除しますか？")) return;
    postsData = postsData.filter(p => p.id !== item.id);
    applySortAndRender();
    renderMyProfileSpots();
    updateMapMarkers();
    document.getElementById("detailModal").classList.remove("show");
    if (db) await db.from("posts").delete().eq("id", item.id);
  });
}

// ★ 画像1枚目風：WEAR式コメントツリーHTML生成
function renderCommentTreeHtml(rootComments, allComments, postAuthorUserId) {
  if (rootComments.length === 0) {
    return '<div style="font-size:12px; color:#94a3b8; text-align:center; padding:20px 0;">まだコメントはありません</div>';
  }

  return rootComments.map(c => {
    const authorUser = allUsersData.find(u => u.user_id === c.user_id);
    const avSrc = authorUser && authorUser.avatar ? authorUser.avatar : 'https://via.placeholder.com/38';
    const isAuthor = c.user_id === postAuthorUserId;

    // 返信コメント一覧
    const replies = allComments.filter(r => r.parent_id === c.id);
    const repliesHtml = replies.map(r => {
      const rUser = allUsersData.find(u => u.user_id === r.user_id);
      const rAvSrc = rUser && rUser.avatar ? rUser.avatar : 'https://via.placeholder.com/38';
      const rIsAuthor = r.user_id === postAuthorUserId;

      return `
        <div class="wear-comment-item" style="margin-left: 36px;">
          <img src="${rAvSrc}" class="wear-comment-avatar" onerror="this.src='https://via.placeholder.com/38'">
          <div class="wear-comment-body">
            <div class="wear-comment-header">
              <span class="wear-comment-author">${r.nickname}</span>
              ${rIsAuthor ? '<span class="wear-author-tag">・投稿者</span>' : ''}
            </div>
            <div class="wear-comment-text">${r.comment}</div>
          </div>
          <div class="wear-comment-like"><i class="fa-regular fa-heart"></i></div>
        </div>
      `;
    }).join('');

    return `
      <div class="wear-comment-item">
        <img src="${avSrc}" class="wear-comment-avatar" onerror="this.src='https://via.placeholder.com/38'">
        <div class="wear-comment-body">
          <div class="wear-comment-header">
            <span class="wear-comment-author">${c.nickname}</span>
            ${isAuthor ? '<span class="wear-author-tag">・投稿者</span>' : ''}
          </div>
          <div class="wear-comment-text">${c.comment}</div>
          <div class="wear-comment-actions">
            <span class="wear-reply-link" onclick="setReplyTarget('${c.id}', '${c.nickname}')">返信</span>
          </div>
        </div>
        <div class="wear-comment-like"><i class="fa-regular fa-heart"></i></div>
      </div>
      ${repliesHtml}
    `;
  }).join('');
}

// ====================================================
// ★ コメント専用ボトムシート表示＆送信処理
// ====================================================
function openCommentsModal(post) {
  const modal = document.getElementById("postCommentsModal");
  const list = document.getElementById("postCommentsModalList");
  const myAv = document.getElementById("commentBarMyAvatar");
  const input = document.getElementById("newCommentInput");
  if (!modal || !list) return;

  // 自分のアイコンをセット
  if (myAv) {
    myAv.src = (currentUser && currentUser.avatar) ? currentUser.avatar : 'https://via.placeholder.com/32';
  }

  // プレースホルダーを更新
  if (input) {
    input.placeholder = `${post.nickname || '投稿者'}へのコメントを追加...`;
    input.value = "";
  }
  currentReplyingCommentId = null;
  cancelReplyTarget();

  function renderList() {
    const postComments = commentsData.filter(c => c.post_id === post.id);
    const rootComments = postComments.filter(c => !c.parent_id);
    list.innerHTML = renderCommentTreeHtml(rootComments, postComments, post.user_id);
    // 詳細画面側の件数バッジも更新
    const cCountEl = document.getElementById("detailCommentCount");
    if (cCountEl) cCountEl.textContent = postComments.length;
  }

  renderList();
  modal.classList.add("show");

  // 閉じるボタン
  safeOnClick("closeCommentsModalBtn", () => modal.classList.remove("show"));

  // コメント送信処理
  safeOnClick("addCommentBtn", async () => {
    const val = (document.getElementById("newCommentInput").value || "").trim();
    if (!val) return;

    const newCmt = {
      id: generateUniqueId("cmt"),
      post_id: post.id,
      user_id: currentUser ? currentUser.userId : "guest",
      nickname: currentUser ? currentUser.nickname : "匿名",
      comment: val,
      parent_id: currentReplyingCommentId
    };

    commentsData.push(newCmt);
    currentReplyingCommentId = null;
    cancelReplyTarget();
    document.getElementById("newCommentInput").value = "";
    renderList();

    if (db) {
      await db.from("comments").insert([newCmt]);
      sendNotification(post.user_id, 'comment', post.id, post.title);
    }
  });
}

window.setReplyTarget = function(commentId, nickname) {
  currentReplyingCommentId = commentId;
  const box = document.getElementById("replyingIndicatorBox");
  if (box) {
    box.innerHTML = `
      <div class="replying-indicator">
        <span><b>@${nickname}</b> に返信中</span>
        <button onclick="cancelReplyTarget()" style="background:none; border:none; cursor:pointer; color:var(--primary-accent);"><i class="fa-solid fa-xmark"></i></button>
      </div>
    `;
  }
  const input = document.getElementById("newCommentInput");
  if (input) input.focus();
};

window.cancelReplyTarget = function() {
  currentReplyingCommentId = null;
  const box = document.getElementById("replyingIndicatorBox");
  if (box) box.innerHTML = "";
};

// いいね（通知付き）
async function toggleLike(postId) {
  if (!currentUser) { alert("ログインが必要です"); return; }
  const post = postsData.find(p => p.id === postId);
  if (!post) return;
  let likes = parseArray(post.likes);
  const idx = likes.indexOf(currentUser.userId);
  const isNowLiked = idx < 0;

  if (isNowLiked) {
    likes.push(currentUser.userId);
    sendNotification(post.user_id, 'like', post.id, post.title);
  } else {
    likes.splice(idx, 1);
  }
  post.likes = likes;
  applySortAndRender();
  if (db) await db.from("posts").update({ likes: likes }).eq("id", postId);
}

async function toggleBookmark(postId) {
  if (!currentUser) { alert("ログインが必要です"); return; }
  currentUser.bookmarks = currentUser.bookmarks || [];
  const idx = currentUser.bookmarks.indexOf(postId);
  if (idx >= 0) currentUser.bookmarks.splice(idx, 1);
  else currentUser.bookmarks.push(postId);
  localStorage.setItem("okatari_user", JSON.stringify(currentUser));
  applySortAndRender();
  renderMyProfileSpots();
  if (db) await db.from("users_custom").update({ bookmarks: currentUser.bookmarks }).eq("user_id", currentUser.userId);
}

// ====================================================
// 11. AI 道なりプラン作成
// ====================================================
function setupAiRouteFeature() {
  const btn = document.getElementById("generateAiRouteBtn");
  if (!btn) return;

  btn.addEventListener("click", async () => {
    const startInput = document.getElementById("aiStartInput");
    const goalInput = document.getElementById("aiGoalInput");
    const themeSelect = document.getElementById("aiThemeSelect");
    const start = (startInput ? startInput.value.trim() : "") || "岡山駅";
    const goal = (goalInput ? goalInput.value.trim() : "") || "倉敷美観地区";
    const theme = themeSelect ? themeSelect.value : "王道の岡山絶景＆名所めぐり";
    const aiBadge = document.getElementById("aiBadgeStatus");
    const placeholder = document.getElementById("routePlaceholder");
    const resultArea = document.getElementById("routeResultArea");

    btn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Gemini AIがプランを作成中...`;
    btn.disabled = true;

    let targetMasterSpots = aiMasterSpotsData.filter(s => s.genre === theme);
    if (targetMasterSpots.length === 0) targetMasterSpots = aiMasterSpotsData;
    const masterContext = targetMasterSpots.map(s => `・${s.name} (${s.area}): ${s.desc}`).join("\n");

    let plan = null;
    let isGeminiSuccess = false;

    const promptText = `あなたは岡山県観光のプロのガイドAIです。
出発地【${start}】から最終目的地【${goal}】まで、岡山県内の位置関係を考慮し、無駄な往復のないスムーズな道なり・順路で巡る1日観光モデルコース（タイムスケジュール付き）を考案してください。

【希望テーマ】: ${theme}
【岡山おすすめスポットデータ】:
${masterContext || '岡山後楽園、倉敷美観地区、問屋町カフェ通り、鷲羽山展望台、吉備津神社など'}

【重要ルール】
1. スタート【${start}】からゴール【${goal}】へ向かう自然な道順（道なり）で立ち寄りスポットを2〜3箇所選んでください。
2. タイムスケジュールは09:00〜17:30で記述してください。
3. 必ず以下のJSON配列フォーマットのみを出力してください:
[
  { "time": "09:00", "name": "スポット名", "desc": "具体的なおすすめポイントや見どころ" },
  { "time": "11:30", "name": "スポット名", "desc": "具体的なおすすめポイントや見どころ" },
  { "time": "14:00", "name": "スポット名", "desc": "具体的なおすすめポイントや見どころ" },
  { "time": "17:30", "name": "${goal}", "desc": "ゴールの見どころや締めくくり" }
]`;

    if (GEMINI_API_KEY && GEMINI_API_KEY.trim() !== "") {
      const apiKey = GEMINI_API_KEY.trim();
      const candidateModels = ["gemini-3.8-flash", "gemini-2.5-flash", "gemini-2.0-flash"];

      for (const model of candidateModels) {
        try {
          const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(apiKey)}`;
          const response = await fetch(url, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              contents: [{ parts: [{ text: promptText }] }],
              generationConfig: { responseMimeType: "application/json" }
            })
          });

          const resJson = await response.json();

          if (!resJson.error && resJson.candidates && resJson.candidates[0].content && resJson.candidates[0].content.parts[0].text) {
            let text = resJson.candidates[0].content.parts[0].text.trim();
            text = text.replace(/```json/gi, '').replace(/```/g, '').trim();
            const startIdx = text.indexOf('[');
            const endIdx = text.lastIndexOf(']');
            if (startIdx !== -1 && endIdx !== -1) text = text.substring(startIdx, endIdx + 1);
            plan = JSON.parse(text);
            if (Array.isArray(plan) && plan.length > 0) {
              isGeminiSuccess = true;
              break;
            }
          }
        } catch (err) {
          console.warn(`モデル ${model} 接続失敗:`, err);
        }
      }
    }

    if (isGeminiSuccess && plan && Array.isArray(plan)) {
      const timeline = document.getElementById("routeTimeline");
      let mapUrl = `https://www.google.com/maps/dir/${encodeURIComponent(start)}/`;

      if (timeline) {
        timeline.innerHTML = "";
        plan.forEach(item => {
          timeline.innerHTML += `<li><b>${item.time} ${item.name}</b><br><span style="color:var(--text-secondary); font-size:12px;">${item.desc}</span></li>`;
          if (item.name !== `${start} 出発`) mapUrl += `${encodeURIComponent(item.name.replace(/^🎯 /, ''))}/`;
        });

        const mapLink = document.getElementById("googleMapsLink");
        if (mapLink) mapLink.href = mapUrl;
      }

      // ★ 生成されたルートデータを保持
      currentGeneratingRouteData = {
        title: `${start} ➔ ${goal} (${theme})`,
        spots: plan,
        mapUrl: mapUrl
      };

      const resTitle = document.getElementById("routeResultTitle");
      if (resTitle) resTitle.textContent = `${start} ➔ ${goal} (${theme})`;
      if (aiBadge) aiBadge.textContent = "Gemini AI 考案";

      if (placeholder) placeholder.style.display = "none";
      if (resultArea) resultArea.style.display = "block";
    } else {
      if (resultArea) resultArea.style.display = "none";
      if (placeholder) {
        placeholder.style.display = "block";
        placeholder.innerHTML = `
          <div style="background:#fff1f2; border:1px solid #fecdd3; border-radius:var(--radius-md); padding:16px; text-align:center;">
            <i class="fa-solid fa-triangle-exclamation" style="font-size:24px; color:#e11d48; margin-bottom:8px;"></i>
            <div style="font-weight:700; font-size:14px; color:#9f1239; margin-bottom:4px;">ただいまAIが大変混雑しております</div>
            <p style="font-size:12px; color:#be123c; margin:0; line-height:1.6;">
              アクセス集中によりプランの生成が一時的に行えませんでした。<br>
              誠に恐れ入りますが、少し時間をおいてから再度お試しください。
            </p>
          </div>
        `;
      }
    }

    btn.innerHTML = `<i class="fa-solid fa-compass"></i> 道なりプランを生成する`;
    btn.disabled = false;
  });
}

function renderRouteSpotCheckboxes() {
  const container = document.getElementById("routeSpotCheckboxes");
  const searchInput = document.getElementById("routeSpotSearch");
  if (!container) return;
  const searchVal = searchInput ? searchInput.value.toLowerCase() : "";
  container.innerHTML = "";

  let filtered = postsData;
  if (routeFilterMode === "liked" && currentUser) filtered = filtered.filter(p => parseArray(p.likes).includes(currentUser.userId));
  else if (routeFilterMode === "bookmarked" && currentUser) filtered = filtered.filter(p => (currentUser.bookmarks || []).includes(p.id));
  if (searchVal) filtered = filtered.filter(p => (p.title && p.title.toLowerCase().includes(searchVal)) || (p.area && p.area.toLowerCase().includes(searchVal)));

  if (filtered.length === 0) {
    container.innerHTML = `<div style="font-size:12px; color:#94a3b8; padding:8px;">選択可能なスポットがありません</div>`;
    return;
  }

  filtered.forEach((p, idx) => {
    const div = document.createElement("div");
    div.className = "checkbox-item";
    div.innerHTML = `<input type="checkbox" id="rt_chk_${idx}" value="${p.title}"><label for="rt_chk_${idx}">${p.title} (@${p.area})</label>`;
    container.appendChild(div);
  });
}

// ====================================================
// 12. 投稿・カメラ・GPS
// ====================================================
function fetchBackgroundLocation() {
  const status = document.getElementById("geoStatus");
  const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
  
  // ★ パソコンの場合はGPS取得を行わない
  if (!isMobile) {
    if (status) status.textContent = "※パソコンからは住所を入力してピンを刺してください";
    return;
  }

  if (!navigator.geolocation) {
    if (status) status.textContent = "GPS非対応の環境です";
    return;
  }
  if (status) status.textContent = "位置情報を取得中...";

  navigator.geolocation.getCurrentPosition(async (pos) => {
    currentLatitude = pos.coords.latitude;
    currentLongitude = pos.coords.longitude;
    if (status) status.textContent = `位置情報取得済み (${currentLatitude.toFixed(4)}, ${currentLongitude.toFixed(4)})`;

    try {
      const res = await fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${currentLatitude}&lon=${currentLongitude}`);
      const data = await res.json();
      if (data && data.display_name) {
        const addrInput = document.getElementById("postAddress");
        if (addrInput) addrInput.value = data.display_name;
        const areaSelect = document.getElementById("postArea");
        const addr = data.display_name;
        if (areaSelect) {
          const areas = [
            "岡山市北区", "岡山市中区", "岡山市東区", "岡山市南区",
            "倉敷市", "津山市", "玉野市", "笠岡市", "井原市", "総社市", "高梁市", "新見市",
            "備前市", "瀬戸内市", "赤磐市", "真庭市", "美作市", "浅口市",
            "和気町", "早島町", "里庄町", "矢掛町", "鏡野町", "勝央町", "奈義町", "久米南町", "美咲町", "吉備中央町",
            "新庄村", "西粟倉村"
          ];
          const found = areas.find(a => addr.includes(a.replace(/市|区|町|村/g, '')));
          if (found) {
            areaSelect.value = found;
          }
        }
      }
    } catch(e) {
      console.warn("住所逆ジオコーディングエラー:", e);
    }
  }, (err) => {
    if (status) status.textContent = "位置情報の取得をスキップしました";
  }, { enableHighAccuracy: true, timeout: 8000 });
}

// ====================================================
// ★ 1枚カメラ撮影 ＆ 複数枚アルバム選択の分岐処理
// ====================================================
// 「＋」ボタン用：カメラを直接起動（1枚）
function handleOpenPostAction() {
  fetchBackgroundLocation();
  const cameraInput = document.getElementById("postCameraInput");
  if (cameraInput) {
    cameraInput.value = "";
    cameraInput.click();
  }
}

// ホームの「アルバムから複数枚投稿」ボタン用：アルバムを開く（最大4枚）
function handleOpenMultiPostAction() {
  fetchBackgroundLocation();
  const multiInput = document.getElementById("postMultiImageInput");
  if (multiInput) {
    multiInput.value = "";
    multiInput.click();
  }
}

// 画像圧縮共通処理
function processImageFile(file, callback) {
  const reader = new FileReader();
  reader.onload = function(evt) {
    const img = new Image();
    img.src = evt.target.result;
    img.onload = function() {
      const canvas = document.createElement("canvas");
      const MAX = 800;
      let w = img.width, h = img.height;
      if (w > MAX) { h *= MAX / w; w = MAX; }
      canvas.width = w; canvas.height = h;
      canvas.getContext("2d").drawImage(img, 0, 0, w, h);
      callback(canvas.toDataURL("image/jpeg", 0.75));
    };
  };
  reader.readAsDataURL(file);
}

// プレビュー描画共通処理
function renderImagePreviews(b64Array) {
  const prevBox = document.getElementById("imagePreviewBox");
  if (!prevBox) return;
  prevBox.innerHTML = "";
  b64Array.forEach(b64 => {
    const img = document.createElement("img");
    img.src = b64;
    img.style.width = "70px";
    img.style.height = "70px";
    img.style.objectFit = "cover";
    img.style.borderRadius = "var(--radius-md)";
    img.style.border = "1px solid var(--border-subtle)";
    prevBox.appendChild(img);
  });
}

// ====================================================
// 13. 認証＆UI制御・イベントリスナー
// ====================================================
function updateUserUI() {
  const mobileAuthBtn = document.getElementById("mobileAuthBtn");
  const sidebarUserName = document.getElementById("sidebarUserName");
  const sidebarAuthBtn = document.getElementById("sidebarAuthBtn");
  const drawerAuthBtn = document.getElementById("drawerAuthBtn");
  const profileNick = document.getElementById("profileNickname");
  const profileBio = document.getElementById("profileBio");
  const followingCount = document.querySelector("#openFollowingBtn b");
  const followerCount = document.querySelector("#openFollowersBtn b");
  const myAvatarBox = document.getElementById("myAvatarBox");
  const sidebarAvatarIcon = document.getElementById("sidebarAvatarIcon");
  const drawerSettingsLink = document.getElementById("drawerSettingsLink");
  const goToSettingsBtn = document.getElementById("goToSettingsBtn");
  const adminRallyArea = document.getElementById("adminCreateRallyArea");

  if (currentUser) {
    const adminBadge = currentUser.is_admin ? `<span class="admin-badge">OFFICIAL</span>` : '';
    if (mobileAuthBtn) mobileAuthBtn.textContent = "ログアウト";
    if (sidebarUserName) sidebarUserName.innerHTML = `${currentUser.nickname} ${adminBadge}`;
    if (sidebarAuthBtn) sidebarAuthBtn.textContent = "ログアウト";
    if (drawerAuthBtn) drawerAuthBtn.innerHTML = `<i class="fa-solid fa-arrow-right-from-bracket"></i> ログアウト`;
    if (profileNick) profileNick.innerHTML = `${currentUser.nickname} (@${currentUser.userId}) ${adminBadge}`;
    if (profileBio) profileBio.textContent = currentUser.bio || "岡山の旅を共有しています";
    
    const myFollowing = parseArray(currentUser.following);
    const myFollowers = parseArray(currentUser.followers);
    if (followingCount) followingCount.textContent = myFollowing.length;
    if (followerCount) followerCount.textContent = myFollowers.length;

    safeOnClick("openFollowingBtn", () => openUserListModal("フォロー中", myFollowing));
    safeOnClick("openFollowersBtn", () => openUserListModal("フォロワー", myFollowers));

    if (goToSettingsBtn) goToSettingsBtn.style.display = "inline-flex";
    if (drawerSettingsLink) drawerSettingsLink.style.display = "flex";
    if (adminRallyArea) adminRallyArea.style.display = currentUser.is_admin ? "block" : "none";

    const av = currentUser.avatar ? `<img src="${currentUser.avatar}">` : `<i class="fa-solid fa-user"></i>`;
    if (myAvatarBox) myAvatarBox.innerHTML = av;
    if (sidebarAvatarIcon) sidebarAvatarIcon.innerHTML = av;
  } else {
    if (mobileAuthBtn) mobileAuthBtn.textContent = "ログイン";
    if (sidebarUserName) sidebarUserName.textContent = "ゲスト";
    if (sidebarAuthBtn) sidebarAuthBtn.textContent = "ログイン / 新規登録";
    if (drawerAuthBtn) drawerAuthBtn.innerHTML = `<i class="fa-solid fa-arrow-right-to-bracket"></i> ログイン / 新規登録`;
    if (profileNick) profileNick.textContent = "未ログイン";
    if (profileBio) profileBio.textContent = "ログインするとすべての機能が利用できます";
    if (followingCount) followingCount.textContent = "0";
    if (followerCount) followerCount.textContent = "0";
    if (goToSettingsBtn) goToSettingsBtn.style.display = "none";
    if (drawerSettingsLink) drawerSettingsLink.style.display = "none";
    if (adminRallyArea) adminRallyArea.style.display = "none";
    if (myAvatarBox) myAvatarBox.innerHTML = `<i class="fa-solid fa-user"></i>`;
    if (sidebarAvatarIcon) sidebarAvatarIcon.innerHTML = `<i class="fa-solid fa-user"></i>`;
  }
}

function setupEventListeners() {
  // プラスボタンは今まで通り「カメラ直接起動（1枚）」
  safeOnClick("sidebarPostBtn", handleOpenPostAction);
  safeOnClick("mobileCenterPostBtn", handleOpenPostAction);

  // ホームのボタンは「アルバムから複数枚選択」
  safeOnClick("topPostBtn", handleOpenMultiPostAction);

  // モーダル内の再選択ボタン
  safeOnClick("modalRetakeCameraBtn", () => {
    const cIn = document.getElementById("postCameraInput");
    if (cIn) cIn.click();
  });
  safeOnClick("modalPickMultiBtn", () => {
    const mIn = document.getElementById("postMultiImageInput");
    if (mIn) mIn.click();
  });

  // ① カメラ撮影完了時のイベント（1枚）
  const cameraInput = document.getElementById("postCameraInput");
  if (cameraInput) {
    cameraInput.addEventListener("change", function(e) {
      const file = e.target.files[0];
      if (!file) return;

      const slotSelect = document.getElementById("postTimeSlot");
      if (slotSelect) slotSelect.value = getInitialTimeSlot();

      processImageFile(file, (b64) => {
        currentUploadedImagesBase64 = [b64];
        currentUploadedBase64 = b64;
        renderImagePreviews(currentUploadedImagesBase64);
        const pModal = document.getElementById("postModal");
        if (pModal) pModal.classList.add("show");
      });
    });
  }

  // ② アルバム複数枚選択時のイベント（最大4枚）
  const multiInput = document.getElementById("postMultiImageInput");
  if (multiInput) {
    multiInput.addEventListener("change", function(e) {
      const files = Array.from(e.target.files).slice(0, 4);
      if (!files || files.length === 0) return;

      const slotSelect = document.getElementById("postTimeSlot");
      if (slotSelect) slotSelect.value = getInitialTimeSlot();

      currentUploadedImagesBase64 = [];
      let loaded = 0;

      files.forEach((file) => {
        processImageFile(file, (b64) => {
          currentUploadedImagesBase64.push(b64);
          loaded++;
          if (loaded === files.length) {
            currentUploadedBase64 = currentUploadedImagesBase64[0];
            renderImagePreviews(currentUploadedImagesBase64);
            const pModal = document.getElementById("postModal");
            if (pModal) pModal.classList.add("show");
          }
        });
      });
    });
  }

  safeOnClick("openDrawerBtn", openMobileDrawer);
  safeOnClick("closeDrawerBtn", closeMobileDrawer);
  safeOnClick("drawerOverlay", closeMobileDrawer);

  safeOnClick("closePostModalBtn", () => document.getElementById("postModal").classList.remove("show"));
  safeOnClick("cancelPostBtn", () => document.getElementById("postModal").classList.remove("show"));
  safeOnClick("closeDetailModalBtn", () => document.getElementById("detailModal").classList.remove("show"));
  safeOnClick("closeUserProfileModalBtn", () => document.getElementById("userProfileModal").classList.remove("show"));
  safeOnClick("closeUserListModalBtn", () => document.getElementById("userListModal").classList.remove("show"));
  safeOnClick("closeNewsDetailModalBtn", () => document.getElementById("newsDetailModal").classList.remove("show"));
  safeOnClick("closeClaimAchievementModalBtn", () => document.getElementById("claimAchievementModal").classList.remove("show"));
  safeOnClick("closeAuthModalBtn", () => document.getElementById("authModal").classList.remove("show"));
  safeOnClick("closeAchDetailModalBtn", () => document.getElementById("achievementDetailModal").classList.remove("show"));
  safeOnClick("closeCreateRallyModalBtn", () => document.getElementById("createRallyModal").classList.remove("show"));
  safeOnClick("cancelCreateRallyBtn", () => document.getElementById("createRallyModal").classList.remove("show"));
  safeOnClick("closeCreateBadgeModalBtn", () => document.getElementById("createBadgeModal").classList.remove("show"));
  safeOnClick("cancelCreateBadgeBtn", () => document.getElementById("createBadgeModal").classList.remove("show"));

  // 昼夜切り替えボタン
  safeOnClick("setTimeDayBtn", () => setTimeMode("day"));
  safeOnClick("setTimeNightBtn", () => setTimeMode("night"));

  // 公式ボタン
  safeOnClick("openCreateBadgeModalBtn", () => document.getElementById("createBadgeModal").classList.add("show"));
  safeOnClick("openCreateRallyModalBtn", openCreateRallyModal);

  // ルートシェア
  safeOnClick("shareRouteXBtn", () => {
    const title = document.getElementById("routeResultTitle").textContent;
    const mapUrl = document.getElementById("googleMapsLink").href;
    const text = `【OKATRI】岡山の観光モデルコースを作成しました！\nルート: ${title}\n#オカトリ #岡山観光 #旅行プラン`;
    window.open(`https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}&url=${encodeURIComponent(mapUrl)}`, '_blank');
  });

  safeOnClick("shareRouteLineBtn", () => {
    const title = document.getElementById("routeResultTitle").textContent;
    const mapUrl = document.getElementById("googleMapsLink").href;
    const text = `【OKATRI】岡山旅行モデルコース: ${title}\nGoogleマップナビ: ${mapUrl}`;
    window.open(`https://line.me/R/msg/text/?${encodeURIComponent(`${text}\n${mapUrl}`)}`, '_blank');
  });

  safeOnClick("shareRouteCopyBtn", () => {
    const title = document.getElementById("routeResultTitle").textContent;
    const mapUrl = document.getElementById("googleMapsLink").href;
    navigator.clipboard.writeText(`【OKATRI 岡山旅行プラン】\n${title}\nナビURL: ${mapUrl}`);
    alert("ルート情報をコピーしました！メッセージ等に貼り付けて共有できます。");
  });

  // ルート投稿モーダル
  safeOnClick("openPublishRouteModalBtn", () => {
    if (!currentUser) { alert("ルートを投稿するにはログインが必要です"); return; }
    const title = document.getElementById("routeResultTitle").textContent;
    document.getElementById("pubRouteTitleInput").value = title;
    document.getElementById("publishRouteModal").classList.add("show");
  });
  safeOnClick("closePublishRouteModalBtn", () => document.getElementById("publishRouteModal").classList.remove("show"));
  safeOnClick("cancelPublishRouteBtn", () => document.getElementById("publishRouteModal").classList.remove("show"));
  safeOnClick("closeRouteDetailModalBtn", () => document.getElementById("routeDetailModal").classList.remove("show"));

  const pubRouteForm = document.getElementById("publishRouteForm");
  if (pubRouteForm) {
    pubRouteForm.onsubmit = async (e) => {
      e.preventDefault();
      const submitBtn = document.getElementById("submitPublishRouteBtn");
      if (submitBtn) { submitBtn.textContent = "投稿中..."; submitBtn.disabled = true; }

      const title = document.getElementById("pubRouteTitleInput").value.trim();
      const theme = document.getElementById("pubRouteThemeInput").value.trim();
      const desc = document.getElementById("pubRouteDescInput").value.trim();
      const mapUrl = document.getElementById("googleMapsLink") ? document.getElementById("googleMapsLink").href : "#";

      const newSharedRoute = {
        id: generateUniqueId("route"),
        title: title,
        theme: theme || "#岡山モデルコース",
        desc: desc,
        spots: currentGeneratingRouteData ? currentGeneratingRouteData.spots : [],
        map_url: mapUrl,
        author: currentUser.nickname,
        user_id: currentUser.userId
      };

      sharedRoutesData.unshift(newSharedRoute);

      if (db) {
        await db.from("shared_routes").insert([newSharedRoute]);
      }

      alert("🎉 ルートをコミュニティに公開・保存しました！\n「検索」タブの「ルート」からいつでも閲覧できます。");
      if (submitBtn) { submitBtn.textContent = "ルートを投稿する"; submitBtn.disabled = false; }
      document.getElementById("publishRouteModal").classList.remove("show");
      
      renderDiscoverRoutes();
    };
  }
  
  // 公式バッジ画像選択
  let badgeImageBase64 = "";
  const badgeImgIn = document.getElementById("badgeImageInput");
  if (badgeImgIn) {
    badgeImgIn.addEventListener("change", function(e) {
      const file = e.target.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = function(evt) {
        badgeImageBase64 = evt.target.result;
        const prev = document.getElementById("badgePreviewBox");
        if (prev) prev.innerHTML = `<img src="${badgeImageBase64}" style="width:64px; height:64px; border-radius:50%; object-fit:cover; border:2px solid #fbcfe0;">`;
      };
      reader.readAsDataURL(file);
    });
  }

  // 公式バッジ作成フォーム
  const badgeForm = document.getElementById("createBadgeForm");
  if (badgeForm) {
    badgeForm.onsubmit = async (e) => {
      e.preventDefault();
      const title = document.getElementById("badgeTitleInput").value.trim();
      const code = document.getElementById("badgeCodeInput").value.trim().toUpperCase();
      const desc = document.getElementById("badgeDescInput").value.trim();

      const newBadge = {
        code: code,
        title: title,
        description: desc,
        image_url: badgeImageBase64 || "https://images.unsplash.com/photo-1579783900882-c0d3dad7b119?auto=format&fit=crop&w=150&q=80"
      };

      masterBadgesData.push(newBadge);
      renderPokedex();

      if (db) await db.from("achievements_master").insert([newBadge]);

      alert(`🎉 新しいバッジ「${title}」（コード: ${code}）を作成しました！`);
      badgeForm.reset();
      const prev = document.getElementById("badgePreviewBox");
      if (prev) prev.innerHTML = "";
      badgeImageBase64 = "";
      document.getElementById("createBadgeModal").classList.remove("show");
    };
  }

  // スタンプラリー作成フォーム
  const rallyForm = document.getElementById("createRallyForm");
  if (rallyForm) {
    rallyForm.onsubmit = async (e) => {
      e.preventDefault();
      const submitBtn = document.getElementById("submitCreateRallyBtn");
      if (submitBtn) { submitBtn.textContent = "保存中..."; submitBtn.disabled = true; }

      const title = document.getElementById("rallyTitleInput").value.trim();
      const desc = document.getElementById("rallyDescInput").value.trim();
      const rewardTitle = document.getElementById("rallyRewardBadgeSelect").value;
      
      // 台紙画像ファイルの選択 ＆ Supabaseへの保存
      const bgFileInput = document.getElementById("rallyBgFileInput");
      let bgImageUrl = document.getElementById("rallyBgImageInput") ? document.getElementById("rallyBgImageInput").value.trim() : "";

      if (bgFileInput && bgFileInput.files && bgFileInput.files[0]) {
        const uploadedUrl = await uploadBgImageToStorage(bgFileInput.files[0]);
        if (uploadedUrl) bgImageUrl = uploadedUrl;
      }

      // チェックされたスポットを取得
      const checkedBoxes = document.querySelectorAll("#rallySpotsCheckboxList input:checked");
      if (checkedBoxes.length === 0) {
        alert("立ち寄りスポットを少なくとも1つ選択してください。");
        if (submitBtn) { submitBtn.textContent = "ラリーを公開する"; submitBtn.disabled = false; }
        return;
      }

      // 選択されたすべてのスポットを保存（チェックした個数がそのままスタンプ数になります）
      const spots = Array.from(checkedBoxes).map((chk, i) => ({
        id: `spot_${i}_${Date.now()}`,
        name: chk.getAttribute("data-name"),
        lat: parseFloat(chk.getAttribute("data-lat")),
        lng: parseFloat(chk.getAttribute("data-lng")),
        image_url: chk.getAttribute("data-image") || "",
        radius_m: 600
      }));

      const badgeObj = masterBadgesData.find(b => b.title === rewardTitle);
      const newRally = {
        id: generateUniqueId("rally"),
        title: title,
        description: desc,
        reward_title: rewardTitle,
        reward_img: badgeObj ? badgeObj.image_url : "",
        bg_image_url: bgImageUrl,
        spots: spots,
        active: true
      };

      stampRalliesData.unshift(newRally);
      renderStampRallies();

      if (db) await db.from("stamp_rallies").insert([newRally]);

      alert(`🎉 スタンプラリー「${title}」を公開しました！\n（スタンプ数: ${spots.length}箇所）`);
      rallyForm.reset();
      if (submitBtn) { submitBtn.textContent = "ラリーを公開する"; submitBtn.disabled = false; }
      document.getElementById("createRallyModal").classList.remove("show");
    };
  }

  // 投稿編集フォーム送信
  const editPostForm = document.getElementById("editPostForm");
  if (editPostForm) {
    editPostForm.onsubmit = async (e) => {
      e.preventDefault();
      const postId = document.getElementById("editPostId").value;
      const targetPost = postsData.find(p => p.id === postId);
      if (!targetPost) return;

      const newTitle = document.getElementById("editPostTitle").value.trim();
      const newArea = document.getElementById("editPostArea").value;
      const newTimeSlot = document.getElementById("editPostTimeSlot").value;
      const newTags = document.getElementById("editPostTags").value.trim();
      const newAddress = document.getElementById("editPostAddress").value.trim();
      const newExtUrl = document.getElementById("editPostExternalUrl").value.trim();
      const newDesc = document.getElementById("editPostDescription").value.trim();

      let newLat = targetPost.lat;
      let newLng = targetPost.lng;
      if (newAddress && newAddress !== targetPost.address) {
        const geo = await geocodeAddress(newAddress);
        if (geo) {
          newLat = geo.lat;
          newLng = geo.lng;
        }
      }

      targetPost.title = newTitle;
      targetPost.area = newArea;
      targetPost.time_slot = newTimeSlot;
      targetPost.tags = newTags;
      targetPost.address = newAddress;
      targetPost.external_url = newExtUrl;
      targetPost.description = newDesc;
      targetPost.lat = newLat;
      targetPost.lng = newLng;

      if (db) {
        await db.from("posts").update({
          title: newTitle,
          area: newArea,
          time_slot: newTimeSlot,
          tags: newTags,
          address: newAddress,
          external_url: newExtUrl,
          description: newDesc,
          lat: newLat,
          lng: newLng
        }).eq("id", postId);
      }

      applySortAndRender();
      updateMapMarkers();
      renderMyProfileSpots();

      alert("投稿を更新しました！");
      document.getElementById("editPostModal").classList.remove("show");
      openDetail(targetPost);
    };
  }

  safeOnClick("closeEditPostModalBtn", () => document.getElementById("editPostModal").classList.remove("show"));
  safeOnClick("cancelEditPostBtn", () => document.getElementById("editPostModal").classList.remove("show"));

  // 最新
  safeOnClick("sortNewestBtn", () => {
    currentSortMode = "newest";
    updateFeedTabsUI("sortNewestBtn");
    applySortAndRender();
  });

  // 週間人気
  safeOnClick("sortPopularBtn", () => {
    currentSortMode = "popular";
    updateFeedTabsUI("sortPopularBtn");
    applySortAndRender();
  });

  // フォロー中
  safeOnClick("sortFollowingBtn", () => {
    currentSortMode = "following";
    updateFeedTabsUI("sortFollowingBtn");
    applySortAndRender();
  });

  // タブの下線（active）切り替え関数
  function updateFeedTabsUI(activeId) {
    ["sortNewestBtn", "sortPopularBtn", "sortFollowingBtn"].forEach(id => {
      const btn = document.getElementById(id);
      if (btn) btn.classList.toggle("active", id === activeId);
    });
  }

  const searchInput = document.getElementById("searchInput");
  if (searchInput) searchInput.oninput = applySortAndRender;

  const userSearchInput = document.getElementById("userSearchInput");
  if (userSearchInput) userSearchInput.oninput = () => renderUserSearch(allUsersData);

  const userListSearchInput = document.getElementById("userListSearchInput");
  if (userListSearchInput) userListSearchInput.oninput = () => renderModalUserList(currentModalUserIds);

  document.querySelectorAll(".spot-filter-chips .chip").forEach(chip => {
    chip.onclick = () => {
      document.querySelectorAll(".spot-filter-chips .chip").forEach(c => c.classList.remove("active"));
      chip.classList.add("active");
      routeFilterMode = chip.getAttribute("data-filter");
      renderRouteSpotCheckboxes();
    };
  });
  const routeSpotSearch = document.getElementById("routeSpotSearch");
  if (routeSpotSearch) routeSpotSearch.oninput = renderRouteSpotCheckboxes;

  safeOnClick("modeCustomBtn", () => {
    const b1 = document.getElementById("modeCustomBtn");
    const b2 = document.getElementById("modeAiBtn");
    const cBox = document.getElementById("customRouteBox");
    const aBox = document.getElementById("aiRouteBox");
    if (b1) b1.classList.add("active");
    if (b2) b2.classList.remove("active");
    if (cBox) cBox.style.display = "block";
    if (aBox) aBox.style.display = "none";
  });
  safeOnClick("modeAiBtn", () => {
    const b1 = document.getElementById("modeAiBtn");
    const b2 = document.getElementById("modeCustomBtn");
    const cBox = document.getElementById("customRouteBox");
    const aBox = document.getElementById("aiRouteBox");
    if (b1) b1.classList.add("active");
    if (b2) b2.classList.remove("active");
    if (cBox) cBox.style.display = "none";
    if (aBox) aBox.style.display = "block";
  });

  safeOnClick("generateRouteBtn", () => {
    const startSelect = document.getElementById("routeStartSelect");
    const start = startSelect ? startSelect.value : "岡山駅";
    const startName = start === "CURRENT_GEO" ? "現在地" : start;
    const checks = document.querySelectorAll("#routeSpotCheckboxes input:checked");
    if (checks.length === 0) { alert("立ち寄るスポットを選択してください"); return; }

    const timeline = document.getElementById("routeTimeline");
    const spotsList = [{ time: "出発", name: startName, desc: "" }];

    if (timeline) {
      timeline.innerHTML = `<li><b>出発: ${startName}</b></li>`;
      let mapUrl = `https://www.google.com/maps/dir/${encodeURIComponent(startName)}/`;

      checks.forEach((c, i) => {
        timeline.innerHTML += `<li><b>経由地 ${i + 1}: ${c.value}</b></li>`;
        mapUrl += `${encodeURIComponent(c.value)}/`;
        spotsList.push({ time: `経由地 ${i + 1}`, name: c.value, desc: "" });
      });

      const mapLink = document.getElementById("googleMapsLink");
      if (mapLink) mapLink.href = mapUrl;

      // ★ 生成データを保存
      currentGeneratingRouteData = {
        title: `${startName}発 自由巡回ルート`,
        spots: spotsList,
        mapUrl: mapUrl
      };
    }

    document.getElementById("routeResultTitle").textContent = "自由選択ルート";
    document.getElementById("routePlaceholder").style.display = "none";
    document.getElementById("routeResultArea").style.display = "block";
  });

  safeOnClick("showCurrentPosOnMapBtn", () => {
    if (!navigator.geolocation) { alert("GPS機能が利用できません"); return; }
    navigator.geolocation.getCurrentPosition((pos) => {
      const lat = pos.coords.latitude;
      const lng = pos.coords.longitude;
      
      if (userCurrentLocationMarker && mapInstance) mapInstance.removeLayer(userCurrentLocationMarker);
      
      if (mapInstance) {
        userCurrentLocationMarker = L.circleMarker([lat, lng], {
          radius: 8,
          fillColor: "#2563eb",
          color: "#ffffff",
          weight: 2,
          opacity: 1,
          fillOpacity: 0.9
        }).addTo(mapInstance);
        
        userCurrentLocationMarker.bindPopup("<b>現在地</b>").openPopup();
        mapInstance.setView([lat, lng], 13);
      }
    }, () => {
      alert("位置情報の取得に失敗しました");
    });
  });

  // アチーブメントコード入力
  const claimForm = document.getElementById("claimAchievementForm");
  if (claimForm) {
    claimForm.onsubmit = async (e) => {
      e.preventDefault();
      const code = document.getElementById("achievementCodeInput").value.trim().toUpperCase();
      const targetBadge = masterBadgesData.find(b => b.code && b.code.toUpperCase() === code);

      if (!targetBadge) {
        alert("無効なイベントコードです。");
        return;
      }

      currentUser.achievements = currentUser.achievements || [];
      if (currentUser.achievements.some(a => a.title === targetBadge.title)) {
        alert(`すでに「${targetBadge.title}」を獲得しています。`);
        document.getElementById("claimAchievementModal").classList.remove("show");
        return;
      }

      const newAch = {
        title: targetBadge.title,
        image_url: targetBadge.image_url,
        description: targetBadge.description,
        date: new Date().toLocaleDateString("ja-JP")
      };

      currentUser.achievements.push(newAch);
      localStorage.setItem("okatari_user", JSON.stringify(currentUser));
      renderMyAchievements();
      renderPokedex();

      if (db) await db.from("users_custom").update({ achievements: currentUser.achievements }).eq("user_id", currentUser.userId);

      alert(`🎉 「${targetBadge.title}」を獲得しました！`);
      document.getElementById("claimAchievementModal").classList.remove("show");
    };
  }

  // 設定アイコン画像（位置調整＆ズーム対応）
  let rawAvatarImg = null;
  const avatarIn = document.getElementById("settingsAvatarInput");
  const avatarControls = document.getElementById("avatarAdjustControls");
  const avatarPosY = document.getElementById("avatarPosY");
  const avatarZoom = document.getElementById("avatarZoom");

  function renderCroppedAvatar() {
    if (!rawAvatarImg) return;
    const canvas = document.createElement("canvas");
    canvas.width = 150;
    canvas.height = 150;
    const ctx = canvas.getContext("2d");

    const zoom = parseFloat(avatarZoom ? avatarZoom.value : 1) || 1;
    const posYPercent = (parseFloat(avatarPosY ? avatarPosY.value : 50) || 50) / 100;

    let w = rawAvatarImg.width;
    let h = rawAvatarImg.height;

    let cropSize = Math.min(w, h) / zoom;
    let sx = (w - cropSize) / 2;
    let sy = (h - cropSize) * posYPercent;

    if (sx < 0) sx = 0;
    if (sy < 0) sy = 0;
    if (sx + cropSize > w) sx = w - cropSize;
    if (sy + cropSize > h) sy = h - cropSize;

    ctx.drawImage(rawAvatarImg, sx, sy, cropSize, cropSize, 0, 0, 150, 150);
    currentAvatarBase64 = canvas.toDataURL("image/jpeg", 0.85);

    const prev = document.getElementById("settingsAvatarPreview");
    if (prev) prev.innerHTML = `<img src="${currentAvatarBase64}">`;
  }

  if (avatarIn) {
    avatarIn.addEventListener("change", function(e) {
      const file = e.target.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = function(evt) {
        rawAvatarImg = new Image();
        rawAvatarImg.src = evt.target.result;
        rawAvatarImg.onload = function() {
          if (avatarControls) avatarControls.style.display = "flex";
          renderCroppedAvatar();
        };
      };
      reader.readAsDataURL(file);
    });
  }

  if (avatarPosY) avatarPosY.addEventListener("input", renderCroppedAvatar);
  if (avatarZoom) avatarZoom.addEventListener("input", renderCroppedAvatar);

  // プロフィール設定保存（メール＆通知設定対応）
  const profileForm = document.getElementById("profileSettingsForm");
  if (profileForm) {
    profileForm.onsubmit = async (e) => {
      e.preventDefault();
      const uEl = document.getElementById("settingsUserId");
      const nEl = document.getElementById("settingsNickname");
      const bEl = document.getElementById("settingsBio");
      const eEl = document.getElementById("settingsEmail");
      const nLikes = document.getElementById("notifySettingLikes");
      const nCmts = document.getElementById("notifySettingComments");
      const nFollows = document.getElementById("notifySettingFollows");

      const newUserId = (uEl ? uEl.value.trim() : currentUser.userId);
      const newNick = (nEl ? nEl.value.trim() : "") || "ユーザー";
      const newBio = bEl ? bEl.value.trim() : "";
      const newEmail = eEl ? eEl.value.trim() : "";
      const newNotifySettings = {
        likes: nLikes ? nLikes.checked : true,
        comments: nCmts ? nCmts.checked : true,
        follows: nFollows ? nFollows.checked : true
      };
      const oldUserId = currentUser.userId;
      const saveBtn = document.getElementById("saveProfileBtn");

      if (saveBtn) { saveBtn.textContent = "保存中..."; saveBtn.disabled = true; }

      try {
        if (newUserId !== oldUserId) {
          if (!/^[a-zA-Z0-9_]+$/.test(newUserId)) {
            alert("ユーザーIDは半角英数字とアンダーバーのみ使用できます。");
            if (saveBtn) { saveBtn.textContent = "変更を保存"; saveBtn.disabled = false; }
            return;
          }

          if (db) {
            const { data: existing } = await db.from("users_custom").select("user_id").eq("user_id", newUserId).maybeSingle();
            if (existing) {
              alert(`「${newUserId}」はすでに他のユーザーに使用されています。`);
              if (saveBtn) { saveBtn.textContent = "変更を保存"; saveBtn.disabled = false; }
              return;
            }

            const { error: idError } = await db.from("users_custom").update({
              user_id: newUserId,
              username: newUserId
            }).eq("user_id", oldUserId);

            if (idError) throw idError;

            await Promise.all([
              db.from("posts").update({ user_id: newUserId }).eq("user_id", oldUserId),
              db.from("comments").update({ user_id: newUserId }).eq("user_id", oldUserId),
              db.from("messages").update({ from_user_id: newUserId }).eq("from_user_id", oldUserId),
              db.from("messages").update({ to_user_id: newUserId }).eq("to_user_id", oldUserId),
              db.from("notifications").update({ to_user_id: newUserId }).eq("to_user_id", oldUserId),
              db.from("notifications").update({ from_user_id: newUserId }).eq("from_user_id", oldUserId)
            ]);
          }

          currentUser.userId = newUserId;
          currentUser.username = newUserId;
          postsData.forEach(p => { if (p.user_id === oldUserId) p.user_id = newUserId; });
          commentsData.forEach(c => { if (c.user_id === oldUserId) c.user_id = newUserId; });
        }

        currentUser.nickname = newNick;
        currentUser.bio = newBio;
        currentUser.email = newEmail;
        currentUser.avatar = currentAvatarBase64;
        currentUser.notify_settings = newNotifySettings;
        localStorage.setItem("okatari_user", JSON.stringify(currentUser));

        const found = allUsersData.find(u => u.user_id === newUserId || u.user_id === oldUserId);
        if (found) { 
          found.user_id = newUserId; 
          found.nickname = newNick; 
          found.bio = newBio; 
          found.email = newEmail;
          found.avatar = currentAvatarBase64; 
          found.notify_settings = newNotifySettings;
        }

        if (db) {
          await db.from("users_custom").update({
            nickname: newNick,
            bio: newBio,
            email: newEmail,
            avatar: currentAvatarBase64,
            notify_settings: newNotifySettings
          }).eq("user_id", newUserId);
        }

        updateUserUI();
        applySortAndRender();
        renderMyProfileSpots();

        if (saveBtn) { saveBtn.textContent = "変更を保存"; saveBtn.disabled = false; }
        alert("設定を保存しました！");
        document.querySelectorAll('[data-tab="tabProfile"]').forEach(el => el.click());
      } catch (err) {
        console.error("設定保存エラー:", err);
        alert("保存エラー: " + err.message);
        if (saveBtn) { saveBtn.textContent = "変更を保存"; saveBtn.disabled = false; }
      }
    };
  }

  // DM送信
  safeOnClick("sendDmPageBtn", async () => {
    const input = document.getElementById("dmPageInput");
    if (!input) return;
    const msg = input.value.trim();
    if (!msg || !currentUser || !currentDmTargetUserId) return;

    const list = document.getElementById("dmPageMessageList");
    if (list) {
      const bubble = document.createElement("div");
      bubble.className = "dm-bubble mine";
      bubble.textContent = msg;
      list.appendChild(bubble);
      list.scrollTop = list.scrollHeight;
    }
    input.value = "";

    if (db) {
      await db.from("messages").insert([{
        id: generateUniqueId("msg"),
        from_user_id: currentUser.userId,
        to_user_id: currentDmTargetUserId,
        message: msg
      }]);
    }
  });

  safeOnClick("getGeoBtn", fetchBackgroundLocation);

  // 投稿送信（複数枚Storageアップロード ＆ 岡山ブロック対応）
  const postF = document.getElementById("postForm");
  if (postF) {
    postF.onsubmit = async (e) => {
      e.preventDefault();
      const btn = document.getElementById("submitBtn");
      if (btn) { btn.textContent = "画像を送信中..."; btn.disabled = true; }

      try {
        let finalImageUrls = await uploadMultipleImagesToStorage(currentUploadedImagesBase64);

        if (btn) btn.textContent = "位置情報を確認中...";

        const tIn = document.getElementById("postTitle");
        const aIn = document.getElementById("postArea");
        const tgIn = document.getElementById("postTags");
        const adIn = document.getElementById("postAddress");
        const exIn = document.getElementById("postExternalUrl");
        const dIn = document.getElementById("postDescription");
        const slotIn = document.getElementById("postTimeSlot");

        const inputAddress = adIn ? adIn.value.trim() : "";
        const selectedArea = aIn ? aIn.value : "";
        const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
        let postLat = null;
        let postLng = null;

        // ① 入力された住所・施設名で緯度経度を検索
        if (inputAddress) {
          const geoResult = await geocodeAddress(inputAddress);
          if (geoResult) {
            postLat = geoResult.lat;
            postLng = geoResult.lng;
          }
        }

        // ② 詳細住所でヒットしなかった場合、選択されたエリア名（例: 倉敷市、津山市など）の中心座標を取得
        if (!postLat && selectedArea) {
          const areaGeo = await geocodeAddress(`岡山県 ${selectedArea}`);
          if (areaGeo) {
            postLat = areaGeo.lat;
            postLng = areaGeo.lng;
          }
        }

        // ③ それでも未取得かつスマホの場合のみ現在地GPSを使用
        if (!postLat) {
          if (isMobile) {
            postLat = currentLatitude;
            postLng = currentLongitude;
          } else {
            // パソコンで何も特定できなかった場合のデフォルト（岡山駅前）
            postLat = 34.6655;
            postLng = 133.9186;
          }
        }

        if (!isInsideOkayama(postLat, postLng, inputAddress)) {
          alert("【投稿制限】\nオカトリは岡山県特化型の旅行SNSです。\n岡山県内のスポット・位置情報のみ投稿できます。");
          if (btn) { btn.textContent = "投稿を公開"; btn.disabled = false; }
          return;
        }

        if (btn) btn.textContent = "投稿中...";

        const newPost = {
          id: generateUniqueId("post"),
          user_id: currentUser ? currentUser.userId : "guest",
          nickname: currentUser ? currentUser.nickname : "匿名",
          title: tIn ? tIn.value : "",
          area: aIn ? aIn.value : "",
          tags: (tgIn ? tgIn.value : "") || "#岡山",
          address: inputAddress,
          lat: postLat,
          lng: postLng,
          external_url: exIn ? exIn.value : "",
          description: dIn ? dIn.value : "",
          time_slot: slotIn ? slotIn.value : "all",
          date: new Date().toLocaleDateString("ja-JP"),
          likes: [],
          image_url: finalImageUrls[0] || "https://images.unsplash.com/photo-1542051841857-5f90071e7989?auto=format&fit=crop&w=800&q=80",
          images: finalImageUrls
        };

        if (db) {
          const { error: insertError } = await db.from("posts").insert([newPost]);
          if (insertError) {
            alert("投稿エラー: " + insertError.message);
            if (btn) { btn.textContent = "投稿を公開"; btn.disabled = false; }
            return;
          }
        }

        postsData.unshift(newPost);
        applySortAndRender();
        renderRouteSpotCheckboxes();
        renderMyProfileSpots();
        updateMapMarkers();

        postF.reset();
        document.getElementById("imagePreviewBox").innerHTML = "";
        currentUploadedBase64 = "";
        currentUploadedImagesBase64 = [];

        if (btn) { btn.textContent = "投稿を公開"; btn.disabled = false; }
        document.getElementById("postModal").classList.remove("show");

        alert("スポットの投稿が完了しました！");
      } catch (err) {
        alert("予期せぬエラーが発生しました: " + err.message);
        if (btn) { btn.textContent = "投稿を公開"; btn.disabled = false; }
      }
    };
  }

  // 認証
  const handleAuthClick = () => {
    if (currentUser) {
      if (confirm("ログアウトしますか？")) {
        currentUser = null;
        localStorage.removeItem("okatari_user");
        updateUserUI();
        applySortAndRender();
        renderMyProfileSpots();
        renderMyAchievements();
        renderPokedex();
        renderStampRallies();
        closeMobileDrawer();
      }
    } else {
      closeMobileDrawer();
      document.getElementById("authModal").classList.add("show");
    }
  };

  safeOnClick("mobileAuthBtn", handleAuthClick);
  safeOnClick("sidebarAuthBtn", handleAuthClick);
  safeOnClick("drawerAuthBtn", handleAuthClick);

  let isRegister = false;
  safeOnClick("tabSwitchLogin", () => {
    isRegister = false;
    document.getElementById("tabSwitchLogin").classList.add("active");
    document.getElementById("tabSwitchRegister").classList.remove("active");
    document.getElementById("nicknameGroup").style.display = "none";
    document.getElementById("authSubmitBtn").textContent = "ログイン";
  });

  safeOnClick("tabSwitchRegister", () => {
    isRegister = true;
    document.getElementById("tabSwitchRegister").classList.add("active");
    document.getElementById("tabSwitchLogin").classList.remove("active");
    document.getElementById("nicknameGroup").style.display = "block";
    document.getElementById("authSubmitBtn").textContent = "アカウント作成";
  });

  // パスワード忘れ・確認
  safeOnClick("forgotPasswordBtn", async (e) => {
    e.preventDefault();
    const inputEmail = prompt("登録済みのメールアドレスを入力してください:");
    if (!inputEmail || inputEmail.trim() === "") return;

    if (db) {
      const { data } = await db.from("users_custom").select("user_id, nickname, password").eq("email", inputEmail.trim()).maybeSingle();
      if (data) {
        alert(`【アカウント情報が見つかりました】\nユーザーID: @${data.user_id}\nパスワード: ${data.password}\n\n※この情報を控えてログインしてください。`);
      } else {
        alert("このメールアドレスに一致するアカウントは見つかりませんでした。\n設定画面からメールアドレスを登録しているかご確認ください。");
      }
    } else {
      alert("データベースに接続されていません。");
    }
  });

  const authF = document.getElementById("authForm");
  if (authF) {
    authF.onsubmit = async (e) => {
      e.preventDefault();
      const uIn = document.getElementById("authUsername");
      const pIn = document.getElementById("authPassword");
      const nIn = document.getElementById("authNickname");
      const inputId = (uIn ? uIn.value.trim() : "");
      const password = (pIn ? pIn.value.trim() : "");
      const nickname = (nIn && nIn.value.trim()) ? nIn.value.trim() : inputId;

      if (isRegister) {
        const newU = {
          user_id: inputId,
          username: inputId,
          password: password,
          nickname: nickname,
          bio: "岡山の旅を共有しています",
          email: "",
          avatar: "",
          is_admin: false,
          following: [],
          followers: [],
          bookmarks: [],
          achievements: [],
          featured_badges: [],
          stamps: [],
          blocked_users: [],
          muted_users: [],
          notify_settings: { likes: true, comments: true, follows: true }
        };

        if (db) {
          const { data: existing } = await db.from("users_custom").select("user_id").eq("user_id", inputId).maybeSingle();
          if (existing) {
            alert(`「${inputId}」というユーザーIDは既に使用されています。`);
            return;
          }

          const { error } = await db.from("users_custom").insert([newU]);
          if (error) {
            alert("登録エラーが発生しました: " + error.message);
            return;
          }
        }

        currentUser = {
          userId: inputId,
          username: inputId,
          nickname: nickname,
          bio: newU.bio,
          email: "",
          avatar: "",
          is_admin: false,
          following: [],
          followers: [],
          bookmarks: [],
          achievements: [],
          featured_badges: [],
          stamps: [],
          blocked_users: [],
          muted_users: [],
          notify_settings: newU.notify_settings
        };
        allUsersData.push(newU);
      } else {
        if (db) {
          const { data } = await db.from("users_custom").select("*").eq("user_id", inputId).eq("password", password).maybeSingle();
          if (data) {
            currentUser = {
              userId: data.user_id,
              username: data.user_id,
              nickname: data.nickname,
              bio: data.bio,
              email: data.email || "",
              avatar: data.avatar || "",
              is_admin: data.is_admin || false,
              following: parseArray(data.following),
              followers: parseArray(data.followers),
              bookmarks: parseArray(data.bookmarks),
              achievements: parseArray(data.achievements),
              featured_badges: parseArray(data.featured_badges || "[]"),
              stamps: parseArray(data.stamps || "[]"),
              blocked_users: parseArray(data.blocked_users || "[]"),
              muted_users: parseArray(data.muted_users || "[]"),
              notify_settings: data.notify_settings || { likes: true, comments: true, follows: true }
            };
          } else {
            alert("ユーザーIDまたはパスワードが正しくありません。");
            return;
          }
        } else {
          currentUser = { userId: inputId, username: inputId, nickname: inputId, following: [], followers: [], bookmarks: [], featured_badges: [], stamps: [] };
        }
      }

      localStorage.setItem("okatari_user", JSON.stringify(currentUser));
      updateUserUI();
      applySortAndRender();
      renderMyProfileSpots();
      renderMyAchievements();
      renderPokedex();
      renderStampRallies();
      fetchNotifications();
      document.getElementById("authModal").classList.remove("show");
    };
  }

  // エリアマップ検索
  const mapSearchInput = document.getElementById("mapSearchInput");
  if (mapSearchInput) {
    mapSearchInput.addEventListener("input", (e) => updateMapMarkers(e.target.value));
  }
  // 統合検索（投稿 / ルート / ユーザー）の切り替え
  let currentDiscoverTab = "posts";
  safeOnClick("dTabPostsBtn", () => switchDiscoverTab("posts"));
  safeOnClick("dTabRoutesBtn", () => switchDiscoverTab("routes"));
  safeOnClick("dTabUsersBtn", () => switchDiscoverTab("users"));

  function switchDiscoverTab(tab) {
    currentDiscoverTab = tab;
    // クラス切り替え
    ["dTabPostsBtn", "dTabRoutesBtn", "dTabUsersBtn"].forEach(id => {
      const b = document.getElementById(id);
      if (b) b.classList.remove("active");
    });
    if (tab === "posts") document.getElementById("dTabPostsBtn").classList.add("active");
    if (tab === "routes") document.getElementById("dTabRoutesBtn").classList.add("active");
    if (tab === "users") document.getElementById("dTabUsersBtn").classList.add("active");

    const pSec = document.getElementById("discoverPostsSection");
    const rSec = document.getElementById("discoverRoutesSection");
    const uSec = document.getElementById("discoverUsersSection");

    if (pSec) pSec.style.display = tab === "posts" ? "block" : "none";
    if (rSec) rSec.style.display = tab === "routes" ? "block" : "none";
    if (uSec) uSec.style.display = tab === "users" ? "block" : "none";

    renderDiscoverResults();
  }

  const dInput = document.getElementById("discoverSearchInput");
  if (dInput) {
    dInput.addEventListener("input", renderDiscoverResults);
  }

  function renderDiscoverResults() {
    const query = (document.getElementById("discoverSearchInput").value || "").toLowerCase().trim();
    if (currentDiscoverTab === "posts") {
      let filtered = postsData;
      if (query) {
        filtered = filtered.filter(p => 
          (p.title && p.title.toLowerCase().includes(query)) ||
          (p.area && p.area.toLowerCase().includes(query)) ||
          (p.tags && p.tags.toLowerCase().includes(query)) ||
          (p.description && p.description.toLowerCase().includes(query))
        );
      }
      renderDiscoverPosts(filtered);
    } else if (currentDiscoverTab === "routes") {
      renderDiscoverRoutes(query);
    } else if (currentDiscoverTab === "users") {
      renderUserSearch(allUsersData, query); // ← 検索文字を渡して絞り込み
    }
  }

  // AIルート作成機能のセットアップ
  setupAiRouteFeature();

  // 通知ページ内の「通知」↔「公式お知らせ」タブ切り替え
  safeOnClick("notifyPageUserBtn", () => {
    const uBtn = document.getElementById("notifyPageUserBtn");
    const oBtn = document.getElementById("notifyPageOfficialBtn");
    const uSec = document.getElementById("notifyPageUserSection");
    const oSec = document.getElementById("notifyPageOfficialSection");
    if (uBtn) uBtn.classList.add("active");
    if (oBtn) oBtn.classList.remove("active");
    if (uSec) uSec.style.display = "block";
    if (oSec) oSec.style.display = "none";
    renderNotificationsPage();
  });

  safeOnClick("notifyPageOfficialBtn", () => {
    const uBtn = document.getElementById("notifyPageUserBtn");
    const oBtn = document.getElementById("notifyPageOfficialBtn");
    const uSec = document.getElementById("notifyPageUserSection");
    const oSec = document.getElementById("notifyPageOfficialSection");
    if (oBtn) oBtn.classList.add("active");
    if (uBtn) uBtn.classList.remove("active");
    if (oSec) oSec.style.display = "block";
    if (uSec) uSec.style.display = "none";
    renderAnnouncements();
  });
} // ← setupEventListeners() 関数の正しい閉じカッコ

// アプリ起動
initApp();