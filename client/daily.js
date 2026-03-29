import { initGame, getSecretWord } from "./script.js";

// ---- Daily mode entry point ----
// Called from main.js when the user picks Daily mode.
// `player`    — { id, username, avatar, guildId, channelId }
// `gameState` — shared mutable object { currentRow, gameOver }
// `helpers`   — { applyResultsInstant, showMessage, showScreen }

export async function startDailyMode(player, gameState, helpers) {
  const { applyResultsInstant, showMessage, showScreen } = helpers;

  await joinDailySession(player);
  await initGame();
  await restoreState(player, gameState, applyResultsInstant, showMessage);

  document.getElementById('players-sidebar').classList.remove('hidden');
  document.getElementById('challenge-indicator').classList.add('hidden');

  if (!gameState.gameOver) {
    const first = document.querySelector(`#row-${gameState.currentRow} input:not([disabled])`);
    if (first) first.focus();
    if (gameState.currentRow === 0) showMessage('Gjett ordet!', '');
  }

  fetchPlayers(player);
  setInterval(() => fetchPlayers(player), 3000);
}

// ---- Called after each submitted guess ----
export function reportProgress(player, word, results, done, won) {
  if (!player.id) return;
  fetch('/api/progress', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      userId: player.id,
      username: player.username,
      avatar: player.avatar,
      guildId: player.guildId,
      channelId: player.channelId,
      word, results, done, won,
    }),
  }).catch(() => {});
}

// ---- Private helpers ----

async function joinDailySession(player) {
  if (!player.id) return;
  await fetch('/api/join', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      userId: player.id,
      username: player.username,
      avatar: player.avatar,
      guildId: player.guildId,
      channelId: player.channelId,
    }),
  }).catch(() => {});
}

async function restoreState(player, gameState, applyResultsInstant, showMessage) {
  if (!player.id) return;
  try {
    const res = await fetch(`/api/state?userId=${encodeURIComponent(player.id)}`);
    const state = await res.json();
    if (!state || !state.rows || state.rows.length === 0) return;

    for (let r = 0; r < state.rows.length; r++) {
      const { word, results } = state.rows[r];
      applyResultsInstant(r, word, results);
      gameState.currentRow = r + 1;
    }

    if (state.done) {
      gameState.gameOver = true;
      if (state.won) showMessage('Du vant allerede i dag!', 'win');
      else showMessage(`Ordet var: ${getSecretWord().toUpperCase()}`, 'lose');
    } else {
      document.querySelectorAll(`#row-${gameState.currentRow} input`)
        .forEach(i => { i.disabled = false; });
    }
  } catch {}
}

async function fetchPlayers(player) {
  try {
    const params = new URLSearchParams();
    if (player.guildId) params.set('guildId', player.guildId);
    if (player.channelId) params.set('channelId', player.channelId);
    const res = await fetch(`/api/players?${params}`);
    renderPlayers(await res.json(), player.id);
  } catch {}
}

function renderPlayers(players, myId) {
  const list = document.getElementById('players-list');
  list.innerHTML = '';
  for (const p of players) {
    const card = document.createElement('div');
    card.className = 'player-card';

    const info = document.createElement('div');
    info.className = 'player-info';

    if (p.avatar) {
      const img = document.createElement('img');
      img.className = 'player-avatar';
      img.src = `https://cdn.discordapp.com/avatars/${p.userId}/${p.avatar}.png?size=32`;
      img.alt = p.username;
      info.appendChild(img);
    } else {
      const ph = document.createElement('div');
      ph.className = 'player-avatar-placeholder';
      info.appendChild(ph);
    }

    const name = document.createElement('span');
    name.className = 'player-name';
    name.textContent = p.userId === myId ? 'Deg' : p.username;
    info.appendChild(name);
    card.appendChild(info);

    const grid = document.createElement('div');
    grid.className = 'mini-grid';
    for (let r = 0; r < 6; r++) {
      const row = document.createElement('div');
      row.className = 'mini-row';
      for (let c = 0; c < 5; c++) {
        const tile = document.createElement('div');
        tile.className = 'mini-tile';
        const rd = p.rows[r];
        tile.classList.add(rd ? rd.results[c] : 'empty');
        row.appendChild(tile);
      }
      grid.appendChild(row);
    }
    card.appendChild(grid);
    list.appendChild(card);
  }
}
