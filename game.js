/* ============================================================
   ECHO//MAZE
   A browser maze game where the enemy studies the player's
   movement history and switches between three explainable
   strategies: DIRECT PURSUIT, INTERCEPTION, ROUTE GUARDING.
   No ML training — pure A* pathfinding + heuristic behavior
   selection over recorded game state. Vanilla JS, no deps.
   ============================================================ */

(() => {
  "use strict";

  // ---------- CONFIG ----------
  const MAZE_COLS = 14;      // maze cells (logical), not tiles
  const MAZE_ROWS = 10;
  const TILE = 28;           // px per tile on canvas
  const TILE_COLS = MAZE_COLS * 2 + 1;
  const TILE_ROWS = MAZE_ROWS * 2 + 1;
  const CELL_COUNT = 3;      // collectible energy cells

  const PLAYER_MOVE_COOLDOWN = 120;   // ms between accepted player moves
  const ENEMY_BASE_INTERVAL = 400;    // ms between enemy moves (start)
  const ENEMY_MIN_INTERVAL = 230;     // fastest enemy can get
  const AI_DECISION_INTERVAL = 1500;  // ms between strategy re-evaluations
  const HISTORY_WINDOW = 24;          // recent player positions tracked
  const DIRECTION_WINDOW = 12;        // recent directions tracked

  // ---------- DOM ----------
  const screens = {
    start: document.getElementById("screen-start"),
    game: document.getElementById("screen-game"),
    lose: document.getElementById("screen-lose"),
    win: document.getElementById("screen-win"),
  };
  const canvas = document.getElementById("canvas");
  const ctx = canvas.getContext("2d");
  const hudCells = document.getElementById("hud-cells");
  const hudTime = document.getElementById("hud-time");
  const hudStrategy = document.getElementById("hud-strategy");
  const aiLogFeed = document.getElementById("ai-log-feed");

  canvas.width = TILE_COLS * TILE;
  canvas.height = TILE_ROWS * TILE;

  // ---------- STATE ----------
  let tileGrid = [];          // 0 = open, 1 = wall
  let player, enemy, cells, exitTile;
  let gameState = "idle";     // idle | playing | lose | win
  let elapsedMs = 0;
  let strategySwitches = 0;
  let lastFrameTime = 0;
  let playerMoveTimer = 0;
  let enemyMoveTimer = 0;
  let aiDecisionTimer = 0;
  let enemyInterval = ENEMY_BASE_INTERVAL;
  let currentStrategy = "DIRECT PURSUIT";
  let keysDown = {};

  // ============================================================
  // MAZE GENERATION — recursive backtracker on logical cells,
  // then carved into a double-resolution tile grid so every
  // wall segment is its own tile (needed for clean A* + render).
  // ============================================================
  function generateMaze() {
    const cellVisited = Array.from({ length: MAZE_ROWS }, () => Array(MAZE_COLS).fill(false));
    // walls[r][c] = {N,S,E,W} true = wall present
    const walls = Array.from({ length: MAZE_ROWS }, () =>
      Array.from({ length: MAZE_COLS }, () => ({ N: true, S: true, E: true, W: true }))
    );

    const stack = [[0, 0]];
    cellVisited[0][0] = true;

    while (stack.length) {
      const [r, c] = stack[stack.length - 1];
      const neighbors = [];
      if (r > 0 && !cellVisited[r - 1][c]) neighbors.push(["N", r - 1, c]);
      if (r < MAZE_ROWS - 1 && !cellVisited[r + 1][c]) neighbors.push(["S", r + 1, c]);
      if (c > 0 && !cellVisited[r][c - 1]) neighbors.push(["W", r, c - 1]);
      if (c < MAZE_COLS - 1 && !cellVisited[r][c + 1]) neighbors.push(["E", r, c + 1]);

      if (neighbors.length === 0) {
        stack.pop();
        continue;
      }
      const [dir, nr, nc] = neighbors[Math.floor(Math.random() * neighbors.length)];
      const opposite = { N: "S", S: "N", E: "W", W: "E" };
      walls[r][c][dir] = false;
      walls[nr][nc][opposite[dir]] = false;
      cellVisited[nr][nc] = true;
      stack.push([nr, nc]);
    }

    // Carve loops: randomly knock down ~8% of remaining internal walls
    // so the maze isn't a single forced path (more interesting AI chase).
    for (let r = 0; r < MAZE_ROWS; r++) {
      for (let c = 0; c < MAZE_COLS; c++) {
        if (Math.random() < 0.08) {
          if (c < MAZE_COLS - 1 && walls[r][c].E) { walls[r][c].E = false; walls[r][c + 1].W = false; }
          else if (r < MAZE_ROWS - 1 && walls[r][c].S) { walls[r][c].S = false; walls[r + 1][c].N = false; }
        }
      }
    }

    // Build tile grid: all walls, then carve cell centers + connections
    const grid = Array.from({ length: TILE_ROWS }, () => Array(TILE_COLS).fill(1));
    for (let r = 0; r < MAZE_ROWS; r++) {
      for (let c = 0; c < MAZE_COLS; c++) {
        const tr = r * 2 + 1, tc = c * 2 + 1;
        grid[tr][tc] = 0;
        if (!walls[r][c].N) grid[tr - 1][tc] = 0;
        if (!walls[r][c].S) grid[tr + 1][tc] = 0;
        if (!walls[r][c].W) grid[tr][tc - 1] = 0;
        if (!walls[r][c].E) grid[tr][tc + 1] = 0;
      }
    }
    return grid;
  }

  function inBounds(r, c) {
    return r >= 0 && r < TILE_ROWS && c >= 0 && c < TILE_COLS;
  }
  function isOpen(r, c) {
    return inBounds(r, c) && tileGrid[r][c] === 0;
  }

  // ============================================================
  // A* PATHFINDING — 4-directional, uniform cost, Manhattan heuristic.
  // Returns array of {r,c} steps from start to goal (excluding start),
  // or [] if unreachable.
  // ============================================================
  function astar(start, goal) {
    const key = (r, c) => r * TILE_COLS + c;
    const open = new Map();
    const cameFrom = new Map();
    const gScore = new Map();
    const fScore = new Map();

    gScore.set(key(start.r, start.c), 0);
    fScore.set(key(start.r, start.c), manhattan(start, goal));
    open.set(key(start.r, start.c), start);

    while (open.size) {
      // pick lowest fScore
      let currentKey = null, current = null, bestF = Infinity;
      for (const [k, pos] of open) {
        const f = fScore.get(k) ?? Infinity;
        if (f < bestF) { bestF = f; currentKey = k; current = pos; }
      }
      if (current.r === goal.r && current.c === goal.c) {
        return reconstructPath(cameFrom, current, key);
      }
      open.delete(currentKey);

      const dirs = [[-1, 0], [1, 0], [0, -1], [0, 1]];
      for (const [dr, dc] of dirs) {
        const nr = current.r + dr, nc = current.c + dc;
        if (!isOpen(nr, nc)) continue;
        const tentativeG = (gScore.get(currentKey) ?? Infinity) + 1;
        const nKey = key(nr, nc);
        if (tentativeG < (gScore.get(nKey) ?? Infinity)) {
          cameFrom.set(nKey, current);
          gScore.set(nKey, tentativeG);
          fScore.set(nKey, tentativeG + manhattan({ r: nr, c: nc }, goal));
          if (!open.has(nKey)) open.set(nKey, { r: nr, c: nc });
        }
      }
    }
    return [];
  }

  function reconstructPath(cameFrom, current, key) {
    const path = [current];
    let k = key(current.r, current.c);
    while (cameFrom.has(k)) {
      current = cameFrom.get(k);
      k = key(current.r, current.c);
      path.unshift(current);
    }
    return path.slice(1); // drop the start tile itself
  }

  function manhattan(a, b) {
    return Math.abs(a.r - b.r) + Math.abs(a.c - b.c);
  }

  // BFS to find the open tile farthest from a given start — used to
  // place the exit and to sanity-check reachability of collectibles.
  function farthestTile(start) {
    const visited = new Set();
    const key = (r, c) => r * TILE_COLS + c;
    let queue = [{ r: start.r, c: start.c, dist: 0 }];
    visited.add(key(start.r, start.c));
    let farthest = queue[0];

    while (queue.length) {
      const cur = queue.shift();
      if (cur.dist > farthest.dist) farthest = cur;
      const dirs = [[-1, 0], [1, 0], [0, -1], [0, 1]];
      for (const [dr, dc] of dirs) {
        const nr = cur.r + dr, nc = cur.c + dc;
        if (isOpen(nr, nc) && !visited.has(key(nr, nc))) {
          visited.add(key(nr, nc));
          queue.push({ r: nr, c: nc, dist: cur.dist + 1 });
        }
      }
    }
    return farthest;
  }

  function allOpenTiles() {
    const out = [];
    for (let r = 0; r < TILE_ROWS; r++)
      for (let c = 0; c < TILE_COLS; c++)
        if (tileGrid[r][c] === 0) out.push({ r, c });
    return out;
  }

  // ============================================================
  // GAME SETUP
  // ============================================================
  function setupGame() {
    tileGrid = generateMaze();

    const start = { r: 1, c: 1 };
    player = { r: start.r, c: start.c, history: [], dirHistory: [] };

    exitTile = farthestTile(start);

    // Enemy starts roughly mid-maze, reachable, not on top of player
    const open = allOpenTiles().filter(t => manhattan(t, start) > 6 && manhattan(t, exitTile) > 3);
    const enemyStart = open.length ? open[Math.floor(Math.random() * open.length)] : farthestTile(exitTile);
    enemy = { r: enemyStart.r, c: enemyStart.c, path: [] };

    // Collectibles: spread across tiles that aren't too close to player start
    const candidates = allOpenTiles().filter(t =>
      manhattan(t, start) > 4 &&
      !(t.r === exitTile.r && t.c === exitTile.c) &&
      !(t.r === enemy.r && t.c === enemy.c)
    );
    cells = [];
    while (cells.length < CELL_COUNT && candidates.length) {
      const idx = Math.floor(Math.random() * candidates.length);
      const pick = candidates.splice(idx, 1)[0];
      if (!cells.some(c => manhattan(c, pick) < 3)) cells.push({ ...pick, collected: false });
    }
    while (cells.length < CELL_COUNT && candidates.length) {
      cells.push({ ...candidates.pop(), collected: false });
    }

    elapsedMs = 0;
    strategySwitches = 0;
    enemyInterval = ENEMY_BASE_INTERVAL;
    currentStrategy = "DIRECT PURSUIT";
    aiLogFeed.innerHTML = "";
    logAI("Hunter process initialized. Tracking target.", "info");
    updateHUD();
  }

  // ============================================================
  // AI DECISION LOGIC
  // Reads the player's recent position/direction history and
  // chooses one of three explainable strategies. No black box:
  // every switch is logged with the reasoning that triggered it.
  // ============================================================
  function decideStrategy() {
    const hist = player.history;
    if (hist.length < 6) return; // not enough data yet

    const recentPositions = hist.slice(-HISTORY_WINDOW);
    const uniqueKeys = new Set(recentPositions.map(p => `${p.r},${p.c}`));
    const revisitRatio = 1 - uniqueKeys.size / recentPositions.length;

    const recentDirs = player.dirHistory.slice(-DIRECTION_WINDOW);
    const dirCounts = { up: 0, down: 0, left: 0, right: 0 };
    recentDirs.forEach(d => dirCounts[d]++);
    const [dominantDir, domCount] = Object.entries(dirCounts).sort((a, b) => b[1] - a[1])[0];
    const domRatio = recentDirs.length ? domCount / recentDirs.length : 0;

    let newStrategy = "DIRECT PURSUIT";
    let target = { r: player.r, c: player.c };
    let reason = null;

    if (revisitRatio > 0.42 && recentPositions.length >= 10) {
      // Player is looping through the same corridor / junction repeatedly.
      newStrategy = "ROUTE GUARDING";
      const freq = {};
      recentPositions.forEach(p => {
        const k = `${p.r},${p.c}`;
        freq[k] = (freq[k] || 0) + 1;
      });
      const hotKey = Object.entries(freq).sort((a, b) => b[1] - a[1])[0][0];
      const [hr, hc] = hotKey.split(",").map(Number);
      target = { r: hr, c: hc };
      reason = `Detected repeated corridor use (${Math.round(revisitRatio * 100)}% revisit rate). Guarding junction.`;
    } else if (domRatio >= 0.55 && recentDirs.length >= 8) {
      // Player strongly favors one direction — project their path forward.
      newStrategy = "INTERCEPTION";
      target = projectPosition(player, dominantDir, 4);
      const dirLabel = { up: "upward", down: "downward", left: "leftward", right: "rightward" }[dominantDir];
      reason = `Detected ${domCount}/${recentDirs.length} recent moves ${dirLabel}. Predicting route, moving to intercept.`;
    } else {
      newStrategy = "DIRECT PURSUIT";
      target = { r: player.r, c: player.c };
    }

    if (newStrategy !== currentStrategy) {
      strategySwitches++;
      currentStrategy = newStrategy;
      enemyInterval = Math.max(ENEMY_MIN_INTERVAL, ENEMY_BASE_INTERVAL - strategySwitches * 18);
      logAI(reason || "Reassessing pursuit strategy.", "switch");
      logAI(`Strategy changed: ${newStrategy}.`, "switch");
      updateHUD();
    }

    enemy.targetOverride = target;
  }

  // Walk up to `steps` tiles from a position in a cardinal direction,
  // stopping at the last open tile (used to "predict" where the player
  // is heading if they keep moving the same way).
  function projectPosition(pos, dirName, steps) {
    const deltas = { up: [-1, 0], down: [1, 0], left: [0, -1], right: [0, 1] };
    const [dr, dc] = deltas[dirName];
    let r = pos.r, c = pos.c;
    for (let i = 0; i < steps; i++) {
      const nr = r + dr, nc = c + dc;
      if (!isOpen(nr, nc)) break;
      r = nr; c = nc;
    }
    return { r, c };
  }

  function logAI(message, type = "") {
    const entry = document.createElement("div");
    entry.className = `entry ${type}`;
    const ts = document.createElement("span");
    ts.className = "ts";
    ts.textContent = `[${formatTime(elapsedMs)}]`;
    entry.appendChild(ts);
    entry.appendChild(document.createTextNode(message));
    aiLogFeed.appendChild(entry);
    aiLogFeed.scrollTop = aiLogFeed.scrollHeight;
  }

  // ============================================================
  // INPUT
  // ============================================================
  window.addEventListener("keydown", (e) => {
    if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "w", "a", "s", "d", "W", "A", "S", "D"].includes(e.key)) {
      e.preventDefault();
    }
    keysDown[e.key.toLowerCase()] = true;
  });
  window.addEventListener("keyup", (e) => {
    keysDown[e.key.toLowerCase()] = false;
  });

  function tryMovePlayer() {
    let dr = 0, dc = 0, dirName = null;
    if (keysDown["w"] || keysDown["arrowup"]) { dr = -1; dirName = "up"; }
    else if (keysDown["s"] || keysDown["arrowdown"]) { dr = 1; dirName = "down"; }
    else if (keysDown["a"] || keysDown["arrowleft"]) { dc = -1; dirName = "left"; }
    else if (keysDown["d"] || keysDown["arrowright"]) { dc = 1; dirName = "right"; }
    if (!dirName) return;

    const nr = player.r + dr, nc = player.c + dc;
    if (!isOpen(nr, nc)) return;

    player.r = nr; player.c = nc;
    player.history.push({ r: nr, c: nc });
    if (player.history.length > HISTORY_WINDOW * 2) player.history.shift();
    player.dirHistory.push(dirName);
    if (player.dirHistory.length > DIRECTION_WINDOW * 2) player.dirHistory.shift();

    checkCollectibles();
    checkExit();
  }

  function checkCollectibles() {
    for (const cell of cells) {
      if (!cell.collected && cell.r === player.r && cell.c === player.c) {
        cell.collected = true;
        logAI(`Energy cell acquired (${cells.filter(c => c.collected).length}/${CELL_COUNT}).`, "info");
        updateHUD();
      }
    }
  }

  function checkExit() {
    const allCollected = cells.every(c => c.collected);
    if (player.r === exitTile.r && player.c === exitTile.c && allCollected) {
      endGame("win");
    }
  }

  // ============================================================
  // ENEMY MOVEMENT
  // ============================================================
  function moveEnemy() {
    const target = enemy.targetOverride || { r: player.r, c: player.c };
    // Recompute path if we don't have one, it's stale, or target moved
    if (!enemy.path || enemy.path.length === 0 ||
        !enemy.lastTarget || enemy.lastTarget.r !== target.r || enemy.lastTarget.c !== target.c) {
      enemy.path = astar({ r: enemy.r, c: enemy.c }, target);
      enemy.lastTarget = target;
    }
    if (enemy.path && enemy.path.length) {
      const next = enemy.path.shift();
      enemy.r = next.r; enemy.c = next.c;
    }
    if (enemy.r === player.r && enemy.c === player.c) {
      endGame("lose");
    }
  }

  // ============================================================
  // RENDER
  // ============================================================
  function render() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = "#070a12";
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // walls
    ctx.fillStyle = "#141d30";
    for (let r = 0; r < TILE_ROWS; r++) {
      for (let c = 0; c < TILE_COLS; c++) {
        if (tileGrid[r][c] === 1) {
          ctx.fillRect(c * TILE, r * TILE, TILE, TILE);
        }
      }
    }
    // subtle grid lines on open tiles
    ctx.strokeStyle = "#0d1420";
    ctx.lineWidth = 1;
    for (let r = 0; r < TILE_ROWS; r++) {
      for (let c = 0; c < TILE_COLS; c++) {
        if (tileGrid[r][c] === 0) {
          ctx.strokeRect(c * TILE + 0.5, r * TILE + 0.5, TILE - 1, TILE - 1);
        }
      }
    }

    // exit
    drawGlowTile(exitTile.r, exitTile.c, "#0aff9d", 0.18);
    ctx.fillStyle = "#0aff9d";
    ctx.font = `${TILE * 0.6}px monospace`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("▣", exitTile.c * TILE + TILE / 2, exitTile.r * TILE + TILE / 2);

    // collectibles
    cells.forEach(cell => {
      if (cell.collected) return;
      ctx.fillStyle = "#00d4ff";
      ctx.beginPath();
      ctx.arc(cell.c * TILE + TILE / 2, cell.r * TILE + TILE / 2, TILE * 0.22, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = "#00d4ff88";
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(cell.c * TILE + TILE / 2, cell.r * TILE + TILE / 2, TILE * 0.34, 0, Math.PI * 2);
      ctx.stroke();
    });

    // enemy
    drawGlowTile(enemy.r, enemy.c, "#ff3b6e", 0.22);
    ctx.fillStyle = "#ff3b6e";
    ctx.beginPath();
    ctx.arc(enemy.c * TILE + TILE / 2, enemy.r * TILE + TILE / 2, TILE * 0.32, 0, Math.PI * 2);
    ctx.fill();

    // player
    ctx.fillStyle = "#0aff9d";
    ctx.beginPath();
    ctx.arc(player.c * TILE + TILE / 2, player.r * TILE + TILE / 2, TILE * 0.3, 0, Math.PI * 2);
    ctx.fill();
  }

  function drawGlowTile(r, c, color, alpha) {
    ctx.fillStyle = color + Math.round(alpha * 255).toString(16).padStart(2, "0");
    ctx.fillRect(c * TILE, r * TILE, TILE, TILE);
  }

  // ============================================================
  // MAIN LOOP
  // ============================================================
  function loop(timestamp) {
    if (gameState !== "playing") return;
    if (!lastFrameTime) lastFrameTime = timestamp;
    const dt = timestamp - lastFrameTime;
    lastFrameTime = timestamp;

    elapsedMs += dt;
    playerMoveTimer += dt;
    enemyMoveTimer += dt;
    aiDecisionTimer += dt;

    if (playerMoveTimer >= PLAYER_MOVE_COOLDOWN) {
      tryMovePlayer();
      playerMoveTimer = 0;
    }
    if (aiDecisionTimer >= AI_DECISION_INTERVAL) {
      decideStrategy();
      aiDecisionTimer = 0;
    }
    if (enemyMoveTimer >= enemyInterval) {
      moveEnemy();
      enemyMoveTimer = 0;
    }

    updateHUD();
    render();

    if (gameState === "playing") requestAnimationFrame(loop);
  }

  // ============================================================
  // HUD + SCREEN MANAGEMENT
  // ============================================================
  function updateHUD() {
    const collected = cells.filter(c => c.collected).length;
    hudCells.textContent = `${collected} / ${CELL_COUNT}`;
    hudTime.textContent = formatTime(elapsedMs);
    hudStrategy.textContent = currentStrategy;
  }

  function formatTime(ms) {
    const totalSec = Math.floor(ms / 1000);
    const m = Math.floor(totalSec / 60).toString().padStart(2, "0");
    const s = (totalSec % 60).toString().padStart(2, "0");
    return `${m}:${s}`;
  }

  function showScreen(name) {
    Object.values(screens).forEach(s => s.classList.add("hidden"));
    screens[name].classList.remove("hidden");
  }

  function startGame() {
    setupGame();
    gameState = "playing";
    lastFrameTime = 0;
    showScreen("game");
    requestAnimationFrame(loop);
  }

  function endGame(result) {
    gameState = result;
    if (result === "lose") {
      document.getElementById("lose-cells").textContent = `${cells.filter(c => c.collected).length} / ${CELL_COUNT}`;
      document.getElementById("lose-time").textContent = formatTime(elapsedMs);
      showScreen("lose");
    } else {
      document.getElementById("win-time").textContent = formatTime(elapsedMs);
      document.getElementById("win-switches").textContent = strategySwitches;
      showScreen("win");
    }
  }

  // ============================================================
  // BUTTONS
  // ============================================================
  document.getElementById("btn-start").addEventListener("click", startGame);
  document.getElementById("btn-retry-lose").addEventListener("click", startGame);
  document.getElementById("btn-retry-win").addEventListener("click", startGame);

})();
