import { DiscordSDK } from "@discord/embedded-app-sdk";
import { initGame, checkWord, isValidWord, getSecretWord, setSecretWord } from "./script.js";
import "./style.css";

let auth;

async function setupDiscordSdk() {
  const clientId = import.meta.env.VITE_DISCORD_CLIENT_ID;
  if (!clientId) throw new Error('No Discord client ID configured');

  const discordSdk = new DiscordSDK(clientId);

  const readyTimeout = new Promise((_, reject) =>
    setTimeout(() => reject(new Error('Discord SDK ready timeout')), 10000)
  );
  await Promise.race([discordSdk.ready(), readyTimeout]);
  console.log("Discord SDK is ready");

  const { code } = await discordSdk.commands.authorize({
    client_id: clientId,
    response_type: "code",
    state: "",
    prompt: "none",
    scope: ["identify", "guilds", "applications.commands"],
  });

  const response = await fetch("/api/token", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ code }),
  });
  const { access_token } = await response.json();

  auth = await discordSdk.commands.authenticate({ access_token });
  if (auth == null) throw new Error("Authenticate command failed");
}

// ---- Player identity ----
let playerId = null;
let playerUsername = null;
let playerAvatar = null;
let playerChannelId = null;
let playerGuildId = null;

// ---- Game state ----
let currentRow = 0;
let gameOver = false;
const MAX_ROWS = 6;

// ---- Mode ----
let gameMode = null; // 'daily' | 'challenge'
let challengeLobby = null;
let challengePollInterval = null;
let roundStartTime = null;

// ---- UI helpers ----

function showMessage(text, type) {
  const msg = document.getElementById('message');
  msg.textContent = text;
  msg.className = type || '';
  if (type === 'error') {
    setTimeout(() => { msg.textContent = ''; msg.className = ''; }, 2000);
  }
}

function showScreen(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.add('hidden'));
  if (id) document.getElementById(id).classList.remove('hidden');
}

function hideScreen(id) {
  document.getElementById(id).classList.add('hidden');
}

// ---- Game grid ----

function resetGrid() {
  currentRow = 0;
  gameOver = false;
  document.querySelectorAll('input').forEach(input => {
    input.value = '';
    input.className = '';
    input.disabled = true;
  });
  // Enable row 0
  document.querySelectorAll('#row-0 input').forEach(i => { i.disabled = false; });
  showMessage('Gjett ordet!', '');
}

function getRowWord(row) {
  return Array.from(document.querySelectorAll(`#row-${row} input`))
    .map(i => i.value.toLowerCase()).join('');
}

function isRowFull(row) {
  return Array.from(document.querySelectorAll(`#row-${row} input`))
    .every(i => i.value.length === 1);
}

function applyResults(row, results) {
  const inputs = document.querySelectorAll(`#row-${row} input`);
  const word = getRowWord(row);
  inputs.forEach((input, i) => {
    const delay = i * 300;
    setTimeout(() => {
      input.classList.add('flip');
      setTimeout(() => { input.classList.add(results[i]); input.disabled = true; }, 250);
    }, delay);
    const keyBtn = document.querySelector(`#keyboard button[data-key="${word[i]}"]`);
    if (keyBtn) {
      setTimeout(() => {
        if (results[i] === 'correct') keyBtn.className = 'correct';
        else if (results[i] === 'present' && !keyBtn.classList.contains('correct')) keyBtn.className = 'present';
        else if (results[i] === 'absent' && !keyBtn.classList.contains('correct') && !keyBtn.classList.contains('present')) keyBtn.className = 'absent';
      }, delay + 250);
    }
  });
}

function applyResultsInstant(row, word, results) {
  const inputs = document.querySelectorAll(`#row-${row} input`);
  inputs.forEach((input, i) => {
    input.value = word[i] || '';
    input.classList.add(results[i]);
    input.disabled = true;
  });
  for (let i = 0; i < word.length; i++) {
    const keyBtn = document.querySelector(`#keyboard button[data-key="${word[i]}"]`);
    if (keyBtn) {
      if (results[i] === 'correct') keyBtn.className = 'correct';
      else if (results[i] === 'present' && !keyBtn.classList.contains('correct')) keyBtn.className = 'present';
      else if (results[i] === 'absent' && !keyBtn.classList.contains('correct') && !keyBtn.classList.contains('present')) keyBtn.className = 'absent';
    }
  }
}

function resetKeyboard() {
  document.querySelectorAll('#keyboard button').forEach(btn => {
    btn.className = btn.dataset.key === 'Enter' || btn.dataset.key === 'Backspace'
      ? 'key-wide' : '';
  });
}

// ---- Submit guess ----

function submitGuess() {
  if (gameOver) return;
  if (!isRowFull(currentRow)) {
    showMessage('Fyll inn alle 5 bokstavene!', 'error');
    return;
  }

  const guess = getRowWord(currentRow);

  if (!isValidWord(guess)) {
    showMessage('Ikke et gyldig ord!', 'error');
    const row = document.getElementById(`row-${currentRow}`);
    row.classList.add('shake');
    row.addEventListener('animationend', () => row.classList.remove('shake'), { once: true });
    return;
  }

  const results = checkWord(guess);
  applyResults(currentRow, results);

  const revealTime = 5 * 300 + 300;
  const won = results.every(r => r === 'correct');
  const thisRow = currentRow;
  const done = won || thisRow + 1 >= MAX_ROWS;

  if (gameMode === 'daily') {
    reportDailyProgress(guess, results, done, won);
  }

  if (won) {
    setTimeout(() => {
      const messages = ['Fantastisk!', 'Imponerende!', 'Flott!', 'Bra!', 'Nesten!', 'Puh!'];
      showMessage(messages[currentRow] || 'Du vant!', 'win');
      gameOver = true;
      if (gameMode === 'challenge') onChallengeRoundDone(thisRow + 1, true);
    }, revealTime);
    return;
  }

  currentRow++;
  if (currentRow >= MAX_ROWS) {
    setTimeout(() => {
      showMessage(`Ordet var: ${getSecretWord().toUpperCase()}`, 'lose');
      gameOver = true;
      if (gameMode === 'challenge') onChallengeRoundDone(MAX_ROWS, false);
    }, revealTime);
    return;
  }

  setTimeout(() => {
    const nextInputs = document.querySelectorAll(`#row-${currentRow} input`);
    nextInputs.forEach(i => { i.disabled = false; });
    nextInputs[0].focus();
  }, revealTime);
}

// ---- Input handling ----

function handleKeyPress(key) {
  if (gameOver) return;
  if (key === 'Enter') { submitGuess(); return; }
  if (key === 'Backspace') {
    const inputs = Array.from(document.querySelectorAll(`#row-${currentRow} input`));
    for (let i = inputs.length - 1; i >= 0; i--) {
      if (inputs[i].value !== '') { inputs[i].value = ''; inputs[i].focus(); return; }
    }
    return;
  }
  if (/^[a-zæøå]$/i.test(key)) {
    const inputs = Array.from(document.querySelectorAll(`#row-${currentRow} input`));
    const empty = inputs.find(i => i.value === '');
    if (empty) {
      empty.value = key.toLowerCase();
      empty.classList.add('filled');
      const next = inputs.find(i => i.value === '');
      if (next) next.focus(); else empty.focus();
    }
  }
}

function setupInputHandlers() {
  document.addEventListener('keydown', (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const key = e.key;
    if (key === 'Enter' || key === 'Backspace' || /^[a-zæøåA-ZÆØÅ]$/.test(key)) {
      e.preventDefault();
      handleKeyPress(key);
    }
  });
  document.querySelectorAll('#keyboard button').forEach(btn => {
    btn.addEventListener('click', () => handleKeyPress(btn.dataset.key));
  });
  document.querySelectorAll('input').forEach(input => {
    input.addEventListener('focus', () => {
      const row = parseInt(input.dataset.row);
      if (row !== currentRow) {
        const cur = document.querySelectorAll(`#row-${currentRow} input`);
        const first = Array.from(cur).find(i => i.value === '');
        if (first) first.focus(); else cur[cur.length - 1].focus();
      }
    });
  });
}

// ---- Daily mode ----

function reportDailyProgress(word, results, done, won) {
  if (!playerId) return;
  fetch('/api/progress', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ userId: playerId, username: playerUsername, avatar: playerAvatar, guildId: playerGuildId, channelId: playerChannelId, word, results, done, won }),
  }).catch(() => {});
}

async function fetchAndRestoreState() {
  if (!playerId) return;
  try {
    const res = await fetch(`/api/state?userId=${encodeURIComponent(playerId)}`);
    const state = await res.json();
    if (!state || !state.rows || state.rows.length === 0) return;
    for (let r = 0; r < state.rows.length; r++) {
      const { word, results } = state.rows[r];
      applyResultsInstant(r, word, results);
      currentRow = r + 1;
    }
    if (state.done) {
      gameOver = true;
      if (state.won) showMessage('Du vant allerede i dag!', 'win');
      else showMessage(`Ordet var: ${getSecretWord().toUpperCase()}`, 'lose');
    } else {
      document.querySelectorAll(`#row-${currentRow} input`).forEach(i => { i.disabled = false; });
    }
  } catch {}
}

// ---- Daily players sidebar ----

function renderPlayers(players) {
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
    name.textContent = p.userId === playerId ? 'Deg' : p.username;
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

async function joinDailySession() {
  if (!playerId) return;
  await fetch('/api/join', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ userId: playerId, username: playerUsername, avatar: playerAvatar, guildId: playerGuildId, channelId: playerChannelId }),
  }).catch(() => {});
}

async function fetchPlayers() {
  try {
    const url = playerGuildId ? `/api/players?guildId=${encodeURIComponent(playerGuildId)}` : '/api/players';
    const res = await fetch(url);
    renderPlayers(await res.json());
  } catch {}
}

// ---- Challenge mode ----

function lobbyParams() {
  return { userId: playerId, username: playerUsername, avatar: playerAvatar, guildId: playerGuildId, channelId: playerChannelId };
}

async function joinChallengeLobby() {
  const res = await fetch('/api/challenge/create-or-join', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(lobbyParams()),
  });
  challengeLobby = await res.json();
  renderLobby();
  showScreen('lobby-screen');
  startLobbyPoll();
}

function startLobbyPoll() {
  stopLobbyPoll();
  challengePollInterval = setInterval(pollLobby, 2000);
}

function stopLobbyPoll() {
  if (challengePollInterval) { clearInterval(challengePollInterval); challengePollInterval = null; }
}

async function pollLobby() {
  try {
    const url = `/api/challenge/lobby?guildId=${encodeURIComponent(playerGuildId ?? '')}&channelId=${encodeURIComponent(playerChannelId ?? '')}&userId=${encodeURIComponent(playerId)}`;
    const res = await fetch(url);
    const lobby = await res.json();
    if (!lobby) return;
    challengeLobby = lobby;

    // Lobby started → switch to game
    if (lobby.started && !lobby.finished) {
      const currentResults = lobby.roundResults[lobby.currentRound] ?? [];
      const myResult = currentResults.find(r => r.userId === playerId);

      if (!myResult) {
        // We haven't played this round yet → show game
        if (document.getElementById('lobby-screen') && !document.getElementById('lobby-screen').classList.contains('hidden')) {
          startChallengeRound(lobby);
        } else if (document.getElementById('results-screen') && !document.getElementById('results-screen').classList.contains('hidden')) {
          // Master advanced, start next round
          startChallengeRound(lobby);
        }
      } else {
        // We've submitted this round → show results
        if (!document.getElementById('results-screen') || document.getElementById('results-screen').classList.contains('hidden')) {
          showRoundResults(lobby);
        } else {
          updateResultsScreen(lobby);
        }
      }
    } else if (!lobby.started) {
      renderLobby();
    } else if (lobby.finished) {
      showFinalResults(lobby);
    }
  } catch {}
}

function renderLobby() {
  if (!challengeLobby) return;
  const isMaster = challengeLobby.isLobbyMaster;

  document.getElementById('lobby-master-badge').classList.toggle('hidden', !isMaster);
  document.getElementById('lobby-master-controls').classList.toggle('hidden', !isMaster);
  document.getElementById('lobby-waiting-msg').classList.toggle('hidden', isMaster);

  if (isMaster) {
    document.getElementById('rounds-display').textContent = challengeLobby.rounds;
  }

  const list = document.getElementById('lobby-players-list');
  list.innerHTML = '';
  for (const p of challengeLobby.players) {
    const row = document.createElement('div');
    row.className = 'lobby-player-row';

    if (p.avatar) {
      const img = document.createElement('img');
      img.src = `https://cdn.discordapp.com/avatars/${p.userId}/${p.avatar}.png?size=32`;
      img.alt = p.username;
      list.appendChild(img);
      row.appendChild(img);
    } else {
      const ph = document.createElement('div');
      ph.className = 'lobby-player-avatar-ph';
      row.appendChild(ph);
    }

    const name = document.createElement('span');
    name.className = 'lobby-player-name';
    name.textContent = p.userId === playerId ? `${p.username} (deg)` : p.username;
    row.appendChild(name);

    const tag = document.createElement('span');
    tag.className = 'lobby-player-tag' + (p.userId === challengeLobby.masterId ? ' master' : '');
    tag.textContent = p.userId === challengeLobby.masterId ? 'Mester' : (p.online ? 'Inne' : 'Borte');
    row.appendChild(tag);

    list.appendChild(row);
  }
}

function startChallengeRound(lobby) {
  stopLobbyPoll();
  challengeLobby = lobby;

  // Set the secret word for this round
  setSecretWord(lobby.currentWord);
  resetGrid();
  resetKeyboard();

  const indicator = document.getElementById('challenge-indicator');
  indicator.textContent = `Runde ${lobby.currentRound + 1} av ${lobby.rounds}`;
  indicator.classList.remove('hidden');

  showScreen(null); // hide all screens, show the game
  roundStartTime = Date.now();
  startLobbyPoll();

  const firstInput = document.querySelector('#row-0 input');
  if (firstInput) firstInput.focus();
}

function onChallengeRoundDone(guesses, won) {
  const timeMs = Date.now() - (roundStartTime ?? Date.now());
  fetch('/api/challenge/submit', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...lobbyParams(), guesses, timeMs, won }),
  })
  .then(r => r.json())
  .then(data => {
    challengeLobby = data;
    showRoundResults(data);
  })
  .catch(() => {});
}

function avatarUrl(p) {
  return p.avatar
    ? `https://cdn.discordapp.com/avatars/${p.userId}/${p.avatar}.png?size=64`
    : null;
}

function makeAvatar(p, size = 42) {
  if (avatarUrl(p)) {
    const img = document.createElement('img');
    img.className = 'podium-avatar';
    img.src = avatarUrl(p);
    img.style.width = img.style.height = size + 'px';
    return img;
  }
  const ph = document.createElement('div');
  ph.className = 'podium-avatar-ph';
  ph.style.width = ph.style.height = size + 'px';
  return ph;
}

function showRoundResults(lobby) {
  stopLobbyPoll();
  challengeLobby = lobby;
  updateResultsScreen(lobby);
  showScreen('results-screen');
  startLobbyPoll();
}

function updateResultsScreen(lobby) {
  const round = lobby.currentRound;
  const roundResults = lobby.roundResults[round] ?? [];
  const isMaster = lobby.isLobbyMaster;
  const allDone = lobby.players.every(p => roundResults.find(r => r.userId === p.userId));

  // Title & word reveal
  document.getElementById('results-title').textContent =
    lobby.finished ? 'Spillet er ferdig!' : `Runde ${round + 1} ferdig!`;
  document.getElementById('results-word-reveal').textContent =
    lobby.currentWord ? `Ordet var: ${lobby.currentWord.toUpperCase()}` : '';

  // Sort by this round's score, then time as tiebreaker
  const sorted = [...roundResults].sort((a, b) => {
    if (a.score !== b.score) return a.score - b.score;
    return (a.timeMs ?? 99999) - (b.timeMs ?? 99999);
  });

  // Build podium (top 3)
  const podium = document.getElementById('podium-container');
  podium.innerHTML = '';

  const podiumOrder = [sorted[1], sorted[0], sorted[2]].filter(Boolean); // 2nd, 1st, 3rd
  const podiumClasses = ['podium-2nd', 'podium-1st', 'podium-3rd'];
  const podiumLabels = ['🥈', '🥇', '🥉'];

  podiumOrder.forEach((entry, idx) => {
    const player = lobby.players.find(p => p.userId === entry.userId);
    if (!player) return;
    const place = document.createElement('div');
    place.className = `podium-place ${podiumClasses[idx]}`;

    place.appendChild(makeAvatar(player, 36));

    const nameEl = document.createElement('div');
    nameEl.className = 'podium-name';
    nameEl.textContent = player.userId === playerId ? 'Deg' : player.username;
    place.appendChild(nameEl);

    const scoreLabel = document.createElement('div');
    scoreLabel.className = 'podium-score-label';
    scoreLabel.textContent = entry.won ? `${entry.guesses} forsøk` : 'Klarte det ikke';
    place.appendChild(scoreLabel);

    const block = document.createElement('div');
    block.className = 'podium-block';
    block.textContent = podiumLabels[idx];
    place.appendChild(block);

    podium.appendChild(place);
  });

  // Full leaderboard
  const lb = document.getElementById('full-leaderboard');
  lb.innerHTML = '';
  lobby.totalScores.forEach((entry, rank) => {
    const roundEntry = roundResults.find(r => r.userId === entry.userId);
    const row = document.createElement('div');
    row.className = 'lb-row';

    const rankEl = document.createElement('div');
    rankEl.className = 'lb-rank';
    rankEl.textContent = `#${rank + 1}`;
    row.appendChild(rankEl);

    row.appendChild(makeAvatar(entry, 26));

    const name = document.createElement('div');
    name.className = 'lb-name';
    name.textContent = entry.userId === playerId ? 'Deg' : entry.username;
    row.appendChild(name);

    if (roundEntry) {
      const rs = document.createElement('div');
      rs.className = 'lb-round-score';
      rs.textContent = roundEntry.won ? `${roundEntry.guesses} forsøk` : 'DNF';
      row.appendChild(rs);
    } else {
      const waiting = document.createElement('div');
      waiting.className = 'lb-round-score';
      waiting.textContent = '⏳';
      row.appendChild(waiting);
    }

    const total = document.createElement('div');
    total.className = 'lb-total-score';
    total.textContent = `${entry.score}p`;
    row.appendChild(total);

    lb.appendChild(row);
  });

  // Actions
  const btnNext = document.getElementById('btn-next-round');
  const waitMsg = document.getElementById('waiting-next-msg');
  const btnBack = document.getElementById('btn-final-back');

  if (lobby.finished) {
    btnNext.classList.add('hidden');
    waitMsg.classList.add('hidden');
    btnBack.classList.remove('hidden');
  } else if (allDone && isMaster) {
    // Everyone done + I'm master → show Next Round button
    btnNext.classList.remove('hidden');
    btnNext.textContent = `Neste runde (${round + 2}/${lobby.rounds}) →`;
    waitMsg.classList.add('hidden');
    btnBack.classList.add('hidden');
  } else if (allDone && !isMaster) {
    // Everyone done but I'm not master → wait for master
    btnNext.classList.add('hidden');
    waitMsg.classList.remove('hidden');
    waitMsg.textContent = 'Alle er ferdige — venter på at lobby-mester starter neste runde…';
    btnBack.classList.add('hidden');
  } else {
    // Still waiting for players to finish
    const doneCount = roundResults.length;
    const totalCount = lobby.players.length;
    const remaining = lobby.players
      .filter(p => !roundResults.find(r => r.userId === p.userId))
      .map(p => p.username)
      .join(', ');
    btnNext.classList.add('hidden');
    waitMsg.classList.remove('hidden');
    waitMsg.textContent = `Venter på ${totalCount - doneCount} spiller${totalCount - doneCount !== 1 ? 'e' : ''}: ${remaining}`;
    btnBack.classList.add('hidden');
  }
}

function showFinalResults(lobby) {
  challengeLobby = lobby;
  updateResultsScreen(lobby);
  showScreen('results-screen');
}

// ---- Mode selection UI ----

function setupModeScreen() {
  document.getElementById('btn-daily').addEventListener('click', () => {
    showScreen(null); // hide mode screen immediately
    showMessage('Laster…', '');
    onIdentityReady(async () => {
      gameMode = 'daily';
      document.getElementById('players-sidebar').classList.remove('hidden');
      document.getElementById('challenge-indicator').classList.add('hidden');
      await joinDailySession();
      await initGame();
      await fetchAndRestoreState();
      if (!gameOver) {
        const first = document.querySelector(`#row-${currentRow} input:not([disabled])`);
        if (first) first.focus();
        if (currentRow === 0) showMessage('Gjett ordet!', '');
      }
      fetchPlayers();
      setInterval(fetchPlayers, 3000);
    });
  });

  document.getElementById('btn-challenge').addEventListener('click', () => {
    showScreen(null); // hide mode screen immediately
    showMessage('Laster…', '');
    onIdentityReady(async () => {
      gameMode = 'challenge';
      document.getElementById('players-sidebar').classList.add('hidden');
      document.getElementById('challenge-indicator').classList.remove('hidden');
      await initGame();
      await joinChallengeLobby();
    });
  });
}

// ---- Lobby UI ----

function setupLobbyScreen() {
  document.getElementById('btn-leave-lobby').addEventListener('click', async () => {
    stopLobbyPoll();
    await fetch('/api/challenge/leave', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(lobbyParams()),
    }).catch(() => {});
    challengeLobby = null;
    gameMode = null;
    document.getElementById('players-sidebar').classList.remove('hidden');
    showScreen('mode-screen');
  });

  let roundCount = 3;
  document.getElementById('btn-rounds-down').addEventListener('click', () => {
    roundCount = Math.max(1, roundCount - 1);
    document.getElementById('rounds-display').textContent = roundCount;
    fetch('/api/challenge/configure', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...lobbyParams(), rounds: roundCount }),
    }).catch(() => {});
  });
  document.getElementById('btn-rounds-up').addEventListener('click', () => {
    roundCount = Math.min(20, roundCount + 1);
    document.getElementById('rounds-display').textContent = roundCount;
    fetch('/api/challenge/configure', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...lobbyParams(), rounds: roundCount }),
    }).catch(() => {});
  });

  document.getElementById('btn-start-challenge').addEventListener('click', async () => {
    const res = await fetch('/api/challenge/start', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(lobbyParams()),
    });
    const lobby = await res.json();
    if (lobby) startChallengeRound(lobby);
  });
}

// ---- Results UI ----

function setupResultsScreen() {
  document.getElementById('btn-next-round').addEventListener('click', async () => {
    const res = await fetch('/api/challenge/next-round', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(lobbyParams()),
    });
    const lobby = await res.json();
    if (lobby && !lobby.finished) {
      startChallengeRound(lobby);
    } else if (lobby?.finished) {
      showFinalResults(lobby);
    }
  });

  document.getElementById('btn-final-back').addEventListener('click', async () => {
    stopLobbyPoll();
    await fetch('/api/challenge/disband', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(lobbyParams()),
    }).catch(() => {});
    challengeLobby = null;
    gameMode = null;
    document.getElementById('players-sidebar').classList.remove('hidden');
    showScreen('mode-screen');
  });
}

// ---- Boot ----

// Resolves once we have a player identity (Discord auth or fallback)
let identityReady = false;
let identityWaiters = [];
function onIdentityReady(fn) {
  if (identityReady) { fn(); return; }
  identityWaiters.push(fn);
}
function resolveIdentity() {
  identityReady = true;
  identityWaiters.forEach(fn => fn());
  identityWaiters = [];
}

async function start() {
  // Set up all UI handlers immediately so buttons work right away
  setupInputHandlers();
  setupModeScreen();
  setupLobbyScreen();
  setupResultsScreen();

  document.getElementById('players-sidebar').classList.add('hidden');
  showScreen('mode-screen');

  // Auth runs in the background — UI is already interactive
  try {
    await setupDiscordSdk();
    playerId = auth.user.id;
    playerUsername = auth.user.username;
    playerAvatar = auth.user.avatar;
    try { playerChannelId = discordSdk.channelId; } catch {}
    try { playerGuildId = discordSdk.guildId; } catch {}
  } catch (e) {
    console.log("Discord SDK setup failed:", e.message);
    playerId = 'local-' + Math.random().toString(36).slice(2, 8);
    playerUsername = 'TestSpiller';
  }

  resolveIdentity();
}

start();
