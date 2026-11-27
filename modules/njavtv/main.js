// nJAV（njavtv.com）—— Laravel 服务端渲染站，列表/详情都能直接解析 HTML。
//
// 播放地址藏在页面的 eval(function(p,a,c,k,e,d)…) packer 里，解包后是：
//   source='https://c.surrit.com/{uuid}/playlist.m3u8'
// 其中 uuid 与页面 seek 缩略图路径里的 uuid 完全一致（已用两个样本核对），
// 所以这里不用实现 packer 解码器，直接从 seek 路径取 uuid 再拼，等价且更轻。
//
// 注意两点：
//   1. 站点会 301 到 /dm339 这类镜像前缀，但 /cn/{slug} 直接访问同样 200，不必跟随。
//   2. 媒体 CDN（c.surrit.com）对「没有浏览器 UA」的请求返回 403（Cloudflare），
//      实测 iOS Safari UA 可通过；App 播放器用的正是 iOS Safari UA。

const SITE = 'https://njavtv.com';
const SITE_NAME = 'nJAV';
const UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.6 Mobile/15E148 Safari/604.1';
const MEDIA_CDN = 'c.surrit.com';
const IMAGE_CDN = 'd.surrit.com';

const CATEGORIES = [
  { id: 'new', name: '最新上架', path: '/cn/new' },
  { id: 'release', name: '最新发行', path: '/cn/release' },
  { id: 'uncensored', name: '无码流出', path: '/cn/uncensored-leak' },
  { id: 'subtitle', name: '中文字幕', path: '/cn/chinese-subtitle' },
];

function categories() {
  var out = [];
  for (var i = 0; i < CATEGORIES.length; i++) out.push({ id: CATEGORIES[i].id, name: CATEGORIES[i].name });
  return out;
}

function validCategory(category) {
  var id = String(category || '');
  if (id === '') return true;
  for (var i = 0; i < CATEGORIES.length; i++) if (CATEGORIES[i].id === id) return true;
  return false;
}

// ---------- 基础 ----------

function clean(value) {
  return String(value || '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&apos;/g, "'")
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

function fetchPage(path) {
  var response;
  try {
    response = host.fetch({
      url: SITE + path,
      headers: {
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
        'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
        Referer: SITE + '/cn',
        'User-Agent': UA,
      },
      anyStatus: true,
      followRedirects: true,
      timeoutMs: 25000,
    });
  } catch (error) {
    var failure = new Error(SITE_NAME + ' 连接失败，请检查网络：' + (error && error.message ? error.message : error));
    failure.retryable = true;
    throw failure;
  }
  var status = Number(response.status) || 0;
  if (status >= 400) {
    var problem = new Error(SITE_NAME + ' 返回 HTTP ' + status);
    problem.retryable = status >= 500 || status === 408 || status === 429;
    throw problem;
  }
  return String(response.body || '');
}

// ---------- 列表 ----------

// slug 必须像番号（yuj-083 / cawd-726-uncensored-leak / musume-112726_01）：
// 带「-数字」。片商/品牌页（fc2、1pondo、10musume）和栏目（new/genres）都不含这个特征。
var SLUG_PATTERN = /<a\b[^>]*href="https?:\/\/(?:www\.)?njavtv\.com(?:\/dm\d+)?(?:\/[a-z]{2}(?:-[a-z]{2})?)?\/([a-z0-9][a-z0-9_-]{2,70})"/gi;

function looksLikeVideo(slug) {
  return /^[a-z0-9]+-[0-9]/.test(slug);
}

function parseCards(html) {
  var items = [];
  var seen = {};
  SLUG_PATTERN.lastIndex = 0;
  var matched = SLUG_PATTERN.exec(html);
  while (matched) {
    var slug = String(matched[1] || '').toLowerCase();
    if (!seen[slug] && looksLikeVideo(slug)) {
      seen[slug] = true;

      var chunk = html.slice(matched.index, Math.min(html.length, matched.index + 3000));
      var title = '';
      var image = (chunk.match(/<img\b[^>]*>/i) || [''])[0];
      if (image) title = clean(attr(image, 'alt'));
      if (title === '') {
        var linked = /class="[^"]*text-secondary[^"]*"[^>]*>([\s\S]*?)<\/a>/i.exec(chunk);
        if (linked) title = clean(linked[1]);
      }
      if (title === '') title = slug.toUpperCase();

      var duration = '';
      var clock = /bottom-1\s+right-1[^>]*>\s*([0-9]{1,2}:[0-9]{2}(?::[0-9]{2})?)\s*</i.exec(chunk);
      if (clock) duration = clock[1];

      var cover = 'https://' + IMAGE_CDN + '/' + slug + '/cover-t.jpg';
      var drama = {
        id: host.dramaId(slug),
        source: host.source,
        sourceId: slug,
        title: title,
        name: title,
        cover: cover,
        coverUrl: cover,
        channelName: SITE_NAME,
        categoryName: '视频',
        durationText: duration,
        totalEpisode: 1,
        episodeCount: 1,
      };
      var serial = serialOf(slug);
      if (serial !== '') drama.serial = serial;
      items.push(drama);
    }
    matched = SLUG_PATTERN.exec(html);
  }
  return items;
}

function serialOf(slug) {
  var matched = /^([a-z]{2,8}-[0-9]{2,6})/i.exec(String(slug || ''));
  return matched ? matched[1].toUpperCase() : '';
}

function listPage(page, category, keyword) {
  var p = Number(page) || 1;
  if (p < 1) p = 1;
  if (p > 10000) p = 10000;
  var path = '/cn';
  var word = String(keyword || '').trim();
  if (word !== '') {
    path = '/cn/search/' + encodeURIComponent(word);
  } else if (String(category || '') !== '') {
    if (!validCategory(category)) throw new Error(SITE_NAME + ' 不支持分类：' + category);
    for (var i = 0; i < CATEGORIES.length; i++) {
      if (CATEGORIES[i].id === category) path = CATEGORIES[i].path;
    }
  }
  var html = fetchPage(path + (p > 1 ? '?page=' + p : ''));
  var items = parseCards(html);
  // 首页约 38 张卡、分类页约 12 张，末页为空；用 12 作阈值判断是否还有下一页。
  return { items: items, hasMore: items.length >= 12 };
}

function catalogPage(page, category, query) {
  return listPage(page, category, query);
}

// 参数顺序跟宿主一致：宿主调用的是 search(page, query)。
// （写成 (query, page) 会让关键词被当页码，搜索永远返回同一批）
function search(page, query) {
  var word = String(query || '').trim();
  if (word === '') return { items: [], hasMore: false, warning: '请输入搜索关键词' };
  var result = listPage(page, '', word);
  if (result.items.length === 0) result.warning = '没有找到「' + word + '」相关内容';
  return result;
}

// ---------- 详情 ----------

function metaOf(html, name) {
  var pattern = new RegExp('<meta\\b[^>]*(?:property|name)="' + name + '"[^>]*content="([^"]*)"', 'i');
  var matched = pattern.exec(html);
  if (matched) return clean(matched[1]);
  var reversed = new RegExp('<meta\\b[^>]*content="([^"]*)"[^>]*(?:property|name)="' + name + '"', 'i').exec(html);
  return reversed ? clean(reversed[1]) : '';
}

function metaAll(html, name) {
  var out = [];
  var pattern = new RegExp('<meta\\b[^>]*(?:property|name)="' + name + '"[^>]*content="([^"]*)"', 'gi');
  var matched = pattern.exec(html);
  while (matched) {
    var value = clean(matched[1]);
    if (value !== '' && out.indexOf(value) < 0) out.push(value);
    matched = pattern.exec(html);
  }
  return out;
}

function clockText(seconds) {
  var total = Number(seconds) || 0;
  if (total <= 0) return '';
  var pad = function (n) {
    return n < 10 ? '0' + n : String(n);
  };
  var hours = Math.floor(total / 3600);
  var minutes = Math.floor((total % 3600) / 60);
  var secs = Math.floor(total % 60);
  if (hours > 0) return hours + ':' + pad(minutes) + ':' + pad(secs);
  return minutes + ':' + pad(secs);
}

function uuidOf(html) {
  // seek 缩略图路径里的 uuid 就是播放 uuid（两个样本已核对一致）
  var pattern = /surrit\.com\\?\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\\?\/seek/i;
  var matched = pattern.exec(html);
  if (matched) return matched[1].toLowerCase();
  var any = /([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i.exec(html);
  return any ? any[1].toLowerCase() : '';
}

function detail(sourceId) {
  var slug = String(sourceId || '').trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9_-]{2,70}$/.test(slug)) throw new Error(SITE_NAME + ' 视频 ID 无效');
  var html = fetchPage('/cn/' + slug);

  var title = metaOf(html, 'og:title');
  if (title === '') {
    var documentTitle = /<title>([\s\S]*?)<\/title>/i.exec(html);
    title = clean(documentTitle ? documentTitle[1] : '').replace(/\s*-\s*nJAV\s*$/, '');
  }
  if (title === '') throw new Error(SITE_NAME + ' 详情缺少标题');

  var cover = metaOf(html, 'og:image');
  if (cover === '') cover = 'https://' + IMAGE_CDN + '/' + slug + '/cover-n.jpg';

  var actors = metaAll(html, 'og:video:actor');
  var durationText = clockText(metaOf(html, 'og:video:duration'));
  var releaseDate = metaOf(html, 'og:video:release_date');
  var serial = serialOf(slug);
  if (serial === '') {
    var fromTitle = /^([A-Za-z]{2,8}-[0-9]{2,6})/.exec(title);
    if (fromTitle) serial = fromTitle[1].toUpperCase();
  }

  var drama = {
    id: host.dramaId(slug),
    source: host.source,
    sourceId: slug,
    title: title,
    name: title,
    desc: serial !== '' ? serial : SITE_NAME,
    intro: serial !== '' ? serial : SITE_NAME,
    cover: cover,
    coverUrl: cover,
    channelName: SITE_NAME,
    categoryName: '视频',
    durationText: durationText,
    tags: [],
    totalEpisode: 1,
    episodeCount: 1,
  };
  if (serial !== '') drama.serial = serial;
  if (releaseDate !== '') drama.onlineDate = releaseDate;
  if (actors.length > 0) {
    drama.actors = actors;
    drama.author = actors[0];
    drama.authorId = actors[0];
  }

  var uuid = uuidOf(html);
  if (uuid !== '') {
    try {
      host.cacheSet('uuid:' + slug, uuid, 1800000);
    } catch (_) {}
  }

  return {
    drama: drama,
    chapters: [
      {
        id: host.chapterId(slug, slug),
        source: host.source,
        title: '正片',
        currentEpisode: 1,
        pageUrl: SITE + '/cn/' + slug,
      },
    ],
  };
}

// ---------- 播放 ----------

function slugFromTask(task) {
  var chapter = task && task.chapter ? task.chapter : {};
  var raw = String(chapter.id || (task && task.dramaId) || (task && task.sourceId) || '');
  var prefix = host.source + ':';
  if (raw.indexOf(prefix) === 0) raw = raw.slice(prefix.length);
  return raw.split(':')[0].trim().toLowerCase();
}

function resolveMedia(task) {
  var slug = slugFromTask(task);
  if (slug === '') throw new Error(SITE_NAME + ' 缺少视频 ID，请刷新详情');

  var uuid = '';
  try {
    var cached = host.cacheGet('uuid:' + slug);
    if (cached) uuid = String(cached);
  } catch (_) {}
  if (uuid === '') {
    var html = fetchPage('/cn/' + slug);
    uuid = uuidOf(html);
  }
  if (uuid === '') throw new Error(SITE_NAME + ' 未解析到播放标识，请重新打开详情');

  var pageUrl = SITE + '/cn/' + slug;
  var address = 'https://' + MEDIA_CDN + '/' + uuid + '/playlist.m3u8';
  return {
    url: address,
    referer: pageUrl,
    quality: 0,
    credentials: {
      origin: SITE,
      referer: pageUrl,
      userAgent: UA,
    },
  };
}

module.exports = {
  categories: categories,
  validCategory: validCategory,
  catalogPage: catalogPage,
  search: search,
  detail: detail,
  resolveMedia: resolveMedia,
};
