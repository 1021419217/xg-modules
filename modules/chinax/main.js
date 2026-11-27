// 中国X站（chinaxmovie.com）—— 服务端渲染站，卡片模板与 nJAV 同源（class="thumbnail group"）。
//
//   列表   /?page=N
//   搜索   /vodsearch/?wd=关键词
//   详情   /vodplay/{slug}
//   播放   详情页里直接给 m3u8（多个线路，取第一个即可，实测 200 且是多码率 master）

const SITE = 'https://chinaxmovie.com';
const SITE_NAME = '中国X站';
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Safari/537.36';

const CATEGORIES = [
  { id: 'latest', name: '最新更新', path: '/' },
  { id: 'domestic', name: '国产传媒', path: '/vodtype/domestic-media/' },
  { id: 'japanese', name: '日本AV', path: '/vodtype/japanese-av/' },
  { id: 'uncensored', name: '无码视频', path: '/vodtype/uncensored-video/' },
  { id: 'subtitle', name: '中文字幕', path: '/vodtype/chinese-subtitles/' },
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

function clean(value) {
  return String(value || '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim();
}

function attr(tag, name) {
  // 属性名前面必须紧跟空白或引号，否则 onerror="this.src='占位图'" 里的 src 会被误取。
  var pattern = new RegExp('(?:^|[\\s"\'])(' + name + ')\\s*=\\s*(?:"([^"]*)"|\'([^\']*)\'|([^\\s>]+))', 'i');
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
  return SITE + (value.indexOf('/') === 0 ? value : '/' + value);
}

function fetchPage(path) {
  var response;
  try {
    response = host.fetch({
      url: SITE + path,
      headers: {
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
        'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
        Referer: SITE + '/',
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

function parseCards(html) {
  var items = [];
  var seen = {};
  var marker = 'class="thumbnail group"';
  var from = 0;
  while (true) {
    var start = html.indexOf(marker, from);
    if (start < 0) break;
    var next = html.indexOf(marker, start + marker.length);
    var chunk = html.slice(start, next < 0 ? Math.min(html.length, start + 6000) : next);
    from = start + marker.length;

    var link = /<a\b[^>]*href="\/vodplay\/([^"\/]+)"[^>]*>/i.exec(chunk);
    if (!link) continue;
    var slug = link[1];
    if (seen[slug]) continue;
    seen[slug] = true;

    var image = (chunk.match(/<img\b[^>]*>/i) || [''])[0];
    var cover = '';
    if (image) {
      cover = attr(image, 'src');
      if (!cover || /^data:/i.test(cover)) cover = attr(image, 'data-src');
      if (!cover || /^data:/i.test(cover)) {
        var srcset = attr(image, 'srcset');
        if (srcset) cover = srcset.split(',')[0].trim().split(/\s+/)[0];
      }
    }

    var title = '';
    var label = attr(link[0], 'aria-label');
    if (label) title = clean(label.replace(/^观看视频\s*/, ''));
    if (title === '' && image) title = clean(attr(image, 'alt').replace(/\s*高清在线观看\s*$/, ''));
    if (title === '') continue;

    var duration = '';
    var clock = /absolute\s+bottom-1\s+left-1[^>]*>\s*([0-9]{1,3}:[0-9]{2}(?::[0-9]{2})?)\s*</i.exec(chunk);
    if (clock) duration = clock[1];

    var serial = '';
    var serialMatched = /([A-Za-z]{2,8}-[0-9]{2,6})/.exec(title);
    if (serialMatched) serial = serialMatched[1].toUpperCase();

    var drama = {
      id: host.dramaId(slug),
      source: host.source,
      sourceId: slug,
      title: title,
      name: title,
      cover: absolute(cover),
      coverUrl: absolute(cover),
      channelName: SITE_NAME,
      categoryName: '视频',
      durationText: duration,
      totalEpisode: 1,
      episodeCount: 1,
    };
    if (serial !== '') drama.serial = serial;
    items.push(drama);
  }
  return items;
}

function listPage(page, keyword, category) {
  var p = Number(page) || 1;
  if (p < 1) p = 1;
  if (p > 5000) p = 5000;
  var word = String(keyword || '').trim();
  var base = '/';
  for (var i = 0; i < CATEGORIES.length; i++) {
    if (CATEGORIES[i].id === String(category || '')) base = CATEGORIES[i].path;
  }
  var path = word !== '' ? '/vodsearch/?wd=' + encodeURIComponent(word) : (p > 1 ? base + '?page=' + p : base);
  var html = fetchPage(path);
  var items = parseCards(html);
  return { items: items, hasMore: items.length >= 16 };
}

function catalogPage(page, category, query) {
  if (String(category || '') !== '' && !validCategory(category)) {
    throw new Error(SITE_NAME + ' 不支持分类：' + category);
  }
  return listPage(page, query, category);
}

// 宿主调用的是 search(page, query)
function search(page, query) {
  var word = String(query || '').trim();
  if (word === '') return { items: [], hasMore: false, warning: '请输入搜索关键词' };
  var result = listPage(page, word);
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

function streamOf(html) {
  // 正片地址在苹果CMS播放器变量 player_aaaa 的 url 字段里。
  // 页面上其他 m3u8 全是侧栏"猜你喜欢"卡片悬浮预览（data-src），
  // 全页第一个 m3u8 就是第一张推荐卡的预览——曾导致所有视频都播同一个。
  var boxed = /var\s+player_aaaa\s*=\s*(\{[\s\S]*?\})\s*<\/script>/.exec(html);
  if (boxed) {
    try {
      var data = JSON.parse(boxed[1]);
      var url = String(data.url || '').trim();
      if (/^https?:\/\/[^"'\s<>]+\.m3u8/i.test(url)) return url;
    } catch (_) {}
  }
  // 兜底：极少数页面没有 player_aaaa 时退回旧逻辑（有误抓预览的风险）。
  var matched = /(https?:\/\/[^"'\s<>]+\.m3u8[^"'\s<>]*)/i.exec(html);
  return matched ? matched[1] : '';
}

function detail(sourceId) {
  var slug = String(sourceId || '').trim();
  if (!/^[A-Za-z0-9_-]{1,80}$/.test(slug)) throw new Error(SITE_NAME + ' 视频 ID 无效');
  var pageUrl = SITE + '/vodplay/' + slug;
  var html = fetchPage('/vodplay/' + slug);

  var title = metaOf(html, 'og:title');
  if (title === '') {
    var documentTitle = /<title>([\s\S]*?)<\/title>/i.exec(html);
    title = clean(documentTitle ? documentTitle[1] : '').replace(/\s*\|\s*中国X站\s*$/, '').replace(/\s*高清在线播放\s*$/, '');
  }
  if (title === '') throw new Error(SITE_NAME + ' 详情缺少标题');

  var cover = absolute(metaOf(html, 'og:image'));

  var serial = '';
  var serialMatched = /([A-Za-z]{2,8}-[0-9]{2,6})/.exec(slug + ' ' + title);
  if (serialMatched) serial = serialMatched[1].toUpperCase();

  // JSON-LD VideoObject：uploadDate / genre 可直接用（铁律 4：先找 JSON-LD）。
  // player_aaaa.vod_class 是制作厂牌（麻豆传媒等），比 publisher.name（站点自己）更有意义。
  var onlineDate = '';
  var tags = [];
  var maker = '';
  var ld = /<script type="application\/ld\+json">\s*(\{[\s\S]*?\})\s*<\/script>/.exec(html);
  if (ld) {
    try {
      var schema = JSON.parse(ld[1]);
      var uploaded = String(schema.uploadDate || '').match(/\d{4}-\d{2}-\d{2}/);
      if (uploaded) onlineDate = uploaded[0];
      if (schema.genre) tags = [clean(String(schema.genre))];
    } catch (_) {}
  }
  var vodClass = /"vod_class":"([^"]*)"/.exec(html);
  if (vodClass) maker = clean(vodClass[1].replace(/\\u([0-9a-fA-F]{4})/g, function (_, h) { return String.fromCharCode(parseInt(h, 16)); }));

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
    tags: tags,
    totalEpisode: 1,
    episodeCount: 1,
  };
  if (serial !== '') drama.serial = serial;
  if (onlineDate !== '') drama.onlineDate = onlineDate;
  if (maker !== '') drama.maker = maker;

  var stream = streamOf(html);
  if (stream !== '') {
    try {
      host.cacheSet('stream:' + slug, stream, 600000);
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
        pageUrl: pageUrl,
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
  return raw.split(':')[0].trim();
}

function resolveMedia(task) {
  var slug = slugFromTask(task);
  if (slug === '') throw new Error(SITE_NAME + ' 缺少视频 ID，请刷新详情');

  var stream = '';
  try {
    var cached = host.cacheGet('stream:' + slug);
    if (cached) stream = String(cached);
  } catch (_) {}
  if (stream === '') {
    var html = fetchPage('/vodplay/' + slug);
    stream = streamOf(html);
    if (stream !== '') {
      try {
        host.cacheSet('stream:' + slug, stream, 600000);
      } catch (_) {}
    }
  }
  if (stream === '') throw new Error(SITE_NAME + ' 未解析到播放地址（可能已下架）');

  var pageUrl = SITE + '/vodplay/' + slug;
  return {
    url: stream,
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
