/* ==========================================================================
   SLEUTH — 404, with the magnifier on the end of the cursor.
   Co-located with this folder's index.html. Zero dependencies.

   One rAF loop, and it owns four things:

     1. the glass — where the lens actually is, which lags the pointer slightly
        because a brass magnifier has weight;
     2. the walk  — the bird keeps a standoff from the glass and turns to face
        it. Its stride advances with DISTANCE TRAVELLED, never with time, which
        is the only reason the feet do not skate;
     3. the reach — the arm is re-drawn from shoulder to handle every frame, in
        scene coordinates, so the bird can mirror itself without the hand ever
        leaving the glass;
     4. the paperwork — footprints behind, a spoken line when he gives up.

   Nothing in the stylesheet may transition .bird, .lens, .arm or .found. Two
   writers on one transform is the oldest bug in this repo.
   ========================================================================== */

const $ = (sel, root = document) => root.querySelector(sel);

const scene   = $('[data-scene]');
const bird    = $('[data-bird]');
const limbBack  = $('[data-limb="back"]');
const limbFront = $('[data-limb="front"]');
const toesBack  = $('[data-toes="back"]');
const toesFront = $('[data-toes="front"]');
const head      = $('[data-head]');
const body    = $('[data-body]');
const wing    = $('[data-wing]');
const pupil   = $('[data-pupil]');
const armSvg  = $('[data-arm]');
const armLimb = $('[data-arm-limb]');
const armHand = $('[data-arm-hand]');
const lens    = $('[data-lens]');
const cursor  = $('[data-cursor]');
const trail   = $('[data-trail]');
const bubble  = $('[data-bubble]');
const bubbleText = $('[data-bubble-text]');
const hint    = $('[data-hint]');

const reduced = matchMedia('(prefers-reduced-motion: reduce)');

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
const lerp  = (a, b, t) => a + (b - a) * t;

/* --------------------------------------------------------------- geometry --
   The bird is drawn in a 240×260 view box whose floor line is y = 250 and
   whose centre line is x = 118. Everything below converts between that box and
   the scene, and those two numbers are the only bridge. */

const VB_MID   = 118;
const VB_FLOOR = 250;
const GROUND_Y = 248;     /* the floor line, in view-box units */

/* ------------------------------------------------------------------ gait --
   All in view-box units. The rig is deliberately small: two hips, two segment
   lengths, a stride, a duty factor and a lift. Everything the legs do is a
   consequence of these six numbers and the distance the bird has travelled. */

/* Short and stubby, tucked up into the body — a chibi bird stands on the last
   third of its leg, not on stilts. Hips at 208 over a floor at 248 is a 40-unit
   drop on 50 units of leg, so the joint is always comfortably bent and never
   near its limit. */
const HIP   = [{ x: 110, y: 208 }, { x: 128, y: 208 }];   /* far leg, near leg */
const THIGH = 25, SHIN = 25;
const STRIDE = 60;                /* body advance per full cycle */
const DUTY  = 0.60;               /* fraction of the cycle a foot is planted */
const LIFT  = 12;                 /* how high the swing foot clears the boards */
const BOB   = 6;                  /* body rise, twice per cycle */
const THRUST = 9;                 /* head hold-and-thrust, twice per cycle */

/* The speed his legs can actually carry, in body-widths per second. A walk is
   stride × cadence and nothing else — let the chase spring run free and you get
   a bird crossing the board at four body-lengths a second on a 46px stride,
   which does not read as fast, it reads as a flicker. Capping the speed is what
   makes the gait legible. */
const MAX_SPEED = 1.15;

/* Where a foot must be, relative to its hip, at gait phase u ∈ [0,1).

   Stance is the half that matters: the foot travels backward at exactly the
   rate the body travels forward, so in the world it does not move at all. That
   is the difference between walking and skating, and it is why this is written
   as a foot POSITION rather than a hip angle. */
function footAt(u) {
  const sweep = DUTY * STRIDE;
  if (u < DUTY) {
    const s = u / DUTY;
    return { x: (0.5 - s) * sweep, y: 0 };
  }
  const s = (u - DUTY) / (1 - DUTY);
  const e = s * s * (3 - 2 * s);                  /* swing eases in and out */
  return { x: (-0.5 + e) * sweep, y: -LIFT * Math.sin(Math.PI * s) };
}

/* Two-bone IK. The knee always takes the solution that bends BACKWARD, because
   that is the joint a bird has, and the target is clamped into reach first so
   the segments stay rigid instead of stretching to meet it. */
function solveLeg(hip, foot) {
  let dx = foot.x - hip.x, dy = foot.y - hip.y;
  let d = Math.hypot(dx, dy) || 0.001;
  const far = THIGH + SHIN - 0.8, near = Math.abs(THIGH - SHIN) + 8;
  if (d > far)  { dx *= far / d;  dy *= far / d;  d = far; }
  if (d < near) { dx *= near / d; dy *= near / d; d = near; }
  const cosA = clamp((THIGH * THIGH + d * d - SHIN * SHIN) / (2 * THIGH * d), -1, 1);
  const ang = Math.atan2(dy, dx) + Math.acos(cosA);
  return {
    knee: { x: hip.x + THIGH * Math.cos(ang), y: hip.y + THIGH * Math.sin(ang) },
    foot: { x: hip.x + dx, y: hip.y + dy },
  };
}

/* Where the arm leaves the body, in view-box coordinates. */
const SHOULDER = { x: 150, y: 158 };
/* Where the bird's voice comes from. */
const MOUTH    = { x: 146, y: 40 };

const M = { w: 0, h: 0, groundY: 0, scale: 1, birdW: 0, birdH: 0, lensR: 74 };

function measure() {
  const r = scene.getBoundingClientRect();
  /* The floor line is the stylesheet's to decide — it paints the boards and the
     skirting against it, and it changes on a phone. Read it rather than keeping
     a second copy of the number in here. */
  const ground = parseFloat(getComputedStyle(scene).getPropertyValue('--ground')) || 54;
  M.w = r.width;
  M.h = r.height;
  M.groundY = r.height - ground;
  M.birdW = bird.offsetWidth;
  M.birdH = bird.offsetHeight;
  M.scale = bird.offsetHeight / 260 || 1;
  M.lensR = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--lens-r')) || 74;
}

/* view-box point → scene pixels, with the mirror applied */
function birdPoint(vx, vy) {
  return {
    /* faceT, not face: during a turn the body is genuinely part-way round, and
       the arm has to leave from where the shoulder actually is. */
    x: S.bx + S.faceT * (vx - VB_MID) * M.scale,
    y: M.groundY - (VB_FLOOR - vy) * M.scale,
  };
}

/* ------------------------------------------------------------------ state */

const S = {
  bx: 0,          /* the bird's ground anchor, scene px */
  vx: 0,          /* px per second */
  face: 1,        /* which way he means to point */
  faceT: 1,       /* which way he is pointing right now — the turn, eased */
  side: 1,        /* which side of him the glass is on (sticky) */
  walking: false,
  phase: 0,       /* gait phase, advanced by distance not by time */
  step: 0,        /* which half-stride we are in, for footfalls */
  lx: 0, ly: 0,   /* the glass */
  tlx: 0, tly: 0, /* where the glass is being asked to be */
  gait: 0,        /* how much of a walk cycle is running, 0..1 */
  frontFootX: 0,  /* where the near foot actually is, for the prints */
  still: 0,       /* seconds spent not walking */
  t: 0,
  live: false,    /* a pointer has taken the glass over */
  said: -1,
};

const LINES = [
  'Nothing here.',
  'Swept it twice.',
  'Not a crumb.',
  'Definitely gone.',
  'Try the front door?',
];

/* --------------------------------------------------------------- the loop */

let last = 0;
let raf = 0;

function frame(now) {
  raf = requestAnimationFrame(frame);
  const dt = last ? clamp((now - last) / 1000, 0, 1 / 20) : 1 / 60;
  last = now;
  S.t += dt;

  /* 1 — where the glass is asked to be. Until a pointer arrives the bird has
         a floor to sweep and does it on its own. */
  if (!S.live) {
    S.tlx = M.w * 0.5 + Math.sin(S.t * 0.55) * M.w * 0.3;
    S.tly = M.groundY - M.h * 0.34 + Math.sin(S.t * 1.3) * 12;
  }

  /* 2 — the glass follows, with weight. */
  const follow = 1 - Math.exp(-(S.live ? 16 : 5) * dt);
  S.lx = lerp(S.lx, S.tlx, follow);
  S.ly = lerp(S.ly, S.tly, follow);

  /* 3 — the walk.

     Three separate quantities, and keeping them separate is the whole fix for
     the moonwalk this thing had first time round:

       · SIDE  — which side of him the glass is on. It picks where he wants to
                 stand, and it is deliberately sticky, because if the standoff
                 target could flip from one frame to the next he would be
                 chasing a post that keeps jumping over his head;
       · GOING — the direction he is actually travelling this frame;
       · FACE  — which way his body points. While he is walking this is GOING
                 and nothing else. A bird whose feet go one way and whose beak
                 goes the other is moonwalking, and no amount of standoff
                 tuning fixes that if facing is read off the glass.

     Only when he has stopped is he allowed to turn towards the glass, and he
     turns THROUGH zero rather than snapping — scaleX passing through 0 reads
     as a body pivoting on the spot. */
  const reach    = M.birdW * 0.92;
  const standoff = M.birdW * 0.86;

  /* The side hysteresis has to be measured against the STANDOFF, not picked
     out of the air. Flipping side moves his target by twice the standoff, so a
     small threshold means a glass drifting over his head sends him marching a
     body-and-a-half one way, then the other. He commits only once the glass is
     further off than he would stand from it anyway — i.e. once his current side
     genuinely no longer works. */
  if (Math.abs(S.lx - S.bx) > M.birdW * 0.8) S.side = S.lx > S.bx ? 1 : -1;

  const want = clamp(S.lx - S.side * standoff, M.w * 0.08, M.w * 0.92);
  const gap  = want - S.bx;
  const prevX = S.bx;

  /* Hysteresis, not a dead zone: it takes a real gap to set him off, and once
     he is off he walks it out. Otherwise he twitches a step at every threshold
     crossing — which is the other half of what read as walking backwards.

     And the two directions are NOT the same size. Walking towards the glass is
     what he is for, so that trigger is short. Backing away from it is a
     correction, and on a wide board a symmetric trigger means he spends the
     take stepping back, turning to look, stepping back — reading as a bird who
     cannot make his mind up. Give ground only when he is properly crowded. */
  const start = gap * S.side > 0 ? M.birdW * 0.26 : M.birdW * 0.55;
  if (!S.walking && Math.abs(gap) > start) S.walking = true;
  if (S.walking && Math.abs(gap) < 8) S.walking = false;

  if (S.walking) {
    S.face = gap > 0 ? 1 : -1;          /* he faces where he is going. Always. */
    /* And he turns BEFORE he travels: the step is scaled by how far round the
       body has actually come, so a reversal is pivot-then-go rather than a
       slide with the beak still pointing the old way. It cannot deadlock —
       faceT eases towards face whether or not he is moving. */
    const committed = clamp(S.faceT * S.face, 0, 1);
    const pull = (1 - Math.exp(-4.2 * dt)) * committed;
    const cap = MAX_SPEED * M.birdW * dt;
    S.bx += clamp(gap * pull, -cap, cap);
  } else {
    /* Stopped, he turns to look at the glass — but at SIDE, not at a raw
       comparison. A raw sign(lx - bx) has no hysteresis, so the moment the
       glass drifts across him he pirouettes on the spot, twice, for a
       two-pixel move. side already carries the hysteresis; use it. */
    S.face = S.side;
  }
  S.vx = (S.bx - prevX) / dt;

  /* the turn is a number, not a class: faceT eases to face and the body pivots
     through zero on the way. Never let it reach zero exactly, or the mirror
     collapses to a hairline. */
  S.faceT = lerp(S.faceT, S.face, 1 - Math.exp(-11 * dt));
  const faceR = Math.abs(S.faceT) < 0.06 ? Math.sign(S.faceT || S.face) * 0.06 : S.faceT;

  /* 4 — the gait. Distance in, phase out: one full cycle per STRIDE travelled,
         so the feet are pinned to the floor at any speed. */
  const travelled = Math.abs(S.bx - prevX);
  S.phase += (travelled / (STRIDE * M.scale)) * 2 * Math.PI;

  const moving = travelled / dt > 14;
  S.still = moving ? 0 : S.still + dt;

  /* One number decides how much gait there is at all, and it eases rather than
     switching: a bird that stops does not freeze mid-stride, it brings the
     trailing foot in and stands. */
  S.gait = lerp(S.gait, S.walking ? 1 : 0, 1 - Math.exp(-7 * dt));

  const cycle = S.phase / (2 * Math.PI);
  const g = S.gait;

  /* the body rises twice per cycle — once over each planted foot */
  const bob  = -BOB * (0.5 - 0.5 * Math.cos(4 * Math.PI * cycle)) * g;
  const lean = clamp(Math.abs(S.vx) * 0.020, 0, 5) * g;
  body.style.setProperty('--bob',  bob.toFixed(2));
  body.style.setProperty('--lean', lean.toFixed(2));

  /* the head holds still in space, then snaps forward to catch up */
  const hp = (cycle * 2) % 1;
  const thrust = hp < 0.72
    ? THRUST * (1 - (hp / 0.72) * 2)                   /* held: drifting back */
    : (() => { const s = (hp - 0.72) / 0.28, e = s * s * (3 - 2 * s);
               return THRUST * (-1 + 2 * e); })();     /* thrown forward */
  head.style.setProperty('--hx', (thrust * g).toFixed(2));

  /* and the legs. Feet first, joints second — never the other way round. */
  const limbs = [limbBack, limbFront], toes = [toesBack, toesFront];
  for (let i = 0; i < 2; i++) {
    const hip = { x: HIP[i].x, y: HIP[i].y + bob };
    const u = (((cycle + i * 0.5) % 1) + 1) % 1;
    const f = footAt(u);
    const target = { x: hip.x + f.x * g, y: GROUND_Y + f.y * g };
    const L = solveLeg(hip, target);
    limbs[i].setAttribute('d',
      `M${hip.x.toFixed(1)} ${hip.y.toFixed(1)}L${L.knee.x.toFixed(1)} ${L.knee.y.toFixed(1)}L${L.foot.x.toFixed(1)} ${L.foot.y.toFixed(1)}`);
    /* three toes, always flat to the floor — a foot that tilts with the shin
       reads as a hoof */
    const fx = L.foot.x, fy = L.foot.y;
    toes[i].setAttribute('d',
      `M${(fx - 11).toFixed(1)} ${(fy + 1).toFixed(1)}h22M${fx.toFixed(1)} ${fy.toFixed(1)}l-8 8M${fx.toFixed(1)} ${fy.toFixed(1)}l8 8`);
    if (i === 1) S.frontFootX = fx;
  }

  /* The wing lifts as he reaches up with the glass — and so does the shoulder.
     A fixed shoulder with the glass overhead draws a straight vertical line out
     of his chest; letting the joint ride up with the reach is the difference
     between an arm and a flagpole. */
  const rest = birdPoint(SHOULDER.x, SHOULDER.y);
  const up = clamp((rest.y - S.ly) / (M.birdW * 0.9), -1, 1);
  wing.style.setProperty('--wing', (up * -18).toFixed(2));
  const shoulderPt = birdPoint(SHOULDER.x + Math.max(0, up) * 5, SHOULDER.y - Math.max(0, up) * 24);

  /* 5 — a footfall every half stride, while actually moving */
  const step = Math.floor(S.phase / Math.PI);
  if (step !== S.step) {
    if (moving) dropPrint();
    S.step = step;
  }

  /* 6 — the arm, drawn in scene coordinates so the mirror never reaches it.
         The hand grips the far end of the handle, not the glass. */
  let dx = shoulderPt.x - S.lx;
  let dy = shoulderPt.y - S.ly;
  let d = Math.hypot(dx, dy) || 1;

  /* The glass can only go as far as he can hold it, and no nearer than a bent
     elbow either — past both he has to walk, and the walk above is already on
     its way. The near clamp is soft: it eases the glass out of his chest
     instead of snatching it off the pointer. */
  /* An arm is an arm. Let the far clamp out to twice his reach and the piece
     draws a pole across the board — worse on a wide one, where the pointer can
     sit half a room away. He holds the glass at arm's length; past that it
     waits for him to walk, which is the honest answer and the one the walk was
     built for. */
  const FAR  = reach * 1.45;
  const NEAR = reach * 0.9;
  if (d > FAR)  { const over = d - FAR;  S.lx += (dx / d) * over;        S.ly += (dy / d) * over; }
  if (d < NEAR) { const in_  = NEAR - d; S.lx -= (dx / d) * in_ * 0.55;  S.ly -= (dy / d) * in_ * 0.55; }

  /* Those two pushes move the glass without asking where the walls are, so the
     board has the last word: the whole ring stays inside the room. Clamping the
     POINTER on the way in is not enough — it is this that ends up on screen. */
  S.lx = clamp(S.lx, M.lensR + 6, M.w - M.lensR - 6);
  S.ly = clamp(S.ly, M.lensR + 6, M.h - M.lensR - 6);

  dx = shoulderPt.x - S.lx; dy = shoulderPt.y - S.ly;

  d = Math.hypot(dx, dy) || 1;
  const ux = dx / d, uy = dy / d;
  const hand = { x: S.lx + ux * (M.lensR + 44), y: S.ly + uy * (M.lensR + 44) };

  /* one bend, away from the body, so the arm reads as an elbow and not a wire */
  const mx = (shoulderPt.x + hand.x) / 2;
  const my = (shoulderPt.y + hand.y) / 2;
  const bendX = -uy * 18 * Math.sign(S.faceT || 1);
  const bendY =  ux * 18 * Math.sign(S.faceT || 1);
  armLimb.setAttribute('d', `M${shoulderPt.x.toFixed(1)} ${shoulderPt.y.toFixed(1)} Q${(mx + bendX).toFixed(1)} ${(my + bendY).toFixed(1)} ${hand.x.toFixed(1)} ${hand.y.toFixed(1)}`);
  armHand.setAttribute('cx', hand.x.toFixed(1));
  armHand.setAttribute('cy', hand.y.toFixed(1));
  armSvg.style.setProperty('--arm-w', (M.birdW * 0.055).toFixed(1));
  armHand.setAttribute('r', (M.birdW * 0.062).toFixed(1));

  /* 7 — the eye goes where the glass is. Local space, so the mirror inverts x
         for us and the pupil never looks out of the back of his head. */
  const eyePt = birdPoint(152, 112);
  const edx = (S.lx - eyePt.x) / M.scale * (S.faceT >= 0 ? 1 : -1);
  const edy = (S.ly - eyePt.y) / M.scale;
  const ed = Math.hypot(edx, edy) || 1;
  const pull = Math.min(ed, 60) / 60 * 6;
  pupil.style.setProperty('--px', ((edx / ed) * pull).toFixed(2));
  pupil.style.setProperty('--py', ((edy / ed) * pull).toFixed(2));

  /* 8 — write the two anchors everything else in the stylesheet hangs off */
  bird.style.setProperty('--bx', S.bx.toFixed(1));
  bird.style.setProperty('--by', M.groundY.toFixed(1));
  bird.style.setProperty('--face', faceR.toFixed(3));
  scene.style.setProperty('--lx', S.lx.toFixed(1));
  scene.style.setProperty('--ly', S.ly.toFixed(1));
  lens.style.setProperty('--handle', ((Math.atan2(uy, ux) * 180) / Math.PI).toFixed(1));

  /* The drawn pointer stands on the RIM, on the side away from the handle, so
     the arrow, the handle and the arm never stack up in the same corner — and
     it leans in, tip on the glass, pointing at whatever is under it. The art
     points up-left at rest, hence the 135°. */
  const cr = M.lensR + 1;
  cursor.style.setProperty('--cx', (S.lx - ux * cr).toFixed(1));
  cursor.style.setProperty('--cy', (S.ly - uy * cr).toFixed(1));
  cursor.style.setProperty('--ca', ((Math.atan2(uy, ux) * 180) / Math.PI + 135).toFixed(1));

  /* 9 — he only speaks once he has stopped, and stops speaking the moment he
         moves again */
  speak(moving);
}

/* -------------------------------------------------------------- the trail */

const prints = [];

function dropPrint() {
  const el = document.createElement('span');
  el.className = 'print';
  /* under the foot, not under the middle of the bird */
  el.style.setProperty('--fx', (S.bx + S.faceT * (S.frontFootX - VB_MID) * M.scale).toFixed(1));
  el.style.setProperty('--fy', (M.groundY + 4).toFixed(1));
  el.style.setProperty('--fd', String(S.face));
  el.style.setProperty('--fr', `${(Math.random() * 10 - 5).toFixed(1)}deg`);
  trail.appendChild(el);
  requestAnimationFrame(() => el.classList.add('is-in'));
  prints.push(el);

  const kill = () => {
    el.classList.remove('is-in');
    setTimeout(() => el.remove(), 600);
  };
  setTimeout(kill, 2600);
  while (prints.length > 14) prints.shift()?.remove();
}

/* ------------------------------------------------------------- the bubble */

let saying = false;

function speak(moving) {
  if (moving) {
    if (saying) { saying = false; bubble.style.setProperty('--say', '0'); }
    return;
  }
  /* Already speaking: re-anchor anyway. He can still creep after the line has
     landed — a standoff correction, the glass easing out of his chest — and a
     caption pinned to where he used to be reads as a bug, not a bird. */
  if (saying) { place(); return; }
  if (S.still < 0.9) return;

  saying = true;
  S.said = (S.said + 1) % LINES.length;
  bubbleText.textContent = LINES[S.said];
  place();
  bubble.style.setProperty('--say', '1');
}

function place() {
  /* He speaks over his shoulder, away from the glass — a caption that lands on
     the lens has covered the one thing the page is about. */
  const m = birdPoint(MOUTH.x, MOUTH.y);
  const bw = bubble.offsetWidth || 120;
  /* and it stays inside the scene — the panel clips, so a caption pushed off
     the left board is a caption nobody reads */
  const sx = clamp(S.face > 0 ? m.x - bw - 4 : m.x + 4, 8, M.w - bw - 8);
  bubble.style.setProperty('--sx', sx.toFixed(1));
  bubble.style.setProperty('--sy', (m.y - 10).toFixed(1));
}

/* -------------------------------------------------------------- the input */

function point(e) {
  /* Reduced motion means the glass is parked. A pointer must not be able to
     talk it back into moving. */
  if (reduced.matches) return;

  const r = scene.getBoundingClientRect();
  S.tlx = clamp(e.clientX - r.left, M.lensR + 6, r.width - M.lensR - 6);
  /* Vertically the glass is kept inside his working envelope: no higher than
     he can hold it, no lower than the boards. Above that band there is nothing
     to read anyway — the address is in the middle of the room. */
  S.tly = clamp(e.clientY - r.top, M.groundY - bird.offsetHeight * 1.25, M.groundY - 12);

  if (!S.live) {
    S.live = true;
    scene.dataset.mode = 'live';
    hint.textContent = 'Only the glass reads the floor. He follows it.';
  }
}

scene.addEventListener('pointermove', point);
scene.addEventListener('pointerdown', point);
scene.addEventListener('pointerleave', (e) => {
  /* Only a mouse ever really leaves. A finger lifts off after every tap, and
     handing the floor back on lift-off would mean touch never got to hold the
     glass at all. */
  if (e.pointerType !== 'mouse') return;
  S.live = false;
  scene.dataset.mode = 'patrol';
});

/* --------------------------------------------------------------- reduced --
   No chase, no gait, no cursor takeover: one posed frame with the glass parked
   over the middle of the 404, which is still a working 404 page with a lens on
   it — just one that does not move. */

function pose() {
  measure();
  S.bx = M.w * 0.34;
  S.face = S.faceT = S.side = 1;
  S.walking = false;
  S.lx = M.w * 0.56;
  S.ly = M.groundY - M.h * 0.36;
  S.t = 0;
  S.phase = 0;
  S.gait = 0;

  bird.style.setProperty('--bx', S.bx.toFixed(1));
  bird.style.setProperty('--by', M.groundY.toFixed(1));
  bird.style.setProperty('--face', '1');
  scene.style.setProperty('--lx', S.lx.toFixed(1));
  scene.style.setProperty('--ly', S.ly.toFixed(1));

  /* stand him up: both feet neutral, nothing mid-stride */
  for (const [i, limb, toe] of [[0, limbBack, toesBack], [1, limbFront, toesFront]]) {
    const hip = HIP[i];
    const L = solveLeg(hip, { x: hip.x, y: GROUND_Y });
    limb.setAttribute('d', `M${hip.x} ${hip.y}L${L.knee.x.toFixed(1)} ${L.knee.y.toFixed(1)}L${L.foot.x.toFixed(1)} ${L.foot.y.toFixed(1)}`);
    toe.setAttribute('d', `M${(L.foot.x - 11).toFixed(1)} ${(L.foot.y + 1).toFixed(1)}h22M${L.foot.x.toFixed(1)} ${L.foot.y.toFixed(1)}l-8 8M${L.foot.x.toFixed(1)} ${L.foot.y.toFixed(1)}l8 8`);
  }
  head.style.setProperty('--hx', '0');
  body.style.setProperty('--bob', '0');
  body.style.setProperty('--lean', '0');

  const sh = birdPoint(SHOULDER.x, SHOULDER.y);
  const dx = sh.x - S.lx, dy = sh.y - S.ly, d = Math.hypot(dx, dy) || 1;
  const lensR = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--lens-r')) || 74;
  const hand = { x: S.lx + (dx / d) * (lensR + 44), y: S.ly + (dy / d) * (lensR + 44) };
  armLimb.setAttribute('d', `M${sh.x.toFixed(1)} ${sh.y.toFixed(1)} Q${((sh.x + hand.x) / 2).toFixed(1)} ${((sh.y + hand.y) / 2 - 16).toFixed(1)} ${hand.x.toFixed(1)} ${hand.y.toFixed(1)}`);
  armHand.setAttribute('cx', hand.x.toFixed(1));
  armHand.setAttribute('cy', hand.y.toFixed(1));
  lens.style.setProperty('--handle', ((Math.atan2(dy, dx) * 180) / Math.PI).toFixed(1));
  cursor.style.setProperty('--cx', (S.lx - (dx / d) * (M.lensR + 1)).toFixed(1));
  cursor.style.setProperty('--cy', (S.ly - (dy / d) * (M.lensR + 1)).toFixed(1));
  cursor.style.setProperty('--ca', ((Math.atan2(dy, dx) * 180) / Math.PI + 135).toFixed(1));
}

/* ----------------------------------------------------------------- boot -- */

function start() {
  measure();
  S.bx = M.w * 0.4;
  S.lx = M.w * 0.55;
  S.ly = M.groundY - M.h * 0.34;
  S.tlx = S.lx; S.tly = S.ly;
  S.face = S.faceT = S.side = 1;
  S.walking = false;
  scene.dataset.mode = 'patrol';
  last = 0;
  if (!raf) raf = requestAnimationFrame(frame);
}

function stop() {
  if (raf) cancelAnimationFrame(raf);
  raf = 0;
  trail.replaceChildren();
  prints.length = 0;
  bubble.style.setProperty('--say', '0');
  saying = false;
}

function apply() {
  if (reduced.matches) {
    stop();
    scene.dataset.mode = 'still';
    hint.textContent = 'Reduced motion: the glass is parked and nobody is chasing anything.';
    pose();
  } else {
    S.live = false;
    start();
    hint.textContent = "Move your cursor — the glass is yours. He'll follow.";
  }
}

apply();
reduced.addEventListener('change', apply);

/* Only a width change is a real relayout. Phone keyboards and URL bars fire
   height-only resizes, and re-posing the scene under a tap reads as a bug. */
let lastW = innerWidth;
addEventListener('resize', () => {
  if (innerWidth === lastW) { measure(); return; }
  lastW = innerWidth;
  measure();
  if (reduced.matches) pose();
  else {
    S.bx = clamp(S.bx, M.w * 0.08, M.w * 0.92);
    S.lx = clamp(S.lx, 40, M.w - 40);
    S.ly = clamp(S.ly, 40, M.groundY - 10);
  }
});

/* The web font changes the glyph metrics, not the rig, but the bird is sized
   off layout — so take the measurement again once fonts have landed. */
if (document.fonts?.ready) document.fonts.ready.then(measure);
addEventListener('load', measure);
