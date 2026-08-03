import http from 'node:http';
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

const readJson = async (file, fallback) => {
  try { return JSON.parse(await readFile(file, 'utf8')); } catch { return fallback; }
};

const toText = (value = '') => value.replace(/<[^>]*>/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
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
        thumbnail, publishedAt, verified: true
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
  for (const source of sources.filter((item) => item.enabled !== false)) {
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
  const fixed = sources.flatMap((source) => (source.featured || []).map((video, index) => ({
    id: `${source.id}-featured-${index}`, brand: source.brand, product: source.product, region: source.region,
    type: video.type || 'Official launch video', title: video.title, url: video.url, sourceUrl: source.url,
    thumbnail: video.thumbnail || source.thumbnail || '', publishedAt: video.publishedAt || source.updatedAt || new Date().toISOString(), verified: true
  })));
  // Keep the same official URL when it is intentionally tracked for two products
  // (for example, a shared RayNeo launch page covering both V3 and X series).
  const refreshedUrls = new Set(sources.map((source) => source.url));
  const staleSafe = existing.videos.filter((video) => !refreshedUrls.has(video.sourceUrl) && !sources.some((source) => video.id.startsWith(`${source.id}-yt-`)));
  const byId = new Map([...staleSafe, ...collected, ...fixed].map((video) => [video.id, video]));
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
