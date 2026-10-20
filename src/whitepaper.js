// Whitepaper: crossfade a faint persona illustration per section.
const imgs = [...document.querySelectorAll('.wp-art img')]; let cur = 0, shown = 'hero';
const src = (m) => `/img/minds/${m}.webp`;
const secs = [...document.querySelectorAll('.wp section[data-mind]')];
const pre = (i) => { const s = secs[i]; if (s) { const im = new Image(); im.src = src(s.dataset.mind); } };
function show(m) {
  if (m === shown) return; shown = m;
  const next = imgs[1 - cur]; next.src = src(m);
  const go = () => { next.classList.add('on'); imgs[cur].classList.remove('on'); cur = 1 - cur; };
  next.decode ? next.decode().then(go, go) : go();
}
const io = new IntersectionObserver((es) => es.forEach((e) => { if (e.isIntersecting) { show(e.target.dataset.mind); pre(secs.indexOf(e.target) + 1); } }), { rootMargin: '-45% 0px -45% 0px' });
secs.forEach((s) => io.observe(s));
