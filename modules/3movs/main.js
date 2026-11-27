// 3Movs（www.3movs.com）—— PHP 服务端渲染站，列表/详情都是完整 HTML。
//
// 接口不用猜，直接解析页面：
//   列表   /latest-updates/{page}/   /most-viewed/   /top-rated/   /longest/
//   搜索   /search_videos/?q=关键词（搜索框 action 就是这个）
//   详情   /videos/{id}/{slug}/（slug 写错会 301 到正确地址）
//   播放   flashvars.video_url 里是带签名的 mp4，请求会 302 到 mjedge CDN，
//          实测 200 / video/mp4 / 337MB 完整片，不带额外 cookie。

const SITE = 'https://www.3movs.com';
const SITE_NAME = '3Movs';
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Safari/537.36';

const CATEGORIES = [
  { id: 'latest', name: '最新更新', path: '/latest-updates/' },
  { id: 'popular', name: '最多观看', path: '/most-viewed/' },
  { id: 'top', name: '最高评分', path: '/top-rated/' },
  { id: 'longest', name: '最长视频', path: '/longest/' },
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
        'Accept-Language': 'en-US,en;q=0.9',
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
  var marker = 'class="item thumb';
  var from = 0;
  while (true) {
    var start = html.indexOf(marker, from);
    if (start < 0) break;
    var next = html.indexOf(marker, start + marker.length);
    var chunk = html.slice(start, next < 0 ? Math.min(html.length, start + 6000) : next);
    from = start + marker.length;

    var link = /href="https?:\/\/www\.3movs\.com\/videos\/(\d+)\/([^"\/]+)\/?"/i.exec(chunk);
    if (!link) continue;
    var videoId = link[1];
    var slug = link[2];
    if (seen[videoId]) continue;
    seen[videoId] = true;

    var image = (chunk.match(/<img\b[^>]*>/i) || [''])[0];
    var cover = '';
    if (image) {
      cover = attr(image, 'data-src');
      if (cover === '') cover = attr(image, 'data-webp');
      if (cover === '') cover = attr(image, 'src');
    }
    if (/^data:/i.test(cover)) cover = '';

    var title = '';
    var titleTag = /<a\b[^>]*class="title"[^>]*>([\s\S]*?)<\/a>/i.exec(chunk);
    if (titleTag) title = clean(titleTag[1]);
    if (title === '' && image) title = clean(attr(image, 'alt'));
    if (title === '') {
      var linkTag = (chunk.match(/<a\b[^>]*class="wrap_image"[^>]*>/i) || [''])[0];
      if (linkTag) title = clean(attr(linkTag, 'title'));
    }
    if (title === '') continue;

    var duration = '';
    var clock = /<div class="time">\s*([0-9]{1,3}:[0-9]{2}(?::[0-9]{2})?)\s*<\/div>/i.exec(chunk);
    if (clock) duration = clock[1];

    var sourceId = videoId + '/' + slug;
    var drama = {
      id: host.dramaId(sourceId),
      source: host.source,
      sourceId: sourceId,
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
    items.push(drama);
  }
  return items;
}

function pagePath(path, page) {
  if (page <= 1) return path;
  return path.replace(/\/$/, '/') + page + '/';
}

function listPage(page, category, keyword) {
  var p = Number(page) || 1;
  if (p < 1) p = 1;
  if (p > 5000) p = 5000;
  var word = String(keyword || '').trim();
  var path = '/latest-updates/';
  if (word !== '') {
    path = '/search_videos/?q=' + encodeURIComponent(word) + (p > 1 ? '&page=' + p : '');
  } else if (String(category || '') !== '') {
    if (!validCategory(category)) throw new Error(SITE_NAME + ' 不支持分类：' + category);
    for (var i = 0; i < CATEGORIES.length; i++) if (CATEGORIES[i].id === category) path = CATEGORIES[i].path;
    path = pagePath(path, p);
  } else {
    path = pagePath(path, p);
  }
  var html = fetchPage(path);
  var items = parseCards(html);
  var hasMore = items.length >= 20;
  return { items: items, hasMore: hasMore };
}

function catalogPage(page, category, query) {
  return listPage(page, category, query);
}

// 宿主调用的是 search(page, query)
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

// flashvars 是单引号包裹的 JS 字面量；值里会出现 \' 这种转义（如 Yui Oonuki\'s），
// 必须跳过转义字符，否则标题会在第一个 \' 处被砍断。
function flashValue(html, key) {
  var marker = key + ':';
  var index = html.indexOf(marker);
  if (index < 0) return '';
  var quoteStart = html.indexOf("'", index + marker.length);
  if (quoteStart < 0) return '';
  // 冒号和引号之间只允许空白，避免把后面别的字段当成本字段
  var between = html.slice(index + marker.length, quoteStart);
  if (/\S/.test(between)) return '';
  var out = '';
  for (var i = quoteStart + 1; i < html.length; i++) {
    var ch = html.charAt(i);
    if (ch === '\\') {
      out += html.charAt(i + 1);
      i++;
      continue;
    }
    if (ch === "'") break;
    out += ch;
  }
  return out;
}

function splitList(value) {
  var out = [];
  var pieces = String(value || '').split(',');
  for (var i = 0; i < pieces.length; i++) {
    var item = clean(pieces[i]);
    if (item !== '' && out.indexOf(item) < 0) out.push(item);
  }
  return out;
}

function sourceIdOf(sourceId) {
  var raw = String(sourceId || '').trim();
  var matched = /^(\d{1,12})\/([A-Za-z0-9._-]{1,120})$/.exec(raw);
  if (!matched) return null;
  return { id: matched[1], slug: matched[2], key: matched[1] + '/' + matched[2] };
}

function detail(sourceId) {
  var ids = sourceIdOf(sourceId);
  if (!ids) throw new Error(SITE_NAME + ' 视频 ID 无效');
  var pageUrl = SITE + '/videos/' + ids.key + '/';
  var html = fetchPage('/videos/' + ids.key + '/');

  var title = flashValue(html, 'video_title');
  if (title === '') title = metaOf(html, 'og:title');
  if (title === '') {
    var documentTitle = /<title>([\s\S]*?)<\/title>/i.exec(html);
    title = clean(documentTitle ? documentTitle[1] : '').replace(/\s*-\s*Porn Movies\s*-\s*3Movs\s*$/i, '');
  }
  if (title === '') throw new Error(SITE_NAME + ' 详情缺少标题');

  var cover = metaOf(html, 'og:image');
  if (cover === '') cover = 'https://img.3movs.com/contents/videos_screenshots/' + Math.floor(Number(ids.id) / 1000) * 1000 + '/' + ids.id + '/preview.jpg';

  var categoriesText = flashValue(html, 'video_categories');
  var tagsText = flashValue(html, 'video_tags');
  var modelsText = flashValue(html, 'video_models');
  var tags = [];
  var pushTags = function (list) {
    for (var t = 0; t < list.length; t++) if (tags.indexOf(list[t]) < 0) tags.push(list[t]);
  };
  pushTags(splitList(categoriesText));
  pushTags(splitList(tagsText));
  var actors = splitList(modelsText);

  var drama = {
    id: host.dramaId(ids.key),
    source: host.source,
    sourceId: ids.key,
    title: title,
    name: title,
    desc: tags.length > 0 ? tags.join(' / ') : SITE_NAME,
    intro: tags.length > 0 ? tags.join(' / ') : SITE_NAME,
    cover: cover,
    coverUrl: cover,
    channelName: SITE_NAME,
    // 分类名必须固定：App 会按 categoryName 聚合出「分类」，
    // 之前把每个视频的第一个标签当分类，看一个视频就多出一个分类（用户实测）。
    categoryName: '视频',
    tags: tags,
    totalEpisode: 1,
    episodeCount: 1,
  };
  if (actors.length > 0) {
    drama.actors = actors;
    drama.author = actors[0];
    drama.authorId = actors[0];
  }

  var stream = flashValue(html, 'video_url');
  if (stream !== '') {
    try {
      host.cacheSet('stream:' + ids.key, stream, 600000);
    } catch (_) {}
  }

  return {
    drama: drama,
    chapters: [
      {
        id: host.chapterId(ids.key, ids.key),
        source: host.source,
        title: '正片',
        currentEpisode: 1,
        pageUrl: pageUrl,
      },
    ],
  };
}

// ---------- 播放 ----------

function keyFromTask(task) {
  var chapter = task && task.chapter ? task.chapter : {};
  var raw = String(chapter.id || (task && task.dramaId) || (task && task.sourceId) || '');
  var prefix = host.source + ':';
  if (raw.indexOf(prefix) === 0) raw = raw.slice(prefix.length);
  return raw.split(':')[0].trim();
}

function resolveMedia(task) {
  var key = keyFromTask(task);
  var ids = sourceIdOf(key);
  if (!ids) throw new Error(SITE_NAME + ' 缺少视频 ID，请刷新详情');

  var stream = '';
  try {
    var cached = host.cacheGet('stream:' + ids.key);
    if (cached) stream = String(cached);
  } catch (_) {}

  if (stream === '') {
    var html = fetchPage('/videos/' + ids.key + '/');
    stream = flashValue(html, 'video_url');
    if (stream !== '') {
      try {
        host.cacheSet('stream:' + ids.key, stream, 600000);
      } catch (_) {}
    }
  }
  if (stream === '') throw new Error(SITE_NAME + ' 未解析到播放地址（可能已下架）');

  return {
    url: stream,
    referer: SITE + '/',
    quality: 0,
    credentials: {
      origin: SITE,
      referer: SITE + '/',
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
