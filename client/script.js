const fs = require('fs');

let csvCache = null;

export function checkWord(guess, secret) {
    // Logic to compare guess vs secret
    return result; 
}

function initializeCache(filePath) {
  if (csvCache) return; // Don't reload if it's already there

  console.log("Loading CSV into memory...");
  const content = fs.readFileSync(filePath, 'utf8');
  
  // Split by commas and newlines, then trim whitespace
  const words = content.split(/[,\n\r]+/).map(w => w.trim());
  
  // A Set provides O(1) lookup time
  csvCache = new Set(words);
  console.log("Cache ready.");
}

function hasWord(word) {
  if (!csvCache) {
    throw new Error("Cache not initialized! Run initializeCache() first.");
  }
  return csvCache.has(word);
}

initializeCache('data.csv');