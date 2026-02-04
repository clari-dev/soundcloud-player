# SoundCloud Player Web Component

A SoundCloud player built with vanilla JavaScript web components, featuring OAuth authentication, streaming playback, comments, and likes.

## Features

- 🎵 **Web Components**: Reusable `<sc-player>` and `<sc-auth>` components
- 🔐 **OAuth Authentication**: Secure authentication with SoundCloud
- ▶️ **Streaming Playback**: Play/pause controls with progress tracking
- 💬 **Comments**: Comment on tracks at specific timestamps
- ❤️ **Likes**: Like tracks
- 📱 **Multi-instance**: Display multiple players on the same page
- 🎯 **Shared Token**: Single authentication for multiple player instances

## Prerequisites

- Node.js 18+ (for development)
- SoundCloud API credentials (Client ID and Client Secret) — see below
- Podman or Docker (for containerization)

## Getting Started

### 1. Get SoundCloud API Credentials

1. Go to [SoundCloud Developers](https://soundcloud.com/you/apps)
2. Create a new application
3. Note your **Client ID** and **Client Secret**
4. Set the **Redirect URI** to `http://localhost:5050/auth/callback`

### 2. Setup Environment

```bash
# Copy the example environment file
cp .env.example .env

# Edit .env and add your credentials (use your preferred editor)
nano .env  # or: code .env, etc.
```

Add your SoundCloud credentials:

```env
SOUNDCLOUD_CLIENT_ID=your_client_id
SOUNDCLOUD_CLIENT_SECRET=your_client_secret
SOUNDCLOUD_REDIRECT_URI=http://localhost:5050/auth/callback
```

### 3. Install Dependencies

```bash
npm install
```

### 4. Run Locally

```bash
npm start

# Or
npm run dev
```

Visit `http://localhost:5050` in your browser.

### 5. Add Track Players

Use the "Add Player" interface in the browser:

1. Paste a SoundCloud track URL in the input field (e.g., `https://soundcloud.com/artist/track-name` or shortened URLs like `https://on.soundcloud.com/xyz123`)
2. Click "Add Player" or press Enter
3. A new player will be added for that track
4. Repeat to add multiple players

## Usage

### Authentication Component

```html
<sc-auth></sc-auth>
```

The authentication component displays:

- Current authentication status
- "Connect with SoundCloud" button
- Logout button

The token is stored in `localStorage` and automatically shared with all player instances.

### Player Component

```html
<sc-player track-url="https://soundcloud.com/artist/track-name"></sc-player>
```

Features:

- Track artwork and metadata
- Play/pause button
- Timeline progress bar with seek
- Like button
- Comment button
- Comments section with timestamps

### Server API Endpoints

**Authentication:**

- `GET /auth/login` - Get SoundCloud OAuth URL
- `GET /auth/callback` - OAuth callback handler
- `GET /auth/token/:tokenKey` - Retrieve stored access token
- `POST /auth/refresh/:tokenKey` - Refresh expired access token

**Note:** Track data, streaming, comments, and likes are handled directly by the client calling SoundCloud's API (`api.soundcloud.com`) using the authenticated token.

## Containerization with Podman

### Build the Container

```bash
podman build -f Containerfile -t soundcloud-player:latest .
```

### Run the Container

```bash
# Create .env file with your credentials
podman run -it \
  -p 5050:5050 \
  --env-file .env \
  --name soundcloud-player \
  soundcloud-player:latest
```

### Using Environment Variables

```bash
podman run -it \
  -p 5050:5050 \
  -e SOUNDCLOUD_CLIENT_ID="your-client-id" \
  -e SOUNDCLOUD_CLIENT_SECRET="your-client-secret" \
  -e REDIRECT_URI="http://localhost:5050/auth/callback" \
  --name soundcloud-player \
  soundcloud-player:latest
```

## Architecture

```txt
soundcloud-player/
├── server.js                # Express server with OAuth
├── public/
│   ├── index.html           # Test page
│   ├── sc-auth.js           # Authentication component
│   └── sc-player.js         # Player component
├── Containerfile            # Podman/Docker configuration
├── package.json             # Dependencies
├── .env.example             # Environment variables template
└── README.md                # This file
```

## How It Works

### OAuth Flow

1. User clicks "Connect with SoundCloud" button
2. `sc-auth` component sends request to `/auth/login`
3. Server returns SoundCloud authorization URL
4. User is redirected to SoundCloud
5. After approval, SoundCloud redirects to `/auth/callback`
6. Server exchanges authorization code for access token
7. Server stores token and redirects to app with token key
8. `sc-auth` component retrieves full token and broadcasts to all players
9. Other `sc-player` instances listen for token-ready event

### Token Sharing

- Only one component (`sc-auth`) handles authentication
- Access token is stored in `localStorage`
- All `sc-player` instances listen for `sc-token-ready` event
- Players can also check `localStorage` for cached tokens

## Development

For development with auto-reload:

```bash
npm run dev
```

## Security Considerations

- Client Secret is stored on the backend only
- Non-root user runs the container
- Use HTTPS in production

## License

MIT

## References

- [SoundCloud API Documentation](https://developers.soundcloud.com/)
- [Web Components Specification](https://www.webcomponents.org/)
- [Express.js Documentation](https://expressjs.com/)
- [Podman Documentation](https://podman.io/)
