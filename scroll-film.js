// Plays a pre-rendered camera move with the scrollbar: each scroll position shows one frame.

const SMOOTHING = 0.14; // Share of the remaining distance covered per frame.
const LOAD_BATCH = 6;
const FADE = 0.04; // Share of the film each caption takes to fade in or out.
const TRAVEL = 40; // Pixels a caption drifts while it fades.

const film = document.getElementById('film');
const topbar = document.getElementById('topbar');
const canvas = document.getElementById('film-canvas');
const context = canvas.getContext('2d', { alpha: false });
const progressBar = document.getElementById('progress');
const hint = document.getElementById('hint');
const loader = document.getElementById('loader');
const beats = [...document.querySelectorAll('.beat')].map((element) => ({
  element,
  start: Number(element.dataset.start),
  end: Number(element.dataset.end),
}));
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

const state = { frames: [], total: 0, width: 1, height: 1, shown: -1, target: 0, position: 0, raf: 0 };

const frameUrl = (index) => `frames/${String(index + 1).padStart(4, '0')}.webp`;

function scrollProgress() {
  const bounds = film.getBoundingClientRect();
  const distance = bounds.height - window.innerHeight;
  return Math.min(1, Math.max(0, -bounds.top / distance));
}

// Frames still downloading fall back to the closest one already in memory.
function nearestFrame(index) {
  for (let offset = 0; offset < state.total; offset += 1) {
    const before = state.frames[index - offset];
    if (before) return before;
    const after = state.frames[index + offset];
    if (after) return after;
  }
  return null;
}

function drawFrame(index) {
  const image = nearestFrame(index);
  if (!image) return;
  const scale = Math.max(canvas.width / state.width, canvas.height / state.height);
  const width = state.width * scale;
  const height = state.height * scale;
  context.drawImage(image, (canvas.width - width) / 2, (canvas.height - height) / 2, width, height);
  state.shown = index;
}

function fitCanvas() {
  const bounds = canvas.getBoundingClientRect();
  const ratio = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = Math.round(bounds.width * ratio);
  canvas.height = Math.round(bounds.height * ratio);
  state.shown = -1;
  drawFrame(Math.round(state.position));
}

function poseCaptions(progress) {
  beats.forEach(({ element, start, end }) => {
    const fadeIn = start <= 0 ? 1 : Math.min(1, Math.max(0, (progress - start) / FADE));
    const fadeOut = Math.min(1, Math.max(0, (end - progress) / FADE));
    const opacity = Math.min(fadeIn, fadeOut);
    element.style.opacity = opacity.toFixed(3);
    element.style.transform = `translateY(${((1 - fadeIn) * TRAVEL - (1 - fadeOut) * TRAVEL).toFixed(1)}px)`;
  });
  hint.style.opacity = Math.max(0, 1 - progress * 40).toFixed(3);
  progressBar.style.transform = `scaleX(${progress.toFixed(4)})`;
}

function tick() {
  const distance = state.target - state.position;
  state.position += reducedMotion ? distance : distance * SMOOTHING;
  if (Math.abs(distance) < 0.05) state.position = state.target;

  const index = Math.round(state.position);
  if (index !== state.shown) drawFrame(index);
  poseCaptions(state.position / Math.max(1, state.total - 1));

  state.raf = state.position === state.target ? 0 : requestAnimationFrame(tick);
}

function handleScroll() {
  state.target = scrollProgress() * (state.total - 1);
  topbar.classList.toggle('is-solid', film.getBoundingClientRect().bottom <= window.innerHeight);
  if (!state.raf) state.raf = requestAnimationFrame(tick);
}

function loadFrame(index) {
  return new Promise((resolve) => {
    const image = new Image();
    image.onload = () => {
      state.frames[index] = image;
      resolve();
    };
    image.onerror = () => resolve();
    image.src = frameUrl(index);
  });
}

// Fetches a coarse pass first, so the whole film can be scrubbed early, then fills the gaps.
async function loadAll() {
  const order = [];
  for (const step of [16, 8, 4, 2, 1]) {
    for (let index = 0; index < state.total; index += step) {
      if (!order.includes(index)) order.push(index);
    }
  }
  let done = 0;
  while (order.length > 0) {
    const batch = order.splice(0, LOAD_BATCH);
    await Promise.all(batch.map(loadFrame));
    done += batch.length;
    loader.textContent = `Loading ${Math.round((done / state.total) * 100)}%`;
    if (!state.raf) drawFrame(Math.round(state.position));
  }
  loader.hidden = true;
}

async function start() {
  const manifest = await (await fetch('frames/manifest.json')).json();
  state.total = manifest.frames;
  state.width = manifest.width;
  state.height = manifest.height;

  await loadFrame(0);
  fitCanvas();
  loader.hidden = false;
  handleScroll();

  window.addEventListener('scroll', handleScroll, { passive: true });
  window.addEventListener('resize', () => {
    fitCanvas();
    handleScroll();
  });

  await loadAll();
}

start().catch((error) => {
  console.error(error);
  loader.hidden = false;
  loader.textContent = 'The film could not load. Please refresh.';
});
