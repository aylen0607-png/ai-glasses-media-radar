const bookmarkStorageKey = 'ai-glasses-media-radar:starred';
const readStarred = () => {
  try { return new Set(JSON.parse(localStorage.getItem(bookmarkStorageKey) || '[]')); } catch { return new Set(); }
};
const pageSize = 32;
const state = { videos: [], filter: '全部', starred: readStarred(), page: 1, query: '' };
const grid = document.querySelector('#grid');
const filters = document.querySelector('#filters');
const searchInput = document.querySelector('#search');
const searchForm = document.querySelector('#search-form');
const backTop = document.querySelector('#back-top');
const staticHosting = location.hostname.endsWith('github.io');
const formatDate = (value) => new Intl.DateTimeFormat('zh-CN', { month: 'short', day: 'numeric', year: 'numeric' }).format(new Date(value));
const preview = document.querySelector('#preview');
const isPlayable = (url) => /\.(mp4|webm)(\?|$)|youtube\.com\/(?:watch|embed)|youtu\.be\//i.test(url);

function videoIntroduction(video) {
  if (video.description) return `官方内容围绕「${video.title}」展开：${video.description}`;
  return `${video.brand} 发布的官方素材，聚焦 ${video.product} 的产品能力、使用场景或发布信息。`;
}

function marketingTakeaways(video) {
  const text = `${video.title} ${video.description || ''}`.toLowerCase();
  const takeaways = [];
  if (/(camera|capture|photo|video|shoot|record|vlog|live stream)/.test(text)) takeaways.push('用第一视角或真实拍摄成片证明能力；营销物料可优先突出“看见即记录”的即时性。');
  if (/(translate|translation|teleprompter|notes|meeting|assistant|ai | ai\b|smart)/.test(text)) takeaways.push('把 AI 能力嵌入具体任务，而非抽象讲参数；可复用“痛点—操作—结果”的三段式演示。');
  if (/(style|design|fashion|wear|frame|color|lightweight|comfort)/.test(text)) takeaways.push('将穿戴感与外观风格作为产品价值的一部分，用人物出街和近景细节降低“科技设备感”。');
  if (/(launch|introducing|new|unbox|announcement|first look)/.test(text)) takeaways.push('发布期应先建立一个可复述的核心主张，再用功能镜头和场景案例为主张背书。');
  if (!takeaways.length) takeaways.push('标题与封面已经给出明确场景；二次传播可裁切为“单一场景 + 单一收益”的短内容单元。');
  takeaways.push('保留真实使用者、环境和操作步骤，能让抽象的智能体验更具可信度与可模仿性。');
  return [...new Set(takeaways)].slice(0, 2);
}

function toggleStar(videoId) {
  if (state.starred.has(videoId)) state.starred.delete(videoId);
  else state.starred.add(videoId);
  localStorage.setItem(bookmarkStorageKey, JSON.stringify([...state.starred]));
  renderFilters();
  render();
}

function renderPagination(total) {
  const pagination = document.querySelector('#pagination');
  const pageCount = Math.ceil(total / pageSize);
  if (state.page > pageCount) state.page = Math.max(1, pageCount);
  pagination.classList.toggle('hidden', pageCount <= 1);
  if (pageCount <= 1) return;
  const pages = Array.from({ length: pageCount }, (_, index) => index + 1);
  pagination.innerHTML = `<button data-page="${state.page - 1}" ${state.page === 1 ? 'disabled' : ''}>上一页</button>${pages.map((page) => `<button data-page="${page}" class="${page === state.page ? 'active' : ''}" aria-current="${page === state.page ? 'page' : 'false'}">${page}</button>`).join('')}<button data-page="${state.page + 1}" ${state.page === pageCount ? 'disabled' : ''}>下一页</button>`;
  pagination.querySelectorAll('button[data-page]').forEach((button) => button.addEventListener('click', () => {
    state.page = Number(button.dataset.page);
    render();
    document.querySelector('.controls').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }));
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
  let visible = state.filter === '全部' ? state.videos
    : state.filter === '我的星标' ? state.videos.filter((v) => state.starred.has(v.id))
      : state.videos.filter((v) => v.brand === state.filter);
  if (state.query) {
    visible = visible.filter((video) => `${video.brand} ${video.product} ${video.title} ${video.description || ''}`.toLowerCase().includes(state.query));
  }
  const pageCount = Math.ceil(visible.length / pageSize);
  if (state.page > pageCount) state.page = Math.max(1, pageCount);
  const pageVideos = visible.slice((state.page - 1) * pageSize, state.page * pageSize);
  grid.innerHTML = '';
  const empty = document.querySelector('#empty');
  empty.classList.toggle('hidden', visible.length > 0);
  empty.textContent = state.query ? `未找到与「${searchInput.value.trim()}」相关的视频。` : '暂未收集到新素材，请稍后再查看。';
  pageVideos.forEach((video, index) => {
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
    node.querySelector('.video-summary').textContent = videoIntroduction(video);
    const takeaways = node.querySelector('.takeaways');
    marketingTakeaways(video).forEach((item) => { const bullet = document.createElement('li'); bullet.textContent = item; takeaways.append(bullet); });
    const link = node.querySelector('a'); link.href = video.url;
    if (isPlayable(video.url)) {
      article.classList.add('playable');
      link.classList.add('hidden');
      const open = (event) => { event.preventDefault(); previewVideo(video); };
      node.querySelector('.media').addEventListener('click', open);
    } else {
      node.querySelector('.play').textContent = '↗';
    }
    grid.append(node);
  });
  document.querySelector('#total').textContent = state.videos.length;
  document.querySelector('#brands').textContent = new Set(state.videos.map((v) => v.brand)).size;
  renderPagination(visible.length);
}

function renderFilters() {
  const names = ['全部', '我的星标', ...new Set(state.videos.map((v) => v.brand))];
  filters.innerHTML = names.map((name) => {
    const label = name === '我的星标' ? `我的星标 <span>${state.starred.size}</span>` : name;
    return `<button class="${state.filter === name ? 'active' : ''}" data-filter="${name}">${label}</button>`;
  }).join('');
  filters.querySelectorAll('button').forEach((button) => button.addEventListener('click', () => { state.filter = button.dataset.filter; state.page = 1; renderFilters(); render(); }));
}

async function load() {
  const response = await fetch(staticHosting ? './data/videos.json' : '/api/videos'); const data = await response.json();
  state.videos = data.videos || [];
  document.querySelector('#loading').classList.add('hidden'); renderFilters(); render();
}
searchForm.addEventListener('submit', (event) => {
  event.preventDefault();
  state.query = searchInput.value.trim().toLowerCase();
  state.page = 1;
  render();
  document.querySelector('#grid').scrollIntoView({ behavior: 'smooth', block: 'start' });
});
backTop.addEventListener('click', () => window.scrollTo({ top: 0, behavior: 'smooth' }));
window.addEventListener('scroll', () => backTop.classList.toggle('visible', window.scrollY > 500), { passive: true });
load();
