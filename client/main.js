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
      // Only upgrade colors: absent -> present -> correct
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

  if (results.every(r => r === 'correct')) {
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

  // Enable next row
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
    // Find last filled input
    for (let i = inputs.length - 1; i >= 0; i--) {
      if (inputs[i].value !== '') {
        inputs[i].value = '';
        inputs[i].focus();
        return;
      }
    }
    return;
  }

  // Letter input
  if (/^[a-zæøå]$/i.test(key)) {
    const inputs = Array.from(document.querySelectorAll(`#row-${currentRow} input`));
    const emptyInput = inputs.find(i => i.value === '');
    if (emptyInput) {
      emptyInput.value = key.toLowerCase();
      emptyInput.classList.add('filled');
      // Focus next empty or stay on last
      const nextEmpty = inputs.find(i => i.value === '');
      if (nextEmpty) nextEmpty.focus();
      else emptyInput.focus();
    }
  }
}

function setupInputHandlers() {
  // Physical keyboard
  document.addEventListener('keydown', (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const key = e.key;
    if (key === 'Enter' || key === 'Backspace' || /^[a-zæøåA-ZÆØÅ]$/.test(key)) {
      e.preventDefault();
      handleKeyPress(key);
    }
  });

  // On-screen keyboard
  document.querySelectorAll('#keyboard button').forEach(btn => {
    btn.addEventListener('click', () => {
      handleKeyPress(btn.dataset.key);
    });
  });

  // Prevent direct typing in inputs (we handle it via keydown)
  document.querySelectorAll('input').forEach(input => {
    input.addEventListener('input', (e) => {
      // Allow our programmatic changes but block direct typing
    });
    input.addEventListener('focus', () => {
      // Only allow focus on current row
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

// Initialize
async function start() {
  try {
    await setupDiscordSdk();
    console.log("Discord SDK is authenticated");
  } catch (e) {
    console.log("Discord SDK setup failed (running outside Discord?):", e.message);
  }

  await initGame();
  setupInputHandlers();
  document.querySelector('#row-0 input').focus();
  showMessage('Gjett ordet!', '');
}

start();