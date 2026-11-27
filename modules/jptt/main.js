// 禁片天堂（jptt.tv）—— 服务端渲染站，卡片用 data-href 做跳转（onclick="goto(this)" 读它）。
//
//   列表   /cn
//   搜索   /cn/search?kw=关键词（首页搜索框 name="kw"）
//   详情   /cn/video/{番号}
//   播放   详情页里 data-src="//cdn-xxx.jptt1.cc/hlsredirect/{签名}/{过期}/hls/opt/.../index.m3u8"
//          实测 200 且是完整 VOD 播放列表（442KB），分片带同一段签名，不需额外 cookie。

const SITE = 'https://jptt.tv';
const SITE_NAME = '禁片天堂';
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Safari/537.36';

const CATEGORIES = [
  { id: 'latest', name: '最新更新', path: '/cn' },
  { id: 'today', name: '今日人气', path: '/cn/list?sort=3' },
  { id: 'week', name: '本周人气', path: '/cn/list?sort=4' },
  { id: 'month', name: '本月人气', path: '/cn/list?sort=5' },
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
  if (/^\/\//.test(value)) return 'https:' + value;
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

function parseCards(html) {
  var items = [];
  var seen = {};
  var pattern = /data-href="https?:\/\/jptt\.tv\/cn\/video\/([A-Za-z0-9_-]{2,60})[^"]*"/gi;
  var matched = pattern.exec(html);
  while (matched) {
    var slug = matched[1];
    if (!seen[slug]) {
      seen[slug] = true;
      var chunk = html.slice(matched.index, Math.min(html.length, matched.index + 1800));
      var image = (chunk.match(/<img\b[^>]*>/i) || [''])[0];
      var cover = image ? absolute(attr(image, 'src')) : '';
      var title = image ? clean(attr(image, 'alt')) : '';
      if (title === '') title = slug.replace(/-/g, ' ');
      var duration = '';
      var clock = /<p class="p_duration">\s*([0-9]{1,3}:[0-9]{2}(?::[0-9]{2})?)\s*<\/p>/i.exec(chunk);
      if (clock) duration = clock[1];

      var serial = '';
      var serialMatched = /^([A-Za-z]{2,8}-[0-9]{2,6})/.exec(slug);
      if (serialMatched) serial = serialMatched[1].toUpperCase();

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
      if (serial !== '') drama.serial = serial;
      items.push(drama);
    }
    matched = pattern.exec(html);
  }
  return items;
}

function listPage(page, keyword, category) {
  var p = Number(page) || 1;
  if (p < 1) p = 1;
  if (p > 5000) p = 5000;
  var word = String(keyword || '').trim();
  var base = '/cn';
  for (var i = 0; i < CATEGORIES.length; i++) {
    if (CATEGORIES[i].id === String(category || '')) base = CATEGORIES[i].path;
  }
  var separator = base.indexOf('?') >= 0 ? '&' : '?';
  var path = word !== ''
    ? '/cn/search?kw=' + encodeURIComponent(word) + (p > 1 ? '&page=' + p : '')
    : base + (p > 1 ? separator + 'page=' + p : '');
  var html = fetchPage(path);
  var items = parseCards(html);
  return { items: items, hasMore: items.length >= 20 };
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
  var matched = /data-src="(\/\/[^"]*index\.m3u8[^"]*)"/i.exec(html);
  if (matched) return absolute(matched[1]);
  var any = /(https?:)?\/\/[^"'\s<>]+\.m3u8[^"'\s<>]*/i.exec(html);
  return any ? absolute(any[0]) : '';
}

function detail(sourceId) {
  var slug = String(sourceId || '').trim();
  if (!/^[A-Za-z0-9_-]{2,60}$/.test(slug)) throw new Error(SITE_NAME + ' 视频 ID 无效');
  // 标签区块（tag_list）只出现在 /video/ 路径的页面；/cn/video/ 是同一页面但没有标签区。
  var pageUrl = SITE + '/video/' + slug;
  var html = fetchPage('/video/' + slug);

  var title = metaOf(html, 'og:title');
  if (title === '') {
    var documentTitle = /<title>([\s\S]*?)<\/title>/i.exec(html);
    title = clean(documentTitle ? documentTitle[1] : '').replace(/\s*\|\s*禁片天堂\s*$/, '');
  }
  if (title === '') throw new Error(SITE_NAME + ' 详情缺少标题');

  var cover = absolute(metaOf(html, 'og:image'));
  var serial = '';
  var serialMatched = /^([A-Za-z]{2,8}-[0-9]{2,6})/.exec(slug);
  if (serialMatched) serial = serialMatched[1].toUpperCase();

  // 铁律 4：先找 JSON-LD——时长（PT2H33M12S）和上传日期全在里面，页面其他地方没有。
  var durationText = '';
  var onlineDate = '';
  var ld = /<script type="application\/ld\+json">\s*(\{[\s\S]*?\})\s*<\/script>/.exec(html);
  if (ld) {
    try {
      var schema = JSON.parse(ld[1]);
      var iso = /PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/.exec(String(schema.duration || ''));
      if (iso) {
        var pad = function (n) { return n < 10 ? '0' + n : String(n); };
        var h = Number(iso[1] || 0), m = Number(iso[2] || 0), sec = Number(iso[3] || 0);
        durationText = h > 0
          ? h + ':' + pad(m) + ':' + pad(sec)
          : m + ':' + pad(sec);
      }
      var uploaded = String(schema.uploadDate || '').match(/\d{4}-\d{2}-\d{2}/);
      if (uploaded) onlineDate = uploaded[0];
    } catch (_) {}
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
    totalEpisode: 1,
    episodeCount: 1,
  };
  if (serial !== '') drama.serial = serial;
  if (durationText !== '') drama.durationText = durationText;
  if (onlineDate !== '') drama.onlineDate = onlineDate;

  // 标签：正文 /tag_list?tid=N 链接（铁律 4 第 2 级：页面信息区）。
  var tags = [];
  var tagSeen = {};
  var tagPattern = /href="\/tag_list\?tid=[0-9]+"[^>]*>([\s\S]{1,30}?)<\/a>/gi;
  var tagMatched = tagPattern.exec(html);
  while (tagMatched) {
    var tag = clean(tagMatched[1]);
    if (tag !== '' && !tagSeen[tag] && tags.length < 12) {
      tagSeen[tag] = true;
      tags.push(tag);
    }
    tagMatched = tagPattern.exec(html);
  }
  drama.tags = tags;

  var actors = [];
  // 兼容 /video/ 与 /cn/video/ 两种页面的演员链接前缀（detail 走 /video/，无 cn）。
  var actorPattern = /href="(?:\/cn)?\/actor\?id=[0-9]+"[^>]*>([\s\S]{1,40}?)<\/a>/gi;
  var actorMatched = actorPattern.exec(html);
  while (actorMatched) {
    var name = clean(actorMatched[1]);
    if (name !== '' && actors.indexOf(name) < 0 && actors.length < 8) actors.push(name);
    actorMatched = actorPattern.exec(html);
  }
  if (actors.length > 0) {
    drama.actors = actors;
    drama.author = actors[0];
    drama.authorId = actors[0];
  }

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
    var html = fetchPage('/cn/video/' + slug);
    stream = streamOf(html);
    if (stream !== '') {
      try {
        host.cacheSet('stream:' + slug, stream, 600000);
      } catch (_) {}
    }
  }
  if (stream === '') throw new Error(SITE_NAME + ' 未解析到播放地址（可能已下架）');

  var pageUrl = SITE + '/cn/video/' + slug;
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
