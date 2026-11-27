// 小欧视频（xiaoou.tv）—— Next.js 站，页面本身是 CSR，数据全在 POST JSON 接口里。
//
// 接口（2026-11-28 用真实 Chrome 抓包确认）：
//   列表/搜索  POST /api/parse/x_video_get2   {api, params:{locale,page,limit,query:{filter:{group|title|actor}}}}
//   详情       POST /api/parse/x_getdetail3   {api, params:{objectId, group}}
//   CDN 配置   POST /api/user/globalConfig    -> data.config[] = [{ip, type:'video'|'image'}]
//
// 播放地址由前端拼出来（服务端只给 fileName）：
//   base64("f=video/{group}/{id}/{id}.m3u8&s={cdnHost}&u=&c=&g=")
//   -> https://{cdnHost}/h/{base64}/f.m3u8
// 主域名 vod.xiaoou.io（与站点同域，渲染页里实际用的就是它）；config 里的
// jqpz7197/lujn9791 是备用 CDN，偶发 520。
//
// 站点自带的搜索是坏的（前端根本没把关键词传给接口，标题显示 "undefined 搜索结果"），
// 但接口的 filter 支持 title / actor 子串匹配，所以 search() 自己查两路再合并。

const SITE = 'https://xiaoou.tv';
const SITE_NAME = '小欧视频';
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Safari/537.36';
const PAGE_SIZE = 96;
const MAIN_CDN = 'vod.xiaoou.io';
const DEFAULT_IMAGE_HOST = 'img.jqpz7197.xyz';

// 站点首页 videoGroups 里的真实分组
const CATEGORIES = [
  { id: 'group13', name: '国产剧情' },
  { id: 'ooxxtube', name: '大神自拍' },
  { id: 'group10', name: '日本AV' },
  { id: 'group14', name: '欧美精品' },
  { id: 'group12', name: '港韩三级' },
];

function categories() {
  var out = [];
  for (var i = 0; i < CATEGORIES.length; i++) {
    out.push({ id: CATEGORIES[i].id, name: CATEGORIES[i].name });
  }
  return out;
}

function validCategory(category) {
  var id = String(category || '');
  if (id === '') return true;
  for (var i = 0; i < CATEGORIES.length; i++) {
    if (CATEGORIES[i].id === id) return true;
  }
  return false;
}

function categoryName(group) {
  for (var i = 0; i < CATEGORIES.length; i++) {
    if (CATEGORIES[i].id === group) return CATEGORIES[i].name;
  }
  return '视频';
}

// ---------- 接口 ----------

function requestJSON(path, payload) {
  var response;
  try {
    response = host.fetch({
      method: 'POST',
      url: SITE + path,
      headers: {
        Accept: 'application/json, text/plain, */*',
        'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
        'Content-Type': 'application/json',
        Origin: SITE,
        Referer: SITE + '/',
        'User-Agent': UA,
      },
      body: JSON.stringify(payload),
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
  var payloadData = null;
  try {
    payloadData = JSON.parse(String(response.body || '{}'));
  } catch (_) {
    payloadData = null;
  }
  if (!payloadData) {
    var broken = new Error(SITE_NAME + ' 返回了无法解析的数据（HTTP ' + status + '）');
    broken.retryable = status >= 500 || status === 0;
    throw broken;
  }
  if (payloadData.ok === false) {
    var reason = payloadData.error ? String(payloadData.error) : 'HTTP ' + status;
    var rejected = new Error(SITE_NAME + ' 接口拒绝：' + reason);
    rejected.retryable = status >= 500 || status === 429;
    throw rejected;
  }
  return payloadData.data;
}

function api(name, params) {
  return requestJSON('/api/parse/' + name, { api: name, params: params || {} });
}

// ---------- CDN / 图片域名 ----------

function globalConfig() {
  try {
    var cached = host.cacheGet('cdn');
    if (cached) return JSON.parse(String(cached));
  } catch (_) {}
  var result = { video: [], image: [] };
  try {
    var data = requestJSON('/api/user/globalConfig', {});
    var list = data && data.config ? data.config : [];
    for (var i = 0; i < list.length; i++) {
      var item = list[i] || {};
      var ip = String(item.ip || '').trim();
      if (ip === '') continue;
      if (item.type === 'video') result.video.push(ip);
      else if (item.type === 'image') result.image.push(ip);
    }
    host.cacheSet('cdn', JSON.stringify(result), 900000);
  } catch (_) {}
  return result;
}

function imageHost() {
  var config = globalConfig();
  if (config.image.length > 0) return config.image[0];
  return DEFAULT_IMAGE_HOST;
}

function videoHosts() {
  var hosts = [MAIN_CDN];
  var config = globalConfig();
  for (var i = 0; i < config.video.length; i++) {
    var host0 = config.video[i];
    if (hosts.indexOf(host0) < 0) hosts.push(host0);
  }
  return hosts;
}

// imageFile 是 video/groupXX/... ，图片站放在 image/ 前缀下（video/ 会 403）。
function coverURL(raw) {
  var value = String(raw || '').trim();
  if (value === '') return '';
  if (/^https?:\/\//i.test(value)) return value;
  value = value.replace(/^video\//, 'image/');
  return 'https://' + imageHost() + '/' + value;
}

// ---------- 字段映射 ----------

function dateOf(value) {
  var text = String(value || '');
  var matched = /^(\d{4}-\d{2}-\d{2})/.exec(text);
  return matched ? matched[1] : '';
}

function durationOf(value) {
  // 站点给 "00:16:13"，去掉开头的 00: 更接近界面习惯（不足一小时时）
  var text = String(value || '').trim();
  var matched = /^(\d{1,2}):(\d{2}):(\d{2})$/.exec(text);
  if (!matched) return text;
  if (matched[1] === '00') return matched[2] + ':' + matched[3];
  return matched[1] + ':' + matched[2] + ':' + matched[3];
}

function stringList(value) {
  var out = [];
  if (!value) return out;
  if (Object.prototype.toString.call(value) === '[object Array]') {
    for (var i = 0; i < value.length; i++) {
      var item = String(value[i] || '').trim();
      if (item !== '') out.push(item);
    }
  } else {
    var single = String(value || '').trim();
    if (single !== '') out.push(single);
  }
  return out;
}

function dramaOf(video) {
  var group = String(video.group || '');
  var objectId = String(video.objectId || '');
  var tags = stringList(video.tag);
  var actors = stringList(video.actor);
  var author = actors.length > 0 ? actors[0] : String(video.uName || '');
  var drama = {
    id: host.dramaId(group + '/' + objectId),
    source: host.source,
    sourceId: group + '/' + objectId,
    title: String(video.title || ''),
    name: String(video.title || ''),
    desc: tags.length > 0 ? tags.join(' / ') : SITE_NAME,
    intro: tags.length > 0 ? tags.join(' / ') : SITE_NAME,
    cover: coverURL(video.imageFile),
    coverUrl: coverURL(video.imageFile),
    channelName: SITE_NAME,
    categoryName: categoryName(group),
    durationText: durationOf(video.length),
    tags: tags,
    totalEpisode: 1,
    episodeCount: 1,
  };
  if (actors.length > 0) {
    drama.actors = actors;
    drama.author = author;
    drama.authorId = author;
  } else if (author !== '') {
    drama.author = author;
  }
  var serial = String(video.sn || '').trim();
  if (serial !== '') drama.serial = serial;
  var online = dateOf(video.createdAt);
  if (online !== '') drama.onlineDate = online;
  var views = String(video.view || '');
  if (views !== '' && views !== '0') drama.views = views;
  return drama;
}

// ---------- 列表 / 搜索 ----------

function listOnce(page, filter) {
  var data = api('x_video_get2', {
    locale: 'zh',
    page: page - 1,
    limit: PAGE_SIZE,
    query: { filter: filter },
  });
  return Object.prototype.toString.call(data) === '[object Array]' ? data : [];
}

function catalogPage(page, category, query) {
  var p = Number(page) || 1;
  if (p < 1) p = 1;
  if (p > 10000) p = 10000;
  var keyword = String(query || '').trim();
  if (keyword !== '') return search(keyword, p);

  var filter = {};
  if (String(category || '') !== '') {
    if (!validCategory(category)) throw new Error(SITE_NAME + ' 不支持分类：' + category);
    filter.group = String(category);
  }
  var rows = listOnce(p, filter);
  var items = [];
  for (var i = 0; i < rows.length; i++) items.push(dramaOf(rows[i]));
  return { items: items, hasMore: rows.length >= PAGE_SIZE };
}

function search(query, page) {
  var keyword = String(query || '').trim();
  if (keyword === '') return { items: [], hasMore: false, warning: '请输入搜索关键词' };
  var p = Number(page) || 1;
  if (p < 1) p = 1;

  // 站点自己的搜索没接上关键词，但接口对 title / actor 都能做子串匹配。
  var filters = [{ title: keyword }, { actor: keyword }];
  var seen = {};
  var items = [];
  var failures = 0;
  for (var i = 0; i < filters.length; i++) {
    try {
      var rows = listOnce(p, filters[i]);
      for (var j = 0; j < rows.length; j++) {
        var drama = dramaOf(rows[j]);
        if (seen[drama.id]) continue;
        seen[drama.id] = true;
        items.push(drama);
      }
    } catch (_) {
      failures++;
    }
  }
  if (failures === filters.length) {
    var error = new Error(SITE_NAME + ' 搜索失败，请稍后重试');
    error.retryable = true;
    throw error;
  }
  return {
    items: items,
    hasMore: items.length >= PAGE_SIZE,
    warning: items.length === 0 ? '没有找到「' + keyword + '」相关内容' : '',
  };
}

// ---------- 详情 ----------

function splitId(sourceId) {
  var raw = String(sourceId || '').trim();
  var parts = raw.split('/');
  if (parts.length < 2) return null;
  var group = parts[0].trim();
  var objectId = parts[1].trim();
  if (!/^[A-Za-z0-9_-]{1,32}$/.test(group) || !/^[A-Za-z0-9_-]{1,48}$/.test(objectId)) return null;
  return { group: group, objectId: objectId };
}

function detail(sourceId) {
  var ids = splitId(sourceId);
  if (!ids) throw new Error(SITE_NAME + ' 视频 ID 无效，请刷新列表');
  var data = api('x_getdetail3', { objectId: ids.objectId, group: ids.group });
  if (!data || !data.objectId) throw new Error(SITE_NAME + ' 详情为空，可能视频已下架');
  var drama = dramaOf(data);
  if (drama.title === '') throw new Error(SITE_NAME + ' 详情缺少标题');
  var sourceIdText = ids.group + '/' + ids.objectId;
  return {
    drama: drama,
    chapters: [
      {
        id: host.chapterId(sourceIdText, sourceIdText),
        source: host.source,
        title: '正片',
        currentEpisode: 1,
        pageUrl: SITE + '/vod/' + ids.group + '/' + ids.objectId,
      },
    ],
  };
}

// ---------- 播放 ----------

function idsFromTask(task) {
  var chapter = task && task.chapter ? task.chapter : {};
  var raw = String(chapter.id || (task && task.dramaId) || (task && task.sourceId) || '');
  var prefix = host.source + ':';
  if (raw.indexOf(prefix) === 0) raw = raw.slice(prefix.length);
  return splitId(raw.split(':')[0]);
}

function streamURL(host0, group, objectId) {
  var plain = 'f=video/' + group + '/' + objectId + '/' + objectId + '.m3u8&s=' + host0 + '&u=&c=&g=';
  return 'https://' + host0 + '/h/' + host.base64Encode(plain) + '/f.m3u8';
}

function usablePlaylist(url) {
  try {
    var probe = host.fetch({
      url: url,
      headers: { Accept: '*/*', Referer: SITE + '/', 'User-Agent': UA },
      anyStatus: true,
      followRedirects: true,
      timeoutMs: 8000,
      limit: 4096,
    });
    if (Number(probe.status) !== 200) return false;
    return String(probe.body || '').indexOf('#EXTM3U') === 0;
  } catch (_) {
    return false;
  }
}

function resolveMedia(task) {
  var ids = idsFromTask(task);
  if (!ids) throw new Error(SITE_NAME + ' 缺少视频 ID，请刷新详情');
  var hosts = videoHosts();
  var fallback = '';
  for (var i = 0; i < hosts.length; i++) {
    var url = streamURL(hosts[i], ids.group, ids.objectId);
    if (fallback === '') fallback = url;
    if (usablePlaylist(url)) {
      return { url: url, referer: SITE + '/', quality: 0 };
    }
  }
  // 所有 CDN 都没探通：把主域名交出去，让播放器自己重试（偶发 520 会自己恢复）。
  return { url: fallback, referer: SITE + '/', quality: 0 };
}

module.exports = {
  categories: categories,
  validCategory: validCategory,
  catalogPage: catalogPage,
  search: search,
  detail: detail,
  resolveMedia: resolveMedia,
};
