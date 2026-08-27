/*
 * Bad Apple as text, played from the record the renderer wrote.
 *
 * The video is glyphs rasterised into pixels; this is the same glyphs as glyphs.
 * Two things have to be right for that to mean anything.
 *
 * Layout. The render places every cell on an exact 7x15 grid, because FreeType
 * hints Menlo's advance from its true 0.6017em (7.22px at size 12) down to a round
 * 7. A browser laying out the same string uses the unhinted advance and drifts a
 * fifth of a pixel per column -- 37px across a 170-column row. So no text here is
 * laid out by the browser at all: every glyph is given its own x, and every row its
 * own baseline at 15r + 12, which is where PIL's top-anchored draw puts it.
 *
 * Framing. Nothing is cropped. The svg's viewBox is set to the crop rectangle, so
 * the box on screen shows exactly the region the video shows, at whatever scale the
 * frame was rendered at; the padding that the renderer cut off is still drawn and
 * simply falls outside the box. The box never moves, so the text shifts behind it as
 * the padding changes from frame to frame. preserveAspectRatio is none to match the
 * renderer's own final resize, which is very slightly non-uniform wherever
 * round(480s)/round(360s) is not exactly 4/3.
 *
 * Time comes from the music, not from a timer: the frame is whatever the audio's
 * currentTime says it is. A frame-counting loop and a 219s song disagree by the end
 * of it, and the disagreement is audible. Without audio it falls back to counting.
 */
const $ = (id) => document.getElementById(id);
const SVG_NS = 'http://www.w3.org/2000/svg';
const XML_NS = 'http://www.w3.org/XML/1998/namespace';

const svg = $('art');
const snd = $('snd');
let CELL_W = 7, CELL_H = 15;
let meta = null;
let fps = 30;
let N = 0;
let first = 0;           // frame index the record starts at, i.e. audio time zero

let text = '';           // the whole decompressed record
let lineAt = [];         // frame index -> offset of its line in `text`
const parsed = new Map();  // frame index -> record, bounded below

let frame = 0;
let playing = false;
let scrubbing = false;
let haveAudio = false;
let acc = 0, last = 0;   // the fallback clock, used only when there is no audio
let boxW = 0, boxH = 0;  // the crop box on screen, in CSS px, for sizing the veil

/* ------------------------------------------------------------------ elements */

const bg = document.createElementNS(SVG_NS, 'rect');
bg.setAttribute('x', '0');
bg.setAttribute('y', '0');
bg.setAttribute('fill', '#fff');
svg.appendChild(bg);

// Rows live in their own layer so the veil stays above them however many get added.
const glyphs = document.createElementNS(SVG_NS, 'g');
svg.appendChild(glyphs);

const veil = document.createElementNS(SVG_NS, 'path');
veil.setAttribute('id', 'veil');
veil.setAttribute('fill-rule', 'evenodd');
svg.appendChild(veil);

const rows = [];
const xCache = new Map();   // grid width -> "0 7 14 ..." 

/** The x of every cell in a row of this width, as SVG wants it. */
function xList(gw) {
  let s = xCache.get(gw);
  if (s === undefined) {
    const xs = new Array(gw);
    for (let i = 0; i < gw; i++) xs[i] = i * CELL_W;
    s = xs.join(' ');
    xCache.set(gw, s);
  }
  return s;
}

/** Grow the pool of row elements to at least n, each pinned to its baseline. */
function ensureRows(n) {
  while (rows.length < n) {
    const t = document.createElementNS(SVG_NS, 'text');
    // Where PIL's text((0, 0)) puts the baseline: ascent below the cell top.
    t.setAttribute('y', rows.length * CELL_H + 12);
    // Belt and braces with the CSS white-space:pre. If runs of spaces collapsed,
    // the per-character x list would bind to the wrong characters.
    t.setAttributeNS(XML_NS, 'xml:space', 'preserve');
    t._gw = -1;
    glyphs.appendChild(t);
    rows.push(t);
  }
}

/* ---------------------------------------------------------------------- data */

async function loadRecord() {
  const res = await fetch('data/frames.jsonl.gz');
  if (!res.ok) throw new Error(`frames.jsonl.gz: ${res.status}`);
  const buf = new Uint8Array(await res.arrayBuffer());

  // A host may or may not have already decompressed it for us, depending on how
  // it serves .gz; the magic number is the only reliable way to tell.
  const gzipped = buf[0] === 0x1f && buf[1] === 0x8b;
  if (!gzipped) return new TextDecoder().decode(buf);

  const stream = new Blob([buf]).stream().pipeThrough(new DecompressionStream('gzip'));
  return await new Response(stream).text();
}

/** Map each frame to where its line starts, without parsing any of them. */
function index() {
  lineAt = [];
  let at = text.indexOf('\n') + 1;      // line 0 is the header
  while (at > 0 && at < text.length) {
    const end = text.indexOf('\n', at);
    if (end < 0) break;
    // Cheap enough to trust the order in the file but not to assume it.
    const m = /"frame":(\d+)/.exec(text.slice(at, at + 24));
    if (m) lineAt[+m[1]] = at;
    at = end + 1;
  }
  return lineAt.length;
}

function record(i) {
  let r = parsed.get(i);
  if (r) return r;
  const at = lineAt[i];
  if (at === undefined) return null;
  const end = text.indexOf('\n', at);
  r = JSON.parse(text.slice(at, end < 0 ? undefined : end));
  parsed.set(i, r);
  if (parsed.size > 240) {
    for (const k of parsed.keys()) {
      if (Math.abs(k - i) > 120) parsed.delete(k);
    }
  }
  return r;
}

/* -------------------------------------------------------------------- render */

function draw(i) {
  const r = record(i);
  if (!r) return;

  const [gw, gh] = r.grid;
  const [pw, ph] = r.padded;
  const [cl, ct, cr, cb] = r.crop;

  // The box shows the crop and only the crop, whatever this frame's scale is.
  svg.setAttribute('viewBox', `${cl} ${ct} ${cr - cl} ${cb - ct}`);
  bg.setAttribute('width', pw);
  bg.setAttribute('height', ph);

  // The whole render, with the crop punched out: even-odd leaves the hole unpainted.
  // The outer edge is pushed a hair past the paper it covers. Landing the two exactly
  // together leaves each of them antialiased against the other along that edge, and
  // neither ends up opaque: white shows through the veil as a hairline outline. The
  // overhang is kept at 1.5 CSS px whatever the frame's scale, so what it spills onto
  // is background rather than anything drawn.
  const ex = boxW > 0 ? 1.5 * (cr - cl) / boxW : 0;
  const ey = boxH > 0 ? 1.5 * (cb - ct) / boxH : 0;
  veil.setAttribute('d', `M${-ex} ${-ey}H${pw + ex}V${ph + ey}H${-ex}Z ` +
                         `M${cl} ${ct}H${cr}V${cb}H${cl}Z`);

  ensureRows(gh);
  const xs = xList(gw);
  for (let y = 0; y < gh; y++) {
    const t = rows[y];
    if (t._gw !== gw) { t.setAttribute('x', xs); t._gw = gw; }
    if (t._hidden) { t.removeAttribute('display'); t._hidden = false; }
    t.textContent = r.rows[y];
  }
  for (let y = gh; y < rows.length; y++) {
    if (!rows[y]._hidden) {
      rows[y].setAttribute('display', 'none');
      rows[y]._hidden = true;
    }
  }
  return r;
}

/** Put the playhead at a frame. Display only -- does not touch the clock. */
function showFrame(i, fromSeek = false) {
  frame = Math.max(0, Math.min(Math.round(i), N - 1));
  const r = draw(frame);
  if (!fromSeek) $('seek').value = String(frame);
  $('frameNum').textContent = frame;
  $('time').textContent = `/ ${N - 1} · ${(frame / fps).toFixed(2)}s`;
  if (r) {
    const [l, t, rr, bb] = r.pad;
    $('geom').textContent =
      `${r.scale.toFixed(3)}x · grid ${r.grid[0]}x${r.grid[1]} · ` +
      `pad ${l + rr}x${t + bb}px · crop ${r.scaled[0]}x${r.scaled[1]}`;
  }
}

/** Go to a frame and take the music with you. */
function setFrame(i, fromSeek = false) {
  showFrame(i, fromSeek);
  if (haveAudio) {
    const t = (frame - first) / fps;
    if (Math.abs(snd.currentTime - t) > 0.05) snd.currentTime = t;
  }
  acc = 0;
}

/* ------------------------------------------------------------------ playback */

function setPlaying(on) {
  playing = on;
  $('play').textContent = on ? 'Pause' : 'Play';
  acc = 0;
  last = performance.now();
  if (!haveAudio) return;
  if (on) {
    // Rejected only if the browser wants a gesture, and a click on Play is one.
    snd.play().catch(() => { haveAudio = false; });
  } else {
    snd.pause();
  }
}

function tick(now) {
  requestAnimationFrame(tick);
  if (!playing || scrubbing) { last = now; return; }

  if (haveAudio) {
    const at = first + Math.round(snd.currentTime * fps);
    if (at >= N || snd.ended) {
      if (!$('loop').checked) { setPlaying(false); showFrame(N - 1); return; }
      snd.currentTime = 0;
      if (snd.paused) snd.play().catch(() => {});
      return;
    }
    if (at !== frame) showFrame(at);
    return;
  }

  // Clamped so a backgrounded tab does not come back and sprint through the video.
  acc += Math.min(0.25, (now - last) / 1000) * fps;
  last = now;
  const step = Math.floor(acc);
  if (step < 1) return;
  acc -= step;

  let next = frame + step;
  if (next > N - 1) {
    if (!$('loop').checked) { setPlaying(false); return; }
    next = 0;
  }
  showFrame(next);
}

/* --------------------------------------------------------------------- audio */

/** True once the track is loaded well enough to be used as the clock.
 *
 * The whole file is fetched and played from a blob rather than streamed from its
 * URL. Seeking a streamed media element needs the host to honour Range requests,
 * and a host that does not -- python -m http.server, for one -- answers a seek by
 * refetching from the start, which drops the playhead back to zero mid-song. A blob
 * is local and seekable, so scrubbing behaves the same wherever this is served from.
 */
async function loadAudio(src) {
  let url;
  try {
    const res = await fetch(src);
    if (!res.ok) throw new Error(`${res.status}`);
    url = URL.createObjectURL(await res.blob());
  } catch {
    return false;
  }

  return await new Promise((resolve) => {
    const ok = () => { cleanup(); resolve(true); };
    const bad = () => { cleanup(); URL.revokeObjectURL(url); resolve(false); };
    const cleanup = () => {
      snd.removeEventListener('loadedmetadata', ok);
      snd.removeEventListener('error', bad);
      clearTimeout(timer);
    };
    // Never let an unplayable track hold the page hostage; it falls back to
    // counting frames and says so.
    const timer = setTimeout(bad, 8000);
    snd.addEventListener('loadedmetadata', ok);
    snd.addEventListener('error', bad);
    snd.src = url;
    snd.volume = Number($('vol').value);
  });
}

/** How hard to knock back everything outside the crop. Only ever affects the veil,
 *  which has the crop punched out of it, so the frame itself cannot be touched. */
function applyVeil() {
  document.documentElement.style.setProperty('--veil', $('veilOpacity').value);
}

function applyVolume() {
  const v = Number($('vol').value);
  snd.volume = v;
  snd.muted = v === 0;
  $('mute').textContent = snd.muted ? 'Muted' : 'Vol';
  $('mute').classList.toggle('off', snd.muted);
}

/* ---------------------------------------------------------------------- init */

async function init() {
  try {
    meta = await (await fetch('data/meta.json')).json();
    CELL_W = meta.cell[0];
    CELL_H = meta.cell[1];
    fps = meta.fps || 30;
    first = meta.start_frame || 0;

    if (meta.audio) {
      $('sub').textContent = 'loading the music…';
      haveAudio = await loadAudio(meta.audio);
    }

    // Block on the font: a frame drawn in a fallback face would be quietly wrong.
    if (document.fonts) {
      await document.fonts.load(`12px MenloRender`);
      await document.fonts.ready;
    }

    $('sub').textContent = 'decompressing the record…';
    text = await loadRecord();
    N = index();

    $('seek').max = String(N - 1);
    for (const id of ['play', 'back', 'fwd', 'copy', 'selectText']) $(id).disabled = false;
    $('seek').disabled = false;

    const [lo, hi] = meta.scale_range || [0, 0];
    $('sub').textContent =
      `${meta.frames} frames @ ${+fps.toFixed(3)} fps · scale ${lo}x–${hi}x` +
      (haveAudio ? '' : ' · no audio');

    setFrame(0);
    requestAnimationFrame(tick);
  } catch (err) {
    $('sub').textContent = `failed: ${err.message}`;
    throw err;
  }
}

$('play').addEventListener('click', () => setPlaying(!playing));
$('back').addEventListener('click', () => { setPlaying(false); setFrame(frame - 1); });
$('fwd').addEventListener('click', () => { setPlaying(false); setFrame(frame + 1); });

/** The clipboard API needs a secure context and can be permission-denied;
 *  either way, fall back to the old selection-based copy. */
async function copyText(s) {
  if (navigator.clipboard && window.isSecureContext) {
    try { await navigator.clipboard.writeText(s); return; } catch { /* fall through */ }
  }
  const ta = document.createElement('textarea');
  ta.value = s;
  ta.style.cssText = 'position:fixed;opacity:0';
  document.body.appendChild(ta);
  ta.select();
  const ok = document.execCommand('copy');
  ta.remove();
  if (!ok) throw new Error('copy blocked');
}

$('copy').addEventListener('click', async () => {
  const r = record(frame);
  if (!r) return;
  const btn = $('copy');
  try {
    await copyText(r.rows.join('\n'));
    btn.textContent = 'Copied';
  } catch {
    btn.textContent = 'Copy failed';
  }
  setTimeout(() => { btn.textContent = 'Copy frame'; }, 1200);
});

// The long-press context menu on touch screens (save/share/print) has nothing
// useful for an inline svg; the Copy frame button covers the one real want.
$('frame').addEventListener('contextmenu', (ev) => {
  if (matchMedia('(pointer: coarse)').matches) ev.preventDefault();
});

// The frame as real, selectable text. SVG text cannot be drag-selected on
// mobile at all, so selection happens here instead, on an HTML copy of the
// frame. Playback pauses: the text is a snapshot, not a live view.
$('selectText').addEventListener('click', () => {
  const r = record(frame);
  if (!r) return;
  setPlaying(false);
  $('tvPre').textContent = r.rows.join('\n');
  $('tvLabel').textContent = `frame ${frame} · ${r.grid[0]}x${r.grid[1]} characters · long-press or drag to select`;
  $('textview').hidden = false;
});
$('tvClose').addEventListener('click', () => { $('textview').hidden = true; });

// Dragging seeks without giving up playback, but the audio is held still while the
// thumb moves: re-seeking a playing track every pointer event only makes it stutter.
$('seek').addEventListener('pointerdown', () => {
  scrubbing = true;
  if (haveAudio) snd.pause();
});
$('seek').addEventListener('input', (ev) => setFrame(Number(ev.target.value), true));
const endScrub = () => {
  if (!scrubbing) return;
  scrubbing = false;
  last = performance.now();
  if (playing && haveAudio) snd.play().catch(() => {});
};
$('seek').addEventListener('pointerup', endScrub);
$('seek').addEventListener('pointercancel', endScrub);
$('seek').addEventListener('change', endScrub);

// The frame must stay 4:3: the svg is stretched to it (preserveAspectRatio is
// none), so any deviation distorts the art. The CSS height:100% sizing breaks
// on narrow screens -- max-width clamps the width while the height stays full --
// so the frame is sized here to the largest 4:3 rect the stage can hold.
new ResizeObserver((entries) => {
  const r = entries[0].contentRect;
  const w = Math.min(r.width, r.height * 4 / 3);
  $('frame').style.width = w + 'px';
  $('frame').style.height = (w * 3 / 4) + 'px';
}).observe(document.querySelector('.stage'));

// The veil's overhang is specified in screen pixels, so it has to be recomputed
// whenever the box changes size.
new ResizeObserver((entries) => {
  const r = entries[0].contentRect;
  if (r.width === boxW && r.height === boxH) return;
  boxW = r.width;
  boxH = r.height;
  if (N) draw(frame);
}).observe($('frame'));

$('veilOpacity').addEventListener('input', applyVeil);
$('vol').addEventListener('input', applyVolume);
$('mute').addEventListener('click', () => {
  snd.muted = !snd.muted;
  $('mute').textContent = snd.muted ? 'Muted' : 'Vol';
  $('mute').classList.toggle('off', snd.muted);
});

document.addEventListener('keydown', (ev) => {
  if (ev.target instanceof Element && ev.target.matches('input, button')) return;
  const jump = ev.shiftKey ? 10 : 1;
  switch (ev.key) {
    case ' ': ev.preventDefault(); setPlaying(!playing); break;
    case 'ArrowLeft': ev.preventDefault(); setPlaying(false); setFrame(frame - jump); break;
    case 'ArrowRight': ev.preventDefault(); setPlaying(false); setFrame(frame + jump); break;
    case 'm': $('mute').click(); break;
    case 'Escape': $('textview').hidden = true; break;
    default: return;
  }
});

init();
