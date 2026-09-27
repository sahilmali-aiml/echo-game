# ECHO//MAZE

**The maze remembers how you escape. Can you outsmart it?**

Built for AGENTHON 2026 (12-hour hackathon, Sept 27 2026).

## Play

Collect all 3 energy cells and reach the exit `▣` before the hunter catches you.

- **Move:** `WASD` or arrow keys
- **Goal:** collect all 3 cyan energy cells, then reach the green exit tile
- **Danger:** the red hunter is watching how you move

No install needed — open `index.html` in a browser, or play the deployed version: **[LIVE LINK HERE]**

## What makes it "AI"

The hunter isn't scripted to just walk toward you. It reads your **recent movement history** every 1.5 seconds and picks one of three explainable strategies:

| Strategy | Trigger | Behavior |
|---|---|---|
| **Direct Pursuit** | Default | A* pathfinds straight to your current tile |
| **Interception** | You've moved the same direction repeatedly (≥55% of recent moves) | Projects your path forward up to 4 tiles and moves to cut you off |
| **Route Guarding** | You keep revisiting the same tiles (>42% revisit rate) | Identifies the tile you loop through most and holds that junction |

Every strategy switch is logged in real time in the **HUNTER.LOG** panel with the reasoning that triggered it — e.g. *"Detected 7/12 recent moves rightward. Predicting route, moving to intercept."*

This is deliberately **not** a trained neural network — it's real-time heuristic decision-making over recorded game state (position history + direction history) combined with A* search for movement. That combination is what adapts the difficulty: the more predictable you are, the faster and smarter the hunter gets (its move interval shortens with each strategy switch).

## Technical details

- **Maze generation:** recursive backtracker on a logical cell grid, carved into a double-resolution tile grid, plus ~8% random extra wall removal to create loops (so there's more than one route — necessary for "route guarding" to mean anything)
- **Pathfinding:** A* with Manhattan-distance heuristic, 4-directional movement
- **Reachability:** every generated maze is fully connected by construction (backtracker guarantees a spanning tree before loops are added) — verified against 200 randomized generation trials
- **Stack:** vanilla HTML5 Canvas + CSS + JavaScript, zero dependencies, zero API keys

## Files

```
echo-maze/
├── index.html   # structure + UI screens
├── style.css    # cyberpunk terminal theme
└── game.js      # maze gen, A* pathfinding, adaptive AI, render loop
```

## Run locally

Just open `index.html` in any modern browser. No build step, no server required.
