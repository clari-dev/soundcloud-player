class SCAuth extends HTMLElement {
    constructor() {
        super();
        this.attachShadow({ mode: 'open' });
        this.accessToken = null;
        this.tokenKey = null;
    }

    connectedCallback() {
        this.render();
        this.checkForToken();
        this.setupEventListeners();
    }

    checkForToken() {
        const params = new URLSearchParams(window.location.search);
        const tokenKey = params.get('token');

        if (tokenKey && !this.accessToken) {
            this.tokenKey = tokenKey;
            this.fetchToken(tokenKey);
            // Clean up URL
            window.history.replaceState({}, document.title, window.location.pathname);
        }
    }

    async fetchToken(tokenKey) {
        try {
            const response = await fetch(`/auth/token/${tokenKey}`);
            if (response.ok) {
                const data = await response.json();
                this.setAccessToken(data.accessToken);
            }
        } catch (error) {
            console.error('Failed to fetch token:', error);
        }
    }

    setAccessToken(token) {
        this.accessToken = token;
        localStorage.setItem('sc_access_token', token);
        this.dispatchTokenEvent();
        this.updateDisplay();

        // Notify other SC player instances
        window.dispatchEvent(new CustomEvent('sc-token-ready', {
            detail: { accessToken: token }
        }));
    }

    getAccessToken() {
        return this.accessToken || localStorage.getItem('sc_access_token');
    }

    dispatchTokenEvent() {
        this.dispatchEvent(new CustomEvent('token-ready', {
            detail: { accessToken: this.accessToken },
            bubbles: true,
            composed: true
        }));
    }

    setupEventListeners() {
        const connectBtn = this.shadowRoot.querySelector('.connect-btn');
        if (connectBtn) {
            connectBtn.addEventListener('click', () => this.handleConnect());
        }

        const logoutBtn = this.shadowRoot.querySelector('.logout-btn');
        if (logoutBtn) {
            logoutBtn.addEventListener('click', () => this.handleLogout());
        }
    }

    async handleConnect() {
        try {
            const response = await fetch('/auth/login');
            const data = await response.json();
            window.location.href = data.url;
        } catch (error) {
            console.error('Failed to initiate login:', error);
            alert('Authentication failed. Please try again.');
        }
    }

    handleLogout() {
        this.accessToken = null;
        localStorage.removeItem('sc_access_token');
        this.updateDisplay();

        // Notify other instances
        window.dispatchEvent(new CustomEvent('sc-token-cleared'));
    }

    updateDisplay() {
        const status = this.shadowRoot.querySelector('.auth-status');
        const connectBtn = this.shadowRoot.querySelector('.connect-btn');
        const logoutBtn = this.shadowRoot.querySelector('.logout-btn');

        if (this.getAccessToken()) {
            status.textContent = 'Authenticated';
            status.classList.add('authenticated');
            connectBtn.style.display = 'none';
            logoutBtn.style.display = 'inline-block';
        } else {
            status.textContent = 'Not authenticated';
            status.classList.remove('authenticated');
            connectBtn.style.display = 'inline-block';
            logoutBtn.style.display = 'none';
        }
    }

    render() {
        const token = this.getAccessToken();
        const isAuthenticated = !!token;

        this.shadowRoot.innerHTML = `
      <style>
        :host {
          display: block;
          padding: 20px;
          background: #f5f5f5;
          border-radius: 8px;
          margin-bottom: 20px;
        }

        .auth-container {
          display: flex;
          align-items: center;
          gap: 20px;
        }

        .auth-status {
          font-weight: 600;
          color: #999;
          font-size: 14px;
        }

        .auth-status.authenticated {
          color: #33a353;
        }

        button {
          padding: 10px 20px;
          border: none;
          border-radius: 4px;
          font-size: 14px;
          cursor: pointer;
          font-weight: 600;
          transition: all 0.3s ease;
        }

        .connect-btn {
          background: linear-gradient(135deg, #ff5500, #ff9900);
          color: white;
          display: ${isAuthenticated ? 'none' : 'inline-block'};
        }

        .connect-btn:hover {
          transform: translateY(-2px);
          box-shadow: 0 4px 12px rgba(255, 85, 0, 0.3);
        }

        .logout-btn {
          background: #e0e0e0;
          color: #333;
          display: ${isAuthenticated ? 'inline-block' : 'none'};
        }

        .logout-btn:hover {
          background: #d0d0d0;
        }
      </style>

      <div class="auth-container">
        <div class="auth-status">${isAuthenticated ? 'Authenticated' : 'Not authenticated'}</div>
        <button class="connect-btn">Connect with SoundCloud</button>
        <button class="logout-btn">Logout</button>
      </div>
    `;

        this.setupEventListeners();
        this.updateDisplay();
    }
}

customElements.define('sc-auth', SCAuth);
