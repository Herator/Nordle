let wordList = [];
let wordSet = null;
let secretWord = '';

export async function initGame() {
  await loadWordList();
  secretWord = getDailyWord();
  console.log('Game initialized, word list size:', wordList.length);
}

function getDailyWord() {
  // Use the date to pick a consistent word for the day
  const today = new Date();
  const dateString = `${today.getFullYear()}-${today.getMonth()}-${today.getDate()}`;

  // Simple hash from the date string to get a stable index
  let hash = 0;
  for (let i = 0; i < dateString.length; i++) {
    hash = ((hash << 5) - hash) + dateString.charCodeAt(i);
    hash |= 0;
  }

  return wordList[Math.abs(hash) % wordList.length];
}

async function loadWordList() {
  const response = await fetch('/ord.csv');
  const text = await response.text();
  wordList = text
    .split(/[\r\n]+/)
    .map(w => w.trim().toLowerCase())
    .filter(w => w.length === 5);
  wordSet = new Set(wordList);
}

export function isValidWord(word) {
  return wordSet && wordSet.has(word.toLowerCase());
}

export function checkWord(guess) {
  const g = guess.toLowerCase().split('');
  const s = secretWord.split('');
  const result = Array(5).fill('absent');

  // First pass: mark correct (green)
  const secretRemaining = [...s];
  for (let i = 0; i < 5; i++) {
    if (g[i] === s[i]) {
      result[i] = 'correct';
      secretRemaining[i] = null;
    }
  }

  // Second pass: mark present (yellow)
  for (let i = 0; i < 5; i++) {
    if (result[i] === 'correct') continue;
    const idx = secretRemaining.indexOf(g[i]);
    if (idx !== -1) {
      result[i] = 'present';
      secretRemaining[idx] = null;
    }
  }

  return result;
}

export function getSecretWord() {
  return secretWord;
}