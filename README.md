# Nordle

A Wordle-style daily word-guessing game for Norwegian words, playable as a Discord Activity.

---

## Prerequisites

- [Node.js](https://nodejs.org/) v18+
- A [Discord application](https://discord.com/developers/applications) with Activities enabled
- [cloudflared](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/) CLI (for Cloudflare Tunnel)

---

## Setup

### 1. Clone and install dependencies

```bash
git clone https://github.com/herator/nordle.git
cd nordle

# Install server dependencies
cd server && npm install && cd ..

# Install client dependencies
cd client && npm install && cd ..
```

### 2. Configure environment variables

Copy the example env file and fill in your Discord app credentials:

```bash
cp example.env .env
```

Edit `.env`:

```env
VITE_DISCORD_CLIENT_ID=your_discord_client_id
DISCORD_CLIENT_SECRET=your_discord_client_secret
DISCORD_BOT_TOKEN=your_discord_bot_token
DISCORD_APPLICATION_PUBLIC_KEY=your_discord_application_public_key
```

You can find these values in the [Discord Developer Portal](https://discord.com/developers/applications) under your application.

### 3. Discord Developer Portal configuration

1. Go to your application in the [Discord Developer Portal](https://discord.com/developers/applications)
2. Under **Activities**, enable the Activities feature
3. Set the **URL Mapping** root path `/` to point to your Cloudflare Tunnel URL (see step below)
4. Under **OAuth2**, make sure `applications.commands` and `identify` scopes are enabled

---

## Running the app

You need two terminals — one for the server and one for the client.

### Terminal 1 — Start the backend server

```bash
cd server
npm start
```

The server runs on `http://localhost:3001`.

### Terminal 2 — Start the frontend dev server

```bash
cd client
npm run dev
```

The Vite dev server runs on `http://localhost:5173` and proxies `/api` requests to the backend on port 3001.

---

## Connecting to Cloudflare Tunnel

Discord Activities require a public HTTPS URL. Use Cloudflare Tunnel to expose your local Vite dev server.

### 1. Install cloudflared

Download from [https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/) or via your package manager:

```bash
# macOS
brew install cloudflare/cloudflare/cloudflared

# Linux (Debian/Ubuntu)
wget -q https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64.deb
sudo dpkg -i cloudflared-linux-amd64.deb
```

### 2. Start a tunnel to the Vite dev server

```bash
cloudflared tunnel --url http://localhost:5173
```

Cloudflared will output a public URL like:

```
https://some-random-name.trycloudflare.com
```

### 3. Update Discord URL Mapping

1. Go to your app in the [Discord Developer Portal](https://discord.com/developers/applications)
2. Navigate to **Activities > URL Mappings**
3. Set the root prefix `/` to your Cloudflare Tunnel URL (e.g. `https://some-random-name.trycloudflare.com`)
4. Save changes

Your Discord Activity will now load the game through the tunnel.

> **Note:** Each time you restart `cloudflared` without a named tunnel, you get a new URL. For a stable URL across restarts, set up a [named Cloudflare Tunnel](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/get-started/) tied to your own domain.

---

## Project structure

```
nordle/
├── client/          # Vite frontend (Discord Embedded App SDK)
│   ├── main.js      # Discord SDK init and game controller
│   ├── script.js    # Game logic and word checking
│   ├── index.html   # Game UI
│   └── public/
│       └── ord.csv  # Norwegian 5-letter word list
├── server/          # Express backend
│   └── server.js    # Discord OAuth, game state, slash commands
├── example.env      # Environment variable template
└── .env             # Your local credentials (not committed)
```