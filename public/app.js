const bookmarkStorageKey = 'ai-glasses-media-radar:starred';
const readStarred = () => {
  try { return new Set(JSON.parse(localStorage.getItem(bookmarkStorageKey) || '[]')); } catch { return new Set(); }
};
const state = { videos: [], filter: '全部', starred: readStarred() };
const grid = document.querySelector('#grid');
const filters = document.querySelector('#filters');
const staticHosting = location.hostname.endsWith('github.io');
const formatDate = (value) => new Intl.DateTimeFormat('zh-CN', { month: 'short', day: 'numeric', year: 'numeric' }).format(new Date(value));
const preview = document.querySelector('#preview');
const isPlayable = (url) => /\.(mp4|webm)(\?|$)|youtube\.com\/(?:watch|embed)|youtu\.be\//i.test(url);

function toggleStar(videoId) {
  if (state.starred.has(videoId)) state.starred.delete(videoId);
  else state.starred.add(videoId);
  localStorage.setItem(bookmarkStorageKey, JSON.stringify([...state.starred]));
  renderFilters();
  render();
}

function previewVideo(video) {
  if (!isPlayable(video.url)) { window.open(video.url, '_blank', 'noopener,noreferrer'); return; }
  const player = document.querySelector('#player');
  const youtube = video.url.match(/(?:youtu\.be\/|youtube\.com\/(?:watch\?v=|embed\/))([^?&/]+)/i)?.[1];
  player.innerHTML = youtube
    ? `<iframe src="https://www.youtube.com/embed/${youtube}?autoplay=1" title="${video.title}" allow="autoplay; encrypted-media; picture-in-picture" allowfullscreen></iframe>`
    : `<video src="${video.url}" controls autoplay playsinline></video>`;
  document.querySelector('#preview-brand').textContent = `${video.brand} · ${video.product}`;
  document.querySelector('#preview-title').textContent = video.title;
  document.querySelector('#preview-source').href = video.sourceUrl || video.url;
  preview.showModal();
}
document.querySelector('#preview .close').addEventListener('click', () => preview.close());
preview.addEventListener('close', () => { document.querySelector('#player').innerHTML = ''; });

function render() {
  const visible = state.filter === '全部' ? state.videos
    : state.filter === '我的星标' ? state.videos.filter((v) => state.starred.has(v.id))
      : state.videos.filter((v) => v.brand === state.filter);
  grid.innerHTML = '';
  document.querySelector('#empty').classList.toggle('hidden', visible.length > 0);
  visible.forEach((video, index) => {
    const node = document.querySelector('#card').content.cloneNode(true);
    const article = node.querySelector('article');
    article.style.setProperty('--i', index);
    const media = node.querySelector('.media');
    const star = node.querySelector('.star');
    const starred = state.starred.has(video.id);
    star.classList.toggle('active', starred);
    star.setAttribute('aria-pressed', String(starred));
    star.setAttribute('aria-label', starred ? '取消星标' : '加入星标');
    star.textContent = starred ? '★' : '☆';
    star.addEventListener('click', (event) => { event.preventDefault(); event.stopPropagation(); toggleStar(video.id); });
    if (video.thumbnail) media.style.backgroundImage = `linear-gradient(180deg,transparent 45%,rgba(5,8,16,.82)),url("${video.thumbnail}")`;
    else media.classList.add(`tone-${index % 5}`);
    node.querySelector('.kind').textContent = video.type.replace('Official ', '').replace(' / ', ' · ');
    node.querySelector('.brand-name').textContent = video.brand;
    node.querySelector('time').textContent = formatDate(video.publishedAt);
    node.querySelector('h2').textContent = video.title;
    node.querySelector('.product').textContent = `${video.product} · ${video.region}`;
    const link = node.querySelector('a'); link.href = video.url;
    if (isPlayable(video.url)) {
      article.classList.add('playable');
      link.textContent = '站内预览';
      link.href = '#preview';
      const open = (event) => { event.preventDefault(); previewVideo(video); };
      node.querySelector('.media').addEventListener('click', open);
      link.addEventListener('click', open);
    } else {
      node.querySelector('.play').textContent = '↗';
    }
    grid.append(node);
  });
  document.querySelector('#total').textContent = state.videos.length;
  document.querySelector('#brands').textContent = new Set(state.videos.map((v) => v.brand)).size;
}

function renderFilters() {
  const names = ['全部', '我的星标', ...new Set(state.videos.map((v) => v.brand))];
  filters.innerHTML = names.map((name) => {
    const label = name === '我的星标' ? `我的星标 <span>${state.starred.size}</span>` : name;
    return `<button class="${state.filter === name ? 'active' : ''}" data-filter="${name}">${label}</button>`;
  }).join('');
  filters.querySelectorAll('button').forEach((button) => button.addEventListener('click', () => { state.filter = button.dataset.filter; renderFilters(); render(); }));
}

async function load() {
  const response = await fetch(staticHosting ? './data/videos.json' : '/api/videos'); const data = await response.json();
  state.videos = data.videos || [];
  document.querySelector('#updated').textContent = data.updatedAt ? `上次同步：${new Date(data.updatedAt).toLocaleString('zh-CN', { hour12: false })}` : '等待首次同步';
  document.querySelector('#loading').classList.add('hidden'); renderFilters(); render();
}
document.querySelector('#refresh').addEventListener('click', async (event) => {
  const button = event.currentTarget; button.disabled = true; button.innerHTML = '扫描中…';
  try {
    if (staticHosting) { button.innerHTML = '每天 08:30 自动更新'; return; }
    await fetch('/api/refresh', { method: 'POST' }); await load();
  } finally { button.disabled = false; button.innerHTML = '立即扫描 <span>↗</span>'; }
});
load();
