/* ============================================================
   Break the Bricks — modern rewrite
   Vanilla JS + Canvas. Delta-time physics, particles, Web Audio SFX,
   responsive DPR-aware rendering, keyboard + mouse + touch controls.
   ============================================================ */
"use strict";

/* ---------- World (logical) coordinate system ----------
   All physics/drawing use these units. The canvas backing store is
   scaled to the real pixel size, so gameplay is identical on every screen. */
const WORLD_W = 480;
const WORLD_H = 560;

/* ---------- DOM ---------- */
const canvas = document.getElementById("breakout");
const ctx = canvas.getContext("2d");
const wrap = document.getElementById("canvasWrap");
const boardArea = document.getElementById("boardArea");

const scoreEl = document.getElementById("score");
const livesEl = document.getElementById("lives");
const levelEl = document.getElementById("level");

const overlay = document.getElementById("overlay");
const overlayIcon = document.getElementById("overlayIcon");
const overlayTitle = document.getElementById("overlayTitle");
const overlaySub = document.getElementById("overlaySub");
const overlayScore = document.getElementById("overlayScore");
const primaryBtn = document.getElementById("primaryBtn");

const soundBtn = document.getElementById("soundBtn");
const pauseBtn = document.getElementById("pauseBtn");
const leftBtn = document.getElementById("leftBtn");
const rightBtn = document.getElementById("rightBtn");
const launchBtn = document.getElementById("launchBtn");

/* ---------- Game configuration ---------- */
const CONFIG = {
    paddle: { w: 90, h: 12, y: WORLD_H - 40, speed: 640, color: "#e8eaf0" },
    ball: { r: 7, baseSpeed: 320, maxSpeed: 560, speedUpPerLevel: 24, color: "#f4f6fb" },
    brick: { cols: 9, rows: 6, gap: 7, padX: 16, padTop: 18, h: 20 },
    maxLives: 3,
};

/* Brick palette — a calm tonal ramp of one accent hue (top → bottom) */
const ROW_COLORS = ["#405cf5", "#5570f6", "#6a84f7", "#8098f8", "#95acf9", "#abbffb"];

/* ---------- Game state ---------- */
const STATE = { START: "start", READY: "ready", RUNNING: "running", PAUSED: "paused", WIN: "win", LOSE: "lose" };

const game = {
    state: STATE.START,
    score: 0,
    lives: CONFIG.maxLives,
    level: 1,
    bricksLeft: 0,
};

const paddle = { x: 0, y: CONFIG.paddle.y, w: CONFIG.paddle.w, h: CONFIG.paddle.h, targetX: null };

/* Multiple balls — the ball-rain combo can add more. Each ball owns its trail. */
function makeBall() {
    return { x: 0, y: 0, dx: 0, dy: 0, r: CONFIG.ball.r, speed: CONFIG.ball.baseSpeed, stuck: true, trail: [] };
}
let balls = [];

let bricks = [];
let particles = [];

/* Ball-rain combo: `needed` brick hits inside a rolling `window` (ms) pour
   `rainBalls` extra balls from the top, capped at `maxBalls` total on screen. */
const COMBO = { window: 10000, needed: 3, rainBalls: 3, maxBalls: 9, cooldown: 20000 };
let comboHits = [];        // timestamps (ms) of recent brick hits
let rainCooldownUntil = 0; // timestamp (ms) before which ball rain can't retrigger
let rainFlash = 0;         // seconds left on the "BALL RAIN" banner

/* Input flags */
const input = { left: false, right: false };

/* ============================================================
   Audio — synthesized SFX (no external files needed)
   ============================================================ */
const sound = {
    enabled: true,
    ctx: null,
    ensure() {
        if (!this.ctx) {
            const AC = window.AudioContext || window.webkitAudioContext;
            if (AC) this.ctx = new AC();
        }
        if (this.ctx && this.ctx.state === "suspended") this.ctx.resume();
    },
    tone(freq, dur, type = "square", gain = 0.06, slideTo = null) {
        if (!this.enabled || !this.ctx) return;
        const t = this.ctx.currentTime;
        const osc = this.ctx.createOscillator();
        const g = this.ctx.createGain();
        osc.type = type;
        osc.frequency.setValueAtTime(freq, t);
        if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
        g.gain.setValueAtTime(gain, t);
        g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
        osc.connect(g).connect(this.ctx.destination);
        osc.start(t);
        osc.stop(t + dur);
    },
    paddle() { this.tone(220, 0.08, "square", 0.05, 330); },
    wall() { this.tone(180, 0.05, "sine", 0.04); },
    brick(row) { this.tone(420 + (5 - row) * 60, 0.07, "square", 0.05); },
    launch() { this.tone(300, 0.12, "sawtooth", 0.05, 600); },
    life() { this.tone(200, 0.35, "sawtooth", 0.07, 80); },
    rain() { [523, 659, 784, 1046].forEach((f, i) => setTimeout(() => this.tone(f, 0.12, "triangle", 0.06), i * 70)); },
    win() { [523, 659, 784, 1046].forEach((f, i) => setTimeout(() => this.tone(f, 0.18, "triangle", 0.07), i * 120)); },
    lose() { [400, 300, 200, 120].forEach((f, i) => setTimeout(() => this.tone(f, 0.25, "sawtooth", 0.07), i * 140)); },
};

/* ============================================================
   Responsive canvas sizing (DPR-aware)
   ============================================================ */
function resizeCanvas() {
    // Contain-fit the largest WORLD_W:WORLD_H box inside the available area,
    // so the board keeps an exact aspect ratio (no stretch) and the whole
    // layout — including the footer — always fits on screen.
    const area = boardArea.getBoundingClientRect();
    let w = area.width;
    let h = (w * WORLD_H) / WORLD_W;
    if (h > area.height) {
        h = area.height;
        w = (h * WORLD_W) / WORLD_H;
    }
    wrap.style.width = w + "px";
    wrap.style.height = h + "px";

    const dpr = Math.min(window.devicePixelRatio || 1, 3);
    canvas.width = Math.max(1, Math.round(w * dpr));
    canvas.height = Math.max(1, Math.round(h * dpr));
    // w:h == WORLD_W:WORLD_H, so these scales are equal → no distortion.
    ctx.setTransform(canvas.width / WORLD_W, 0, 0, canvas.height / WORLD_H, 0, 0);
}
window.addEventListener("resize", resizeCanvas);
window.addEventListener("orientationchange", () => setTimeout(resizeCanvas, 200));

/* ============================================================
   Level / entity setup
   ============================================================ */
/* Rows grow with the level: L1 = 3, L2 = 4, L3 = 5 … capped at the max */
function rowsForLevel(level) {
    return Math.min(2 + level, CONFIG.brick.rows);
}

function buildLevel() {
    const { cols, gap, padX, padTop, h } = CONFIG.brick;
    const rows = rowsForLevel(game.level);
    const totalGap = gap * (cols - 1);
    const bw = (WORLD_W - padX * 2 - totalGap) / cols;
    bricks = [];
    for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
            bricks.push({
                x: padX + c * (bw + gap),
                y: padTop + r * (h + gap),
                w: bw,
                h,
                row: r,
                alive: true,
            });
        }
    }
    game.bricksLeft = bricks.length;
}

function resetPaddle() {
    paddle.w = CONFIG.paddle.w;
    paddle.x = WORLD_W / 2 - paddle.w / 2;
    paddle.targetX = null;
}

/* Ball speed scales with the level. */
function levelBallSpeed() {
    return Math.min(
        CONFIG.ball.baseSpeed + (game.level - 1) * CONFIG.ball.speedUpPerLevel,
        CONFIG.ball.maxSpeed
    );
}

/* Reset to a single ball resting on the paddle, waiting to launch. */
function resetBalls() {
    const b = makeBall();
    b.speed = levelBallSpeed();
    b.x = paddle.x + paddle.w / 2;
    b.y = paddle.y - b.r - 1;
    balls = [b];
    comboHits = [];
    rainCooldownUntil = 0;
    rainFlash = 0;
}

function launchBall() {
    let launched = false;
    for (const b of balls) {
        if (!b.stuck) continue;
        // Launch upward with a slight random horizontal angle.
        const angle = (Math.random() * 0.5 - 0.25) * Math.PI; // ±45°
        b.dx = b.speed * Math.sin(angle);
        b.dy = -b.speed * Math.cos(angle);
        b.stuck = false;
        launched = true;
    }
    if (launched) { sound.ensure(); sound.launch(); }
}

/* ============================================================
   Game lifecycle
   ============================================================ */
function startGame() {
    game.score = 0;
    game.lives = CONFIG.maxLives;
    game.level = 1;
    beginLevel();
}

function beginLevel() {
    buildLevel();
    resetPaddle();
    resetBalls();
    particles = [];
    game.state = STATE.READY;
    hideOverlay();
    updateHUD();
}

function loseLife() {
    game.lives--;
    sound.life();
    shakeScreen();
    updateHUD();
    if (game.lives <= 0) {
        endGame(false);
    } else {
        resetBalls();
        game.state = STATE.READY;
    }
}

function nextLevelOrWin() {
    if (game.level >= 3) {
        endGame(true);
    } else {
        game.level++;
        beginLevel();
        // Spawn AFTER beginLevel — it resets particles, so the burst must come last.
        spawnBurst(WORLD_W / 2, WORLD_H / 2, "#4ee39a", 40);
    }
}

function endGame(won) {
    game.state = won ? STATE.WIN : STATE.LOSE;
    won ? sound.win() : sound.lose();
    showOverlay(won ? "win" : "lose");
}

/* ============================================================
   Update loop
   ============================================================ */
function updatePaddle(dt) {
    // Keyboard / button movement
    let dir = 0;
    if (input.left) dir -= 1;
    if (input.right) dir += 1;
    if (dir !== 0) {
        paddle.x += dir * CONFIG.paddle.speed * dt;
        paddle.targetX = null; // keyboard overrides pointer target
    } else if (paddle.targetX !== null) {
        // Pointer / drag: smoothly ease paddle centre toward finger
        const desired = paddle.targetX - paddle.w / 2;
        paddle.x += (desired - paddle.x) * Math.min(1, dt * 18);
    }
    // Clamp inside walls
    paddle.x = clamp(paddle.x, 0, WORLD_W - paddle.w);

    // Keep any stuck balls riding the paddle
    for (const b of balls) {
        if (b.stuck) {
            b.x = paddle.x + paddle.w / 2;
            b.y = paddle.y - b.r - 1;
        }
    }
}

function updateBalls(dt) {
    // Walk backwards so we can splice fallen balls safely.
    for (let i = balls.length - 1; i >= 0; i--) {
        const ball = balls[i];
        if (ball.stuck) continue;

        // Sub-step to prevent tunnelling at high speed.
        const dist = Math.hypot(ball.dx, ball.dy) * dt;
        const steps = Math.max(1, Math.ceil(dist / (ball.r * 0.8)));
        const sdt = dt / steps;

        let lost = false;
        for (let s = 0; s < steps; s++) {
            ball.x += ball.dx * sdt;
            ball.y += ball.dy * sdt;

            // Walls
            if (ball.x - ball.r < 0) { ball.x = ball.r; ball.dx = Math.abs(ball.dx); sound.wall(); }
            else if (ball.x + ball.r > WORLD_W) { ball.x = WORLD_W - ball.r; ball.dx = -Math.abs(ball.dx); sound.wall(); }
            if (ball.y - ball.r < 0) { ball.y = ball.r; ball.dy = Math.abs(ball.dy); sound.wall(); }

            // Bottom — this ball is gone
            if (ball.y - ball.r > WORLD_H) { lost = true; break; }

            paddleCollision(ball);
            brickCollision(ball);
            // A brick hit may have ended the level / game — stop touching stale state.
            if (game.state !== STATE.RUNNING) return;
        }

        if (lost) {
            balls.splice(i, 1);
            continue;
        }

        // Ball trail sampling
        ball.trail.push({ x: ball.x, y: ball.y });
        if (ball.trail.length > 10) ball.trail.shift();
    }

    // Losing the LAST ball costs a life.
    if (balls.length === 0) loseLife();
}

function paddleCollision(ball) {
    if (ball.dy <= 0) return; // only when moving down
    if (
        ball.y + ball.r >= paddle.y &&
        ball.y - ball.r <= paddle.y + paddle.h &&
        ball.x + ball.r >= paddle.x &&
        ball.x - ball.r <= paddle.x + paddle.w
    ) {
        // Reflect with angle based on where it hit the paddle.
        let hit = (ball.x - (paddle.x + paddle.w / 2)) / (paddle.w / 2);
        hit = clamp(hit, -1, 1);
        const angle = hit * (Math.PI / 3); // max 60°
        ball.dx = ball.speed * Math.sin(angle);
        ball.dy = -ball.speed * Math.cos(angle);
        ball.y = paddle.y - ball.r - 0.5; // lift out of the paddle
        sound.paddle();
    }
}

function brickCollision(ball) {
    for (const b of bricks) {
        if (!b.alive) continue;
        if (
            ball.x + ball.r > b.x &&
            ball.x - ball.r < b.x + b.w &&
            ball.y + ball.r > b.y &&
            ball.y - ball.r < b.y + b.h
        ) {
            // Determine reflection axis by smallest overlap.
            const overlapL = ball.x + ball.r - b.x;
            const overlapR = b.x + b.w - (ball.x - ball.r);
            const overlapT = ball.y + ball.r - b.y;
            const overlapB = b.y + b.h - (ball.y - ball.r);
            const minX = Math.min(overlapL, overlapR);
            const minY = Math.min(overlapT, overlapB);

            if (minX < minY) {
                ball.dx = -ball.dx;
                ball.x += overlapL < overlapR ? -minX : minX;
            } else {
                ball.dy = -ball.dy;
                ball.y += overlapT < overlapB ? -minY : minY;
            }

            b.alive = false;
            game.bricksLeft--;
            game.score += 10 * game.level;
            spawnBurst(b.x + b.w / 2, b.y + b.h / 2, ROW_COLORS[b.row % ROW_COLORS.length], 10);
            sound.brick(b.row);
            updateHUD();
            registerBrickHit();

            if (game.bricksLeft <= 0) nextLevelOrWin();
            return; // one brick per sub-step keeps physics stable
        }
    }
}

/* Track a rolling window of brick hits; a hot streak triggers ball rain. */
function registerBrickHit() {
    const t = performance.now();
    comboHits.push(t);
    while (comboHits.length && t - comboHits[0] > COMBO.window) comboHits.shift();
    if (comboHits.length >= COMBO.needed && t >= rainCooldownUntil) {
        comboHits = [];            // consume the streak — need a fresh run to retrigger
        rainCooldownUntil = t + COMBO.cooldown;
        triggerBallRain();
    }
}

/* Y just below the lowest brick row — extra balls spawn here so they fall
   toward the paddle instead of raining down onto the bricks (which would be
   free hits). Player still has to catch them. */
function brickFieldBottom() {
    const { padTop, h, gap } = CONFIG.brick;
    const rows = rowsForLevel(game.level);
    return padTop + rows * (h + gap) - gap;
}

/* Ball rain: pour extra balls in from below the bricks, falling downward. */
function triggerBallRain() {
    if (balls.length >= COMBO.maxBalls) return;
    const n = Math.min(COMBO.rainBalls, COMBO.maxBalls - balls.length);
    const speed = levelBallSpeed();
    const spawnY = brickFieldBottom() + 30; // safely under the brick field
    for (let i = 0; i < n; i++) {
        const b = makeBall();
        b.speed = speed;
        b.stuck = false;
        b.x = clamp(WORLD_W / 2 + (i - (n - 1) / 2) * 70, b.r, WORLD_W - b.r);
        b.y = spawnY;
        const angle = (i - (n - 1) / 2) * 0.35; // gentle downward spread
        b.dx = speed * Math.sin(angle);
        b.dy = speed * Math.cos(angle);         // positive dy = downward → falls to paddle
        balls.push(b);
        spawnBurst(b.x, b.y, "#4ee39a", 12);
    }
    rainFlash = 1.2;
    sound.rain();
}

/* ============================================================
   Particles
   ============================================================ */
function spawnBurst(x, y, color, count) {
    for (let i = 0; i < count; i++) {
        const a = Math.random() * Math.PI * 2;
        const sp = 40 + Math.random() * 160;
        particles.push({
            x, y,
            dx: Math.cos(a) * sp,
            dy: Math.sin(a) * sp,
            life: 1,
            size: 2 + Math.random() * 3,
            color,
        });
    }
    if (particles.length > 400) particles.splice(0, particles.length - 400);
}

function updateParticles(dt) {
    for (let i = particles.length - 1; i >= 0; i--) {
        const p = particles[i];
        p.x += p.dx * dt;
        p.y += p.dy * dt;
        p.dy += 240 * dt; // gravity
        p.life -= dt * 1.6;
        if (p.life <= 0) particles.splice(i, 1);
    }
}

/* ============================================================
   Rendering
   ============================================================ */
function draw() {
    ctx.clearRect(0, 0, WORLD_W, WORLD_H);
    drawBricks();
    drawBalls();
    drawPaddle();
    drawParticles();
    if (rainFlash > 0) drawRainBanner();
    if (game.state === STATE.READY) drawReadyHint();
}

function drawBricks() {
    for (const b of bricks) {
        if (!b.alive) continue;
        // Flat fill, gently rounded — no glow.
        roundRect(b.x, b.y, b.w, b.h, 6);
        ctx.fillStyle = ROW_COLORS[b.row % ROW_COLORS.length];
        ctx.fill();
    }
}

function drawPaddle() {
    roundRect(paddle.x, paddle.y, paddle.w, paddle.h, paddle.h / 2);
    ctx.fillStyle = CONFIG.paddle.color;
    ctx.fill();
}

function drawBalls() {
    for (const ball of balls) {
        // Subtle, monochrome, short trail — a hint of motion, not a neon streak.
        for (let i = 0; i < ball.trail.length; i++) {
            const t = ball.trail[i];
            const k = i / ball.trail.length;
            ctx.beginPath();
            ctx.arc(t.x, t.y, ball.r * k * 0.9, 0, Math.PI * 2);
            ctx.fillStyle = `rgba(244, 246, 251, ${k * 0.18})`;
            ctx.fill();
        }
        ctx.beginPath();
        ctx.arc(ball.x, ball.y, ball.r, 0, Math.PI * 2);
        ctx.fillStyle = CONFIG.ball.color;
        ctx.fill();
    }
}

function drawRainBanner() {
    ctx.save();
    ctx.globalAlpha = Math.min(1, rainFlash * 2);
    ctx.fillStyle = "#4ee39a";
    ctx.font = "700 22px system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.fillText("BONUS BALL", WORLD_W / 2, 42);
    ctx.restore();
    ctx.textAlign = "start";
}

function drawParticles() {
    for (const p of particles) {
        ctx.globalAlpha = Math.max(0, p.life);
        ctx.fillStyle = p.color;
        ctx.fillRect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size);
    }
    ctx.globalAlpha = 1;
}

function drawReadyHint() {
    ctx.fillStyle = "rgba(139, 144, 157, 0.95)";
    ctx.font = "500 14px system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.fillText("Tap or press Space to launch", WORLD_W / 2, paddle.y - 44);
    ctx.textAlign = "start";
}

/* ============================================================
   Main loop (delta-time)
   ============================================================ */
let lastTime = 0;

function frame(now) {
    if (!lastTime) lastTime = now;
    let dt = (now - lastTime) / 1000;
    lastTime = now;
    dt = Math.min(dt, 0.05); // clamp huge gaps (tab switch)

    if (game.state === STATE.RUNNING || game.state === STATE.READY) {
        updatePaddle(dt);
        if (game.state === STATE.RUNNING) updateBalls(dt);
        updateParticles(dt);
        if (rainFlash > 0) rainFlash = Math.max(0, rainFlash - dt);
    }
    draw();
    requestAnimationFrame(frame);
}

/* ============================================================
   HUD + overlay helpers
   ============================================================ */
function updateHUD() {
    scoreEl.textContent = game.score;
    levelEl.textContent = game.level;
    // Always render maxLives hearts; lost ones are dimmed so the width stays fixed.
    let hearts = "";
    for (let i = 0; i < CONFIG.maxLives; i++) {
        hearts += `<span class="heart${i < game.lives ? "" : " lost"}">♥</span>`;
    }
    livesEl.innerHTML = hearts;
}

/* Minimal line icons for overlays (stroke = currentColor) */
const svg = (paths) =>
    `<svg viewBox="0 0 24 24" width="40" height="40" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`;
/* The game's logo mark — a mini breakout board (bricks · ball · paddle) */
const LOGO = (s) =>
    `<svg viewBox="0 0 32 32" width="${s}" height="${s}" fill="none" aria-hidden="true">` +
    '<rect x="1" y="1" width="30" height="30" rx="8" fill="#5b7cfa"/><g fill="#fff">' +
    '<rect x="6" y="7" width="6" height="3" rx="1" opacity=".95"/><rect x="13" y="7" width="6" height="3" rx="1" opacity=".7"/><rect x="20" y="7" width="6" height="3" rx="1" opacity=".95"/>' +
    '<rect x="6" y="12" width="6" height="3" rx="1" opacity=".7"/><rect x="13" y="12" width="6" height="3" rx="1" opacity=".95"/><rect x="20" y="12" width="6" height="3" rx="1" opacity=".7"/>' +
    '<circle cx="16" cy="20.5" r="2.2"/><rect x="10" y="24.6" width="12" height="2.6" rx="1.3"/></g></svg>';

const OVERLAY_ICONS = {
    start: LOGO(56),
    win: svg('<circle cx="12" cy="12" r="9"/><path d="m8.3 12 2.6 2.6 4.8-5.2"/>'),
    lose: svg('<circle cx="12" cy="12" r="9"/><path d="m9 9 6 6"/><path d="m15 9-6 6"/>'),
    pause: svg('<circle cx="12" cy="12" r="9"/><path d="M10 9v6"/><path d="M14 9v6"/>'),
};
const ICON_COLOR = { start: "var(--muted)", win: "var(--accent)", lose: "var(--heart)", pause: "var(--muted)" };

function showOverlay(screen) {
    overlay.dataset.screen = screen;
    overlayIcon.innerHTML = OVERLAY_ICONS[screen] || OVERLAY_ICONS.start;
    overlayIcon.style.color = ICON_COLOR[screen] || "var(--muted)";
    if (screen === "win") {
        overlayTitle.textContent = "You Win!";
        overlaySub.textContent = "You cleared every brick.";
        overlayScore.textContent = `Final Score: ${game.score}`;
        primaryBtn.textContent = "Play Again";
    } else if (screen === "lose") {
        overlayTitle.textContent = "Game Over";
        overlaySub.textContent = "The ball got away this time.";
        overlayScore.textContent = `Score: ${game.score}`;
        primaryBtn.textContent = "Try Again";
    } else {
        overlayTitle.textContent = "Break the Bricks";
        overlaySub.textContent = "Clear every brick. Don't drop the ball.";
        overlayScore.textContent = "";
        primaryBtn.textContent = "Play";
    }
    overlay.classList.add("is-visible");
}

function hideOverlay() {
    overlay.classList.remove("is-visible");
}

function shakeScreen() {
    wrap.classList.remove("shake");
    void wrap.offsetWidth; // reflow to restart animation
    wrap.classList.add("shake");
}

/* ============================================================
   Controls
   ============================================================ */
function primaryAction() {
    sound.ensure();
    if (game.state === STATE.PAUSED) {
        togglePause(); // resume
    } else if (game.state === STATE.START || game.state === STATE.WIN || game.state === STATE.LOSE) {
        startGame();
    }
}
primaryBtn.addEventListener("click", primaryAction);

/* Pointer → move paddle (works for mouse and touch) */
function pointerX(e) {
    const rect = canvas.getBoundingClientRect();
    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    return ((clientX - rect.left) / rect.width) * WORLD_W;
}

function onPointerMove(e) {
    if (game.state !== STATE.RUNNING && game.state !== STATE.READY) return;
    paddle.targetX = clamp(pointerX(e), 0, WORLD_W);
}

function onPointerDown(e) {
    sound.ensure();
    if (game.state === STATE.READY) {
        paddle.targetX = clamp(pointerX(e), 0, WORLD_W);
        game.state = STATE.RUNNING;
        launchBall();
    } else if (game.state === STATE.RUNNING) {
        paddle.targetX = clamp(pointerX(e), 0, WORLD_W);
    }
}

canvas.addEventListener("mousemove", onPointerMove);
canvas.addEventListener("mousedown", onPointerDown);
canvas.addEventListener("touchstart", (e) => { e.preventDefault(); onPointerDown(e); }, { passive: false });
canvas.addEventListener("touchmove", (e) => { e.preventDefault(); onPointerMove(e); }, { passive: false });

/* Keyboard */
document.addEventListener("keydown", (e) => {
    if (e.code === "ArrowLeft" || e.code === "KeyA") input.left = true;
    else if (e.code === "ArrowRight" || e.code === "KeyD") input.right = true;
    else if (e.code === "Space") {
        e.preventDefault();
        if (game.state === STATE.READY) { game.state = STATE.RUNNING; launchBall(); }
        else if (game.state === STATE.PAUSED) togglePause();
        else if (game.state === STATE.START || game.state === STATE.WIN || game.state === STATE.LOSE) primaryAction();
    } else if (e.code === "KeyP" || e.code === "Escape") {
        togglePause();
    }
});
document.addEventListener("keyup", (e) => {
    if (e.code === "ArrowLeft" || e.code === "KeyA") input.left = false;
    else if (e.code === "ArrowRight" || e.code === "KeyD") input.right = false;
});

/* On-screen mobile buttons */
function holdButton(btn, onStart, onEnd) {
    const start = (e) => { e.preventDefault(); onStart(); };
    const end = (e) => { e.preventDefault(); onEnd(); };
    btn.addEventListener("touchstart", start, { passive: false });
    btn.addEventListener("touchend", end, { passive: false });
    btn.addEventListener("touchcancel", end, { passive: false });
    btn.addEventListener("mousedown", start);
    btn.addEventListener("mouseup", end);
    btn.addEventListener("mouseleave", end);
}
holdButton(leftBtn, () => (input.left = true), () => (input.left = false));
holdButton(rightBtn, () => (input.right = true), () => (input.right = false));
launchBtn.addEventListener("click", () => {
    sound.ensure();
    if (game.state === STATE.READY) { game.state = STATE.RUNNING; launchBall(); }
});

/* Pause / sound toggles */
function togglePause() {
    if (game.state === STATE.RUNNING || game.state === STATE.READY) {
        game.state = STATE.PAUSED;
        overlay.dataset.screen = "pause";
        overlayIcon.innerHTML = OVERLAY_ICONS.pause;
        overlayIcon.style.color = ICON_COLOR.pause;
        overlayTitle.textContent = "Paused";
        overlaySub.textContent = "Take a breather.";
        overlayScore.textContent = "";
        primaryBtn.textContent = "Resume";
        overlay.classList.add("is-visible");
    } else if (game.state === STATE.PAUSED) {
        game.state = STATE.READY;
        // if any ball was already flying, keep the game running
        if (balls.some((b) => !b.stuck)) game.state = STATE.RUNNING;
        hideOverlay();
    }
}
pauseBtn.addEventListener("click", togglePause);

const ICON_SOUND_ON =
    '<svg viewBox="0 0 24 24" width="19" height="19" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
    '<path d="M11 5 6 9H2v6h4l5 4z"/><path d="M15.5 8.5a5 5 0 0 1 0 7"/><path d="M18.5 5.5a9 9 0 0 1 0 13"/></svg>';
const ICON_SOUND_OFF =
    '<svg viewBox="0 0 24 24" width="19" height="19" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
    '<path d="M11 5 6 9H2v6h4l5 4z"/><line x1="17" y1="9" x2="22" y2="15"/><line x1="22" y1="9" x2="17" y2="15"/></svg>';

soundBtn.addEventListener("click", () => {
    sound.enabled = !sound.enabled;
    sound.ensure();
    soundBtn.innerHTML = sound.enabled ? ICON_SOUND_ON : ICON_SOUND_OFF;
    soundBtn.classList.toggle("is-off", !sound.enabled);
});

/* Pause automatically when the tab is hidden */
document.addEventListener("visibilitychange", () => {
    if (document.hidden && (game.state === STATE.RUNNING || game.state === STATE.READY)) togglePause();
});

/* ============================================================
   Utilities
   ============================================================ */
function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }

function roundRect(x, y, w, h, r) {
    r = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
}

/* ============================================================
   Boot
   ============================================================ */
resizeCanvas();
resetPaddle();
resetBalls();
updateHUD();
showOverlay("start");
requestAnimationFrame(frame);
