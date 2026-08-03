import http from 'node:http';
import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));
const dataDir = path.join(root, 'data');
const publicDir = path.join(root, 'public');
const sourcesPath = path.join(dataDir, 'sources.json');
const videosPath = path.join(dataDir, 'videos.json');
const port = Number(process.env.PORT || 4173);
const biliMixinKeyEncTab = [46, 47, 18, 2, 53, 8, 23, 32, 15, 50, 10, 31, 58, 3, 45, 35, 27, 43, 5, 49, 33, 9, 42, 19, 29, 28, 14, 39, 12, 48, 38, 13, 41, 37, 17, 0, 7, 40, 4, 25, 21, 20, 34, 24, 6, 55, 52, 36, 11, 56, 57, 1, 30, 51, 26, 22, 44, 16, 54, 59];

const readJson = async (file, fallback) => {
  try { return JSON.parse(await readFile(file, 'utf8')); } catch { return fallback; }
};

const toText = (value = '') => value.replace(/<[^>]*>/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
const mediaIdentity = (video) => {
  const youtubeId = video.url?.match(/[?&]v=([^&]+)|youtu\.be\/([^?&/]+)|youtube\.com\/embed\/([^?&/]+)/i);
  return youtubeId ? `youtube:${youtubeId[1] || youtubeId[2] || youtubeId[3]}` : `url:${video.url}`;
};
const absoluteUrl = (candidate, base) => {
  const cleaned = candidate.replaceAll('\\u0026', '&');
  const external = /^(?:www\.)?(?:youtube\.com|youtu\.be)\//i.test(cleaned) ? `https://${cleaned}` : cleaned;
  try { return new URL(external, base).href; } catch { return null; }
};

function extractMedia(html, source) {
  const found = [];
  const add = (url, title = source.product, type = 'Official video') => {
    const href = absoluteUrl(url, source.url);
    if (!href || !/\.(mp4|webm)(\?|$)|youtube\.com\/embed|youtu\.be\//i.test(href)) return;
    if (!found.some((item) => item.url === href)) found.push({
      id: `${source.id}-${found.length}-${Buffer.from(href).toString('base64url').slice(0, 9)}`,
      brand: source.brand, product: source.product, region: source.region,
      type, title: toText(title).slice(0, 110) || source.product,
      url: href, sourceUrl: source.url, publishedAt: new Date().toISOString(),
      thumbnail: source.thumbnail || '', verified: true
    });
  };
  for (const match of html.matchAll(/(?:src|content)=["']([^"']+\.(?:mp4|webm)[^"']*)/gi)) add(match[1]);
  for (const match of html.matchAll(/(?:youtube\.com\/embed\/[^"'\s?]+|youtu\.be\/[^"'\s?]+)/gi)) add(match[0]);
  return found;
}

function extractRss(xml, source) {
  const items = [];
  for (const entry of xml.matchAll(/<entry>([\s\S]*?)<\/entry>/g)) {
    const part = entry[1];
    const title = part.match(/<title>([\s\S]*?)<\/title>/)?.[1] || source.product;
    const id = part.match(/<yt:videoId>([^<]+)<\/yt:videoId>/)?.[1];
    const publishedAt = part.match(/<published>([^<]+)<\/published>/)?.[1] || new Date().toISOString();
    const media = part.match(/<media:thumbnail url="([^"]+)/)?.[1] || '';
    if (id) items.push({ id: `${source.id}-${id}`, brand: source.brand, product: source.product, region: source.region,
      type: 'Official channel video', title: toText(title), url: `https://www.youtube.com/watch?v=${id}`,
      sourceUrl: source.url, thumbnail: media, publishedAt, verified: true });
  }
  return items;
}

async function getBiliMixinKey() {
  const response = await fetch('https://api.bilibili.com/x/web-interface/nav', { headers: { 'user-agent': 'Mozilla/5.0 AI-Glasses-Media-Radar/1.0' }, signal: AbortSignal.timeout(15000) });
  const data = await response.json();
  const img = data.data?.wbi_img?.img_url?.split('/').at(-1)?.split('.')[0];
  const sub = data.data?.wbi_img?.sub_url?.split('/').at(-1)?.split('.')[0];
  if (!img || !sub) throw new Error('Bilibili WBI signing key unavailable');
  return biliMixinKeyEncTab.map((index) => `${img}${sub}`[index]).join('').slice(0, 32);
}

function signBiliParams(params, mixinKey) {
  const sanitized = Object.fromEntries(Object.entries(params).map(([key, value]) => [key, String(value).replace(/[!'()*]/g, '')]));
  const query = new URLSearchParams(Object.entries(sanitized).sort(([a], [b]) => a.localeCompare(b))).toString();
  return `${query}&w_rid=${createHash('md5').update(query + mixinKey).digest('hex')}`;
}

async function collectBilibiliVideos(source, since, mixinKey) {
  const videos = [];
  for (let page = 1; page <= 6; page += 1) {
    const params = { mid: source.bilibili.mid, pn: page, ps: 50, order: 'pubdate', platform: 'web', web_location: 1550101, wts: Math.floor(Date.now() / 1000) };
    const url = `https://api.bilibili.com/x/space/wbi/arc/search?${signBiliParams(params, mixinKey)}`;
    const response = await fetch(url, { headers: { referer: `https://space.bilibili.com/${source.bilibili.mid}`, 'user-agent': 'Mozilla/5.0 AI-Glasses-Media-Radar/1.0' }, signal: AbortSignal.timeout(15000) });
    const data = await response.json();
    if (data.code !== 0) throw new Error(`Bilibili API ${data.code}: ${data.message || 'unknown error'}`);
    const entries = data.data?.list?.vlist || [];
    for (const entry of entries) {
      const publishedAt = new Date(entry.created * 1000).toISOString();
      if (Date.parse(publishedAt) < since) continue;
      const title = toText(entry.title || source.product);
      const keywords = source.bilibili.keywords || [];
      if (keywords.length && !keywords.some((keyword) => `${title} ${entry.description || ''}`.toLowerCase().includes(keyword.toLowerCase()))) continue;
      videos.push({
        id: `${source.id}-bili-${entry.bvid}`, brand: source.brand, product: source.product, region: source.region,
        type: 'Official Bilibili video', title, url: `https://www.bilibili.com/video/${entry.bvid}`,
        sourceUrl: `https://space.bilibili.com/${source.bilibili.mid}`, thumbnail: entry.pic?.replace(/^http:/, 'https:') || '',
        description: toText(entry.description || '').slice(0, 360), publishedAt, verified: true
      });
    }
    const oldest = entries.at(-1)?.created;
    if (!data.data?.page?.pn || !entries.length || (oldest && oldest * 1000 < since)) break;
  }
  return videos;
}

async function youtubeRequest(params, apiKey) {
  const url = new URL('https://www.googleapis.com/youtube/v3/' + params.resource);
  Object.entries(params).forEach(([key, value]) => {
    if (key !== 'resource' && value !== undefined && value !== null) url.searchParams.set(key, value);
  });
  url.searchParams.set('key', apiKey);
  const response = await fetch(url, { signal: AbortSignal.timeout(15000) });
  if (!response.ok) throw new Error(`YouTube API HTTP ${response.status}: ${(await response.text()).slice(0, 180)}`);
  return response.json();
}

function youtubeMatchesSource(item, source) {
  const keywords = source.youtube?.keywords || [];
  if (!keywords.length) return true;
  const text = `${item.snippet?.title || ''} ${item.snippet?.description || ''}`.toLowerCase();
  return keywords.some((keyword) => text.includes(keyword.toLowerCase()));
}

async function collectYoutubeVideos(source, apiKey, since) {
  if (!source.youtube?.handle) return [];
  const channelData = await youtubeRequest({ resource: 'channels', part: 'contentDetails', forHandle: source.youtube.handle }, apiKey);
  const uploads = channelData.items?.[0]?.contentDetails?.relatedPlaylists?.uploads;
  if (!uploads) throw new Error(`Official channel not found: ${source.youtube.handle}`);

  const videos = [];
  let pageToken;
  for (let page = 0; page < 6; page += 1) {
    const feed = await youtubeRequest({ resource: 'playlistItems', part: 'snippet,contentDetails', playlistId: uploads, maxResults: 50, pageToken }, apiKey);
    const entries = feed.items || [];
    for (const item of entries) {
      const publishedAt = item.contentDetails?.videoPublishedAt || item.snippet?.publishedAt;
      if (!publishedAt || Date.parse(publishedAt) < since) continue;
      if (!item.contentDetails?.videoId || !youtubeMatchesSource(item, source)) continue;
      const videoId = item.contentDetails.videoId;
      const thumbnail = item.snippet?.thumbnails?.maxres?.url || item.snippet?.thumbnails?.high?.url || item.snippet?.thumbnails?.medium?.url || '';
      videos.push({
        id: `${source.id}-yt-${videoId}`, brand: source.brand, product: source.product, region: source.region,
        type: 'Official YouTube video', title: toText(item.snippet?.title || source.product),
        url: `https://www.youtube.com/watch?v=${videoId}`, sourceUrl: `https://www.youtube.com/${source.youtube.handle}`,
        thumbnail, description: toText(item.snippet?.description || '').slice(0, 360), publishedAt, verified: true
      });
    }
    const oldest = entries.at(-1)?.contentDetails?.videoPublishedAt || entries.at(-1)?.snippet?.publishedAt;
    if (!feed.nextPageToken || (oldest && Date.parse(oldest) < since)) break;
    pageToken = feed.nextPageToken;
  }
  return videos;
}

async function refresh() {
  const sources = await readJson(sourcesPath, []);
  const existing = await readJson(videosPath, { videos: [] });
  const collected = [];
  for (const source of sources.filter((item) => item.enabled !== false && item.kind !== 'bilibili')) {
    try {
      const response = await fetch(source.url, { headers: { 'user-agent': 'AI-Glasses-Media-Radar/1.0' }, signal: AbortSignal.timeout(12000) });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const body = await response.text();
      collected.push(...(source.kind === 'youtube-rss' ? extractRss(body, source) : extractMedia(body, source)));
    } catch (error) {
      console.warn(`Source unavailable: ${source.brand}/${source.product}`, error.message);
    }
  }
  const apiKey = process.env.YOUTUBE_API_KEY;
  const since = Date.now() - 365 * 24 * 60 * 60 * 1000;
  if (apiKey) {
    for (const source of sources.filter((item) => item.enabled !== false && item.youtube?.handle)) {
      try { collected.push(...await collectYoutubeVideos(source, apiKey, since)); }
      catch (error) { console.warn(`YouTube unavailable: ${source.brand}/${source.product}`, error.message); }
    }
  } else if (sources.some((source) => source.youtube?.handle)) {
    console.warn('YOUTUBE_API_KEY is not set; skipped YouTube API collection.');
  }
  const biliSources = sources.filter((source) => source.enabled !== false && source.bilibili?.mid);
  if (biliSources.length) {
    try {
      const mixinKey = await getBiliMixinKey();
      for (const source of biliSources) {
        try { collected.push(...await collectBilibiliVideos(source, since, mixinKey)); }
        catch (error) { console.warn(`Bilibili unavailable: ${source.brand}/${source.product}`, error.message); }
      }
    } catch (error) { console.warn('Bilibili WBI signing unavailable:', error.message); }
  }
  const fixed = sources.flatMap((source) => (source.featured || []).map((video, index) => ({
    id: `${source.id}-featured-${index}`, brand: source.brand, product: source.product, region: source.region,
    type: video.type || 'Official launch video', title: video.title, url: video.url, sourceUrl: source.url,
    thumbnail: video.thumbnail || source.thumbnail || '', publishedAt: video.publishedAt || source.updatedAt || new Date().toISOString(), verified: true
  })));
  // Keep the same official URL when it is intentionally tracked for two products
  // (for example, a shared RayNeo launch page covering both V3 and X series).
  const refreshedUrls = new Set(sources.map((source) => source.url));
  const staleSafe = existing.videos.filter((video) => !refreshedUrls.has(video.sourceUrl) && !sources.some((source) => video.id.startsWith(`${source.id}-yt-`) || video.id.startsWith(`${source.id}-bili-`)));
  // Multiple products can subscribe to the same official channel. Keep one card
  // for a shared video, using the earliest configured product as its attribution.
  const byId = new Map([...staleSafe, ...collected, ...fixed].map((video) => [mediaIdentity(video), video]));
  const videos = [...byId.values()].sort((a, b) => Date.parse(b.publishedAt) - Date.parse(a.publishedAt)).slice(0, 250);
  await mkdir(dataDir, { recursive: true });
  await writeFile(videosPath, JSON.stringify({ updatedAt: new Date().toISOString(), videos }, null, 2));
  return { updatedAt: new Date().toISOString(), count: videos.length, collected: collected.length };
}

function nextDailyDelay() {
  const now = new Date(); const target = new Date();
  target.setHours(8, 30, 0, 0);
  if (target <= now) target.setDate(target.getDate() + 1);
  return target - now;
}
function scheduleRefresh() {
  setTimeout(async function tick() { await refresh(); setTimeout(tick, 24 * 60 * 60 * 1000); }, nextDailyDelay());
}

const mime = { '.html': 'text/html; charset=utf-8', '.js': 'application/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8' };
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  if (url.pathname === '/api/videos') {
    const data = await readJson(videosPath, { updatedAt: null, videos: [] });
    res.writeHead(200, { 'content-type': mime['.json'], 'cache-control': 'no-store' }); return res.end(JSON.stringify(data));
  }
  if (url.pathname === '/api/refresh' && req.method === 'POST') {
    const result = await refresh(); res.writeHead(200, { 'content-type': mime['.json'] }); return res.end(JSON.stringify(result));
  }
  const requested = url.pathname === '/' ? '/index.html' : url.pathname;
  const file = path.normalize(path.join(publicDir, requested));
  if (!file.startsWith(publicDir) || !existsSync(file)) { res.writeHead(404); return res.end('Not found'); }
  res.writeHead(200, { 'content-type': mime[path.extname(file)] || 'application/octet-stream' });
  res.end(await readFile(file));
});

if (process.argv.includes('--refresh')) { refresh().then((r) => console.log(JSON.stringify(r))); }
else { server.listen(port, async () => { console.log(`Media Radar → http://localhost:${port}`); if (!existsSync(videosPath)) await refresh(); scheduleRefresh(); }); }
