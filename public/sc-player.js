class SCPlayer extends HTMLElement {
    constructor() {
        super();
        this.attachShadow({ mode: 'open' });
        this.audio = new Audio();
        this.trackUrl = null;
        this.trackData = null;
        this.isPlaying = false;
        this.accessToken = null;
        this.comments = [];
        this.currentTimestamp = 0;
        this.authRequired = false;
        this.apiBase = 'https://api.soundcloud.com';
        this.hlsInstance = null;
        this.isLiked = false;
    }

    static get observedAttributes() {
        return ['track-url'];
    }

    connectedCallback() {
        this.trackUrl = this.getAttribute('track-url');
        this.setupAudioListeners();
        this.setupGlobalListeners();
        this.checkForAccessToken();
        if (this.trackUrl) {
            this.loadTrack();
        }
        this.render();
    }

    attributeChangedCallback(name, oldValue, newValue) {
        if (name === 'track-url' && newValue !== oldValue) {
            this.trackUrl = newValue;
            this.loadTrack();
        }
    }

    setupGlobalListeners() {
        window.addEventListener('sc-token-ready', (e) => {
            this.accessToken = e.detail.accessToken;
            this.updateButtonStates();
            if (this.trackUrl) {
                this.loadTrack();
            }
        });

        window.addEventListener('sc-token-cleared', (e) => {
            this.accessToken = null;

            // Only clear track data if this is a real logout (not just token expiry test)
            if (e.detail?.fullLogout) {
                this.trackData = null;
                this.comments = [];
                this.authRequired = true;
                this.render();
            }

            this.updateButtonStates();
        });
    }

    checkForAccessToken() {
        const token = localStorage.getItem('sc_access_token');
        if (token) {
            this.accessToken = token;
        }
    }

    async loadTrack() {
        if (!this.trackUrl) return;
        console.log('Loading track from URL:', this.trackUrl);

        if (!this.accessToken) {
            this.authRequired = true;
            this.trackData = null;
            this.comments = [];
            this.render();
            return;
        }

        try {
            // Resolve track URL to track data using SoundCloud API
            const response = await this.apiFetch(
                `${this.apiBase}/resolve?url=${encodeURIComponent(this.trackUrl)}`,
                { headers: this.getAuthHeaders() }
            );
            if (response.ok) {
                this.trackData = await response.json();
                console.log('Track data loaded:', this.trackData);
                this.authRequired = false;
                this.loadComments(this.trackData.urn);
                await this.setupStreamUrl();
                this.render();
            } else {
                console.error('Failed to resolve track URL');
            }
        } catch (error) {
            console.error('Error loading track:', error);
        }
    }

    async setupStreamUrl() {
        if (!this.trackData) return;

        try {
            const response = await this.apiFetch(
                `${this.apiBase}/tracks/${this.trackData.id}/streams`,
                {
                    headers: {
                        ...this.getAuthHeaders(),
                        Accept: 'application/json; charset=utf-8'
                    }
                }
            );

            if (!response.ok) {
                throw new Error(`Streams request failed: ${response.status}`);
            }

            const streams = await response.json();
            console.log('Streams response:', streams);
            const candidates = Object.entries(streams)
                .filter(([key, url]) => url && !key.toLowerCase().includes('preview'))
                .map(([key, url]) => ({ key, url, score: this.getStreamScore(key) }))
                .sort((a, b) => b.score - a.score);

            if (!candidates.length) {
                throw new Error('No non-preview streams available');
            }

            const selected = candidates[0];
            console.log('Selected stream candidate:', selected);

            // Use redirect: 'follow' to automatically follow redirects and get the final URL
            const streamResponse = await this.apiFetch(selected.url, {
                method: 'GET',
                redirect: 'follow',
                headers: this.getAuthHeaders()
            });
            console.log('Stream response:', streamResponse);

            if (!streamResponse.ok) {
                throw new Error(`Stream fetch failed: ${streamResponse.status}`);
            }

            // Issue: https://github.com/soundcloud/api/issues/478
            const finalStreamUrl = streamResponse.url;
            if (!finalStreamUrl) {
                throw new Error('No final stream URL provided');
            }

            console.log('Final stream URL from redirect:', finalStreamUrl);

            // Check if this is an HLS stream
            const isHlsStream = finalStreamUrl.includes('.m3u8');

            if (isHlsStream) {
                await this.setupHlsStream(finalStreamUrl);
            } else {
                this.audio.crossOrigin = 'anonymous';
                this.audio.src = finalStreamUrl;
            }
        } catch (error) {
            console.error('Error setting up stream:', error);
        }
    }

    async setupHlsStream(streamUrl) {
        try {
            // HLS.js should be available from npm package
            if (typeof window.Hls === 'undefined') {
                throw new Error('HLS.js not loaded.');
            }

            const Hls = window.Hls;

            if (this.hlsInstance) {
                this.hlsInstance.destroy();
            }

            if (Hls.isSupported()) {
                this.hlsInstance = new Hls();
                this.hlsInstance.loadSource(streamUrl);
                this.hlsInstance.attachMedia(this.audio);
                console.log('HLS stream loaded:', streamUrl);
            } else if (this.audio.canPlayType('application/vnd.apple.mpegurl')) {
                // Native HLS support (Safari)
                this.audio.src = streamUrl;
                console.log('Native HLS support used:', streamUrl);
            } else {
                throw new Error('HLS playback not supported');
            }
        } catch (error) {
            console.error('Error setting up HLS stream:', error);
        }
    }

    getStreamScore(key) {
        const lower = key.toLowerCase();

        // Prioritize higher quality
        if (lower.includes('hls') && lower.includes('aac') && lower.includes('160')) return 5;
        if (lower.includes('hls') && lower.includes('aac')) return 4;
        if (lower.includes('http') && lower.includes('mp3') && lower.includes('128')) return 3;
        if (lower.includes('http') && lower.includes('mp3')) return 2;
        if (lower.includes('hls') && lower.includes('mp3')) return 1;
        return 0;
    }

    async loadComments(trackUrn) {
        try {
            const cacheBuster = Date.now();
            const response = await this.apiFetch(
                `${this.apiBase}/tracks/${trackUrn}/comments?limit=100&linked_partitioning=true&cache_bust=${cacheBuster}`,
                {
                    headers: this.getAuthHeaders(),
                    cache: 'no-store'
                }
            );
            if (response.ok) {
                const data = await response.json();
                this.comments = data.collection || [];
                this.renderComments();
            }
        } catch (error) {
            console.error('Error loading comments:', error);
        }
    }

    setupAudioListeners() {
        this.audio.addEventListener('play', () => {
            this.isPlaying = true;
            this.updatePlayButton();
        });

        this.audio.addEventListener('pause', () => {
            this.isPlaying = false;
            this.updatePlayButton();
        });

        this.audio.addEventListener('timeupdate', () => {
            this.currentTimestamp = this.audio.currentTime;
            this.updateTimeDisplay();
        });

        this.audio.addEventListener('loadedmetadata', () => {
            this.updateDurationDisplay();
        });

        this.audio.addEventListener('ended', () => {
            this.isPlaying = false;
            this.updatePlayButton();
        });

        this.audio.addEventListener('error', async (e) => {
            console.error('Audio playback error:', e, 'Code:', this.audio.error?.code);

            // If we get a network/permission error (code 4), try refreshing token and reloading stream
            if (this.audio.error?.code === 4 && !this.audioRetryInProgress) {
                this.audioRetryInProgress = true;
                const refreshed = await this.refreshAccessToken();
                if (refreshed) {
                    console.log('Token refreshed, retrying stream...');
                    await this.setupStreamUrl();
                    this.audio.play().catch(err => console.error('Retry play failed:', err));
                }
                this.audioRetryInProgress = false;
            }
        });
    }

    togglePlay() {
        if (!this.trackData) {
            alert('Track not loaded');
            return;
        }

        if (this.isPlaying) {
            this.audio.pause();
        } else {
            this.audio.play().catch(error => {
                console.error('Playback error:', error);
                alert('Failed to play audio');
            });
        }
    }

    updatePlayButton() {
        const btn = this.shadowRoot.querySelector('.play-btn');
        if (btn) {
            btn.textContent = this.isPlaying ? '⏸ Pause' : '▶ Play';
        }
    }

    updateTimeDisplay() {
        const timeDisplay = this.shadowRoot.querySelector('.time-display');
        if (timeDisplay) {
            const current = this.formatTime(this.audio.currentTime);
            const duration = this.formatTime(this.audio.duration);
            timeDisplay.textContent = `${current} / ${duration}`;
        }

        const progressBar = this.shadowRoot.querySelector('input[type="range"]');
        if (progressBar && this.audio.duration) {
            progressBar.value = this.audio.currentTime;
        }
    }

    updateDurationDisplay() {
        const progressBar = this.shadowRoot.querySelector('input[type="range"]');
        if (progressBar && this.audio.duration) {
            progressBar.max = this.audio.duration;
        }
    }

    formatTime(seconds) {
        if (!seconds || isNaN(seconds)) return '0:00';
        const mins = Math.floor(seconds / 60);
        const secs = Math.floor(seconds % 60);
        return `${mins}:${secs.toString().padStart(2, '0')}`;
    }

    handleProgressChange(e) {
        this.audio.currentTime = parseFloat(e.target.value);
    }

    async handleLike() {
        if (!this.accessToken) {
            alert('Please authenticate first');
            return;
        }

        if (!this.trackData) {
            alert('Track not loaded');
            return;
        }

        try {
            const trackUrn = this.trackData.urn;
            if (!trackUrn) {
                throw new Error('Track URN not available');
            }

            const method = this.isLiked ? 'DELETE' : 'POST';
            const response = await this.apiFetch(
                `${this.apiBase}/likes/tracks/${trackUrn}`,
                {
                    method: method,
                    headers: this.getAuthHeaders()
                }
            );

            if (response.ok) {
                this.isLiked = !this.isLiked;
                const likeBtn = this.shadowRoot.querySelector('.like-btn');
                if (this.isLiked) {
                    likeBtn.style.color = '#ff5500';
                    alert('Track liked!');
                } else {
                    likeBtn.style.color = '#999';
                    alert('Track unliked!');
                }
            } else {
                alert(`Failed to ${this.isLiked ? 'unlike' : 'like'} track`);
            }
        } catch (error) {
            console.error('Error toggling like:', error);
        }
    }

    async handleComment() {
        if (!this.accessToken) {
            this.showCommentStatus('Please authenticate first', 'error');
            return;
        }

        const commentInput = this.shadowRoot.querySelector('.comment-input');
        const commentText = commentInput.value.trim();

        if (!commentText) {
            this.showCommentStatus('Please enter a comment', 'error');
            return;
        }

        const submitBtn = this.shadowRoot.querySelector('.comment-submit');
        submitBtn.disabled = true;
        commentInput.disabled = true;

        try {
            const response = await this.apiFetch(
                `${this.apiBase}/tracks/${this.trackData.urn}/comments`,
                {
                    method: 'POST',
                    headers: {
                        ...this.getAuthHeaders(),
                    },
                    body: JSON.stringify({
                        comment: {
                            body: commentText,
                            timestamp: Math.floor(this.currentTimestamp * 1000).toString()
                        }
                    })
                }
            );

            if (response.ok) {
                this.showCommentStatus('Comment posted successfully!', 'success');
                commentInput.value = '';
                this.loadComments(this.trackData.urn);
            } else {
                this.showCommentStatus('Failed to post comment', 'error');
            }
        } catch (error) {
            console.error('Error posting comment:', error);
            this.showCommentStatus('Error posting comment', 'error');
        } finally {
            submitBtn.disabled = false;
            commentInput.disabled = false;
        }
    }

    showCommentStatus(message, type) {
        const statusEl = this.shadowRoot.querySelector('.comment-status');
        if (statusEl) {
            statusEl.textContent = message;
            statusEl.className = `comment-status ${type}`;
            setTimeout(() => {
                statusEl.className = 'comment-status';
            }, 6000);
        }
    }

    renderComments() {
        const commentsListEl = this.shadowRoot.querySelector('.comments-list');
        if (!commentsListEl) return;

        if (this.comments.length > 0) {
            commentsListEl.innerHTML = this.comments.map(comment => `
        <div class="comment">
          <div class="comment-user-header">
            <span class="comment-user">${comment.user?.username || 'Anonymous'}</span>
            <span class="comment-time">${comment.timestamp ? 'at ' + this.formatTime(comment.timestamp / 1000) : 'general'}</span>
          </div>
          <div class="comment-text">${comment.body}</div>
        </div>
      `).join('');
        } else {
            commentsListEl.innerHTML = '<div style="color: #999; font-size: 13px;">No comments yet</div>';
        }
    }

    updateButtonStates() {
        const likeBtn = this.shadowRoot.querySelector('.like-btn');

        const isAuthenticated = !!this.accessToken;
        const isPrivate = this.trackData?.sharing === 'private';

        if (likeBtn) {
            likeBtn.disabled = !isAuthenticated || isPrivate;
            if (isPrivate) {
                likeBtn.title = 'Cannot like private tracks';
            }
        }
    }

    getAuthHeaders() {
        return this.accessToken ? { Authorization: `OAuth ${this.accessToken}` } : {};
    }

    async refreshAccessToken() {
        const tokenKey = localStorage.getItem('sc_token_key');
        if (!tokenKey) return false;

        try {
            const response = await fetch(`/auth/refresh/${tokenKey}`, { method: 'POST' });
            if (!response.ok) return false;
            const data = await response.json();
            if (!data?.accessToken) return false;

            this.accessToken = data.accessToken;
            localStorage.setItem('sc_access_token', data.accessToken);

            window.dispatchEvent(new CustomEvent('sc-token-ready', {
                detail: { accessToken: data.accessToken }
            }));

            return true;
        } catch (error) {
            console.error('Token refresh failed:', error);
            return false;
        }
    }

    async apiFetch(url, options = {}, retry = true) {
        const response = await fetch(url, options);
        if ((response.status === 401 || response.status === 403) && retry) {
            console.log('Access token expired, attempting to refresh...');
            const refreshed = await this.refreshAccessToken();
            if (refreshed) {
                console.log('Token refreshed, retrying original request...');
                const retryOptions = {
                    ...options,
                    headers: {
                        ...(options.headers || {}),
                        ...this.getAuthHeaders()
                    }
                };
                return fetch(url, retryOptions);
            }
        }
        return response;
    }

    render() {
        if (this.authRequired) {
            this.shadowRoot.innerHTML = `
        <style>
          :host {
            display: block;
            padding: 20px;
            background: #f9f9f9;
            border-radius: 8px;
            border: 1px solid #eee;
          }
          .auth-required {
            color: #666;
            font-size: 14px;
          }
        </style>
        <div class="auth-required">Authenticate with SoundCloud to load this track.</div>
      `;
            return;
        }

        if (!this.trackData) {
            this.shadowRoot.innerHTML = `
        <style>
          :host {
            display: block;
            padding: 20px;
            background: #f9f9f9;
            border-radius: 8px;
            border: 1px solid #eee;
          }
        </style>
        <div>Loading track...</div>
      `;
            return;
        }

        const artwork = this.trackData.artwork_url || 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"%3E%3Crect fill="%23ddd" width="100" height="100"/%3E%3C/svg%3E';
        const waveformUrl = this.trackData.waveform_url || '';

        this.shadowRoot.innerHTML = `
      <style>
        :host {
          display: block;
          padding: 20px;
          background: white;
          border-radius: 8px;
          border: 1px solid #eee;
          box-shadow: 0 2px 8px rgba(0,0,0,0.1);
          max-height: 800px;
          overflow-y: auto;
          display: flex;
          flex-direction: column;
        }

        .player-header {
          display: flex;
          gap: 15px;
          margin-bottom: 20px;
        }

        .artwork {
          width: 80px;
          height: 80px;
          border-radius: 4px;
          overflow: hidden;
          flex-shrink: 0;
        }

        .artwork img {
          width: 100%;
          height: 100%;
          object-fit: cover;
        }

        .track-info {
          flex: 1;
          display: flex;
          flex-direction: column;
          justify-content: center;
        }

        .track-title {
          font-weight: 600;
          font-size: 16px;
          margin-bottom: 5px;
          color: #333;
        }

        .track-artist {
          font-size: 14px;
          color: #999;
        }

        .player-controls {
          display: flex;
          gap: 10px;
          margin-bottom: 15px;
          align-items: center;
        }

        button {
          padding: 10px 16px;
          border: none;
          border-radius: 4px;
          font-size: 14px;
          cursor: pointer;
          font-weight: 600;
          transition: all 0.2s ease;
          background: #f0f0f0;
          color: #333;
        }

        button:hover:not(:disabled) {
          background: #e0e0e0;
        }

        button:disabled {
          opacity: 0.5;
          cursor: not-allowed;
        }

        .play-btn {
          background: linear-gradient(135deg, #ff5500, #ff9900);
          color: white;
          padding: 10px 20px;
          min-width: 100px;
        }

        .play-btn:hover:not(:disabled) {
          transform: translateY(-2px);
          box-shadow: 0 4px 12px rgba(255, 85, 0, 0.3);
        }

        .like-btn {
          color: #999;
          min-width: 100px;
        }

        .reload-track-btn {
          background: none;
          border: none;
          padding: 4px 8px;
          cursor: pointer;
          font-size: 16px;
          color: #999;
          transition: all 0.2s ease;
          border-radius: 4px;
        }

        .reload-track-btn:hover {
          color: #333;
          background: #f0f0f0;
        }

        .transport-controls {
          display: flex;
          flex-direction: column;
          gap: 8px;
          margin-bottom: 15px;
        }

        .waveform {
          margin: 12px 0 8px;
          border-radius: 6px;
          overflow: hidden;
          background: #ff5500;
          display: flex;
          align-items: center;
          justify-content: center;
          aspect-ratio: 1800 / 140;
        }

        .waveform img {
          width: 100%;
          height: 100%;
          object-fit: cover;
          display: block;
          object-position: top;
        }

        input[type="range"] {
          width: 100%;
          cursor: pointer;
          height: 6px;
          border-radius: 3px;
          background: #e0e0e0;
          outline: none;
          -webkit-appearance: none;
        }

        input[type="range"]::-webkit-slider-thumb {
          -webkit-appearance: none;
          appearance: none;
          width: 14px;
          height: 14px;
          border-radius: 50%;
          background: #ff5500;
          cursor: pointer;
        }

        input[type="range"]::-moz-range-thumb {
          width: 14px;
          height: 14px;
          border-radius: 50%;
          background: #ff5500;
          cursor: pointer;
          border: none;
        }

        .time-display {
          font-size: 12px;
          color: #999;
          text-align: right;
        }

        .comments-section {
          margin-top: 20px;
          padding-top: 20px;
          border-top: 1px solid #eee;
          flex: 1;
          display: flex;
          flex-direction: column;
          overflow: hidden;
        }

        .comments-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 10px;
          flex-shrink: 0;
        }

        .comments-title {
          font-weight: 600;
          font-size: 14px;
          color: #333;
        }

        .comments-list {
          flex: 1;
          overflow-y: auto;
          min-height: 0;
        }

        .comment {
          padding: 10px;
          background: #f9f9f9;
          border-radius: 4px;
          margin-bottom: 10px;
          font-size: 13px;
        }

        .comment-user-header {
          display: flex;
          gap: 8px;
          align-items: baseline;
          margin-bottom: 5px;
        }

        .comment-user {
          font-weight: 600;
          color: #333;
        }

        .comment-time {
          font-size: 11px;
          color: #999;
        }

        .comment-text {
          color: #666;
          margin-top: 5px;
        }

        .reload-comments-btn {
          background: none;
          border: none;
          padding: 4px 8px;
          cursor: pointer;
          font-size: 16px;
          color: #999;
          transition: all 0.2s ease;
          border-radius: 4px;
        }

        .reload-comments-btn:hover {
          color: #333;
          background: #f0f0f0;
        }

        .comment-form {
          margin-bottom: 15px;
          display: flex;
          gap: 8px;
          flex-direction: column;
        }

        .comment-input-row {
          display: flex;
          gap: 8px;
        }

        .comment-input {
          flex: 1;
          padding: 8px 12px;
          border: 1px solid #ddd;
          border-radius: 4px;
          font-size: 14px;
          font-family: inherit;
          outline: none;
        }

        .comment-input:focus {
          border-color: #ff5500;
        }

        .comment-input:disabled {
          background: #f5f5f5;
          cursor: not-allowed;
        }

        .comment-submit {
          padding: 8px 16px;
          background: #ff5500;
          color: white;
          border: none;
          border-radius: 4px;
          font-size: 14px;
          cursor: pointer;
          font-weight: 600;
          transition: all 0.2s ease;
        }

        .comment-submit:hover:not(:disabled) {
          background: #ff6a00;
        }

        .comment-submit:disabled {
          opacity: 0.5;
          cursor: not-allowed;
        }

        .comment-status {
          font-size: 13px;
          padding: 6px 10px;
          border-radius: 4px;
          display: none;
        }

        .comment-status.success {
          display: block;
          color: #28a745;
          background: #d4edda;
          border: 1px solid #c3e6cb;
        }

        .comment-status.error {
          display: block;
          color: #dc3545;
          background: #f8d7da;
          border: 1px solid #f5c6cb;
        }
      </style>

      <div class="player-header">
        <div class="artwork">
          <img src="${artwork}" alt="${this.trackData.title}">
        </div>
        <div class="track-info">
          <div class="track-title">${this.trackData.title}</div>
          <div class="track-artist">${this.trackData.user?.username || 'Unknown Artist'}</div>
        </div>
      </div>

      <div class="player-controls">
        <button class="play-btn">▶ Play</button>
        <button class="like-btn" title="Like this track">♥ Like</button>
        <button class="reload-track-btn" title="Reload track">🔄</button>
      </div>

      <div class="waveform">
        ${waveformUrl ? `<img src="${waveformUrl}" alt="Waveform">` : ''}
      </div>

      <div class="transport-controls">
        <input type="range" min="0" max="127" value="0">
      </div>

      <div class="time-display">0:00 / 0:00</div>

      <div class="comments-section">
        <div class="comments-header">
          <div class="comments-title">Comments</div>
          <button class="reload-comments-btn" title="Reload comments">🔄</button>
        </div>
        <div class="comment-form">
          <div class="comment-input-row">
            <input type="text" class="comment-input" placeholder="Write a comment at ${this.formatTime(this.currentTimestamp)}..." ${!this.accessToken ? 'disabled' : ''}>
            <button class="comment-submit" ${!this.accessToken ? 'disabled' : ''}>Post</button>
          </div>
          <div class="comment-status"></div>
        </div>
        <div class="comments-list">
        </div>
      </div>
    `;

        this.setupEventListeners();
        this.updateButtonStates();
        this.updateTimeDisplay();
        this.renderComments();
    }

    setupEventListeners() {
        const playBtn = this.shadowRoot.querySelector('.play-btn');
        const likeBtn = this.shadowRoot.querySelector('.like-btn');
        const progressBar = this.shadowRoot.querySelector('input[type="range"]');
        const reloadCommentsBtn = this.shadowRoot.querySelector('.reload-comments-btn');
        const reloadTrackBtn = this.shadowRoot.querySelector('.reload-track-btn');
        const commentSubmitBtn = this.shadowRoot.querySelector('.comment-submit');
        const commentInput = this.shadowRoot.querySelector('.comment-input');

        if (playBtn) playBtn.addEventListener('click', () => this.togglePlay());
        if (likeBtn) likeBtn.addEventListener('click', () => this.handleLike());
        if (reloadCommentsBtn) reloadCommentsBtn.addEventListener('click', () => this.loadComments(this.trackData.urn));
        if (reloadTrackBtn) reloadTrackBtn.addEventListener('click', () => this.loadTrack());
        if (commentSubmitBtn) commentSubmitBtn.addEventListener('click', () => this.handleComment());
        if (commentInput) {
            commentInput.addEventListener('keypress', (e) => {
                if (e.key === 'Enter') {
                    this.handleComment();
                }
            });
            // Update placeholder as time changes
            this.audio.addEventListener('timeupdate', () => {
                if (commentInput) {
                    commentInput.placeholder = `Write a comment at ${this.formatTime(this.currentTimestamp)}...`;
                }
            });
        }
        if (progressBar) {
            progressBar.addEventListener('input', (e) => this.handleProgressChange(e));
        }
    }
}

customElements.define('sc-player', SCPlayer);
