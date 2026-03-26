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
  const { userId, username, avatar, channelId, word, results, done, won } = req.body;
  if (!userId || !results) { res.status(400).json({ error: "Missing params" }); return; }

  const state = getOrCreateState(userId, { username, avatar, channelId });
  state.username = username || state.username;
  state.avatar = avatar || state.avatar;
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

app.listen(port, () => {
  console.log(`Server listening at http://localhost:${port}`);
  registerSlashCommand();
});