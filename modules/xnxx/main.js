// XNXX 站源模块 · 小果影视 模块 API 1
//
// 与 XVIDEOS 同门，页面模板高度一致，但路径不同（2026-11 真实页面核对）：
//   列表  /hits/{n}            热门
//         /best/{yyyy-mm}/{n}  本月最佳（首页 <a class="dir next"> 给的路径）
//         /search/{tag}/{n}    标签 / 搜索（xnxx 的标签就是 search）
//   详情  /video-{code}/{slug}  （slug 随便给一段，站点会重定向到规范地址）
//   作者  /porn-maker/{slug}、模特 /pornstar/{slug}
//   播放  setVideoHLS('…hls.m3u8') → master 选最高不超过 1080p 的变体
//         setVideoUrlHigh/Low('…mp4') → 单段 HLS
//         JSON-LD VideoObject.contentUrl → mp4 兜底
//
// 首页 / 是 JS 动态渲染的，静态 HTML 里没有卡片，不能拿来当列表源。
// 模块函数必须同步。

const SITE = 'https://www.xnxx.com';
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

const HEADERS = {
  'User-Agent': UA,
  Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
};

// 分类 id 必须是不含 "/" 的 slug（App 会拒绝带斜杠的 id）。
const CATEGORIES = [
  { id: 'hits', name: '热门', path: '/hits' },
  { id: 'best', name: '本月最佳', path: '/best' },
  { id: 'asian', name: '亚洲', path: '/search/asian' },
  { id: 'chinese', name: '中文', path: '/search/chinese' },
  { id: 'japanese', name: '日本', path: '/search/japanese' },
  { id: 'amateur', name: '素人', path: '/search/amateurs' },
  { id: 'bigtits', name: '巨乳', path: '/search/big+tits' },
  { id: 'anal', name: '肛交', path: '/search/anal' },
  { id: 'blowjob', name: '口交', path: '/search/blowjob' },
  { id: 'milf', name: '熟女', path: '/search/milf' },
  { id: 'lesbian', name: '女同', path: '/search/lesbian' },
  { id: '4k', name: '4K', path: '/search/4k' },
];

function clean(value) {
  let text = String(value == null ? '' : value).replace(/<[^>]*>/g, ' ');
  if (text.indexOf('&') >= 0) {
    text = text
      .replace(/&#(\d+);/g, (all, code) => String.fromCharCode(Number(code)))
      .replace(/&#x([0-9a-f]+);/gi, (all, code) =>
        String.fromCharCode(parseInt(code, 16)),
      )
      .replace(/&quot;/g, '"')
      .replace(/&#39;|&apos;/g, "'")
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&');
  }
  return text.replace(/\s+/g, ' ').trim();
}

function get(path, referer) {
  const url = path.indexOf('http') === 0 ? path : SITE + path;
  let response = null;
  try {
    response = host.fetch({
      url,
      headers: HEADERS,
      referer: referer || SITE + '/',
      anyStatus: true,
    });
  } catch (error) {
    throw new Error(
      'XNXX 连接失败：' + String((error && error.message) || error),
    );
  }
  const status = response.status || 0;
  const body = response.body || '';
  if (status < 200 || status >= 300) {
    // 搜索无结果时站点会 404，调用方按空列表处理
    const error = new Error('XNXX 返回 HTTP ' + status + '（' + path + '）');
    error.status = status;
    throw error;
  }
  return body;
}

function absolute(href) {
  const value = String(href || '').replace(/&amp;/g, '&');
  if (/^https?:\/\//i.test(value)) return value;
  if (value.slice(0, 2) === '//') return 'https:' + value;
  return SITE + (value.charAt(0) === '/' ? value : '/' + value);
}

// 从卡片里取名字：<span class="name">…</span> 或链接文本
function nameIn(seg) {
  const named = seg.match(/class="name"[^>]*>([\s\S]{1,120}?)<\//);
  if (named) return clean(named[1]);
  const anchor = seg.match(/<a[^>]*>([\s\S]{1,120}?)<\/a>/);
  return anchor ? clean(anchor[1]) : '';
}

// 列表卡片：只认真正带 data-eid / thumb-under 的 thumb-block。
// 首页有 162 个空的 <div class="thumb-block thumb-cat">，不能按 class 直接切。
function parseCards(html) {
  const out = [];
  const seen = {};
  const source = String(html || '');
  let parts = source.split(/<div id="video_[a-z0-9]+"/);
  if (parts.length < 2) {
    parts = source.split(/<div[^>]+class="[^"]*\bthumb-block\b[^"]*"[^>]*>/);
  }
  for (let i = 1; i < parts.length; i++) {
    const seg = parts[i].slice(0, 4000);
    const code =
      (seg.match(/data-eid="([a-z0-9]+)"/) ||
        seg.match(/href="\/video-([a-z0-9]+)\//) ||
        [])[1] || '';
    if (!code || seen[code]) continue;
    if (seg.indexOf('thumb-under') < 0 && seg.indexOf('/video-') < 0) continue;

    let title = '';
    const titled =
      seg.match(/<div class="thumb-under">[\s\S]{0,600}?<a[^>]+title="([^"]+)"/) ||
      seg.match(/<a[^>]+href="\/video-[a-z0-9]+\/[^"]*"[^>]+title="([^"]+)"/);
    if (titled) title = clean(titled[1]);
    if (!title) {
      const alt = seg.match(/<img[^>]+alt="([^"]{4,})"/);
      if (alt) title = clean(alt[1]);
    }
    if (!title) {
      const plain = seg.match(/<div class="thumb-under">[\s\S]{0,600}?<p><a[^>]*>([\s\S]{2,200}?)<\/a>/);
      if (plain) title = clean(plain[1]);
    }
    if (!title || title === code) continue;
    seen[code] = 1;

    const cover =
      seg.match(/data-src="(https:\/\/[^"]*xnxx-cdn\.com[^"]+)"/) ||
      seg.match(/data-src="([^"]+)"/) ||
      seg.match(/<img[^>]+src="(https?:\/\/[^"]+)"/);
    const duration = seg.match(/<p class="metadata">[\s\S]{0,400}?(\d{1,3}\s*min)/i);
    const hd = seg.match(/class="video-hd"[^>]*>[\s\S]{0,120}?(\d{3,4}p)/i);

    // 上传者：/porn-maker/{slug}
    let author = '';
    let authorId = '';
    let authorUrl = '';
    const uploader = seg.match(/<a href="\/porn-maker\/([A-Za-z0-9_.\-]+)"[^>]*>([\s\S]{0,120}?)<\/a>/);
    if (uploader) {
      authorId = uploader[1];
      author = nameIn(uploader[2]) || uploader[1];
      authorUrl = SITE + '/porn-maker/' + authorId;
    }

    const tags = [];
    if (hd) tags.push('高清');
    out.push({
      sourceId: code,
      title: title.slice(0, 160),
      cover: cover ? absolute(cover[1]) : '',
      durationText: duration ? duration[1].replace(/\s+/g, '') : '',
      badge: hd ? hd[1] : '',
      tags,
      author,
      authorId,
      authorUrl,
    });
  }
  return out;
}

// 页面底部有 <a … class="dir next">下一步</a>，用它判断还有没有下一页最准。
function hasNextPage(html) {
  const source = String(html || '');
  // 榜单是 class="dir next"，搜索 / 标签是 class="no-page next"。
  if (/class="[^"]*\bnext\b[^"]*"/.test(source)) {
    return !/class="[^"]*\bnext\b[^"]*\bdisabled\b/.test(source);
  }
  return false;
}

function monthPath() {
  const now = new Date();
  const month = now.getUTCMonth() + 1;
  return (
    now.getUTCFullYear() +
    '-' +
    (month < 10 ? '0' + month : String(month))
  );
}

function listPath(category, page) {
  const entry = CATEGORIES.filter((item) => item.id === category)[0] || CATEGORIES[0];
  const index = Math.max(1, Number(page || 1) < 1 ? 1 : Math.floor(Number(page || 1)));
  if (index <= 1) return entry.path;
  if (entry.id === 'best') return '/best/' + monthPath() + '/' + index;
  if (entry.id === 'hits') return '/hits/' + index;
  return entry.path + '/' + index;
}

// 详情元数据。优先用页面里的 JS 数据（uploader / video_models / video_tags），
// 它比 HTML 模板稳定；取不到再退回页面标签与 JSON-LD。
function detailMeta(html) {
  const meta = {
    author: '',
    authorId: '',
    authorUrl: '',
    actors: [],
    maker: '',
    onlineDate: '',
    tags: [],
    durationMs: 0,
    contentUrl: '',
  };
  if (!html) return meta;

  const uploader = html.match(/"uploader"\s*:\s*"([^"]{1,80})"/);
  const uploaderUrl = html.match(/"uploader_url"\s*:\s*"([^"]{1,120})"/);
  if (uploader) {
    meta.author = clean(uploader[1]);
    if (uploaderUrl) {
      const slug = uploaderUrl[1].replace(/\\\//g, '/').replace(/^\/+|\/+$/g, '');
      const parts = slug.split('/');
      meta.authorId = parts[parts.length - 1];
      meta.authorUrl = SITE + '/' + slug;
    }
  }

  // video_models: {"id":{"name":"…","profile":"…","uri":"…"}}
  const modelsAt = html.indexOf('"video_models"');
  if (modelsAt >= 0) {
    const chunk = html.slice(modelsAt, modelsAt + 6000);
    // video_models 每项是 {name, profile, uri}；必须带 profile，
    // 否则会把后面 JSON-LD 的 "name"（视频标题）也当成女优收进来。
    const nameRe = /"name"\s*:\s*"([^"]{1,80})"\s*,\s*"profile"/g;
    let found = null;
    while ((found = nameRe.exec(chunk)) !== null) {
      const name = clean(found[1]).replace(/\\"/g, '"');
      if (name && meta.actors.indexOf(name) < 0 && meta.actors.length < 12) {
        meta.actors.push(name);
      }
    }
  }

  const tagRe = /class="is-keyword"[^>]*href="\/search\/[^"]*"[^>]*>([^<]{1,40})</g;
  let tag = null;
  while ((tag = tagRe.exec(html)) !== null) {
    const value = clean(tag[1]);
    if (value && meta.tags.indexOf(value) < 0 && meta.tags.length < 20) {
      meta.tags.push(value);
    }
  }
  if (!meta.tags.length) {
    const tagsAt = html.indexOf('"video_tags"');
    if (tagsAt >= 0) {
      const chunk = html.slice(tagsAt, tagsAt + 1200);
      const inline = chunk.match(/\[([^\]]+)\]/);
      if (inline) {
        const valueRe = /"([^"]{1,40})"/g;
        let value = null;
        while ((value = valueRe.exec(inline[1])) !== null) {
          if (meta.tags.length >= 20) break;
          meta.tags.push(value[1]);
        }
      }
    }
  }

  if (!meta.author) {
    const legacy = html.match(/href="\/porn-maker\/([A-Za-z0-9_.\-]+)"[^>]*>([\s\S]{0,160}?)<\/a>/);
    if (legacy) {
      meta.authorId = legacy[1];
      meta.author = nameIn(legacy[2]) || legacy[1];
      meta.authorUrl = SITE + '/porn-maker/' + legacy[1];
    }
  }
  const maker = html.match(/href="\/porn-maker\/([A-Za-z0-9_.\-]+)"/);
  if (maker) meta.maker = meta.author || clean(maker[1]);

  const ldAt = html.indexOf('"@type": "VideoObject"');
  const ld = ldAt >= 0 ? html.slice(Math.max(0, ldAt - 200), ldAt + 2000) : html;
  const date = ld.match(/"uploadDate"\s*:\s*"(\d{4}-\d{2}-\d{2})/);
  if (date) meta.onlineDate = date[1];
  const duration = ld.match(/"duration"\s*:\s*"PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?"/);
  if (duration) {
    meta.durationMs =
      (Number(duration[1] || 0) * 3600 +
        Number(duration[2] || 0) * 60 +
        Number(duration[3] || 0)) *
      1000;
  }
  const content = ld.match(/"contentUrl"\s*:\s*"([^"]+)"/);
  if (content) meta.contentUrl = content[1].replace(/\\\//g, '/');
  return meta;
}

function sourcesOf(html, meta) {
  const quoted = (name) => {
    const single = html.match(new RegExp(name + "\\(\\s*'([^']+)'"));
    if (single) return single[1];
    const double = html.match(new RegExp(name + '\\(\\s*"([^"]+)"'));
    return double ? double[1] : '';
  };
  const hls = quoted('setVideoHLS');
  const high = quoted('setVideoUrlHigh');
  const low = quoted('setVideoUrlLow');
  const fromLd = (meta && meta.contentUrl) || '';
  const generic = (
    html.match(/https:\/\/[^"'\s\\]*xnxx-cdn\.com\/[^"'\s\\]+\.mp4[^"'\s\\]*/i) ||
    []
  )[1] || '';
  return {
    hls,
    mp4: high || low || fromLd || generic,
  };
}

// master 里挑最高但不超 1080p 的变体
function bestVariant(masterText, baseUrl) {
  const raw = String(masterText || '').trim();
  // 站点偶尔把 404 / 验证页当 200 返回，不能把 HTML 拼成播放地址。
  if (!raw || raw.charAt(0) === '<' || raw.slice(0, 7) !== '#EXTM3U') return '';
  const lines = raw.split(/\r?\n/);
  const variants = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line || line.charAt(0) === '#') continue;
    const previous = (lines[i - 1] || '').trim();
    const resolution = previous.match(/RESOLUTION=(\d+)x(\d+)/);
    const bandwidth = Number((previous.match(/BANDWIDTH=(\d+)/) || [])[1] || 0);
    const url = line.indexOf('http') === 0 ? line : baseUrl.replace(/[^/]*$/, '') + line;
    variants.push({
      url,
      height: resolution ? Number(resolution[2]) : 0,
      bandwidth,
    });
  }
  if (!variants.length) return '';
  const capped = variants.filter((item) => item.height > 0 && item.height <= 1080);
  const pool = capped.length ? capped : variants;
  let best = pool[0];
  for (const item of pool) {
    if (
      item.height > best.height ||
      (item.height === best.height && item.bandwidth > best.bandwidth)
    ) {
      best = item;
    }
  }
  return best.url;
}

function wrapMp4(mp4, durationMs) {
  const seconds = durationMs > 0 ? Math.max(1, Math.round(durationMs / 1000)) : 3600;
  return {
    url: mp4,
    playlist: [
      '#EXTM3U',
      '#EXT-X-VERSION:3',
      '#EXT-X-TARGETDURATION:' + seconds,
      '#EXT-X-MEDIA-SEQUENCE:0',
      '#EXT-X-PLAYLIST-TYPE:VOD',
      '#EXTINF:' + seconds + ',',
      mp4,
      '#EXT-X-ENDLIST',
      '',
    ].join('\n'),
    durationMs: durationMs || 0,
  };
}

function prepareMedia(html, pageUrl) {
  const meta = detailMeta(html);
  const sources = sourcesOf(html, meta);
  if (sources.hls) {
    try {
      const master = get(sources.hls, pageUrl);
      const variant = bestVariant(master, sources.hls);
      if (variant) {
        const prepared = host.prepareWebMedia(
          { url: variant, referer: pageUrl, quality: 1080 },
          'XNXX',
        );
        if (prepared && prepared.playlist) {
          prepared.durationMs = prepared.durationMs || meta.durationMs;
          return prepared;
        }
      }
    } catch (error) {
      /* 退回 master 本身 */
    }
    return host.prepareWebMedia(
      { url: sources.hls, referer: pageUrl, quality: 1080 },
      'XNXX',
    );
  }
  if (sources.mp4) {
    const media = wrapMp4(sources.mp4, meta.durationMs);
    media.referer = pageUrl;
    return media;
  }
  const hint =
    html && html.indexOf('video-metadata') >= 0
      ? '页面有视频信息但没有播放源，可能该视频已被移除或限制地区'
      : '页面没有视频信息，可能视频已删除或链接失效';
  throw new Error('XNXX 没有找到播放地址：' + hint);
}

function toDrama(item) {
  const title = item.title || item.sourceId;
  const drama = {
    id: host.dramaId(item.sourceId),
    source: host.source,
    sourceId: item.sourceId,
    title,
    name: title,
    desc: '',
    intro: '',
    cover: item.cover || '',
    totalEpisode: 1,
  };
  if (item.durationText) drama.durationText = item.durationText;
  if (item.badge) drama.badge = item.badge;
  if (item.tags && item.tags.length) drama.tags = item.tags.slice();
  if (item.author) {
    drama.author = item.author;
    if (item.authorId) drama.authorId = item.authorId;
    if (item.authorUrl) drama.authorUrl = item.authorUrl;
  }
  return drama;
}

function cacheCards(raw) {
  for (const item of raw) {
    try {
      host.cacheSet('card:' + item.sourceId, JSON.stringify(item), 30 * 60 * 1000);
    } catch (error) {
      /* 忽略 */
    }
  }
}

// 作者页：上传者频道 /porn-maker/{id}、模特 /pornstar/{id}，都取不到就按名字搜索
function authorPage(authorId, authorName, page) {
  const index = Math.max(1, Number(page || 1) < 1 ? 1 : Math.floor(Number(page || 1)));
  const id = String(authorId == null ? '' : authorId)
    .trim()
    .replace(/^\/+|\/+$/g, '');
  const name = clean(authorName || '');
  if (!id && !name) return { items: [], hasMore: false, warning: '缺少作者信息' };

  const suffix = index > 1 ? '/' + index : '';
  const candidates = [];
  if (id) {
    candidates.push('/porn-maker/' + id + suffix);
    candidates.push('/pornstar/' + id + suffix);
    candidates.push('/search/' + encodeURIComponent(id) + suffix);
  }
  if (name) candidates.push('/search/' + encodeURIComponent(name) + suffix);

  for (const path of candidates) {
    try {
      const raw = parseCards(get(path));
      if (!raw.length) continue;
      const items = raw.map(function (item) {
        if (!item.author) {
          item.author = name || id;
          item.authorId = id;
          item.authorUrl = SITE + '/porn-maker/' + id;
        }
        return toDrama(item);
      });
      return { items, hasMore: hasNextPage(get(path)), warning: '' };
    } catch (error) {
      /* 换下一个候选 */
    }
  }
  return { items: [], hasMore: false, warning: '没有找到这位作者的作品' };
}

module.exports = {
  validCategory(category) {
    const key = String(category || '').trim();
    return key === '' || CATEGORIES.some((entry) => entry.id === key);
  },

  categories() {
    return CATEGORIES.map((entry) => ({ id: entry.id, name: entry.name }));
  },

  catalogPage(page, category) {
    const html = get(listPath(String(category || 'hits').trim(), page));
    const raw = parseCards(html);
    cacheCards(raw);
    return { items: raw.map(toDrama), hasMore: hasNextPage(html), warning: '' };
  },

  search(page, query) {
    const keyword = clean(query || '');
    if (!keyword || keyword.length > 80) {
      return { items: [], hasMore: false, warning: '' };
    }
    const index = Math.max(1, Number(page || 1) < 1 ? 1 : Math.floor(Number(page || 1)));
    const base = '/search/' + encodeURIComponent(keyword.replace(/\s+/g, '+'));
    const path = index > 1 ? base + '/' + index : base;
    let html = '';
    try {
      html = get(path);
    } catch (error) {
      if (error.status !== 404) throw error;
    }
    const raw = parseCards(html);
    cacheCards(raw);
    return { items: raw.map(toDrama), hasMore: hasNextPage(html), warning: '' };
  },

  author(authorId, authorName, page) {
    return authorPage(authorId, authorName, page);
  },

  detail(sourceId) {
    const code = String(sourceId || '')
      .trim()
      .match(/^[a-z0-9]{6,16}$/);
    if (!code) throw new Error('XNXX 视频 ID 无效');
    const pageUrl = SITE + '/video-' + code[0] + '/1';
    const html = get('/video-' + code[0] + '/1', pageUrl);
    const meta = detailMeta(html);
    const title = meta.title || code[0];
    const pageTitle = html.match(/<title>([^<]{2,200})<\/title>/);
    const finalTitle = pageTitle
      ? clean(pageTitle[1]).replace(/\s*[-–]\s*XNXX\.COM[\s\S]*$/i, '')
      : title;

    const drama = {
      id: host.dramaId(code[0]),
      source: host.source,
      sourceId: code[0],
      title: finalTitle || code[0],
      name: finalTitle || code[0],
      desc: '',
      intro: '',
      cover:
        (html.match(/"thumbnailUrl"\s*:\s*\["([^"]+)"/) || [])[1] || '',
      totalEpisode: 1,
      episodeCount: 1,
    };
    if (meta.author) drama.author = meta.author;
    if (meta.authorId) drama.authorId = meta.authorId;
    if (meta.authorUrl) drama.authorUrl = meta.authorUrl;
    if (meta.actors.length) drama.actors = meta.actors.slice();
    if (meta.maker) drama.maker = meta.maker;
    if (meta.onlineDate) drama.onlineDate = meta.onlineDate;
    if (meta.tags.length) drama.tags = meta.tags.slice();
    if (meta.durationMs > 0) {
      const total = Math.round(meta.durationMs / 1000);
      drama.durationText =
        Math.floor(total / 60) + ':' + String(total % 60).padStart(2, '0');
    }

    return {
      drama,
      chapters: [
        {
          id: host.chapterId(code[0], 'video'),
          source: host.source,
          title: '正片',
          currentEpisode: 1,
          videoUrl: 'xnxx-play://' + code[0],
          pageUrl,
          referer: pageUrl,
        },
      ],
    };
  },

  resolveMedia(task) {
    const chapter = (task && task.chapter) || {};
    let code = '';
    const drama = String((task && task.dramaId) || '').split(':');
    if (drama.length >= 2) code = drama[1];
    if (!code) {
      const fromChapter = String(chapter.id || '').split(':');
      if (fromChapter.length >= 3) code = fromChapter[1];
    }
    if (!/^[a-z0-9]{6,16}$/.test(code)) throw new Error('XNXX 无法确定视频 ID');
    const pageUrl = SITE + '/video-' + code + '/1';
    return prepareMedia(get('/video-' + code + '/1', pageUrl), pageUrl);
  },
};
