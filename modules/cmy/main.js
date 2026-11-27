// 绅士风度（cmy6666.com）—— Rails 服务端渲染站，列表和详情都能直接解析 HTML。
//
// 播放链路比较特殊，必须按它真实的规矩来：
//   /episode/guest_play/{id} 只接受 POST，且要同时带「同一次会话的
//   _nipple_session cookie」和「详情页里的 csrf-token」，少一个就
//   422 ActionController::InvalidAuthenticityToken（已实测三种组合）。
//   宿主的 http.Client 没有 cookie jar，所以这里用 host.fetch 读响应的
//   Set-Cookie，自己把会话拼出来，再手工塞进 POST 的 Cookie / X-CSRF-Token。
//
// 已知限制（站点自己的商业规则，不是模块缺陷）：
//   游客只有 25 秒试看，完整版要登录并开通 VIP。接口返回的 limitSeconds
//   就是 25，媒体文件本身也只有几 MB。模块如实播放站点给的地址。

// 主站 + 官方备用线路（首页底部「获取最新地址」给的 abc111.club，同一套后端、
// 同样的 csrf 与详情结构）。站点对游客限流很严：HTTP 429 + Retry-After 约 5 分钟，
// 而宿主的退避是按域名记的，所以一条线被限就换另一条，能立刻恢复。
const SITES = ['https://cmy6666.com', 'https://abc111.club'];
const SITE = SITES[0];
const SITE_NAME = '绅士风度';
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Safari/537.36';

const CATEGORIES = [
  { id: 'japan', name: '日本', path: '/home/japan' },
  { id: 'china', name: '国产', path: '/home/china' },
  { id: 'uncen', name: '步兵', path: '/home/uncen' },
  { id: 'ama', name: '欧美', path: '/home/ama' },
];

function categories() {
  return CATEGORIES.map(function (entry) {
    return { id: entry.id, name: entry.name };
  });
}

function validCategory(category) {
  var id = String(category || '');
  if (id === '') return true;
  for (var i = 0; i < CATEGORIES.length; i++) {
    if (CATEGORIES[i].id === id) return true;
  }
  return false;
}

// ---------- 基础工具 ----------

function clean(value) {
  return String(value || '')
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim();
}

function attr(tag, name) {
  var pattern = new RegExp('\\b' + name + '\\s*=\\s*("([^"]*)"|\'([^\']*)\'|([^\\s>]+))', 'i');
  var matched = pattern.exec(tag || '');
  if (!matched) return '';
  if (matched[2] !== undefined) return matched[2];
  if (matched[3] !== undefined) return matched[3];
  return matched[4] || '';
}

function absolute(address) {
  var value = String(address || '').trim();
  if (value === '') return '';
  if (/^https?:\/\//i.test(value)) return value;
  try {
    return host.resolveUrl(SITE + '/', value);
  } catch (_) {
    return value.indexOf('/') === 0 ? SITE + value : value;
  }
}

// srcset 里第一段是 480w 的小图，取最大的一张更清楚。
function fromSrcset(value) {
  var parts = String(value || '').split(',');
  var best = '';
  var bestWidth = -1;
  for (var i = 0; i < parts.length; i++) {
    var piece = parts[i].trim().split(/\s+/);
    if (!piece[0]) continue;
    var width = parseInt(piece[1], 10);
    if (isNaN(width)) width = 0;
    if (width > bestWidth) {
      bestWidth = width;
      best = piece[0];
    }
  }
  return best;
}

function videoId(href) {
  var matched = /\/episode\/show\/([0-9]{1,12})\/?/.exec(String(href || ''));
  return matched ? matched[1] : '';
}

function slugOf(sourceId) {
  var matched = /^[0-9]{1,12}$/.exec(String(sourceId || '').trim());
  return matched ? matched[0] : '';
}

// 日文片标题普遍以番号开头（abf-362.xxxx），抽出来单独给 serial 字段。
function serialOf(title) {
  var matched = /^([A-Za-z]{2,8}-[0-9]{2,6})(?:[.\s]|$)/.exec(String(title || '').trim());
  return matched ? matched[1].toUpperCase() : '';
}

// ---------- 页面请求 ----------

function orderedSites() {
  var preferred = '';
  try {
    preferred = String(host.cacheGet('site') || '');
  } catch (_) {}
  var list = [];
  for (var i = 0; i < SITES.length; i++) if (SITES[i] === preferred) list.push(SITES[i]);
  for (var j = 0; j < SITES.length; j++) if (SITES[j] !== preferred) list.push(SITES[j]);
  return list;
}

function fetchPage(path) {
  var sites = orderedSites();
  var lastError = null;
  for (var i = 0; i < sites.length; i++) {
    var site = sites[i];
    var response;
    try {
      response = host.fetch({
        url: site + path,
        headers: {
          Accept:
            'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
          'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
          Referer: site + '/',
          'User-Agent': UA,
        },
        anyStatus: true,
        followRedirects: true,
        timeoutMs: 25000,
      });
    } catch (error) {
      var failure = new Error(SITE_NAME + ' 连接失败，请检查网络：' + (error && error.message ? error.message : error));
      failure.retryable = true;
      lastError = failure;
      continue;
    }
    var status = Number(response.status) || 0;
    // 429 是站点限流（Retry-After 约 5 分钟）：这条线换掉，试下一条。
    if (status === 429 || status >= 500) {
      lastError = new Error(SITE_NAME + ' 访问太频繁被站点限流了，请等 5 分钟左右再试');
      lastError.retryable = true;
      continue;
    }
    if (status >= 400) {
      lastError = new Error(SITE_NAME + ' 返回 HTTP ' + status);
      lastError.retryable = status === 408;
      continue;
    }
    try {
      host.cacheSet('site', site, 1800000);
    } catch (_) {}
    return { html: String(response.body || ''), headers: response.headers || {}, site: site };
  }
  if (lastError) throw lastError;
  var blocked = new Error(SITE_NAME + ' 所有线路都不可用，请稍后重试');
  blocked.retryable = true;
  throw blocked;
}

// ---------- 列表 ----------

function parseCards(html, fallbackCategory) {
  var items = [];
  var pattern = /<a\b[^>]*\bmedia-card-link\b[^>]*>([\s\S]*?)<\/a>/gi;
  var matched = pattern.exec(html);
  while (matched) {
    var open = matched[0].slice(0, matched[0].indexOf('>') + 1);
    var id = videoId(attr(open, 'href'));
    if (id !== '') {
      var chunk = matched[1];
      var image = (chunk.match(/<img\b[^>]*>/i) || [''])[0];
      var cover = absolute(attr(image, 'src'));
      if (cover === '') cover = absolute(fromSrcset(attr(image, 'srcset')));
      var titleTag = chunk.match(/<div\b[^>]*class="[^"]*media-card-title[^"]*"[^>]*>([\s\S]*?)<\/div>/i);
      var title = clean(titleTag ? titleTag[1] : '') || clean(attr(image, 'alt'));
      var durationTag = chunk.match(/<span\b[^>]*card-badge-dur[^>]*>([^<]*)<\/span>/i);
      var duration = durationTag ? clean(durationTag[1]) : '';
      // 分区页的卡片不重复挂分区徽章（只有首页挂），用当前分区名兜底。
      var categoryTag = chunk.match(/<span\b[^>]*card-badge-cat[^>]*>([^<]*)<\/span>/i);
      var category = categoryTag ? clean(categoryTag[1]) : '';
      if (category === '') category = String(fallbackCategory || '');
      if (title !== '') {
        var tags = category !== '' ? [category] : [];
        var serial = serialOf(title);
        var card = {
          id: host.dramaId(id),
          source: host.source,
          sourceId: id,
          title: title,
          name: title,
          cover: cover,
          coverUrl: cover,
          channelName: SITE_NAME,
          categoryName: category,
          durationText: duration,
          tags: tags,
          totalEpisode: 1,
          episodeCount: 1,
        };
        if (serial !== '') card.serial = serial;
        items.push(card);
      }
    }
    matched = pattern.exec(html);
  }
  return items;
}

function hasNextPage(html, page) {
  var next = 'page=' + (page + 1);
  return new RegExp('[?&]' + next + '(?:&|"|\'|\\b)').test(html) || /rel="next"/i.test(html);
}

function listPage(page, category, query) {
  var p = Number(page) || 1;
  if (p < 1) p = 1;
  if (p > 100000) p = 100000;
  var keyword = String(query || '').trim();
  var path = '/';
  var fallbackCategory = '';
  if (keyword !== '') {
    // 站内搜索的真实入口在首页表单 action 里：/home/search/video?q=关键词
    // （/home/search/xxx 是「搜索页」路由，会把 xxx 当分类而不是关键词）
    path = '/home/search/video?q=' + encodeURIComponent(keyword);
  } else if (String(category || '') !== '') {
    var found = '';
    for (var i = 0; i < CATEGORIES.length; i++) {
      if (CATEGORIES[i].id === category) {
        found = CATEGORIES[i].path;
        fallbackCategory = CATEGORIES[i].name;
      }
    }
    if (found === '') throw new Error(SITE_NAME + ' 不支持分类：' + category);
    path = found;
  }
  var address = path + (path.indexOf('?') >= 0 ? '&' : '?') + 'page=' + p;
  // 站点对游客限流很紧，同一页 2 分钟内翻回来直接复用，不再打站点。
  var cacheKey = 'list:' + (keyword !== '' ? 'q:' + keyword : category || 'home') + ':' + p;
  try {
    var memo = host.cacheGet(cacheKey);
    if (memo) return JSON.parse(String(memo));
  } catch (_) {}
  var response = fetchPage(address);
  var items = parseCards(response.html, fallbackCategory);
  var result = { items: items, hasMore: hasNextPage(response.html, p) };
  try {
    host.cacheSet(cacheKey, JSON.stringify(result), 120000);
  } catch (_) {}
  return result;
}

function catalogPage(page, category, query) {
  return listPage(page, category, query);
}

// 参数顺序必须跟宿主一致：宿主调用的是 search(page, query)。
// （写反的话关键词会被当成页码，所有搜索都返回同一批——2026-11-28 用户实测踩到）
function search(page, query) {
  return listPage(page, '', query);
}

// ---------- 详情 ----------

function propsOf(html) {
  var matched = /<script\b[^>]*data-frontend-island-props="true"[^>]*>([\s\S]*?)<\/script>/i.exec(html);
  if (!matched) return {};
  try {
    return JSON.parse(matched[1]) || {};
  } catch (_) {
    return {};
  }
}

function csrfToken(html) {
  var matched = /<meta\b[^>]*name="csrf-token"[^>]*content="([^"]+)"/i.exec(html);
  return matched ? matched[1] : '';
}

function cookieHeader(headers) {
  var raw = headers['Set-Cookie'] || headers['set-cookie'] || [];
  var list = Array.isArray(raw) ? raw : [String(raw)];
  var parts = [];
  for (var i = 0; i < list.length; i++) {
    var first = String(list[i] || '').split(';')[0].trim();
    if (first !== '' && first.indexOf('=') > 0) parts.push(first);
  }
  return parts.join('; ');
}

function detail(sourceId) {
  var id = slugOf(sourceId);
  if (id === '') throw new Error(SITE_NAME + ' 视频 ID 无效');
  // 5 分钟内重复打开同一个视频直接复用，减少对站点的请求（它的游客限流很严）。
  try {
    var memo = host.cacheGet('detail:' + id);
    if (memo) return JSON.parse(String(memo));
  } catch (_) {}
  var response = fetchPage('/episode/show/' + id);
  var site = response.site || SITE;
  var html = response.html;
  var props = propsOf(html);

  var heading = html.match(/<h2\b[^>]*>([\s\S]*?)<\/h2>/i);
  var title = clean(heading ? heading[1] : '');
  if (title === '') title = clean(props.name);
  if (title === '') {
    var documentTitle = html.match(/<title>([\s\S]*?)<\/title>/i);
    title = clean(documentTitle ? documentTitle[1] : '').replace(/\s*·\s*绅士风度\s*$/, '');
  }
  if (title === '') throw new Error(SITE_NAME + ' 详情缺少视频标题');

  var poster = String(props.posterUrl || '');
  if (poster === '') {
    var video = (html.match(/<video\b[^>]*>/i) || [''])[0];
    poster = attr(video, 'poster');
  }
  var cover = absolute(poster);

  var durationMatched = /全片\s*([0-9]{1,2}(?::[0-9]{2}){1,2})/.exec(html);
  var durationText = durationMatched ? durationMatched[1] : '';

  var tags = [];
  var chipPattern = /<a\b[^>]*class="meta-chip"[^>]*href="\/home\/([^"?#]+)"[^>]*>([\s\S]*?)<\/a>/gi;
  var chip = chipPattern.exec(html);
  while (chip) {
    var label = clean(chip[2]);
    if (label !== '' && tags.indexOf(label) < 0) tags.push(label);
    chip = chipPattern.exec(html);
  }

  var descParts = [];
  var serial = serialOf(title);
  if (serial !== '') descParts.push(serial);
  if (tags.length > 0) descParts.push(tags.join(' / '));
  var desc = descParts.length > 0 ? descParts.join(' · ') : SITE_NAME;
  var drama = {
    id: host.dramaId(id),
    source: host.source,
    sourceId: id,
    title: title,
    name: title,
    desc: desc,
    intro: desc,
    cover: cover,
    coverUrl: cover,
    channelName: SITE_NAME,
    categoryName: tags.length > 0 ? tags[0] : '视频',
    durationText: durationText,
    tags: tags,
    totalEpisode: 1,
    episodeCount: 1,
  };
  if (serial !== '') drama.serial = serial;

  // 详情页里拿到的会话顺手缓存，播放时可以少一次往返；过期或失效会自动重取。
  var token = csrfToken(html);
  var cookie = cookieHeader(response.headers);
  if (token !== '' && cookie !== '') {
    try {
      host.cacheSet('session:' + site + ':' + id, JSON.stringify({ token: token, cookie: cookie, site: site }), 240000);
    } catch (_) {}
  }

  var result = {
    drama: drama,
    chapters: [
      {
        id: host.chapterId(id, id),
        source: host.source,
        title: '正片',
        currentEpisode: 1,
        pageUrl: site + '/episode/show/' + id,
      },
    ],
  };
  try {
    host.cacheSet('detail:' + id, JSON.stringify(result), 300000);
  } catch (_) {}
  return result;
}

// ---------- 播放 ----------

function taskId(task) {
  var chapter = task && task.chapter ? task.chapter : {};
  var raw = String(chapter.id || (task && task.dramaId) || (task && task.sourceId) || '');
  var parts = raw.split(':');
  return slugOf(parts.length >= 2 ? parts[1] : raw);
}

// 在指定线路上请求页面（不轮换，由调用方决定换线）。
function fetchAt(site, path) {
  var response = host.fetch({
    url: site + path,
    headers: {
      Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
      'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
      Referer: site + '/',
      'User-Agent': UA,
    },
    anyStatus: true,
    followRedirects: true,
    timeoutMs: 25000,
  });
  var status = Number(response.status) || 0;
  if (status >= 400) {
    var problem = new Error(SITE_NAME + ' 返回 HTTP ' + status);
    problem.status = status;
    problem.retryable = status === 429 || status >= 500 || status === 408;
    throw problem;
  }
  return { html: String(response.body || ''), headers: response.headers || {}, site: site };
}

// 会话按「线路 + 视频」缓存：两条线路的 session cookie 各自独立。
function sessionAt(id, site) {
  var key = 'session:' + site + ':' + id;
  try {
    var cached = host.cacheGet(key);
    if (cached) {
      var parsed = JSON.parse(String(cached));
      if (parsed && parsed.token && parsed.cookie) return parsed;
    }
  } catch (_) {}
  var response = fetchAt(site, '/episode/show/' + id);
  var session = { token: csrfToken(response.html), cookie: cookieHeader(response.headers), site: site };
  if (session.token !== '' && session.cookie !== '') {
    try {
      host.cacheSet(key, JSON.stringify(session), 240000);
    } catch (_) {}
  }
  return session;
}

// 播放接口逐条线路重试：站点的 429 是按域名算的，主站被限时不能复用
// 「主站建立的会话」继续打主站，否则永远卡在那 5 分钟冷却里。
function resolveMedia(task) {
  var id = taskId(task);
  if (id === '') throw new Error(SITE_NAME + ' 缺少视频 ID，请刷新详情');
  // 重播同一个视频时没必要再打一次试看接口。
  try {
    var memoMedia = host.cacheGet('media:' + id);
    if (memoMedia) return JSON.parse(String(memoMedia));
  } catch (_) {}
  var sites = orderedSites();
  var lastError = null;
  for (var i = 0; i < sites.length; i++) {
    var site = sites[i];
    try {
      var session = sessionAt(id, site);
      if (!session.token || !session.cookie) {
        lastError = new Error(SITE_NAME + ' 会话建立失败，请稍后重试');
        continue;
      }
      var pageUrl = site + '/episode/show/' + id;
      var response = host.fetch({
        method: 'POST',
        url: site + '/episode/guest_play/' + id,
        headers: {
          Accept: 'application/json, text/plain, */*',
          'Content-Type': 'application/json',
          'X-CSRF-Token': session.token,
          'X-Requested-With': 'XMLHttpRequest',
          Cookie: session.cookie,
          Origin: site,
          Referer: pageUrl,
          'User-Agent': UA,
        },
        body: '{}',
        anyStatus: true,
        followRedirects: true,
        timeoutMs: 20000,
      });
      var status = Number(response.status) || 0;
      if (status === 429 || status >= 500) {
        lastError = new Error(SITE_NAME + ' 访问太频繁被站点限流了，请等 5 分钟左右再试');
        lastError.retryable = true;
        continue;
      }
      var payload = {};
      try {
        payload = JSON.parse(String(response.body || '{}')) || {};
      } catch (_) {
        payload = {};
      }
      var address = String(payload.hdSource || payload.av1Source || '');
      if (address !== '') {
        try {
          host.cacheSet('site', site, 1800000);
        } catch (_) {}
        var prepared = {
          url: address,
          referer: pageUrl,
          quality: 0,
          credentials: {
            origin: site,
            referer: pageUrl,
            userAgent: UA,
            cookie: session.cookie,
          },
        };
        try {
          host.cacheSet('media:' + id, JSON.stringify(prepared), 300000);
        } catch (_) {}
        return prepared;
      }
      if (status === 422) {
        try {
          host.cacheSet('session:' + site + ':' + id, '', 0);
        } catch (_) {}
        lastError = new Error(SITE_NAME + ' 会话已过期，请重新点一次播放');
        lastError.retryable = true;
        continue;
      }
      lastError = new Error(SITE_NAME + ' 未返回播放地址（该片可能需要登录或开通 VIP）');
    } catch (error) {
      lastError = error;
      continue;
    }
  }
  if (lastError) throw lastError;
  var blocked = new Error(SITE_NAME + ' 所有线路都不可用，请稍后重试');
  blocked.retryable = true;
  throw blocked;
}

module.exports = {
  categories: categories,
  validCategory: validCategory,
  catalogPage: catalogPage,
  search: search,
  detail: detail,
  resolveMedia: resolveMedia,
};
