import { DiscordSDK } from "@discord/embedded-app-sdk";
import { initGame, checkWord, isValidWord, getSecretWord } from "./script.js";
import "./style.css";

let auth;
const discordSdk = new DiscordSDK(import.meta.env.VITE_DISCORD_CLIENT_ID);

async function setupDiscordSdk() {
  await discordSdk.ready();
  console.log("Discord SDK is ready");

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
  if (auth == null) {
    throw new Error("Authenticate command failed");
  }
}

// Game state
let currentRow = 0;
let gameOver = false;
const MAX_ROWS = 6;

// Player identity (set after Discord auth)
let playerId = null;
let playerUsername = null;
let playerAvatar = null;
let playerChannelId = null;

function showMessage(text, type) {
  const msg = document.getElementById('message');
  msg.textContent = text;
  msg.className = type || '';
  if (type === 'error') {
    setTimeout(() => { msg.textContent = ''; msg.className = ''; }, 2000);
  }
}

function getRowWord(row) {
  const inputs = document.querySelectorAll(`#row-${row} input`);
  return Array.from(inputs).map(i => i.value.toLowerCase()).join('');
}

function isRowFull(row) {
  const inputs = document.querySelectorAll(`#row-${row} input`);
  return Array.from(inputs).every(i => i.value.length === 1);
}

function applyResults(row, results) {
  const inputs = document.querySelectorAll(`#row-${row} input`);
  const word = getRowWord(row);

  inputs.forEach((input, i) => {
    const delay = i * 300;
    setTimeout(() => {
      input.classList.add('flip');
      setTimeout(() => {
        input.classList.add(results[i]);
        input.disabled = true;
      }, 250);
    }, delay);

    // Update keyboard colors
    const letter = word[i];
    const keyBtn = document.querySelector(`#keyboard button[data-key="${letter}"]`);
    if (keyBtn) {
      setTimeout(() => {
        if (results[i] === 'correct') {
          keyBtn.className = 'correct';
        } else if (results[i] === 'present' && !keyBtn.classList.contains('correct')) {
          keyBtn.className = 'present';
        } else if (results[i] === 'absent' && !keyBtn.classList.contains('correct') && !keyBtn.classList.contains('present')) {
          keyBtn.className = 'absent';
        }
      }, delay + 250);
    }
  });
}

// Instantly apply color classes to a row (no animation) — used for state restore
function applyResultsInstant(row, word, results) {
  const inputs = document.querySelectorAll(`#row-${row} input`);
  inputs.forEach((input, i) => {
    input.value = word[i] || '';
    input.classList.add(results[i]);
    input.disabled = true;
  });

  // Update keyboard colors immediately
  for (let i = 0; i < word.length; i++) {
    const letter = word[i];
    const keyBtn = document.querySelector(`#keyboard button[data-key="${letter}"]`);
    if (keyBtn) {
      if (results[i] === 'correct') {
        keyBtn.className = 'correct';
      } else if (results[i] === 'present' && !keyBtn.classList.contains('correct')) {
        keyBtn.className = 'present';
      } else if (results[i] === 'absent' && !keyBtn.classList.contains('correct') && !keyBtn.classList.contains('present')) {
        keyBtn.className = 'absent';
      }
    }
  }
}

function submitGuess() {
  if (gameOver) return;
  if (!isRowFull(currentRow)) {
    showMessage('Fyll inn alle 5 bokstavene!', 'error');
    return;
  }

  const guess = getRowWord(currentRow);

  if (!isValidWord(guess)) {
    showMessage('Ikke et gyldig ord!', 'error');
    return;
  }

  const results = checkWord(guess);
  applyResults(currentRow, results);

  const revealTime = 5 * 300 + 300;
  const won = results.every(r => r === 'correct');
  const thisRow = currentRow;
  const done = won || thisRow + 1 >= MAX_ROWS;

  // Report progress to server (which posts/updates Discord channel chat)
  reportProgress(guess, results, done, won);

  if (won) {
    setTimeout(() => {
      const messages = ['Fantastisk!', 'Imponerende!', 'Flott!', 'Bra!', 'Nesten!', 'Puh!'];
      showMessage(messages[currentRow] || 'Du vant!', 'win');
      gameOver = true;
    }, revealTime);
    return;
  }

  currentRow++;
  if (currentRow >= MAX_ROWS) {
    setTimeout(() => {
      showMessage(`Ordet var: ${getSecretWord().toUpperCase()}`, 'lose');
      gameOver = true;
    }, revealTime);
    return;
  }

  setTimeout(() => {
    const nextInputs = document.querySelectorAll(`#row-${currentRow} input`);
    nextInputs.forEach(input => input.disabled = false);
    nextInputs[0].focus();
  }, revealTime);
}

function handleKeyPress(key) {
  if (gameOver) return;

  if (key === 'Enter') {
    submitGuess();
    return;
  }

  if (key === 'Backspace') {
    const inputs = Array.from(document.querySelectorAll(`#row-${currentRow} input`));
    for (let i = inputs.length - 1; i >= 0; i--) {
      if (inputs[i].value !== '') {
        inputs[i].value = '';
        inputs[i].focus();
        return;
      }
    }
    return;
  }

  if (/^[a-zæøå]$/i.test(key)) {
    const inputs = Array.from(document.querySelectorAll(`#row-${currentRow} input`));
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
    btn.addEventListener('click', () => {
      handleKeyPress(btn.dataset.key);
    });
  });

  document.querySelectorAll('input').forEach(input => {
    input.addEventListener('focus', () => {
      const row = parseInt(input.dataset.row);
      if (row !== currentRow) {
        const currentInputs = document.querySelectorAll(`#row-${currentRow} input`);
        const firstEmpty = Array.from(currentInputs).find(i => i.value === '');
        if (firstEmpty) firstEmpty.focus();
        else currentInputs[currentInputs.length - 1].focus();
      }
    });
  });
}

// ---- Server communication ----

function reportProgress(word, results, done, won) {
  if (!playerId) return;
  fetch('/api/progress', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      userId: playerId,
      username: playerUsername,
      avatar: playerAvatar,
      channelId: playerChannelId,
      word,
      results,
      done,
      won,
    }),
  }).catch(e => console.log('Progress report failed:', e.message));
}

async function fetchAndRestoreState() {
  if (!playerId) return;
  try {
    const res = await fetch(`/api/state?userId=${encodeURIComponent(playerId)}`);
    const state = await res.json();
    if (!state || !state.rows || state.rows.length === 0) return;

    // Restore all previously played rows
    for (let r = 0; r < state.rows.length; r++) {
      const { word, results } = state.rows[r];
      applyResultsInstant(r, word, results);
      currentRow = r + 1;
    }

    if (state.done) {
      gameOver = true;
      if (state.won) {
        showMessage('Du vant allerede i dag!', 'win');
      } else {
        showMessage(`Ordet var: ${getSecretWord().toUpperCase()}`, 'lose');
      }
    } else {
      // Enable the current (next) row
      const nextInputs = document.querySelectorAll(`#row-${currentRow} input`);
      nextInputs.forEach(input => input.disabled = false);
      // Focus handled after this function returns
    }
  } catch (e) {
    console.log('State restore failed:', e.message);
  }
}

// ---- Initialize ----
async function start() {
  try {
    await setupDiscordSdk();
    console.log("Discord SDK is authenticated");
    playerId = auth.user.id;
    playerUsername = auth.user.username;
    playerAvatar = auth.user.avatar;
    try { playerChannelId = discordSdk.channelId; } catch {}
  } catch (e) {
    console.log("Discord SDK setup failed (running outside Discord?):", e.message);
  }

  await initGame();

  // Restore today's saved progress before setting up input handlers
  await fetchAndRestoreState();

  setupInputHandlers();

  if (!gameOver) {
    const firstInput = document.querySelector(`#row-${currentRow} input:not([disabled])`);
    if (firstInput) firstInput.focus();
    if (currentRow === 0) showMessage('Gjett ordet!', '');
  }
}

start();