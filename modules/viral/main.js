// viralxxxporn.com（病毒式 XXX / OnlyFans 泄露）站源模块 · 小果影视 模块 API 1
//
//   列表  /zh/                      首页
//         /zh/latest-updates/{n}/   最新
//         /zh/categories/{slug}/{n}/
//   搜索  /zh/search/{关键词}/        （一次返回全部，不分页）
//   详情  /zh/video/{id}/{slug}/
//
// 详情页 flashvars 直接给 MP4：
//     video_alt_url  → 720p
//     video_alt_url2 → 1080p
//     video_url      → 480p
// 地址会 302 跳到 sextape.viralxxxporn.com，跟随之后 Range 正常（实测 206 video/mp4）。
// 游客可播，不需要登录。
// 模块函数必须同步。

const SITE = 'https://viralxxxporn.com';
const LOC = '/zh';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

const HEADERS = {
  'User-Agent': UA,
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'zh-CN,zh;q=0.9',
  'Referer': SITE + LOC + '/'
};

const CATEGORIES = [
  { id: 'latest', name: '最新' },
  { id: 'c-anal', name: '肛门' },
  { id: 'c-closeup', name: '特写' },
  { id: 'c-solo', name: '单人' },
  { id: 'c-ppv', name: 'PPV' },
  { id: 'c-lingerie', name: '内衣' },
  { id: 'c-tease', name: '挑逗' },
  { id: 'c-topless', name: '无上装' },
  { id: 'c-cute', name: '可爱' }
];

function clean(s) {
  return String(s == null ? '' : s)
    .replace(/<[^>]*>/g, '')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, ' ')
    .replace(/&#x([0-9a-f]+);/gi, function (_m, h) { return String.fromCharCode(parseInt(h, 16)); })
    .replace(/&#(\d+);/g, function (_m, d) { return String.fromCharCode(parseInt(d, 10)); })
    .trim();
}

function get(path) {
  const url = path.indexOf('http') === 0 ? path : SITE + path;
  const res = host.fetch({ method: 'GET', url: url, headers: HEADERS });
  if (res.status === 429) throw new Error('ViralXXX 限流了，等 1~2 分钟再试');
  if (res.status < 200 || res.status >= 300) throw new Error('ViralXXX 返回 HTTP ' + res.status);
  return res.body || '';
}

// 卡片（首页用 .vx-card，列表页用 .vx-th item，但都有 a.vx-media + img.vx-img）：
//   <a class="vx-media" href="https://viralxxxporn.com/zh/video/553583/slug/" title="…">
//     <img class="vx-img" src="https://imgcdn.viralxxxporn.com/…/800x450/2.jpg" alt="…">
function shrinkCover(url) {
  return String(url || '').replace('/800x450/', '/320x180/');
}

function parseCards(html) {
  const out = [];
  const seen = {};
  const re = /href="https:\/\/viralxxxporn\.com\/zh\/video\/(\d+)\/([^"\/]+)\/"/g;
  let m;
  while ((m = re.exec(html)) !== null) {
    const id = 'video/' + m[1] + '/' + m[2];
    if (seen[id]) continue;
    seen[id] = 1;
    const chunk = html.substring(m.index, m.index + 1200);
    const img = chunk.match(/<img[^>]+src="(https?:\/\/[^"]+\.(?:jpg|jpeg|png|webp))"/i);
    const alt = chunk.match(/<img[^>]+alt="([^"]*)"/i) || chunk.match(/title="([^"]*)"/i);
    // 卡片上的时长与清晰度：<div class="vx-duration">2:25:55</div>
    //                    <span class="vx-sticky is-2k">1080p</span>
    const dur = chunk.match(/class="vx-duration"[^>]*>([^<]{2,12})</i);
    const hd = chunk.match(/class="vx-sticky[^"]*"[^>]*>([^<]{1,10})</i);
    out.push({
      sourceId: id,
      title: alt ? clean(alt[1]) : m[2].replace(/-/g, ' '),
      cover: img ? shrinkCover(img[1]) : '',
      duration: dur ? clean(dur[1]) : '',
      badge: hd ? clean(hd[1]) : ''
    });
  }
  return out;
}

function listPath(category, page) {
  const n = Number(page || 1) < 1 ? 1 : Number(page || 1);
  const tail = n > 1 ? n + '/' : '';
  if (category && category.indexOf('c-') === 0) return LOC + '/categories/' + category.slice(2) + '/' + tail;
  return LOC + '/latest-updates/' + tail;
}

function toDrama(item) {
  const title = item.title || item.sourceId;
  const drama = {
    id: host.dramaId(item.sourceId),
    source: host.source,
    sourceId: item.sourceId,
    title: title,
    name: title,
    desc: '',
    intro: '',
    cover: item.cover || '',
    totalEpisode: 1
  };
  if (item.duration) drama.durationText = item.duration;
  if (item.badge) drama.badge = item.badge;
  if (item.tags && item.tags.length) drama.tags = item.tags;
  return drama;
}

function detailKey(sourceId) {
  const m = String(sourceId || '').match(/^video\/(\d+)\/([^\/]+)$/);
  if (!m) throw new Error('视频 ID 无效');
  return { id: m[1], slug: m[2], path: LOC + '/video/' + m[1] + '/' + m[2] + '/' };
}

// flashvars 里的三档清晰度；720p 优先（起播快），1080p / 480p 作为备选
function pickStreams(html) {
  const out = [];
  function take(name, re) {
    const m = html.match(re);
    if (m && m[1] && /^https?:/.test(m[1])) {
      const u = m[1].replace(/&amp;/g, '&');
      if (!out.some(function (x) { return x.url === u; })) out.push({ name: name, url: u });
    }
  }
  take('720p', /video_alt_url:\s*'([^']+)'/);
  take('1080p', /video_alt_url2:\s*'([^']+)'/);
  take('480p', /video_url:\s*'([^']+)'/);
  return out;
}

module.exports = {
  validCategory(category) {
    return !category || CATEGORIES.some(function (entry) { return entry.id === category; });
  },

  categories() {
    return CATEGORIES;
  },

  catalogPage(page, category) {
    if (!this.validCategory(category)) throw new Error('没有分类 ' + category);
    const items = parseCards(get(listPath(category, page))).map(toDrama);
    return { items: items, hasMore: items.length >= 12 };
  },

  search(page, query) {
    const kw = clean(query || '');
    if (!kw) return { items: [], hasMore: false };
    const n = Number(page || 1) < 1 ? 1 : Number(page || 1);
    if (n > 1) return { items: [], hasMore: false };  // 站点搜索一次返回全部
    const items = parseCards(get(LOC + '/search/' + encodeURIComponent(kw) + '/')).map(toDrama);
    return { items: items, hasMore: false };
  },

  detail(sourceId) {
    const info = detailKey(sourceId);
    const html = get(info.path);

    const h1 = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/);
    let title = h1 ? clean(h1[1]) : '';
    if (!title) {
      const t = html.match(/<title[^>]*>([\s\S]*?)<\/title>/);
      title = t ? clean(t[1]).replace(/^免费观看/, '').replace(/！$/, '') : info.slug;
    }
    const og = html.match(/property="og:image"[^>]*content="([^"]+)"/);
    const desc = html.match(/name="description"[^>]*content="([^"]*)"/);

    const drama = toDrama({ sourceId: sourceId, title: title, cover: og ? shrinkCover(og[1]) : '' });
    drama.desc = desc ? clean(desc[1]).substring(0, 200) : '';

    // 页面有多个 ld+json 块（WebSite/Organization 在第一块，VideoObject 在后面），
    // 必须全部遍历，只抓第一块会拿到没有 VideoObject 的导航结构。
    var videoLd = null;
    var ldPattern = /<script type="application\/ld\+json">\s*(\{[\s\S]*?\})\s*<\/script>/g;
    var ldMatch;
    while ((ldMatch = ldPattern.exec(html)) !== null && !videoLd) {
      try {
        var graph = JSON.parse(ldMatch[1])['@graph'] || [];
        for (var gi = 0; gi < graph.length; gi++) {
          if (graph[gi]['@type'] === 'VideoObject') { videoLd = graph[gi]; break; }
        }
      } catch (_) {}
    }
    if (videoLd) {
      var iso = /PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/.exec(String(videoLd.duration || ''));
      if (iso) {
        var pad = function (n) { return n < 10 ? '0' + n : String(n); };
        var hh = Number(iso[1] || 0), mm = Number(iso[2] || 0), ss = Number(iso[3] || 0);
        drama.durationText = hh > 0 ? hh + ':' + pad(mm) + ':' + pad(ss) : mm + ':' + pad(ss);
      }
      var uploaded = String(videoLd.uploadDate || videoLd.datePublished || '').match(/\d{4}-\d{2}-\d{2}/);
      if (uploaded) drama.onlineDate = uploaded[0];
      var ldActors = Array.isArray(videoLd.actor) ? videoLd.actor : [];
      var actors = [];
      var authorIds = [];
      for (var ai = 0; ai < ldActors.length && actors.length < 8; ai++) {
        var name = clean(ldActors[ai] && ldActors[ai].name);
        if (!name) continue;
        // 站点的 JSON-LD 演员名常是短名（Luna），但真实模特页是完整名（Luna Doll）——
        // 标题尾部「- 模特名」与短名前缀匹配时，用完整名 + 对应 slug，
        // 否则演员页对不上（用户实测 Luna 索引到错误内容）。
        var titleTail = /(?:^|[-–—]\s*)([^-–—]{2,40})\s*$/.exec(String(drama.title || ''));
        if (titleTail) {
          var tail = titleTail[1].trim();
          var tailLower = tail.toLowerCase();
          var nameLower = name.toLowerCase();
          if (tailLower.indexOf(nameLower) === 0 && tailLower.length > nameLower.length && /^[A-Za-z0-9 .'-]+$/.test(tail)) {
            name = tail;
          }
        }
        actors.push(name);
        var slug = /\/models\/([^"\/?#]+)/.exec(String(ldActors[ai].url || ''));
        var authorId = slug ? slug[1] : '';
        // 演员名被标题尾名增强时，slug 同步换成完整名的 slug（与站点 models 路由一致：小写、空格转-）
        if (name !== clean(ldActors[ai] && ldActors[ai].name)) {
          authorId = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
        }
        authorIds.push(authorId);
      }
      if (actors.length > 0) {
        drama.actors = actors;
        drama.author = actors[0];
        drama.authorId = authorIds[0];
      }
    }

    // 信息区（铁律 4 第 2 级）：<h3 class="vx-name-thumb">标签:</h3> 后面的 vx-list-tags。
    // 注意 a 标签文本两侧缩进空白可达 30+ 字符，跨度不能用 {1,40}，用 [^<] 非标签字符。
    var tagsZone = html.match(/<h3 class="vx-name-thumb">\s*标签\s*:?\s*<\/h3>[\s\S]{0,2000}?<ul class="vx-list-tags">([\s\S]*?)<\/ul>/);
    if (tagsZone) {
      var tags = [];
      var tagRe = /<a\s[^>]*>\s*([^<]{1,80}?)\s*<\/a>/g;
      var tagM;
      while ((tagM = tagRe.exec(tagsZone[1])) !== null && tags.length < 12) {
        var tag = clean(tagM[1]);
        if (tag && tags.indexOf(tag) < 0) tags.push(tag);
      }
      if (tags.length > 0) drama.tags = tags;
    }

    // 详情页已经打开了：顺手把时长和文件大小缓存好，播放时就不用再请求。
    try {
      host.cacheSet('streams:' + info.id, JSON.stringify(pickStreams(html)), 30 * 60 * 1000);

      let ms = 0;
      const dur = html.match(/property="video:duration"[^>]*content="(\d+)"/);
      if (dur) ms = Number(dur[1] || 0) * 1000;
      if (!ms) {
        const iso = html.match(/"duration"\s*:\s*"PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?"/);
        if (iso) ms = ((Number(iso[1] || 0) * 3600) + (Number(iso[2] || 0) * 60) + Number(iso[3] || 0)) * 1000;
      }
      if (ms > 0) host.cacheSet('duration:' + info.id, String(ms), 30 * 60 * 1000);

      // 记录这个视频有哪些清晰度（flashvars 里有 video_alt_url2 = 有 1080p）
      const names = pickStreams(html).map(function (s) { return s.name; });
      host.cacheSet('tiers:' + info.id, names.join(','), 30 * 60 * 1000);
      const tier = '_720p';

      // 取文件总大小（用 Range: bytes=0-0，只回 1 字节，比 HEAD 稳）
      const m = info.id;
      const band = String(Math.floor(Number(m) / 1000) * 1000);
      const probeUrl = 'https://sextape.viralxxxporn.com/contents/videos/' + band + '/' + m + '/' + m + tier + '.mp4';
      const res = host.fetch({ method: 'GET', url: probeUrl, headers: { 'User-Agent': UA, 'Range': 'bytes=0-0' } });
      const h = res.headers || {};
      const range = (h['content-range'] || h['Content-Range'] || [''])[0] || '';
      let len = Number((range.match(/\/(\d+)\s*$/) || [])[1] || 0);
      if (!len) len = Number((h['content-length'] || h['Content-Length'] || ['0'])[0] || 0);
      if (len > 1) host.cacheSet('size:' + info.id, String(len), 30 * 60 * 1000);
    } catch (e) { /* 忽略：拿不到就退回整段播放 */ }

    const page = SITE + info.path;
    return {
      drama: drama,
      chapters: [{
        id: host.chapterId(sourceId, 'video'),
        source: host.source,
        title: title || '正片',
        currentEpisode: 1,
        pageUrl: page,
        referer: page
      }]
    };
  },

  resolveMedia(task) {
    // DramaID 形如 "viral:video/<id>/<slug>"；Chapter.ID 形如 "viral:video/<id>/<slug>:video"
    let sourceId = '';
    const prefix = host.source + ':';
    if (task && typeof task.dramaId === 'string' && task.dramaId.indexOf(prefix) === 0) {
      sourceId = task.dramaId.slice(prefix.length);
    }
    if (!sourceId && task && task.chapter && task.chapter.id) {
      const parts = String(task.chapter.id).split(':');
      if (parts.length >= 2) sourceId = parts.slice(1, parts.length - 1).join(':');
    }
    const info = detailKey(sourceId);
    const page = SITE + info.path;
    const vid = info.id;

    // 播放地址优先用详情页 flashvars 的真实地址（detail 已缓存 'streams:'）。
    // 不能再按 id 硬拼 sextape CDN 直链：部分视频没有 720p 档（如 237457 只有
    // 480p+1080p），拼出来的 _720p.mp4 直接 404；网页播放走的是 get_file 带token 链接。
    let streamUrl = '';
    try {
      const cached = host.cacheGet('streams:' + vid);
      if (cached) {
        const list = JSON.parse(cached);
        if (Array.isArray(list)) {
          // video_alt_url(中档，多数是 720p) 优先，其次 alt2，最后 url(基础档)
          const order = list.slice().sort(function (a, b) {
            const rank = { '720p': 0, '1080p': 1, '480p': 2 };
            return (rank[a.name] !== undefined ? rank[a.name] : 9) - (rank[b.name] !== undefined ? rank[b.name] : 9);
          });
          if (order.length > 0 && /^https?:/.test(order[0].url)) streamUrl = order[0].url;
        }
      }
    } catch (e) { streamUrl = ''; }

    // 无缓存（用户直接从历史记录进播放）→ 现抓详情页解析 flashvars，token 保证新鲜
    if (streamUrl === '') {
      try {
        const html = get(info.path);
        const list = pickStreams(html);
        if (list.length > 0) {
          streamUrl = list[0].url;
          try { host.cacheSet('streams:' + vid, JSON.stringify(list), 10 * 60 * 1000); } catch (e) {}
        }
      } catch (e) { /* 落到兜底 */ }
    }

    // 兜底：flashvars 也没有（极少）才按 id 规律拼 CDN 直链
    if (streamUrl === '') {
      const band = String(Math.floor(Number(vid) / 1000) * 1000);
      streamUrl = 'https://sextape.viralxxxporn.com/contents/videos/' + band + '/' + vid + '/' + vid + '_720p.mp4';
    }

    // 时长和文件大小在详情页阶段就缓存好
    let durationMs = 0;
    try {
      const d = host.cacheGet('duration:' + vid);
      if (d) durationMs = Number(d) || 0;
    } catch (e) { durationMs = 0; }

    // 不包 HLS，直接给 MP4（get_file 地址会 302 到真实 CDN，播放器跟随即可）。
    // 普通 MP4 走 HTTP Range，拖到哪取哪，seek 是瞬间的。
    return {
      url: streamUrl,
      referer: page,
      quality: 0,
      durationMs: durationMs,
      credentials: {
        referer: page,
        origin: SITE,
        userAgent: UA
      }
    };
  }
};
