// Plays one camera move with the scrollbar. The whole film downloads before it can start:
// until then the opening picture stays still and the page cannot scroll, so a visitor never
// sees a half-loaded film. Once it is in memory, every scroll position shows at once.

const FILM_FILE = 'film.mp4';
const GIVE_UP_MS = 60000; // After this the page opens without the film, so nobody gets stuck.
const SMOOTHING = 0.12; // Share of the remaining distance covered per frame.
const SEEK_STEP = 1 / 30; // Smallest change in seconds worth a new seek.
const FADE = 0.04; // Share of the film each caption takes to fade in or out.
const TRAVEL = 40; // Pixels a caption drifts while it fades.

const root = document.documentElement;
const film = document.getElementById('film');
const topbar = document.getElementById('topbar');
const video = document.getElementById('film-video');
const progressBar = document.getElementById('progress');
const hint = document.getElementById('hint');
const beats = [...document.querySelectorAll('.beat')].map((element) => ({
  element,
  start: Number(element.dataset.start),
  end: Number(element.dataset.end),
}));
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

const state = { duration: 0, target: 0, position: 0, raf: 0, opened: false };

function scrollProgress() {
  const bounds = film.getBoundingClientRect();
  const distance = bounds.height - window.innerHeight;
  return Math.min(1, Math.max(0, -bounds.top / distance));
}

function poseCaptions(progress) {
  beats.forEach(({ element, start, end }) => {
    const fadeIn = start <= 0 ? 1 : Math.min(1, Math.max(0, (progress - start) / FADE));
    const fadeOut = Math.min(1, Math.max(0, (end - progress) / FADE));
    const opacity = Math.min(fadeIn, fadeOut);
    element.style.opacity = opacity.toFixed(3);
    element.style.transform = `translateY(${((1 - fadeIn) * TRAVEL - (1 - fadeOut) * TRAVEL).toFixed(1)}px)`;
  });
  hint.style.opacity = state.opened ? Math.max(0, 1 - progress * 40).toFixed(3) : '0';
  progressBar.style.transform = `scaleX(${progress.toFixed(4)})`;
}

function tick() {
  const distance = state.target - state.position;
  state.position += reducedMotion ? distance : distance * SMOOTHING;
  if (Math.abs(distance) < 0.01) state.position = state.target;

  const gap = Math.abs(video.currentTime - state.position);
  if (!video.seeking && gap >= SEEK_STEP) video.currentTime = state.position;
  poseCaptions(state.position / state.duration);

  const done = state.position === state.target && !video.seeking && gap < SEEK_STEP;
  state.raf = done ? 0 : requestAnimationFrame(tick);
}

function handleScroll() {
  const progress = scrollProgress();
  topbar.classList.toggle('is-solid', film.getBoundingClientRect().bottom <= window.innerHeight);

  if (!state.duration) {
    poseCaptions(progress);
    return;
  }
  state.target = progress * state.duration;
  if (!state.raf) state.raf = requestAnimationFrame(tick);
}

function openPage() {
  if (state.opened) return;
  state.opened = true;
  root.classList.remove('is-waiting');
  handleScroll();
}

function showDownload(share) {
  if (!state.opened) progressBar.style.transform = `scaleX(${share.toFixed(4)})`;
}

async function downloadFilm() {
  const response = await fetch(FILM_FILE);
  if (!response.ok) throw new Error(`Could not load ${FILM_FILE}`);

  const total = Number(response.headers.get('Content-Length')) || 0;
  const reader = response.body.getReader();
  const pieces = [];
  let received = 0;

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    pieces.push(value);
    received += value.length;
    if (total) showDownload(received / total);
  }
  return new Blob(pieces, { type: 'video/mp4' });
}

// Resolves once the film can show its first frame from memory.
function loadIntoVideo(blob) {
  return new Promise((resolve, reject) => {
    video.addEventListener('loadeddata', resolve, { once: true });
    video.addEventListener('error', () => reject(new Error('The film could not be read')), { once: true });
    video.src = URL.createObjectURL(blob);
    video.load();
  });
}

async function start() {
  if ('scrollRestoration' in history) history.scrollRestoration = 'manual';
  window.scrollTo(0, 0);

  window.addEventListener('scroll', handleScroll, { passive: true });
  window.addEventListener('resize', handleScroll);
  handleScroll();

  // A very slow connection still gets the menu and the visit details, just without the film.
  setTimeout(openPage, GIVE_UP_MS);

  const blob = await downloadFilm();
  await loadIntoVideo(blob);
  state.duration = video.duration;
  video.classList.add('is-ready');
  openPage();
}

start().catch((error) => {
  console.error(error);
  openPage();
});
