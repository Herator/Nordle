import { initGame, setSecretWord } from "./script.js";

// ---- Challenge mode entry point ----
// Called from main.js when the user picks Challenge mode.
// `player`    — { id, username, avatar, guildId, channelId }
// `gameState` — shared mutable object { currentRow, gameOver, onRoundDone }
// `helpers`   — { resetGrid, resetKeyboard, showMessage, showScreen }

export async function startChallengeMode(player, gameState, helpers) {
  await initGame();
  await joinChallengeLobby(player, gameState, helpers);
}

// ---- Lobby ----

function lobbyParams(player) {
  return {
    userId: player.id,
    username: player.username,
    avatar: player.avatar,
    guildId: player.guildId,
    channelId: player.channelId,
  };
}

let pollInterval = null;
let roundStartTime = null;
let currentLobby = null;

function startPoll(player, gameState, helpers) {
  stopPoll();
  pollInterval = setInterval(() => pollLobby(player, gameState, helpers), 2000);
}

function stopPoll() {
  if (pollInterval) { clearInterval(pollInterval); pollInterval = null; }
}

async function joinChallengeLobby(player, gameState, helpers) {
  const { showScreen } = helpers;
  try {
    const res = await fetch('/api/challenge/create-or-join', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(lobbyParams(player)),
    });
    currentLobby = await res.json();
    renderLobby(player, gameState, helpers);
    showScreen('lobby-screen');
    startPoll(player, gameState, helpers);
  } catch (e) {
    helpers.showMessage('Kunne ikke koble til lobbyen.', 'error');
  }
}

async function pollLobby(player, gameState, helpers) {
  try {
    const { guildId, channelId, id } = player;
    const url = `/api/challenge/lobby?guildId=${encodeURIComponent(guildId ?? '')}&channelId=${encodeURIComponent(channelId ?? '')}&userId=${encodeURIComponent(id)}`;
    const res = await fetch(url);
    const lobby = await res.json();
    if (!lobby) return;
    currentLobby = lobby;

    if (lobby.finished) {
      showFinalResults(player, gameState, helpers);
      return;
    }

    if (!lobby.started) {
      renderLobby(player, gameState, helpers);
      return;
    }

    // Game is running
    const roundResults = lobby.roundResults[lobby.currentRound] ?? [];
    const myResult = roundResults.find(r => r.userId === player.id);

    const lobbyVisible = !document.getElementById('lobby-screen').classList.contains('hidden');
    const resultsVisible = !document.getElementById('results-screen').classList.contains('hidden');
    const gameVisible = !lobbyVisible && !resultsVisible;

    if (!myResult) {
      // Haven't played this round yet
      if (!gameVisible) startChallengeRound(lobby, player, gameState, helpers);
    } else {
      // Already submitted
      if (!resultsVisible) {
        showRoundResults(lobby, player, gameState, helpers);
      } else {
        updateResultsScreen(lobby, player, gameState, helpers);
      }
    }
  } catch {}
}

// ---- Lobby UI ----

function renderLobby(player, gameState, helpers) {
  if (!currentLobby) return;
  const isMaster = currentLobby.isLobbyMaster;

  document.getElementById('lobby-master-badge').classList.toggle('hidden', !isMaster);
  document.getElementById('lobby-master-controls').classList.toggle('hidden', !isMaster);
  document.getElementById('lobby-waiting-msg').classList.toggle('hidden', isMaster);

  if (isMaster) {
    document.getElementById('rounds-display').textContent = currentLobby.rounds;
  }

  const list = document.getElementById('lobby-players-list');
  list.innerHTML = '';

  for (const p of currentLobby.players) {
    const row = document.createElement('div');
    row.className = 'lobby-player-row';

    if (p.avatar) {
      const img = document.createElement('img');
      img.src = `https://cdn.discordapp.com/avatars/${p.userId}/${p.avatar}.png?size=32`;
      img.alt = p.username;
      row.appendChild(img);
    } else {
      const ph = document.createElement('div');
      ph.className = 'lobby-player-avatar-ph';
      row.appendChild(ph);
    }

    const name = document.createElement('span');
    name.className = 'lobby-player-name';
    name.textContent = p.userId === player.id ? `${p.username} (deg)` : p.username;
    row.appendChild(name);

    const tag = document.createElement('span');
    tag.className = 'lobby-player-tag' + (p.userId === currentLobby.masterId ? ' master' : '');
    tag.textContent = p.userId === currentLobby.masterId ? 'Mester' : (p.online ? 'Inne' : 'Borte');
    row.appendChild(tag);

    list.appendChild(row);
  }
}

export function setupLobbyHandlers(player, gameState, helpers) {
  const { showScreen } = helpers;

  // Back button
  document.getElementById('btn-leave-lobby').addEventListener('click', async () => {
    stopPoll();
    await fetch('/api/challenge/leave', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(lobbyParams(player)),
    }).catch(() => {});
    currentLobby = null;
    document.getElementById('players-sidebar').classList.remove('hidden');
    showScreen('mode-screen');
  });

  // Round count controls
  let roundCount = 3;
  document.getElementById('btn-rounds-down').addEventListener('click', () => {
    roundCount = Math.max(1, roundCount - 1);
    document.getElementById('rounds-display').textContent = roundCount;
    fetch('/api/challenge/configure', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...lobbyParams(player), rounds: roundCount }),
    }).catch(() => {});
  });
  document.getElementById('btn-rounds-up').addEventListener('click', () => {
    roundCount = Math.min(20, roundCount + 1);
    document.getElementById('rounds-display').textContent = roundCount;
    fetch('/api/challenge/configure', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...lobbyParams(player), rounds: roundCount }),
    }).catch(() => {});
  });

  // Start button
  document.getElementById('btn-start-challenge').addEventListener('click', async () => {
    const res = await fetch('/api/challenge/start', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(lobbyParams(player)),
    });
    const lobby = await res.json();
    if (lobby) startChallengeRound(lobby, player, gameState, helpers);
  });

  // Results: next round button
  document.getElementById('btn-next-round').addEventListener('click', async () => {
    const res = await fetch('/api/challenge/next-round', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(lobbyParams(player)),
    });
    const lobby = await res.json();
    if (lobby?.finished) showFinalResults(player, gameState, helpers);
    else if (lobby) startChallengeRound(lobby, player, gameState, helpers);
  });

  // Results: back to menu button
  document.getElementById('btn-final-back').addEventListener('click', async () => {
    stopPoll();
    await fetch('/api/challenge/disband', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(lobbyParams(player)),
    }).catch(() => {});
    currentLobby = null;
    document.getElementById('players-sidebar').classList.remove('hidden');
    showScreen('mode-screen');
  });
}

// ---- Round flow ----

function startChallengeRound(lobby, player, gameState, helpers) {
  stopPoll();
  currentLobby = lobby;

  setSecretWord(lobby.currentWord);
  helpers.resetGrid();
  helpers.resetKeyboard();

  const indicator = document.getElementById('challenge-indicator');
  indicator.textContent = `Runde ${lobby.currentRound + 1} av ${lobby.rounds}`;
  indicator.classList.remove('hidden');

  helpers.showScreen(null);
  roundStartTime = Date.now();

  // Tell main.js what to call when the round ends
  gameState.onRoundDone = (guesses, won) => onRoundDone(guesses, won, player, gameState, helpers);

  startPoll(player, gameState, helpers);

  const firstInput = document.querySelector('#row-0 input');
  if (firstInput) firstInput.focus();
}

function onRoundDone(guesses, won, player, gameState, helpers) {
  const timeMs = Date.now() - (roundStartTime ?? Date.now());
  fetch('/api/challenge/submit', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...lobbyParams(player), guesses, timeMs, won }),
  })
    .then(r => r.json())
    .then(lobby => {
      currentLobby = lobby;
      showRoundResults(lobby, player, gameState, helpers);
    })
    .catch(() => {});
}

// ---- Results / Podium ----

function showRoundResults(lobby, player, gameState, helpers) {
  stopPoll();
  currentLobby = lobby;
  updateResultsScreen(lobby, player, gameState, helpers);
  helpers.showScreen('results-screen');
  startPoll(player, gameState, helpers);
}

function showFinalResults(player, gameState, helpers) {
  stopPoll();
  updateResultsScreen(currentLobby, player, gameState, helpers);
  helpers.showScreen('results-screen');
}

function makeAvatar(p, size) {
  if (p.avatar) {
    const img = document.createElement('img');
    img.className = 'podium-avatar';
    img.src = `https://cdn.discordapp.com/avatars/${p.userId}/${p.avatar}.png?size=64`;
    img.style.width = img.style.height = size + 'px';
    return img;
  }
  const ph = document.createElement('div');
  ph.className = 'podium-avatar-ph';
  ph.style.width = ph.style.height = size + 'px';
  return ph;
}

function updateResultsScreen(lobby, player, gameState, helpers) {
  if (!lobby) return;
  const round = lobby.currentRound;
  const roundResults = lobby.roundResults[round] ?? [];
  const isMaster = lobby.isLobbyMaster;
  const allDone = lobby.players.every(p => roundResults.find(r => r.userId === p.userId));

  document.getElementById('results-title').textContent =
    lobby.finished ? 'Spillet er ferdig!' : `Runde ${round + 1} ferdig!`;
  document.getElementById('results-word-reveal').textContent =
    lobby.currentWord ? `Ordet var: ${lobby.currentWord.toUpperCase()}` : '';

  // Sort round results: fewest guesses wins, then fastest time
  const sorted = [...roundResults].sort((a, b) => {
    if (a.score !== b.score) return a.score - b.score;
    return (a.timeMs ?? 99999) - (b.timeMs ?? 99999);
  });

  // Podium — order: 2nd, 1st, 3rd (so 1st stands tallest in the middle)
  const podium = document.getElementById('podium-container');
  podium.innerHTML = '';
  const podiumOrder = [sorted[1], sorted[0], sorted[2]].filter(Boolean);
  const podiumClasses = ['podium-2nd', 'podium-1st', 'podium-3rd'];
  const podiumLabels = ['🥈', '🥇', '🥉'];

  podiumOrder.forEach((entry, idx) => {
    const p = lobby.players.find(x => x.userId === entry.userId);
    if (!p) return;

    const place = document.createElement('div');
    place.className = `podium-place ${podiumClasses[idx]}`;

    place.appendChild(makeAvatar(p, 36));

    const nameEl = document.createElement('div');
    nameEl.className = 'podium-name';
    nameEl.textContent = p.userId === player.id ? 'Deg' : p.username;
    place.appendChild(nameEl);

    const scoreEl = document.createElement('div');
    scoreEl.className = 'podium-score-label';
    scoreEl.textContent = entry.won ? `${entry.guesses} forsøk` : 'Klarte det ikke';
    place.appendChild(scoreEl);

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

    const nameEl = document.createElement('div');
    nameEl.className = 'lb-name';
    nameEl.textContent = entry.userId === player.id ? 'Deg' : entry.username;
    row.appendChild(nameEl);

    const rsEl = document.createElement('div');
    rsEl.className = 'lb-round-score';
    rsEl.textContent = roundEntry
      ? (roundEntry.won ? `${roundEntry.guesses} forsøk` : 'DNF')
      : '⏳';
    row.appendChild(rsEl);

    const totalEl = document.createElement('div');
    totalEl.className = 'lb-total-score';
    totalEl.textContent = `${entry.score}p`;
    row.appendChild(totalEl);

    lb.appendChild(row);
  });

  // Action buttons
  const btnNext = document.getElementById('btn-next-round');
  const waitMsg = document.getElementById('waiting-next-msg');
  const btnBack = document.getElementById('btn-final-back');

  if (lobby.finished) {
    btnNext.classList.add('hidden');
    waitMsg.classList.add('hidden');
    btnBack.classList.remove('hidden');
  } else if (allDone && isMaster) {
    btnNext.classList.remove('hidden');
    btnNext.textContent = `Neste runde (${round + 2}/${lobby.rounds}) →`;
    waitMsg.classList.add('hidden');
    btnBack.classList.add('hidden');
  } else if (allDone && !isMaster) {
    btnNext.classList.add('hidden');
    waitMsg.classList.remove('hidden');
    waitMsg.textContent = 'Alle er ferdige — venter på at lobby-mester starter neste runde…';
    btnBack.classList.add('hidden');
  } else {
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
