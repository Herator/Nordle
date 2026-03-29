import express from "express";
import dotenv from "dotenv";
import fetch from "node-fetch";
import { webcrypto } from "crypto";

dotenv.config({ path: "../.env" });

const app = express();
const port = 3001;

// ---- Discord OAuth token exchange ----

app.post("/api/token", express.json(), async (req, res) => {
  const response = await fetch(`https://discord.com/api/oauth2/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: process.env.VITE_DISCORD_CLIENT_ID,
      client_secret: process.env.DISCORD_CLIENT_SECRET,
      grant_type: "authorization_code",
      code: req.body.code,
    }),
  });
  const { access_token } = await response.json();
  res.send({ access_token });
});

// ---- Per-user daily game state ----
// Map<userId, { date, channelId, messageId, username, avatar, rows, done, won, optedIn }>
// rows: [{ word: string, results: string[] }]

const playerStates = new Map();

function getTodayDate() {
  const d = new Date();
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

function getState(userId) {
  const state = playerStates.get(userId);
  if (!state || state.date !== getTodayDate()) return null;
  return state;
}

function getOrCreateState(userId, defaults = {}) {
  let state = getState(userId);
  if (!state) {
    state = {
      date: getTodayDate(),
      userId,
      username: "Ukjent",
      avatar: null,
      channelId: null,
      guildId: null,
      messageId: null,
      rows: [],
      done: false,
      won: false,
      optedIn: false,
      ...defaults,
    };
    playerStates.set(userId, state);
  }
  return state;
}

// ---- Discord bot helpers ----

const EMOJI = { correct: "🟩", present: "🟨", absent: "⬛" };

function buildEmojiGrid(rows) {
  return rows.map(r => r.results.map(s => EMOJI[s] ?? "⬜").join("")).join("\n");
}

function buildEmbed(state) {
  const rowCount = state.rows.length;
  let title, color;
  if (state.won) {
    title = `Nordle — Vant! 🎉 (${rowCount}/6)`;
    color = 0x538d4e;
  } else if (state.done) {
    title = `Nordle — Tapte (${rowCount}/6)`;
    color = 0x3a3a3c;
  } else {
    title = `Nordle — Rad ${rowCount}/6`;
    color = 0x1d2226;
  }

  const embed = { title, color };
  if (state.rows.length > 0) embed.description = buildEmojiGrid(state.rows);

  embed.author = state.avatar
    ? { name: state.username, icon_url: `https://cdn.discordapp.com/avatars/${state.userId}/${state.avatar}.png?size=64` }
    : { name: state.username };

  return embed;
}

async function postOrEditDiscordMessage(state) {
  const token = process.env.DISCORD_BOT_TOKEN;
  if (!token || !state.channelId || !state.optedIn) return;

  const body = JSON.stringify({ embeds: [buildEmbed(state)] });
  const headers = { Authorization: `Bot ${token}`, "Content-Type": "application/json" };

  if (state.messageId) {
    const r = await fetch(
      `https://discord.com/api/v10/channels/${state.channelId}/messages/${state.messageId}`,
      { method: "PATCH", headers, body }
    );
    if (!r.ok) {
      const err = await r.json().catch(() => ({}));
      if (err.code === 10008) { state.messageId = null; await postOrEditDiscordMessage(state); }
    }
  } else {
    const r = await fetch(
      `https://discord.com/api/v10/channels/${state.channelId}/messages`,
      { method: "POST", headers, body }
    );
    if (r.ok) { const msg = await r.json(); state.messageId = msg.id; }
  }
}

// ---- Discord slash command (/nordle) ----

async function registerSlashCommand() {
  const appId = process.env.VITE_DISCORD_CLIENT_ID;
  const token = process.env.DISCORD_BOT_TOKEN;
  if (!appId || !token) return;
  await fetch(`https://discord.com/api/v10/applications/${appId}/commands`, {
    method: "POST",
    headers: { Authorization: `Bot ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      name: "nordle",
      description: "Del Nordle-fremgangen din i kanalen",
      type: 1,
    }),
  }).catch(e => console.error("Command registration failed:", e.message));
}

async function verifyDiscordSignature(publicKey, signature, timestamp, rawBody) {
  const key = await webcrypto.subtle.importKey(
    "raw",
    Buffer.from(publicKey, "hex"),
    { name: "Ed25519" },
    false,
    ["verify"]
  );
  return webcrypto.subtle.verify(
    "Ed25519",
    key,
    Buffer.from(signature, "hex"),
    Buffer.from(timestamp + rawBody)
  );
}

// Interactions endpoint — MUST use raw body parser (before express.json())
app.post("/api/interactions", express.raw({ type: "*/*" }), async (req, res) => {
  const signature = req.headers["x-signature-ed25519"];
  const timestamp = req.headers["x-signature-timestamp"];
  const rawBody = req.body.toString("utf8");
  const publicKey = process.env.DISCORD_APPLICATION_PUBLIC_KEY;

  if (!publicKey || !signature || !timestamp) {
    res.status(401).send("Missing signature headers");
    return;
  }

  const valid = await verifyDiscordSignature(publicKey, signature, timestamp, rawBody).catch(() => false);
  if (!valid) { res.status(401).send("Invalid signature"); return; }

  const interaction = JSON.parse(rawBody);

  // Discord PING
  if (interaction.type === 1) { res.json({ type: 1 }); return; }

  // Slash command
  if (interaction.type === 2 && interaction.data?.name === "nordle") {
    const user = interaction.member?.user ?? interaction.user;
    const userId = user?.id;
    const channelId = interaction.channel_id;

    if (!userId) { res.json({ type: 4, data: { content: "Kunne ikke hente bruker-ID.", flags: 64 } }); return; }

    const state = getOrCreateState(userId, {
      username: user.username,
      avatar: user.avatar,
      channelId,
    });

    // Update identity/channel in case they changed
    state.username = user.username || state.username;
    state.avatar = user.avatar || state.avatar;
    state.channelId = channelId;
    state.optedIn = true;

    // Post current progress immediately if they've already guessed
    if (state.rows.length > 0) {
      await postOrEditDiscordMessage(state).catch(() => {});
      res.json({ type: 4, data: { content: "Fremgangen din deles nå i kanalen!", flags: 64 } });
    } else {
      res.json({ type: 4, data: { content: "Fremgangen din vil deles her når du begynner å gjette.", flags: 64 } });
    }
    return;
  }

  res.status(400).json({ error: "Unknown interaction" });
});

// ---- REST API endpoints ----

app.use(express.json());

// Get all players' today progress for a channel (words are NOT included)
app.get("/api/players", (req, res) => {
  const { guildId, channelId } = req.query;
  if (!guildId || !channelId) { res.json([]); return; }
  const today = getTodayDate();
  const players = [];
  for (const [, state] of playerStates) {
    if (state.date !== today) continue;
    if (state.guildId !== guildId) continue;
    if (state.channelId !== channelId) continue;
    players.push({
      userId: state.userId,
      username: state.username,
      avatar: state.avatar,
      rows: state.rows.map(r => ({ results: r.results })),
      done: state.done,
      won: state.won,
    });
  }
  res.json(players);
});

// Register a player as active (called on activity open, before any guesses)
app.post("/api/join", (req, res) => {
  const { userId, username, avatar, guildId, channelId } = req.body;
  if (!userId) { res.status(400).json({ error: "Missing userId" }); return; }
  const state = getOrCreateState(userId, { username, avatar, guildId, channelId });
  state.username = username || state.username;
  state.avatar = avatar || state.avatar;
  if (guildId) state.guildId = guildId;
  if (channelId && !state.channelId) state.channelId = channelId;
  res.json({ ok: true });
});

// Get today's saved state (called on activity load to restore progress)
app.get("/api/state", (req, res) => {
  const { userId } = req.query;
  if (!userId) { res.status(400).json({ error: "Missing userId" }); return; }
  const state = getState(userId);
  if (!state) { res.json(null); return; }
  res.json({ rows: state.rows, done: state.done, won: state.won });
});

// Called after each submitted guess row
app.post("/api/progress", async (req, res) => {
  const { userId, username, avatar, guildId, channelId, word, results, done, won } = req.body;
  if (!userId || !results) { res.status(400).json({ error: "Missing params" }); return; }

  const state = getOrCreateState(userId, { username, avatar, guildId, channelId });
  state.username = username || state.username;
  state.avatar = avatar || state.avatar;
  if (guildId) state.guildId = guildId;
  if (channelId && !state.channelId) state.channelId = channelId;

  state.rows.push({ word, results });
  state.done = !!done;
  state.won = !!won;

  // Only post to Discord if this user typed /nordle
  if (state.optedIn) {
    postOrEditDiscordMessage(state).catch(e => console.error("Discord post failed:", e.message));
  }

  res.json({ ok: true });
});

// ---- Challenge mode ----
// Lobbies are keyed by guildId+channelId so everyone in the same Discord
// voice channel shares a lobby automatically.
//
// Lobby shape:
// {
//   id, masterId, masterUsername,
//   players: Map<userId, { username, avatar, online, joinedAt }>,
//   rounds: number, currentRound: number (0-indexed),
//   started: boolean, finished: boolean,
//   words: string[],          // one word per round, chosen at start
//   roundResults: [           // index = round number
//     Map<userId, { guesses, timeMs, done, won, submittedAt }>
//   ],
//   totalScores: Map<userId, number>,  // cumulative (lower = better)
// }

const lobbies = new Map(); // key = `${guildId}:${channelId}`

function lobbyKey(guildId, channelId) {
  return `${guildId ?? 'noguild'}:${channelId ?? 'nochannel'}`;
}

// Scoring: 1 guess = 1pt, ..., 6 guesses = 6pt, DNF = 7pt
function calcScore(guesses, won) {
  return won ? guesses : 7;
}

// Pick `n` random words from the daily word list (loaded from file at startup)
let challengeWordPool = [];
async function loadChallengeWords() {
  try {
    const fs = await import('fs/promises');
    const path = await import('path');
    const { fileURLToPath } = await import('url');
    const __dirname = path.dirname(fileURLToPath(import.meta.url));
    const txt = await fs.readFile(
      path.join(__dirname, '../client/public/daglige-ord.txt'), 'utf8'
    );
    challengeWordPool = txt.split(/[\r\n]+/).map(w => w.trim().toLowerCase()).filter(w => w.length === 5);
    console.log(`Challenge word pool loaded: ${challengeWordPool.length} words`);
  } catch (e) {
    console.error('Failed to load challenge word pool:', e.message);
  }
}

function pickWords(n) {
  const pool = [...challengeWordPool];
  const words = [];
  for (let i = 0; i < n && pool.length; i++) {
    const idx = Math.floor(Math.random() * pool.length);
    words.push(pool.splice(idx, 1)[0]);
  }
  return words;
}

function serializeLobby(lobby, requestingUserId) {
  const players = [];
  for (const [uid, p] of lobby.players) {
    players.push({ userId: uid, username: p.username, avatar: p.avatar, online: p.online });
  }

  const roundResults = lobby.roundResults.map(roundMap => {
    const results = [];
    for (const [uid, r] of roundMap) {
      results.push({ userId: uid, ...r });
    }
    return results;
  });

  const totalScores = [];
  for (const [uid, score] of lobby.totalScores) {
    const p = lobby.players.get(uid);
    totalScores.push({ userId: uid, username: p?.username, avatar: p?.avatar, score });
  }
  totalScores.sort((a, b) => a.score - b.score);

  return {
    id: lobby.id,
    masterId: lobby.masterId,
    masterUsername: lobby.masterUsername,
    players,
    rounds: lobby.rounds,
    currentRound: lobby.currentRound,
    started: lobby.started,
    finished: lobby.finished,
    // Only reveal the current round's word (never future words)
    currentWord: lobby.started ? lobby.words[lobby.currentRound] : null,
    roundResults,
    totalScores,
    isLobbyMaster: requestingUserId === lobby.masterId,
  };
}

function allPlayersFinishedRound(lobby) {
  const roundMap = lobby.roundResults[lobby.currentRound];
  if (!roundMap) return false;
  for (const [uid] of lobby.players) {
    if (!roundMap.has(uid)) return false;
  }
  return true;
}

// GET /api/challenge/lobby — poll for lobby state
app.get('/api/challenge/lobby', (req, res) => {
  const { guildId, channelId, userId } = req.query;
  const key = lobbyKey(guildId, channelId);
  const lobby = lobbies.get(key);
  if (!lobby) { res.json(null); return; }
  res.json(serializeLobby(lobby, userId));
});

// POST /api/challenge/create-or-join — first caller becomes master
app.post('/api/challenge/create-or-join', express.json(), (req, res) => {
  const { userId, username, avatar, guildId, channelId } = req.body;
  if (!userId) { res.status(400).json({ error: 'Missing userId' }); return; }

  const key = lobbyKey(guildId, channelId);
  let lobby = lobbies.get(key);

  if (!lobby) {
    lobby = {
      id: key,
      masterId: userId,
      masterUsername: username,
      players: new Map(),
      rounds: 3,
      currentRound: 0,
      started: false,
      finished: false,
      words: [],
      roundResults: [],
      totalScores: new Map(),
    };
    lobbies.set(key, lobby);
  }

  // Add/update player
  lobby.players.set(userId, { username, avatar, online: true, joinedAt: Date.now() });
  if (!lobby.totalScores.has(userId)) lobby.totalScores.set(userId, 0);

  // Mark player online
  const p = lobby.players.get(userId);
  p.online = true;

  res.json(serializeLobby(lobby, userId));
});

// POST /api/challenge/configure — master sets round count
app.post('/api/challenge/configure', express.json(), (req, res) => {
  const { userId, guildId, channelId, rounds } = req.body;
  const key = lobbyKey(guildId, channelId);
  const lobby = lobbies.get(key);
  if (!lobby) { res.status(404).json({ error: 'No lobby' }); return; }
  if (lobby.masterId !== userId) { res.status(403).json({ error: 'Not lobby master' }); return; }
  if (lobby.started) { res.status(400).json({ error: 'Already started' }); return; }
  lobby.rounds = Math.max(1, Math.min(20, parseInt(rounds) || 3));
  res.json({ ok: true });
});

// POST /api/challenge/start — master starts the game
app.post('/api/challenge/start', express.json(), (req, res) => {
  const { userId, guildId, channelId } = req.body;
  const key = lobbyKey(guildId, channelId);
  const lobby = lobbies.get(key);
  if (!lobby) { res.status(404).json({ error: 'No lobby' }); return; }
  if (lobby.masterId !== userId) { res.status(403).json({ error: 'Not lobby master' }); return; }
  if (lobby.started) { res.status(400).json({ error: 'Already started' }); return; }

  lobby.words = pickWords(lobby.rounds);
  lobby.started = true;
  lobby.currentRound = 0;
  lobby.roundResults = Array.from({ length: lobby.rounds }, () => new Map());

  res.json(serializeLobby(lobby, userId));
});

// POST /api/challenge/submit — player submits their round result
app.post('/api/challenge/submit', express.json(), (req, res) => {
  const { userId, guildId, channelId, guesses, timeMs, won } = req.body;
  const key = lobbyKey(guildId, channelId);
  const lobby = lobbies.get(key);
  if (!lobby || !lobby.started) { res.status(404).json({ error: 'No active lobby' }); return; }

  const round = lobby.currentRound;
  const roundMap = lobby.roundResults[round];
  if (!roundMap) { res.status(400).json({ error: 'Invalid round' }); return; }

  // Only record if player hasn't already submitted this round
  if (!roundMap.has(userId)) {
    const score = calcScore(guesses, won);
    roundMap.set(userId, {
      guesses,
      timeMs,
      won,
      score,
      submittedAt: Date.now(),
    });
    // Add to cumulative score
    lobby.totalScores.set(userId, (lobby.totalScores.get(userId) ?? 0) + score);
  }

  res.json({
    allDone: allPlayersFinishedRound(lobby),
    ...serializeLobby(lobby, userId),
  });
});

// POST /api/challenge/next-round — master advances to next round (only when all done)
app.post('/api/challenge/next-round', express.json(), (req, res) => {
  const { userId, guildId, channelId } = req.body;
  const key = lobbyKey(guildId, channelId);
  const lobby = lobbies.get(key);
  if (!lobby) { res.status(404).json({ error: 'No lobby' }); return; }
  if (lobby.masterId !== userId) { res.status(403).json({ error: 'Not lobby master' }); return; }

  if (!allPlayersFinishedRound(lobby)) {
    res.status(400).json({ error: 'Not everyone has finished yet' }); return;
  }

  if (lobby.currentRound + 1 >= lobby.rounds) {
    lobby.finished = true;
  } else {
    lobby.currentRound++;
  }

  res.json(serializeLobby(lobby, userId));
});

// POST /api/challenge/leave — mark player offline
app.post('/api/challenge/leave', express.json(), (req, res) => {
  const { userId, guildId, channelId } = req.body;
  const key = lobbyKey(guildId, channelId);
  const lobby = lobbies.get(key);
  if (lobby) {
    const p = lobby.players.get(userId);
    if (p) p.online = false;
  }
  res.json({ ok: true });
});

// POST /api/challenge/disband — master closes the lobby
app.post('/api/challenge/disband', express.json(), (req, res) => {
  const { userId, guildId, channelId } = req.body;
  const key = lobbyKey(guildId, channelId);
  const lobby = lobbies.get(key);
  if (lobby && lobby.masterId === userId) lobbies.delete(key);
  res.json({ ok: true });
});

app.listen(port, () => {
  console.log(`Server listening at http://localhost:${port}`);
  registerSlashCommand();
  loadChallengeWords();
});