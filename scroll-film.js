// Plays a pre-rendered camera move with the scrollbar: each scroll position shows one frame.

const SMOOTHING = 0.14; // Share of the remaining distance covered per frame.
const LOAD_BATCH = 10;
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

const state = { frames: [], total: 0, width: 1, height: 1, target: 0, position: 0, raf: 0 };

const frameUrl = (index) => `frames/${String(index + 1).padStart(4, '0')}.webp`;

function scrollProgress() {
  const bounds = film.getBoundingClientRect();
  const distance = bounds.height - window.innerHeight;
  return Math.min(1, Math.max(0, -bounds.top / distance));
}

function paint(image, alpha) {
  const scale = Math.max(canvas.width / state.width, canvas.height / state.height);
  const width = state.width * scale;
  const height = state.height * scale;
  context.globalAlpha = alpha;
  context.drawImage(image, (canvas.width - width) / 2, (canvas.height - height) / 2, width, height);
}

// Blends the two loaded frames around the scroll position, so the film stays smooth
// between frames, and also while the frames in between are still downloading.
function drawFilm() {
  let lower = Math.floor(state.position);
  let upper = Math.ceil(state.position);
  while (lower >= 0 && !state.frames[lower]) lower -= 1;
  while (upper < state.total && !state.frames[upper]) upper += 1;

  const before = state.frames[lower];
  const after = state.frames[upper];
  if (!before && !after) return;

  paint(before ?? after, 1);
  if (before && after && upper !== lower) paint(after, (state.position - lower) / (upper - lower));
}

function fitCanvas() {
  const bounds = canvas.getBoundingClientRect();
  const ratio = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = Math.round(bounds.width * ratio);
  canvas.height = Math.round(bounds.height * ratio);
  drawFilm();
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

  drawFilm();
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

// Fetches a coarse pass first, so the whole film works early, then fills the gaps quietly.
async function loadAll() {
  const order = [state.total - 1];
  for (const step of [8, 4, 2, 1]) {
    for (let index = 0; index < state.total; index += step) {
      if (!order.includes(index)) order.push(index);
    }
  }

  const coarse = Math.ceil(state.total / 8);
  let done = 0;
  while (order.length > 0) {
    const batch = order.splice(0, LOAD_BATCH);
    await Promise.all(batch.map(loadFrame));
    done += batch.length;
    if (done >= coarse) loader.hidden = true;
    else loader.textContent = `Loading ${Math.round((done / coarse) * 100)}%`;
    if (!state.raf) drawFilm();
  }
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
