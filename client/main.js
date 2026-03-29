import { DiscordSDK } from "@discord/embedded-app-sdk";
import { checkWord, isValidWord, getSecretWord } from "./script.js";
import { startDailyMode, reportProgress } from "./daily.js";
import { startChallengeMode, setupLobbyHandlers } from "./challenge.js";
import "./style.css";

// ---- Player identity (populated after Discord auth) ----
const player = { id: null, username: null, avatar: null, guildId: null, channelId: null };

// ---- Shared game state ----
const gameState = {
  currentRow: 0,
  gameOver: false,
  mode: null,         // 'daily' | 'challenge'
  onRoundDone: null,  // set by challenge.js when a round starts
};

const MAX_ROWS = 6;

// ---- UI utilities ----

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

// ---- Game grid ----

function resetGrid() {
  gameState.currentRow = 0;
  gameState.gameOver = false;
  document.querySelectorAll('input').forEach(i => {
    i.value = '';
    i.className = '';
    i.disabled = true;
  });
  document.querySelectorAll('#row-0 input').forEach(i => { i.disabled = false; });
  showMessage('Gjett ordet!', '');
}

function resetKeyboard() {
  document.querySelectorAll('#keyboard button').forEach(btn => {
    btn.className = (btn.dataset.key === 'Enter' || btn.dataset.key === 'Backspace')
      ? 'key-wide' : '';
  });
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

export function applyResultsInstant(row, word, results) {
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

// ---- Submit guess ----

function submitGuess() {
  if (gameState.gameOver) return;
  if (!isRowFull(gameState.currentRow)) {
    showMessage('Fyll inn alle 5 bokstavene!', 'error');
    return;
  }

  const guess = getRowWord(gameState.currentRow);

  if (!isValidWord(guess)) {
    showMessage('Ikke et gyldig ord!', 'error');
    const rowEl = document.getElementById(`row-${gameState.currentRow}`);
    rowEl.classList.add('shake');
    rowEl.addEventListener('animationend', () => rowEl.classList.remove('shake'), { once: true });
    return;
  }

  const results = checkWord(guess);
  applyResults(gameState.currentRow, results);

  const revealTime = 5 * 300 + 300;
  const won = results.every(r => r === 'correct');
  const thisRow = gameState.currentRow;
  const done = won || thisRow + 1 >= MAX_ROWS;

  if (gameState.mode === 'daily') {
    reportProgress(player, guess, results, done, won);
  }

  if (won) {
    setTimeout(() => {
      const msgs = ['Fantastisk!', 'Imponerende!', 'Flott!', 'Bra!', 'Nesten!', 'Puh!'];
      showMessage(msgs[thisRow] || 'Du vant!', 'win');
      gameState.gameOver = true;
      if (gameState.mode === 'challenge' && gameState.onRoundDone) {
        gameState.onRoundDone(thisRow + 1, true);
      }
    }, revealTime);
    return;
  }

  gameState.currentRow++;
  if (gameState.currentRow >= MAX_ROWS) {
    setTimeout(() => {
      showMessage(`Ordet var: ${getSecretWord().toUpperCase()}`, 'lose');
      gameState.gameOver = true;
      if (gameState.mode === 'challenge' && gameState.onRoundDone) {
        gameState.onRoundDone(MAX_ROWS, false);
      }
    }, revealTime);
    return;
  }

  setTimeout(() => {
    document.querySelectorAll(`#row-${gameState.currentRow} input`)
      .forEach(i => { i.disabled = false; });
    document.querySelector(`#row-${gameState.currentRow} input`).focus();
  }, revealTime);
}

// ---- Keyboard / input handling ----

function handleKeyPress(key) {
  if (gameState.gameOver) return;
  if (key === 'Enter') { submitGuess(); return; }
  if (key === 'Backspace') {
    const inputs = Array.from(document.querySelectorAll(`#row-${gameState.currentRow} input`));
    for (let i = inputs.length - 1; i >= 0; i--) {
      if (inputs[i].value !== '') { inputs[i].value = ''; inputs[i].focus(); return; }
    }
    return;
  }
  if (/^[a-zæøå]$/i.test(key)) {
    const inputs = Array.from(document.querySelectorAll(`#row-${gameState.currentRow} input`));
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
      if (row !== gameState.currentRow) {
        const cur = Array.from(document.querySelectorAll(`#row-${gameState.currentRow} input`));
        const first = cur.find(i => i.value === '');
        if (first) first.focus(); else cur[cur.length - 1].focus();
      }
    });
  });
}

// ---- Mode selection ----

const helpers = {
  resetGrid,
  resetKeyboard,
  applyResultsInstant,
  showMessage,
  showScreen,
};

function setupModeScreen() {
  document.getElementById('btn-daily').addEventListener('click', () => {
    showScreen(null);
    showMessage('Laster…', '');
    onIdentityReady(() => {
      gameState.mode = 'daily';
      startDailyMode(player, gameState, helpers);
    });
  });

  document.getElementById('btn-challenge').addEventListener('click', () => {
    showScreen(null);
    showMessage('Laster…', '');
    document.getElementById('challenge-indicator').classList.remove('hidden');
    onIdentityReady(() => {
      gameState.mode = 'challenge';
      document.getElementById('players-sidebar').classList.add('hidden');
      startChallengeMode(player, gameState, helpers);
    });
  });
}

// ---- Discord auth ----

let identityReady = false;
const identityWaiters = [];

function onIdentityReady(fn) {
  if (identityReady) { fn(); return; }
  identityWaiters.push(fn);
}

function resolveIdentity() {
  identityReady = true;
  identityWaiters.forEach(fn => fn());
  identityWaiters.length = 0;
}

async function setupDiscordSdk() {
  const clientId = import.meta.env.VITE_DISCORD_CLIENT_ID;
  if (!clientId) throw new Error('No Discord client ID');

  const discordSdk = new DiscordSDK(clientId);
  const timeout = new Promise((_, reject) =>
    setTimeout(() => reject(new Error('Discord SDK timeout')), 10000)
  );
  await Promise.race([discordSdk.ready(), timeout]);

  const { code } = await discordSdk.commands.authorize({
    client_id: clientId,
    response_type: 'code',
    state: '',
    prompt: 'none',
    scope: ['identify', 'guilds', 'applications.commands'],
  });

  const { access_token } = await fetch('/api/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code }),
  }).then(r => r.json());

  const auth = await discordSdk.commands.authenticate({ access_token });
  if (!auth) throw new Error('Auth failed');

  player.id = auth.user.id;
  player.username = auth.user.username;
  player.avatar = auth.user.avatar;
  try { player.channelId = discordSdk.channelId; } catch {}
  try { player.guildId = discordSdk.guildId; } catch {}
}

// ---- Boot ----

async function start() {
  // Wire up UI immediately — buttons work before auth completes
  setupInputHandlers();
  setupModeScreen();
  setupLobbyHandlers(player, gameState, helpers);

  document.getElementById('players-sidebar').classList.add('hidden');
  showScreen('mode-screen');

  // Auth in background
  try {
    await setupDiscordSdk();
  } catch (e) {
    console.log('Discord auth failed, using fallback identity:', e.message);
    player.id = 'local-' + Math.random().toString(36).slice(2, 8);
    player.username = 'TestSpiller';
  }

  resolveIdentity();
}

start();
