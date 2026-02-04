import express from 'express';
import fetch from 'node-fetch';
import cors from 'cors';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 5050;

// Client configuration
const CLIENT_ID = process.env.SOUNDCLOUD_CLIENT_ID;
const CLIENT_SECRET = process.env.SOUNDCLOUD_CLIENT_SECRET;
const REDIRECT_URI = process.env.REDIRECT_URI || 'http://localhost:5050/auth/callback';
const SOUNDCLOUD_AUTH_URL = 'https://secure.soundcloud.com/authorize';
const SOUNDCLOUD_TOKEN_URL = 'https://secure.soundcloud.com/oauth/token';

// Middleware
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Store tokens (in production, use a database)
const tokenStore = new Map();

// OAuth endpoints
app.get('/auth/login', (req, res) => {
  const authUrl = new URL(SOUNDCLOUD_AUTH_URL);
  authUrl.searchParams.append('client_id', CLIENT_ID);
  authUrl.searchParams.append('redirect_uri', REDIRECT_URI);
  authUrl.searchParams.append('response_type', 'code');
  authUrl.searchParams.append('scope', 'non-expiring');
  
  res.json({ url: authUrl.toString() });
});

app.get('/auth/callback', async (req, res) => {
  const { code, error } = req.query;
  
  if (error) {
    return res.status(400).send(`Authentication failed: ${error}`);
  }
  
  if (!code) {
    return res.status(400).send('No authorization code provided');
  }
  
  try {
    // Exchange code for access token
    const response = await fetch(SOUNDCLOUD_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: CLIENT_ID,
        client_secret: CLIENT_SECRET,
        redirect_uri: REDIRECT_URI,
        grant_type: 'authorization_code',
        code: code,
        scope: 'non-expiring' // Should be a nonce
      })
    });
    
    if (!response.ok) {
      throw new Error(`Token exchange failed: ${response.statusText}`);
    }
    
    const tokenData = await response.json();
    const accessToken = tokenData.access_token;
    const refreshToken = tokenData.refresh_token || null;
    const expiresAt = tokenData.expires_in ? Date.now() + tokenData.expires_in * 1000 : null;
    
    // Store token with a unique key (in production, use session/database)
    const tokenKey = `token_${Date.now()}`;
    tokenStore.set(tokenKey, { accessToken, refreshToken, expiresAt });
    
    // Redirect back to app with token info
    res.redirect(`/?token=${tokenKey}`);
  } catch (error) {
    console.error('Token exchange error:', error);
    res.status(500).send('Authentication failed');
  }
});

app.get('/auth/token/:tokenKey', (req, res) => {
  const { tokenKey } = req.params;
  const tokenData = tokenStore.get(tokenKey);
  
  if (!tokenData?.accessToken) {
    return res.status(404).json({ error: 'Token not found' });
  }
  
  res.json({ accessToken: tokenData.accessToken, expiresAt: tokenData.expiresAt });
});

app.post('/auth/refresh/:tokenKey', async (req, res) => {
  const { tokenKey } = req.params;
  const tokenData = tokenStore.get(tokenKey);
  
  if (!tokenData?.refreshToken) {
    return res.status(400).json({ error: 'Refresh token not available. Re-authenticate.' });
  }
  
  try {
    const response = await fetch(SOUNDCLOUD_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: CLIENT_ID,
        client_secret: CLIENT_SECRET,
        redirect_uri: REDIRECT_URI,
        grant_type: 'refresh_token',
        refresh_token: tokenData.refreshToken
      })
    });
    
    if (!response.ok) {
      return res.status(response.status).json({ error: 'Failed to refresh token' });
    }
    
    const refreshed = await response.json();
    const accessToken = refreshed.access_token;
    const refreshToken = refreshed.refresh_token || tokenData.refreshToken;
    const expiresAt = refreshed.expires_in ? Date.now() + refreshed.expires_in * 1000 : tokenData.expiresAt;
    
    tokenStore.set(tokenKey, { accessToken, refreshToken, expiresAt });
    res.json({ accessToken, expiresAt });
  } catch (error) {
    console.error('Token refresh error:', error);
    res.status(500).json({ error: 'Token refresh failed' });
  }
});

app.listen(PORT, () => {
  console.log(`SoundCloud Player server running on http://localhost:${PORT}`);
  if (!CLIENT_ID || !CLIENT_SECRET) {
    console.warn('Warning: SOUNDCLOUD_CLIENT_ID and SOUNDCLOUD_CLIENT_SECRET environment variables are required');
  }
});
