/**
 * UI Controller
 * Handles DOM manipulation and UI state updates
 */

class UIController {
    constructor() {
        // DOM elements
        this.elements = {};

        // State
        this.findings = [];
        this.transcript = [];
    }

    /**
     * Initialize UI controller and cache DOM elements
     */
    init() {
        // Cache frequently accessed elements
        this.elements = {
            // Status
            connectionStatus: document.getElementById('connectionStatus'),
            statusText: document.querySelector('.status-text'),

            // Camera
            cameraPreview: document.getElementById('cameraPreview'),
            captureCanvas: document.getElementById('captureCanvas'),
            cameraOverlay: document.getElementById('cameraOverlay'),

            // Speaking indicators
            userSpeaking: document.getElementById('userSpeaking'),
            aiSpeaking: document.getElementById('aiSpeaking'),

            // Panels
            transcriptPanel: document.getElementById('transcriptPanel'),
            findingsPanel: document.getElementById('findingsPanel'),
            findingsCount: document.getElementById('findingsCount'),

            // Controls
            startBtn: document.getElementById('startBtn'),
            stopBtn: document.getElementById('stopBtn'),
            settingsBtn: document.getElementById('settingsBtn'),

            // Settings modal
            settingsModal: document.getElementById('settingsModal'),
            closeSettingsBtn: document.getElementById('closeSettingsBtn'),
            saveSettingsBtn: document.getElementById('saveSettingsBtn'),
            apiKeyInput: document.getElementById('apiKeyInput')
        };

        // Load saved settings
        this._loadSettings();

        // Setup event listeners
        this._setupEventListeners();

        console.log('[UI] Initialized');
    }

    /**
     * Setup UI event listeners
     */
    _setupEventListeners() {
        // Settings modal
        this.elements.settingsBtn.addEventListener('click', () => this.showSettings());
        this.elements.closeSettingsBtn.addEventListener('click', () => this.hideSettings());
        this.elements.saveSettingsBtn.addEventListener('click', () => this._saveSettings());

        // Close modal on backdrop click
        this.elements.settingsModal.addEventListener('click', (e) => {
            if (e.target === this.elements.settingsModal) {
                this.hideSettings();
            }
        });
    }

    /**
     * Load saved settings from localStorage
     */
    _loadSettings() {
        const apiKey = localStorage.getItem(CONFIG.STORAGE_API_KEY) || '';
        this.elements.apiKeyInput.value = apiKey;
    }

    /**
     * Save settings to localStorage
     */
    _saveSettings() {
        const apiKey = this.elements.apiKeyInput.value.trim();

        if (apiKey) {
            localStorage.setItem(CONFIG.STORAGE_API_KEY, apiKey);
        } else {
            localStorage.removeItem(CONFIG.STORAGE_API_KEY);
        }

        this.hideSettings();
        console.log('[UI] Settings saved');
    }

    /**
     * Get API key from settings
     */
    getApiKey() {
        return localStorage.getItem(CONFIG.STORAGE_API_KEY) || '';
    }

    /**
     * Show settings modal
     */
    showSettings() {
        this.elements.settingsModal.classList.remove('hidden');
    }

    /**
     * Hide settings modal
     */
    hideSettings() {
        this.elements.settingsModal.classList.add('hidden');
    }

    /**
     * Update connection status
     * @param {string} status - 'connected', 'connecting', 'disconnected', 'error'
     * @param {string} [message] - Optional status message
     */
    setConnectionStatus(status, message) {
        const statusBar = this.elements.connectionStatus;
        const statusText = this.elements.statusText;

        // Remove all status classes
        statusBar.classList.remove('connected', 'connecting', 'disconnected', 'error');
        statusBar.classList.add(status);

        // Set status text
        const defaultMessages = {
            connected: 'Connected',
            connecting: 'Connecting...',
            disconnected: 'Disconnected',
            error: 'Connection Error'
        };

        statusText.textContent = message || defaultMessages[status] || status;
    }

    /**
     * Show/hide camera overlay
     * @param {boolean} show - Whether to show the overlay
     */
    setCameraOverlay(show) {
        if (show) {
            this.elements.cameraOverlay.classList.remove('hidden');
        } else {
            this.elements.cameraOverlay.classList.add('hidden');
        }
    }

    /**
     * Set user speaking indicator
     * @param {boolean} speaking - Whether user is speaking
     */
    setUserSpeaking(speaking) {
        if (speaking) {
            this.elements.userSpeaking.classList.add('active');
        } else {
            this.elements.userSpeaking.classList.remove('active');
        }
    }

    /**
     * Set AI speaking indicator
     * @param {boolean} speaking - Whether AI is speaking
     */
    setAiSpeaking(speaking) {
        if (speaking) {
            this.elements.aiSpeaking.classList.add('active');
        } else {
            this.elements.aiSpeaking.classList.remove('active');
        }
    }

    /**
     * Add transcript entry
     * @param {string} role - 'user' or 'ai'
     * @param {string} text - Transcript text
     */
    addTranscript(role, text) {
        if (!text || !text.trim()) return;

        const timestamp = new Date().toISOString();
        this.transcript.push({ role, text, timestamp });

        // Remove placeholder if present
        const placeholder = this.elements.transcriptPanel.querySelector('.transcript-placeholder');
        if (placeholder) {
            placeholder.remove();
        }

        // Create transcript entry
        const entry = document.createElement('div');
        entry.className = `transcript-entry ${role}`;
        entry.innerHTML = `
            <div class="role">${role === 'user' ? 'You' : 'AI'}</div>
            <div class="text">${this._escapeHtml(text)}</div>
            <div class="timestamp">${new Date().toLocaleTimeString()}</div>
        `;

        this.elements.transcriptPanel.appendChild(entry);

        // Auto-scroll to bottom
        this.elements.transcriptPanel.scrollTop = this.elements.transcriptPanel.scrollHeight;
    }

    /**
     * Add finding
     * @param {string} title - Finding title
     * @param {string} description - Finding description
     * @param {string} severity - 'info', 'warning', or 'critical'
     */
    addFinding(title, description, severity = 'info') {
        const timestamp = new Date().toISOString();
        this.findings.push({ title, description, severity, timestamp });

        // Remove placeholder if present
        const placeholder = this.elements.findingsPanel.querySelector('.findings-placeholder');
        if (placeholder) {
            placeholder.remove();
        }

        // Update count
        this.elements.findingsCount.textContent = `(${this.findings.length})`;

        // Create finding element
        const item = document.createElement('div');
        item.className = `finding-item ${severity}`;
        item.innerHTML = `
            <div class="finding-title">${this._escapeHtml(title)}</div>
            <div class="finding-description">${this._escapeHtml(description)}</div>
            <span class="finding-severity">${severity}</span>
        `;

        this.elements.findingsPanel.appendChild(item);

        // Auto-scroll to bottom
        this.elements.findingsPanel.scrollTop = this.elements.findingsPanel.scrollHeight;
    }

    /**
     * Parse AI text for findings
     * Looks for patterns like "CRITICAL:", "WARNING:", "INFO:"
     * @param {string} text - AI response text
     */
    parseFindings(text) {
        const patterns = [
            { regex: /CRITICAL:\s*(.+?)(?=(?:CRITICAL:|WARNING:|INFO:|$))/gi, severity: 'critical' },
            { regex: /WARNING:\s*(.+?)(?=(?:CRITICAL:|WARNING:|INFO:|$))/gi, severity: 'warning' },
            { regex: /INFO:\s*(.+?)(?=(?:CRITICAL:|WARNING:|INFO:|$))/gi, severity: 'info' }
        ];

        for (const pattern of patterns) {
            let match;
            while ((match = pattern.regex.exec(text)) !== null) {
                const content = match[1].trim();
                if (content) {
                    // Split into title and description at first period or dash
                    const parts = content.split(/[.\-](.+)/);
                    const title = parts[0].trim();
                    const description = parts[1] ? parts[1].trim() : '';
                    this.addFinding(title, description, pattern.severity);
                }
            }
        }
    }

    /**
     * Show start button, hide stop button
     */
    showStartButton() {
        this.elements.startBtn.classList.remove('hidden');
        this.elements.stopBtn.classList.add('hidden');
    }

    /**
     * Show stop button, hide start button
     */
    showStopButton() {
        this.elements.startBtn.classList.add('hidden');
        this.elements.stopBtn.classList.remove('hidden');
    }

    /**
     * Clear transcript panel
     */
    clearTranscript() {
        this.transcript = [];
        this.elements.transcriptPanel.innerHTML = '<p class="transcript-placeholder">Conversation will appear here...</p>';
    }

    /**
     * Clear findings panel
     */
    clearFindings() {
        this.findings = [];
        this.elements.findingsPanel.innerHTML = '<p class="findings-placeholder">No findings yet</p>';
        this.elements.findingsCount.textContent = '(0)';
    }

    /**
     * Reset UI to initial state
     */
    reset() {
        this.clearTranscript();
        this.clearFindings();
        this.setConnectionStatus('disconnected');
        this.setCameraOverlay(true);
        this.setUserSpeaking(false);
        this.setAiSpeaking(false);
        this.showStartButton();
    }

    /**
     * Get session data for webhook
     * @param {number} sessionDuration - Session duration in milliseconds
     */
    getSessionData(sessionDuration) {
        return {
            findings: this.findings,
            checklist: [], // Could be extended with checklist feature
            transcript: this.transcript,
            sessionDuration: sessionDuration,
            endTime: new Date().toISOString()
        };
    }

    /**
     * Escape HTML to prevent XSS
     * @param {string} text - Text to escape
     */
    _escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    /**
     * Get DOM elements (for external access)
     */
    getElements() {
        return this.elements;
    }
}
