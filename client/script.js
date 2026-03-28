let allWords = [];    // all valid 5-letter words (for guess validation)
let dailyWords = [];  // common everyday words (for daily word selection)
let wordSet = null;
let secretWord = '';

export async function initGame() {
  await loadWordLists();
  secretWord = getDailyWord();
  console.log('Game initialized, all words:', allWords.length, 'daily words:', dailyWords.length);
}

function getDailyWord() {
  // Use the date to pick a consistent word for the day
  const today = new Date();
  const dateString = `${today.getFullYear()}-${today.getMonth()}-${today.getDate()}`;

  let hash = 0;
  for (let i = 0; i < dateString.length; i++) {
    hash = ((hash << 5) - hash) + dateString.charCodeAt(i);
    hash |= 0;
  }

  return dailyWords[Math.abs(hash) % dailyWords.length];
}

function parseWordFile(text) {
  return text
    .split(/[\r\n]+/)
    .map(w => w.trim().toLowerCase())
    .filter(w => w.length === 5);
}

async function loadWordLists() {
  const [allRes, dailyRes] = await Promise.all([
    fetch('/ord.txt'),
    fetch('/daglige-ord.txt'),
  ]);

  allWords = parseWordFile(await allRes.text());
  dailyWords = parseWordFile(await dailyRes.text());
  wordSet = new Set(allWords);
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
