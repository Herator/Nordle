import { DiscordSDK } from "@discord/embedded-app-sdk";
import { isValidWord, checkWord, getSecretWord } from "./script.js";
import { startDailyMode, reportProgress } from "./daily.js";
import { startChallengeMode, setupLobbyHandlers } from "./challenge.js";
import "./style.css";

let auth;
const discordSdk = new DiscordSDK(import.meta.env.VITE_DISCORD_CLIENT_ID);

async function setupDiscordSdk() {
  await discordSdk.ready();
  const { code } = await discordSdk.commands.authorize({
    client_id: import.meta.env.VITE_DISCORD_CLIENT_ID,
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

// Game state
const gameState = { currentRow: 0, gameOver: false, onRoundDone: null };

// Player identity (populated after Discord auth)
const player = { id: null, username: null, avatar: null, channelId: null, guildId: null };

function showMessage(text, type) {
  const msg = document.getElementById('message');
  msg.textContent = text;
  msg.className = type || '';
  if (type === 'error') setTimeout(() => { msg.textContent = ''; msg.className = ''; }, 2000);
}

function showScreen(screenId) {
  document.querySelectorAll('.screen').forEach(s => s.classList.add('hidden'));
  if (screenId) document.getElementById(screenId).classList.remove('hidden');
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
    const letter = word[i];
    const keyBtn = document.querySelector(`#keyboard button[data-key="${letter}"]`);
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
    const letter = word[i];
    const keyBtn = document.querySelector(`#keyboard button[data-key="${letter}"]`);
    if (keyBtn) {
      if (results[i] === 'correct') keyBtn.className = 'correct';
      else if (results[i] === 'present' && !keyBtn.classList.contains('correct')) keyBtn.className = 'present';
      else if (results[i] === 'absent' && !keyBtn.classList.contains('correct') && !keyBtn.classList.contains('present')) keyBtn.className = 'absent';
    }
  }
}

function resetGrid() {
  gameState.currentRow = 0;
  gameState.gameOver = false;
  gameState.onRoundDone = null;
  document.querySelectorAll('.row input').forEach(input => {
    input.value = '';
    input.className = '';
  });
  document.querySelectorAll('#row-0 input').forEach(i => { i.disabled = false; });
  for (let r = 1; r <= 5; r++) {
    document.querySelectorAll(`#row-${r} input`).forEach(i => { i.disabled = true; });
  }
}

function resetKeyboard() {
  document.querySelectorAll('#keyboard button').forEach(btn => {
    const isWide = btn.classList.contains('key-wide');
    btn.className = isWide ? 'key-wide' : '';
  });
}

function submitGuess() {
  if (gameState.gameOver) return;
  if (!isRowFull(gameState.currentRow)) {
    showMessage('Fyll inn alle 5 bokstavene!', 'error');
    return;
  }
  const guess = getRowWord(gameState.currentRow);
  if (!isValidWord(guess)) {
    showMessage('Ikke et gyldig ord!', 'error');
    const row = document.getElementById(`row-${gameState.currentRow}`);
    row.classList.add('shake');
    row.addEventListener('animationend', () => row.classList.remove('shake'), { once: true });
    return;
  }

  const results = checkWord(guess);
  applyResults(gameState.currentRow, results);

  const revealTime = 5 * 300 + 300;
  const won = results.every(r => r === 'correct');
  const thisRow = gameState.currentRow;
  const done = won || thisRow + 1 >= 6;

  if (gameState.onRoundDone) {
    if (done) setTimeout(() => gameState.onRoundDone(thisRow + 1, won), revealTime);
  } else {
    reportProgress(player, guess, results, done, won);
  }

  if (won) {
    setTimeout(() => {
      if (!gameState.onRoundDone) {
        const messages = ['Fantastisk!', 'Imponerende!', 'Flott!', 'Bra!', 'Nesten!', 'Puh!'];
        showMessage(messages[thisRow] || 'Du vant!', 'win');
      }
      gameState.gameOver = true;
    }, revealTime);
    return;
  }

  gameState.currentRow++;
  if (gameState.currentRow >= 6) {
    setTimeout(() => {
      if (!gameState.onRoundDone) showMessage(`Ordet var: ${getSecretWord().toUpperCase()}`, 'lose');
      gameState.gameOver = true;
    }, revealTime);
    return;
  }

  setTimeout(() => {
    const nextInputs = document.querySelectorAll(`#row-${gameState.currentRow} input`);
    nextInputs.forEach(i => { i.disabled = false; });
    nextInputs[0].focus();
  }, revealTime);
}

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
    const emptyInput = inputs.find(i => i.value === '');
    if (emptyInput) {
      emptyInput.value = key.toLowerCase();
      emptyInput.classList.add('filled');
      const nextEmpty = inputs.find(i => i.value === '');
      if (nextEmpty) nextEmpty.focus();
      else emptyInput.focus();
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
        const currentInputs = document.querySelectorAll(`#row-${gameState.currentRow} input`);
        const firstEmpty = Array.from(currentInputs).find(i => i.value === '');
        if (firstEmpty) firstEmpty.focus();
        else currentInputs[currentInputs.length - 1].focus();
      }
    });
  });
}

const helpers = {
  applyResultsInstant,
  showMessage,
  showScreen,
  resetGrid,
  resetKeyboard,
};

async function start() {
  try {
    await setupDiscordSdk();
    player.id = auth.user.id;
    player.username = auth.user.username;
    player.avatar = auth.user.avatar;
    try { player.channelId = discordSdk.channelId; } catch {}
    try { player.guildId = discordSdk.guildId; } catch {}
  } catch (e) {
    console.log("Discord SDK setup failed (running outside Discord?):", e.message);
  }

  setupInputHandlers();
  setupLobbyHandlers(player, gameState, helpers);

  document.getElementById('btn-daily').addEventListener('click', async () => {
    resetGrid();
    resetKeyboard();
    showMessage('', '');
    showScreen(null);
    document.getElementById('challenge-indicator').classList.add('hidden');
    await startDailyMode(player, gameState, helpers);
  });

  document.getElementById('btn-challenge').addEventListener('click', async () => {
    resetGrid();
    resetKeyboard();
    showMessage('', '');
    document.getElementById('players-sidebar').classList.add('hidden');
    document.getElementById('challenge-indicator').classList.add('hidden');
    await startChallengeMode(player, gameState, helpers);
  });

  document.getElementById('btn-switch-mode').addEventListener('click', () => {
    resetGrid();
    resetKeyboard();
    showMessage('', '');
    document.getElementById('players-sidebar').classList.add('hidden');
    document.getElementById('challenge-indicator').classList.add('hidden');
    showScreen('mode-screen');
  });

  showScreen('mode-screen');
}

start();
