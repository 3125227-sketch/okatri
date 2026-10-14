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
  try {
    const query = encodeURIComponent(address.trim());
    const res = await fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${query}&limit=1`);
    const data = await res.json();
    if (data && data.length > 0) {
      return {
        lat: parseFloat(data[0].lat),
        lng: parseFloat(data[0].lon)
      };
    }
  } catch (e) {
    console.warn("住所からの座標取得エラー:", e);
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
let notificationsData = [];
let appAboutData = null;
let mapInstance = null;
let mapMarkers = [];
let userCurrentLocationMarker = null;

// 複数画像ファイル管理
let currentUploadedFiles = [];
let currentUploadedImagesBase64 = [];
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
      const [users, comments, pickups, news, aiSpots, badges, about, rallies] = await Promise.all([
        safeFetch(db.from("users_custom").select("*"), []),
        safeFetch(db.from("comments").select("*").order("created_at", { ascending: true }), []),
        safeFetch(db.from("pickups").select("*"), []),
        safeFetch(db.from("announcements").select("*").eq("active", true), []),
        safeFetch(db.from("ai_master_spots").select("*"), []),
        safeFetch(db.from("achievements_master").select("*"), []),
        safeFetch(db.from("app_about").select("*").eq("id", "about_main").maybeSingle(), null),
        safeFetch(db.from("stamp_rallies").select("*").eq("active", true), [])
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

function openNotificationsModal() {
  if (!currentUser) { alert("ログインが必要です"); return; }
  const container = document.getElementById("notifyListContainer");
  if (!container) return;
  container.innerHTML = "";

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
          if (p) {
            document.getElementById("notifyModal").classList.remove("show");
            openDetail(p);
          }
        } else if (n.type === 'follow') {
          document.getElementById("notifyModal").classList.remove("show");
          openUserProfile(n.from_user_id, n.from_nickname);
        }
      };

      container.appendChild(item);
    });
  }

  document.getElementById("notifyModal").classList.add("show");
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

  safeOnClick("mobileNotifyBellBtn", openNotificationsModal);
  safeOnClick("openNotifyModalBtn", openNotificationsModal);
  safeOnClick("closeNotifyModalBtn", () => document.getElementById("notifyModal").classList.remove("show"));

  safeOnClick("goNewsPageBtn", () => {
    document.querySelectorAll('[data-tab="tabNewsPage"]').forEach(el => el.click());
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
  const homeContainer = document.getElementById("announcementListHome");
  const fullContainer = document.getElementById("announcementListFull");

  if (homeContainer) homeContainer.innerHTML = "";
  if (fullContainer) fullContainer.innerHTML = "";

  if (!announcementsData || announcementsData.length === 0) {
    if (homeContainer) homeContainer.innerHTML = `<div style="font-size:12px; color:#94a3b8; padding:8px 0;">現在新しいお知らせはありません</div>`;
    if (fullContainer) fullContainer.innerHTML = `<div class="empty-state">現在お知らせはありません</div>`;
    return;
  }

  announcementsData.slice(0, 3).forEach(item => {
    const div = document.createElement("div");
    div.className = "news-item";
    div.style.cursor = "pointer";
    div.innerHTML = `
      <span class="news-badge">${item.badge || 'INFO'}</span>
      <span class="news-item-title">${item.title || item.sub_text}</span>
      <i class="fa-solid fa-chevron-right" style="font-size:10px; color:#94a3b8;"></i>
    `;
    div.onclick = () => openNewsDetail(item);
    if (homeContainer) homeContainer.appendChild(div);
  });

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
    if (fullContainer) fullContainer.appendChild(card);
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
  if (trimmed === "" || trimmed === "岡山県" || trimmed.length < 5) return false;
  return /(市|区|町|村)/.test(trimmed);
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

// ====================================================
// 6. 投稿一覧 ＆ 複数枚スライダー表示
// ====================================================
function applySortAndRender() {
  let list = [...postsData];
  const searchInput = document.getElementById("searchInput");
  const query = searchInput ? searchInput.value.toLowerCase() : "";

  // ブロック/ミュートされたユーザーの投稿を除外
  if (currentUser) {
    list = list.filter(p => !(currentUser.blocked_users || []).includes(p.user_id));
    list = list.filter(p => !(currentUser.muted_users || []).includes(p.user_id));
  }

  list = list.filter(p => isPostMatchTimeMode(p, currentActiveTimeMode));

  if (query) {
    list = list.filter(p => 
      (p.title && p.title.toLowerCase().includes(query)) ||
      (p.area && p.area.toLowerCase().includes(query)) ||
      (p.tags && p.tags.toLowerCase().includes(query))
    );
  }

  if (currentSortMode === "popular") {
    list.sort((a, b) => parseArray(b.likes).length - parseArray(a.likes).length);
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
function renderUserSearch(users) {
  const container = document.getElementById("userSearchResultGrid");
  const searchInput = document.getElementById("userSearchInput");
  if (!container) return;
  const query = searchInput ? searchInput.value.toLowerCase() : "";
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

  if (stampRalliesData.length === 0) {
    container.innerHTML = `<div style="font-size:12px; color:#94a3b8; padding:8px 0;">現在開催中のスタンプラリーはありません</div>`;
    return;
  }

  const userStamps = (currentUser && currentUser.stamps) || [];

  stampRalliesData.forEach(rally => {
    const card = document.createElement("div");
    card.className = "stamp-rally-card";
    const spots = parseArray(rally.spots);
    const clearedSpots = spots.filter(s => userStamps.includes(s.id));

    card.innerHTML = `
      <div style="display:flex; justify-content:space-between; align-items:flex-start; margin-bottom:6px;">
        <h4 style="font-size:14px; font-weight:700; margin:0;">${rally.title}</h4>
        <span class="tech-badge">${clearedSpots.length} / ${spots.length} 達成</span>
      </div>
      <p style="font-size:12px; color:var(--text-secondary); margin-bottom:10px;">${rally.description || rally.desc || ''}</p>
      
      <div class="stamp-spots-grid">
        ${spots.map(s => {
          const isCleared = userStamps.includes(s.id);
          return `
            <div class="stamp-spot-item ${isCleared ? 'cleared' : ''}">
              <i class="${isCleared ? 'fa-solid fa-circle-check' : 'fa-regular fa-circle'}"></i><br>
              ${s.name}
            </div>
          `;
        }).join('')}
      </div>

      <div style="display:flex; gap:8px; margin-top:10px;">
        <button class="btn-primary checkin-rally-btn" style="flex:1; padding:8px 12px; font-size:12px;" data-rally="${rally.id}">
          <i class="fa-solid fa-location-crosshairs"></i> 現在地でチェックイン
        </button>
      </div>
    `;

    const btn = card.querySelector(".checkin-rally-btn");
    if (btn) btn.onclick = () => handleGpsCheckIn(rally);
    container.appendChild(card);
  });
}

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
        div.innerHTML = `
          <input type="checkbox" id="rally_spot_${idx}" value="${p.id}" data-name="${p.title}" data-lat="${p.lat || 34.6618}" data-lng="${p.lng || 133.9350}">
          <label for="rally_spot_${idx}">${p.title} (@${p.area})</label>
        `;
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

// ====================================================
// 10. 投稿詳細（★ カルーセル・スレッド・シェア対応）
// ====================================================
function openDetail(item) {
  const content = document.getElementById("detailContent");
  if (!content) return;
  const isMine = currentUser && currentUser.userId === item.user_id;
  const isOfficial = currentUser && currentUser.is_admin;
  
  // スレッドコメントの抽出
  const postComments = commentsData.filter(c => c.post_id === item.id);
  const rootComments = postComments.filter(c => !c.parent_id);

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
    imageHtml = `<img src="${displayImages[0]}" onerror="this.src='https://via.placeholder.com/800x600?text=OKATRI'" style="width:100%; height:260px; object-fit:cover; border-radius:var(--radius-md); margin-bottom:12px; border:1px solid var(--border-subtle);">`;
  }

  content.innerHTML = `
    ${imageHtml}
    
    <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:4px;">
      <span style="color:var(--primary-accent); font-weight:600; font-size:12px;">@${item.area}</span>
      ${!isMine && item.user_id ? `<button id="detailUserBtn" class="btn-secondary" style="padding:4px 10px; font-size:11px;"><i class="fa-regular fa-user"></i> ${item.nickname} ${adminBadge}</button>` : ''}
    </div>
    
    <h2 style="font-size:18px; font-weight:700; margin:4px 0 8px; color:var(--text-primary);">${item.title}</h2>
    <div style="margin-bottom:10px;">${tagsHtml}</div>
    <p style="font-size:13px; line-height:1.6; margin-bottom:12px; color:var(--text-primary);">${item.description || ''}</p>
    
    ${item.external_url ? `
      <div style="margin-bottom:12px;">
        <a href="${item.external_url}" target="_blank" style="display:inline-flex; align-items:center; gap:6px; background:#f1f5f9; color:var(--text-primary); text-decoration:none; padding:6px 12px; border-radius:var(--radius-md); font-size:12px; font-weight:500; border:1px solid var(--border-subtle);">
          <i class="fa-solid fa-arrow-up-right-from-square"></i> 関連リンクを開く
        </a>
      </div>
    ` : ''}

    <div style="font-size:12px; font-weight:500; margin-bottom:8px; color:var(--text-secondary);"><i class="fa-solid fa-location-dot" style="margin-right:4px;"></i> ${item.address || '岡山県'}</div>
    <iframe style="width:100%; height:140px; border-radius:var(--radius-md); border:1px solid var(--border-subtle);" 
      src="https://maps.google.co.jp/maps?output=embed&q=${encodeURIComponent(item.address || item.title)}">
    </iframe>

    <!-- SNSシェアボタン -->
    <div class="share-buttons-row">
      <button class="btn-share-x" id="sharePostXBtn"><i class="fa-brands fa-x-twitter"></i> Xでシェア</button>
      <button class="btn-share-line" id="sharePostLineBtn"><i class="fa-brands fa-line"></i> LINE</button>
      <button class="btn-share-copy" id="sharePostCopyBtn"><i class="fa-regular fa-copy"></i> URLコピー</button>
    </div>

    <div class="detail-action-buttons">
      <button id="detailLikeBtn" class="btn-secondary" style="background:${isLiked ? '#0f172a' : '#fff'}; color:${isLiked ? '#fff' : 'inherit'}; flex:1;">
        <i class="${isLiked ? 'fa-solid fa-heart' : 'fa-regular fa-heart'}" style="color:${isLiked ? '#f02868' : 'inherit'};"></i> いいね (${likes.length})
      </button>

      <button id="detailBmBtn" class="btn-secondary" style="background:${isBookmarked ? '#0f172a' : '#fff'}; color:${isBookmarked ? '#fff' : 'inherit'}; flex:1;">
        <i class="${isBookmarked ? 'fa-solid fa-bookmark' : 'fa-regular fa-bookmark'}"></i> ${isBookmarked ? '保存済み' : '保存'}
      </button>

      <button id="setStartSpotBtn" class="btn-secondary" style="flex:1.2;">
        <i class="fa-solid fa-route"></i> 出発地に設定
      </button>

      ${isOfficial ? `<button id="adminPickupBtn" class="btn-admin-pickup"><i class="fa-solid fa-star"></i> ピックアップに登録</button>` : ''}
      ${isMine ? `<button id="openEditPostBtn" class="btn-secondary" style="color:var(--primary-accent);"><i class="fa-regular fa-pen-to-square"></i> 編集</button>` : ''}
      ${!isMine ? `<button id="reportPostBtn" class="btn-report" title="通報"><i class="fa-regular fa-flag"></i> 通報</button>` : ''}
      ${isMine ? `<button id="deletePostBtn" class="btn-danger"><i class="fa-regular fa-trash-can"></i> 削除</button>` : ''}
    </div>

    <!-- コメント＆スレッド返信欄 -->
    <div class="comment-section">
      <h3 class="sub-heading" style="margin-top:0;"><i class="fa-regular fa-comment"></i> コメント (${postComments.length})</h3>
      
      <div id="replyingIndicatorBox"></div>

      <div class="comment-list" id="detailCommentList">
        ${renderCommentTreeHtml(rootComments, postComments)}
      </div>
      <div class="comment-input-row">
        <input type="text" id="newCommentInput" placeholder="コメントを入力...">
        <button id="addCommentBtn" class="btn-primary" style="width:auto; padding:8px 16px; font-size:12px;">送信</button>
      </div>
    </div>
  `;

  document.getElementById("detailModal").classList.add("show");

  // シェア
  const baseUrl = window.location.origin + window.location.pathname;
  const postUrl = `${baseUrl}?post=${encodeURIComponent(item.id)}`;
  const shareText = `【OKATRI】岡山のスポット「${item.title}」(@${item.area})`;

  safeOnClick("sharePostXBtn", () => {
    window.open(`https://twitter.com/intent/tweet?text=${encodeURIComponent(shareText)}&url=${encodeURIComponent(postUrl)}&hashtags=オカトリ,岡山旅行`, '_blank');
  });

  safeOnClick("sharePostLineBtn", () => {
    window.open(`https://line.me/R/msg/text/?${encodeURIComponent(`${shareText}\n${postUrl}`)}`, '_blank');
  });

  safeOnClick("sharePostCopyBtn", () => {
    if (navigator.clipboard) navigator.clipboard.writeText(postUrl);
    alert(`投稿の専用URLをコピーしました！\n${postUrl}`);
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

  // コメント送信（返信・スレッド・通知対応）
  safeOnClick("addCommentBtn", async () => {
    const input = document.getElementById("newCommentInput");
    if (!input) return;
    const val = input.value.trim();
    if (!val) return;

    const newCmt = {
      id: generateUniqueId("cmt"),
      post_id: item.id,
      user_id: currentUser ? currentUser.userId : "guest",
      nickname: currentUser ? currentUser.nickname : "匿名",
      comment: val,
      parent_id: currentReplyingCommentId
    };

    commentsData.push(newCmt);
    currentReplyingCommentId = null;
    input.value = "";
    openDetail(item);

    if (db) {
      await db.from("comments").insert([newCmt]);
      // 投稿者に通知を送信
      sendNotification(item.user_id, 'comment', item.id, item.title);
    }
  });
}

// スレッドコメントHTML生成
function renderCommentTreeHtml(rootComments, allComments) {
  if (rootComments.length === 0) return '<div style="font-size:12px; color:#94a3b8;">まだコメントはありません</div>';

  return rootComments.map(c => {
    const replies = allComments.filter(r => r.parent_id === c.id);
    const repliesHtml = replies.map(r => `
      <div class="comment-item reply">
        <span class="comment-author">${r.nickname} (@${r.user_id})</span>
        <div style="margin-top:2px;">${r.comment}</div>
      </div>
    `).join('');

    return `
      <div class="comment-item">
        <div style="display:flex; justify-content:space-between; align-items:center;">
          <span class="comment-author">${c.nickname} (@${c.user_id})</span>
          <span class="reply-badge" onclick="setReplyTarget('${c.id}', '${c.nickname}')"><i class="fa-solid fa-reply"></i> 返信</span>
        </div>
        <div style="margin-top:2px;">${c.comment}</div>
      </div>
      ${repliesHtml}
    `;
  }).join('');
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
      if (timeline) {
        timeline.innerHTML = "";
        let mapUrl = `https://www.google.com/maps/dir/${encodeURIComponent(start)}/`;
        plan.forEach(item => {
          timeline.innerHTML += `<li><b>${item.time} ${item.name}</b><br><span style="color:var(--text-secondary); font-size:12px;">${item.desc}</span></li>`;
          if (item.name !== `${start} 出発`) mapUrl += `${encodeURIComponent(item.name.replace(/^🎯 /, ''))}/`;
        });

        const mapLink = document.getElementById("googleMapsLink");
        if (mapLink) mapLink.href = mapUrl;
      }

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
          if (addr.includes("岡山市")) areaSelect.value = "岡山市";
          else if (addr.includes("倉敷市")) areaSelect.value = "倉敷市";
          else if (addr.includes("瀬戸内市")) areaSelect.value = "瀬戸内市";
          else if (addr.includes("津山市")) areaSelect.value = "津山市";
          else if (addr.includes("備前市")) areaSelect.value = "備前市";
          else if (addr.includes("総社市")) areaSelect.value = "総社市";
          else areaSelect.value = "その他岡山県内";
        }
      }
    } catch(e) {
      console.warn("住所逆ジオコーディングエラー:", e);
    }
  }, (err) => {
    if (status) status.textContent = "位置情報の取得をスキップしました";
  }, { enableHighAccuracy: true, timeout: 8000 });
}

function handleOpenPostAction() {
  fetchBackgroundLocation();
  const fileInput = document.getElementById("postImageInput");
  if (fileInput) fileInput.click();
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
  safeOnClick("sidebarPostBtn", handleOpenPostAction);
  safeOnClick("topPostBtn", handleOpenPostAction);
  safeOnClick("mobileCenterPostBtn", handleOpenPostAction);

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
    window.open(`https://social-plugins.line.me/lineit/share?url=${encodeURIComponent(text)}`, '_blank');
  });

  safeOnClick("shareRouteCopyBtn", () => {
    const title = document.getElementById("routeResultTitle").textContent;
    const mapUrl = document.getElementById("googleMapsLink").href;
    navigator.clipboard.writeText(`【OKATRI 岡山旅行プラン】\n${title}\nナビURL: ${mapUrl}`);
    alert("ルート情報をコピーしました！メッセージ等に貼り付けて共有できます。");
  });

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
      const title = document.getElementById("rallyTitleInput").value.trim();
      const desc = document.getElementById("rallyDescInput").value.trim();
      const rewardTitle = document.getElementById("rallyRewardBadgeSelect").value;
      const checkedBoxes = document.querySelectorAll("#rallySpotsCheckboxList input:checked");

      if (checkedBoxes.length === 0) {
        alert("立ち寄りスポットを少なくとも1つ以上選択してください。");
        return;
      }

      const spots = Array.from(checkedBoxes).map((chk, i) => ({
        id: `spot_${i}_${Date.now()}`,
        name: chk.getAttribute("data-name"),
        lat: parseFloat(chk.getAttribute("data-lat")),
        lng: parseFloat(chk.getAttribute("data-lng")),
        radius_m: 600
      }));

      const badgeObj = masterBadgesData.find(b => b.title === rewardTitle);
      const newRally = {
        id: generateUniqueId("rally"),
        title: title,
        description: desc,
        reward_title: rewardTitle,
        reward_img: badgeObj ? badgeObj.image_url : "",
        spots: spots,
        active: true
      };

      stampRalliesData.unshift(newRally);
      renderStampRallies();

      if (db) await db.from("stamp_rallies").insert([newRally]);

      alert(`🎉 スタンプラリー「${title}」を公開しました！`);
      rallyForm.reset();
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

  safeOnClick("sortNewestBtn", () => {
    currentSortMode = "newest";
    document.getElementById("sortNewestBtn").classList.add("active");
    document.getElementById("sortPopularBtn").classList.remove("active");
    applySortAndRender();
  });
  safeOnClick("sortPopularBtn", () => {
    currentSortMode = "popular";
    document.getElementById("sortPopularBtn").classList.add("active");
    document.getElementById("sortNewestBtn").classList.remove("active");
    applySortAndRender();
  });

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
    document.getElementById("modeCustomBtn").classList.add("active");
    document.getElementById("modeAiBtn").classList.remove("active");
    document.getElementById("customRouteBox").style.display = "block";
    document.getElementById("aiRouteBox").style.display = "none";
  });
  safeOnClick("modeAiBtn", () => {
    document.getElementById("modeAiBtn").classList.add("active");
    document.getElementById("modeCustomBtn").classList.remove("active");
    document.getElementById("customRouteBox").style.display = "none";
    document.getElementById("aiRouteBox").style.display = "block";
  });

  safeOnClick("generateRouteBtn", () => {
    const startSelect = document.getElementById("routeStartSelect");
    const start = startSelect ? startSelect.value : "岡山駅";
    const startName = start === "CURRENT_GEO" ? "現在地" : start;
    const checks = document.querySelectorAll("#routeSpotCheckboxes input:checked");
    if (checks.length === 0) { alert("立ち寄るスポットを選択してください"); return; }

    const timeline = document.getElementById("routeTimeline");
    if (timeline) {
      timeline.innerHTML = `<li><b>出発: ${startName}</b></li>`;
      let mapUrl = `https://www.google.com/maps/dir/${encodeURIComponent(startName)}/`;

      checks.forEach((c, i) => {
        timeline.innerHTML += `<li><b>経由地 ${i + 1}: ${c.value}</b></li>`;
        mapUrl += `${encodeURIComponent(c.value)}/`;
      });

      const mapLink = document.getElementById("googleMapsLink");
      if (mapLink) mapLink.href = mapUrl;
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

      if (db) {
        await db.from("users_custom").update({ achievements: currentUser.achievements }).eq("user_id", currentUser.userId);
      }

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

  // プロフィール設定保存（★ メール＆通知設定対応）
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

  // ★ 複数枚写真選択（最大4枚）
  const postImgIn = document.getElementById("postImageInput");
  if (postImgIn) {
    postImgIn.addEventListener("change", function(e) {
      const files = Array.from(e.target.files).slice(0, 4); // 最大4枚
      const pModal = document.getElementById("postModal");
      const prevBox = document.getElementById("imagePreviewBox");

      const slotSelect = document.getElementById("postTimeSlot");
      if (slotSelect) slotSelect.value = getInitialTimeSlot();

      if (!files || files.length === 0) {
        if (pModal) pModal.classList.add("show");
        return;
      }

      currentUploadedImagesBase64 = [];
      if (prevBox) prevBox.innerHTML = "";

      let loadedCount = 0;
      files.forEach(file => {
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
            const b64 = canvas.toDataURL("image/jpeg", 0.75);
            currentUploadedImagesBase64.push(b64);

            if (prevBox) {
              const previewImg = document.createElement("img");
              previewImg.src = b64;
              previewImg.style.width = "70px";
              previewImg.style.height = "70px";
              previewImg.style.objectFit = "cover";
              previewImg.style.borderRadius = "var(--radius-md)";
              prevBox.appendChild(previewImg);
            }

            loadedCount++;
            if (loadedCount === files.length) {
              currentUploadedBase64 = currentUploadedImagesBase64[0];
              if (pModal) pModal.classList.add("show");
            }
          };
        };
        reader.readAsDataURL(file);
      });
    });
  }

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
        let postLat = currentLatitude;
        let postLng = currentLongitude;

        if (inputAddress) {
          const geoResult = await geocodeAddress(inputAddress);
          if (geoResult) {
            postLat = geoResult.lat;
            postLng = geoResult.lng;
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
      const inputId = document.getElementById("authUsername").value.trim();
      const password = document.getElementById("authPassword").value.trim();
      const nickname = document.getElementById("authNickname").value.trim() || inputId;

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

  setupAiRouteFeature();
}

// アプリ起動
initApp();