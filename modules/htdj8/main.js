// 黄桃 AI（www.htdj8.com）· 小果影视模块 API 1
//
//   列表    GET  /api/v1/ai-adult/short-feed     一次返回全部分类 + 全部影片
//   详情    GET  /api/v1/ai-adult/films/{id}     带 episodes 分集
//   播放    POST /api/v1/ai-adult/episodes/{id}/play-auth  → data.url (/r/xxx)
//            GET  https://www.htdj8.com/r/xxx     → HLS master playlist
//
// 所有请求必须带 `X-Age-Confirmed: 1`（站点 451「请先确认已年满 18 周岁」），
// 对应前端 localStorage 的 yy_adult_age_confirmed=1。

const SITE = "https://www.htdj8.com";
const UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.6 Mobile/15E148 Safari/604.1";
const CHANNEL = "黄桃 AI";
const API = "/api/v1/ai-adult";
const DEFAULT_CATEGORY = "all";

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function text(value, max) {
  const s = String(value === undefined || value === null ? "" : value).trim();
  if (!max || s.length <= max) return s;
  return Array.from(s).slice(0, max).join("");
}

function relUrl(raw) {
  const s = text(raw, 4096);
  if (s === "") return "";
  if (s.indexOf("http") === 0) return s;
  return SITE + (s.charAt(0) === "/" ? s : "/" + s);
}

/// 秒数转 12:34 / 1:02:03，界面统一认 durationText
function durationText(seconds) {
  const total = Number(seconds);
  if (!Number.isFinite(total) || total <= 0) return "";
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = Math.floor(total % 60);
  const pad = (n) => (n < 10 ? "0" + n : String(n));
  return h > 0 ? h + ":" + pad(m) + ":" + pad(s) : m + ":" + pad(s);
}

function baseHeaders(referer) {
  return {
    "User-Agent": UA,
    "X-Age-Confirmed": "1",
    Accept: "application/json, text/plain, */*",
    "Accept-Language": "zh-CN,zh;q=0.9",
    Referer: referer || SITE + "/",
    Origin: SITE,
  };
}

function request(method, path, body) {
  const options = {
    method,
    url: path.indexOf("http") === 0 ? path : SITE + path,
    headers: baseHeaders(),
    anyStatus: true,
    followRedirects: true,
    timeoutMs: 20000,
  };
  if (method !== "GET" && body !== undefined) {
    options.body = body;
    options.headers["Content-Type"] = "application/json";
  }
  let response;
  try {
    response = host.fetch(options);
  } catch (error) {
    throw new Error("黄桃AI 连接失败：" + String((error && error.message) || error));
  }
  const status = Number((response && response.status) || 0);
  const raw = String((response && response.body) || "");
  if (status === 451) {
    throw new Error("黄桃AI 需要年龄确认，请在设置里开启成人内容后重试");
  }
  if (status < 200 || status >= 300) {
    throw new Error("黄桃AI 请求失败：HTTP " + status);
  }
  let envelope;
  try {
    envelope = JSON.parse(raw);
  } catch (error) {
    throw new Error("黄桃AI 返回格式无效");
  }
  if (!isRecord(envelope)) {
    throw new Error("黄桃AI 返回格式无效");
  }
  if (Number(envelope.code) !== 200) {
    throw new Error("黄桃AI 接口报错：" + text(envelope.message, 80));
  }
  return envelope.data;
}

// ---- 列表 ----

// short-feed 一次给全量（约 546 部，336KB），按分类组织。
// 这里缓存 10 分钟，避免每次进站都重复下载。
const FEED_KEY = "feed:v1";
const FEED_TTL = 10 * 60 * 1000;

function feed() {
  const cached = host.cacheGet(FEED_KEY);
  if (cached !== null && cached !== undefined) {
    try {
      return typeof cached === "string" ? JSON.parse(cached) : cached;
    } catch (error) {
      /* 缓存坏了就重新拉 */
    }
  }
  const data = request("GET", API + "/short-feed");
  const categories = Array.isArray(data && data.categories) ? data.categories : [];
  host.cacheSet(FEED_KEY, JSON.stringify(categories), FEED_TTL);
  return categories;
}

function categories(force) {
  if (force) host.cacheSet(FEED_KEY, null, 0);
  const list = feed();
  const tabs = [{ id: DEFAULT_CATEGORY, name: "全部" }];
  for (const category of list) {
    if (!isRecord(category)) continue;
    const name = text(category.name, 16);
    const code = text(category.code, 40);
    if (name === "" || code === "") continue;
    tabs.push({ id: code, name });
  }
  return tabs;
}

function validCategory(category) {
  const id = text(category, 40);
  if (id === "" || id === DEFAULT_CATEGORY) return true;
  return feed().some((c) => isRecord(c) && text(c.code, 40) === id);
}

function filmTags(film) {
  const out = [];
  for (const tag of Array.isArray(film.tags) ? film.tags : []) {
    const name = isRecord(tag) ? text(tag.name, 24) : text(tag, 24);
    if (name !== "" && !out.includes(name) && out.length < 12) out.push(name);
  }
  return out;
}

function toDrama(film, categoryName) {
  const id = text(film.id, 32);
  if (id === "") return null;
  const drama = {
    id: host.dramaId(id),
    source: host.source,
    sourceId: id,
    title: text(film.title, 256),
    name: text(film.title, 256),
    desc: text(film.description, 2000),
    intro: text(film.description, 2000),
    cover: relUrl(film.cover_url),
    channelName: categoryName || CHANNEL,
    tags: filmTags(film),
    onlineDate: text(film.published_at, 10),
  };
  const episodes = Number(film.published_episode_count);
  if (Number.isFinite(episodes) && episodes > 0) {
    drama.totalEpisode = episodes;
    drama.episodeCount = episodes;
  }
  const views = Number(film.plays_count);
  if (Number.isFinite(views) && views > 0) {
    drama.views = views >= 10000 ? (views / 10000).toFixed(1) + "万" : String(views);
  }
  return drama;
}

function catalogPage(page, category) {
  if (page !== 1) return { items: [], hasMore: false };
  const wanted = text(category, 40);
  const list = feed();
  const items = [];
  for (const item of list) {
    if (!isRecord(item)) continue;
    const code = text(item.code, 40);
    if (wanted !== "" && wanted !== DEFAULT_CATEGORY && code !== wanted) continue;
    for (const film of Array.isArray(item.films) ? item.films : []) {
      if (!isRecord(film)) continue;
      const drama = toDrama(film, text(item.name, 16));
      if (drama !== null) items.push(drama);
    }
  }
  return { items, hasMore: false };
}

function search(page, query) {
  const keyword = text(query, 64).toLowerCase();
  if (keyword === "" || page !== 1) return { items: [], hasMore: false };
  const result = catalogPage(1, DEFAULT_CATEGORY);
  return {
    items: result.items.filter(
      (item) =>
        String(item.title).toLowerCase().indexOf(keyword) >= 0 ||
        String(item.desc).toLowerCase().indexOf(keyword) >= 0,
    ),
    hasMore: false,
  };
}

// ---- 详情 ----

function chapterOf(sourceId, episode) {
  const id = text(episode.id, 32);
  const number = Number(episode.sort);
  return {
    id: host.chapterId(sourceId, id || String(number || 1)),
    source: host.source,
    title: text(episode.title, 64) || "第" + episodeString(number || 1) + "集",
    currentEpisode: Number.isFinite(number) && number > 0 ? number : 1,
    pageUrl: SITE + "/video/" + sourceId,
    durationText: durationText(episode.duration_sec),
    vip: episode.is_free === false || episode.requires_purchase === true,
  };
}

function episodeString(value) {
  return String(value);
}

function detail(sourceId) {
  const id = text(sourceId, 32);
  if (id === "") throw new Error("黄桃AI 剧集标识无效");
  const data = request("GET", API + "/films/" + encodeURIComponent(id));
  if (!isRecord(data)) throw new Error("黄桃AI 详情数据无效");
  const drama = toDrama(data, "");
  if (drama === null) throw new Error("黄桃AI 详情缺少剧集信息");
  drama.sourceId = id;
  drama.id = host.dramaId(id);
  const chapters = [];
  for (const episode of Array.isArray(data.episodes) ? data.episodes : []) {
    if (!isRecord(episode)) continue;
    chapters.push(chapterOf(id, episode));
  }
  chapters.sort((a, b) => a.currentEpisode - b.currentEpisode);
  if (chapters.length === 0) throw new Error("黄桃AI 该剧还没有可播放的分集");
  drama.totalEpisode = chapters.length;
  drama.episodeCount = chapters.length;
  return { drama, chapters };
}

// ---- 播放 ----

function resolveMedia(task) {
  const dramaPrefix = host.source + ":";
  const sourceId = String(task.dramaId || "").startsWith(dramaPrefix)
    ? String(task.dramaId).slice(dramaPrefix.length)
    : "";
  const chapterPrefix = host.chapterId(sourceId, "");
  const episodeId = String((task.chapter && task.chapter.id) || "").startsWith(chapterPrefix)
    ? String(task.chapter.id).slice(chapterPrefix.length)
    : "";
  if (sourceId === "" || episodeId === "") {
    throw new Error("黄桃AI 播放信息无效，请刷新详情");
  }
  const data = request("POST", API + "/episodes/" + encodeURIComponent(episodeId) + "/play-auth", "{}");
  const path = isRecord(data) ? text(data.url, 4096) : "";
  if (path === "") {
    throw new Error("黄桃AI 没有返回播放地址，可能需要解锁该集");
  }
  const address = relUrl(path);
  return host.prepareWebMedia(
    {
      url: address,
      referer: SITE + "/",
      credentials: { origin: SITE, referer: SITE + "/", userAgent: UA },
    },
    CHANNEL,
  );
}

module.exports = {
  validCategory,
  categories,
  catalogPage,
  search,
  detail,
  resolveMedia,
};
