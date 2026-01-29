/**
 * App Orchestrator
 * Main application controller that wires all components together
 */

class App {
    constructor() {
        // Components
        this.ui = new UIController();
        this.gemini = new GeminiLiveClient();
        this.camera = new CameraManager();
        this.audio = new AudioManager();

        // State
        this.isRunning = false;
        this.sessionStartTime = null;
        this.sessionTimeout = null;
    }

    /**
     * Initialize the application
     */
    async init() {
        console.log('[App] Initializing...');

        // Initialize UI
        this.ui.init();

        // Get DOM elements
        const elements = this.ui.getElements();

        // Initialize camera manager
        this.camera.init(elements.cameraPreview, elements.captureCanvas);

        // Setup button handlers
        elements.startBtn.addEventListener('click', () => this.start());
        elements.stopBtn.addEventListener('click', () => this.stop());

        // Setup Gemini callbacks
        this._setupGeminiCallbacks();

        // Setup Camera callbacks
        this._setupCameraCallbacks();

        // Setup Audio callbacks
        this._setupAudioCallbacks();

        // Setup network listeners
        this._setupNetworkListeners();

        console.log('[App] Initialized');
    }

    /**
     * Setup network status listeners for offline detection
     */
    _setupNetworkListeners() {
        window.addEventListener('offline', () => {
            console.log('[App] Network offline');
            if (this.isRunning) {
                this.ui.setConnectionStatus('error', 'Internet connection lost');
                this.stop();
            }
        });

        window.addEventListener('online', () => {
            console.log('[App] Network back online');
            if (!this.isRunning) {
                this.ui.setConnectionStatus('disconnected', 'Back online - ready');
            }
        });
    }

    /**
     * Setup Gemini client callbacks
     */
    _setupGeminiCallbacks() {
        this.gemini.onConnecting = (attempt, maxAttempts) => {
            this.ui.setConnectionStatus('connecting', `Connecting... (${attempt}/${maxAttempts})`);
        };

        this.gemini.onRetry = (attempt, maxAttempts, reason) => {
            console.log(`[App] Gemini retry ${attempt}/${maxAttempts}: ${reason}`);
            this.ui.setConnectionStatus('connecting', `Retrying... (${attempt}/${maxAttempts})`);
        };

        this.gemini.onConnected = () => {
            console.log('[App] Gemini connected');
            this.ui.setConnectionStatus('connected');

            // Start camera capture and audio input
            this.camera.startCapture();
            this.audio.startInput();
        };

        this.gemini.onDisconnected = (event) => {
            console.log('[App] Gemini disconnected');
            if (this.isRunning) {
                this.ui.setConnectionStatus('error', 'Connection lost');
                this.stop();
            }
        };

        this.gemini.onError = (error) => {
            console.error('[App] Gemini error:', error);
            const message = this._getErrorMessage(error);
            this.ui.setConnectionStatus('error', message);

            if (this.isRunning) {
                this.stop();
            }
        };

        this.gemini.onAudioResponse = (base64Audio) => {
            // Queue audio for playback
            this.audio.queueAudio(base64Audio);
            this.ui.setAiSpeaking(true);
        };

        this.gemini.onTextResponse = (text) => {
            console.log('[App] Text response:', text);
            // Parse for findings
            this.ui.parseFindings(text);
        };

        this.gemini.onTranscript = (role, text) => {
            if (text && text.trim()) {
                this.ui.addTranscript(role, text);

                // Parse AI transcripts for findings
                if (role === 'ai') {
                    this.ui.parseFindings(text);
                }
            }
        };

        this.gemini.onInterrupted = () => {
            console.log('[App] AI interrupted');
            this.audio.stopPlayback();
            this.ui.setAiSpeaking(false);
        };

        this.gemini.onTurnComplete = () => {
            console.log('[App] Turn complete');
            // AI speaking indicator will be cleared when audio queue empties
        };

        this.gemini.onSetupComplete = () => {
            console.log('[App] Gemini setup complete');
        };
    }

    /**
     * Setup camera callbacks
     */
    _setupCameraCallbacks() {
        this.camera.onFrameCaptured = (base64Image) => {
            if (this.gemini.isReady()) {
                this.gemini.sendVideoFrame(base64Image);
            }
        };

        this.camera.onError = (error) => {
            console.error('[App] Camera error:', error);
            const message = this._getPermissionErrorMessage(error, 'camera');
            this.ui.setConnectionStatus('error', message);
        };
    }

    /**
     * Setup audio callbacks
     */
    _setupAudioCallbacks() {
        this.audio.onAudioChunk = (base64Audio) => {
            if (this.gemini.isReady()) {
                this.gemini.sendAudio(base64Audio);
            }
        };

        this.audio.onSpeechStart = () => {
            console.log('[App] User speech started');
            this.ui.setUserSpeaking(true);

            // Barge-in: stop AI playback when user speaks
            if (this.audio.isSpeakingNow()) {
                console.log('[App] Barge-in detected');
                this.audio.stopPlayback();
                this.ui.setAiSpeaking(false);
            }
        };

        this.audio.onSpeechEnd = () => {
            console.log('[App] User speech ended');
            this.ui.setUserSpeaking(false);
        };

        this.audio.onError = (error) => {
            console.error('[App] Audio error:', error);
            const message = this._getPermissionErrorMessage(error, 'microphone');
            this.ui.setConnectionStatus('error', message);
        };
    }

    /**
     * Get user-friendly error message for permission errors
     * @param {Error} error - The error object
     * @param {string} device - Device type ('camera' or 'microphone')
     * @returns {string} User-friendly error message
     */
    _getPermissionErrorMessage(error, device) {
        const name = error.name || '';
        const message = error.message || '';

        if (name === 'NotAllowedError' || message.includes('Permission denied')) {
            return `Please allow ${device} access`;
        }

        if (name === 'NotFoundError' || message.includes('not found')) {
            return `No ${device} found`;
        }

        if (name === 'NotReadableError' || message.includes('in use')) {
            return `${device.charAt(0).toUpperCase() + device.slice(1)} in use by another app`;
        }

        if (name === 'OverconstrainedError') {
            return `${device.charAt(0).toUpperCase() + device.slice(1)} doesn't support required settings`;
        }

        return error.userMessage || error.message || `${device.charAt(0).toUpperCase() + device.slice(1)} error`;
    }

    /**
     * Get user-friendly error message for general errors
     * @param {Error} error - The error object
     * @returns {string} User-friendly error message
     */
    _getErrorMessage(error) {
        const message = error.message || '';

        if (message.includes('timeout')) {
            return 'Connection timed out';
        }

        if (message.includes('retries')) {
            return 'Could not connect - check your internet';
        }

        if (message.includes('not found') || message.includes('not supported')) {
            return 'API model not available';
        }

        if (message.includes('API key') || message.includes('401') || message.includes('403')) {
            return 'Invalid API key';
        }

        return message || 'Connection error';
    }

    /**
     * Start inspection session
     */
    async start() {
        // Check for internet connection
        if (!navigator.onLine) {
            this.ui.setConnectionStatus('error', 'No internet connection');
            return;
        }

        // Check for API key
        const apiKey = this.ui.getApiKey();
        if (!apiKey) {
            this.ui.showSettings();
            alert('Please enter your Gemini API key in settings.');
            return;
        }

        console.log('[App] Starting inspection...');
        this.isRunning = true;
        this.sessionStartTime = Date.now();

        // Update UI
        this.ui.showStopButton();
        this.ui.setConnectionStatus('connecting');
        this.ui.clearTranscript();
        this.ui.clearFindings();

        try {
            // Initialize audio (requires user gesture)
            const audioInitialized = await this.audio.init();
            if (!audioInitialized) {
                throw new Error('Failed to initialize audio');
            }

            // Start camera
            const cameraStarted = await this.camera.start();
            if (!cameraStarted) {
                // Camera manager stores specific error info
                const cameraError = new Error('Camera access failed');
                cameraError.name = 'CameraError';
                throw cameraError;
            }

            // Hide camera overlay
            this.ui.setCameraOverlay(false);

            // Connect to Gemini (with built-in retry)
            this.gemini.connect(apiKey);

            // Set session timeout (Gemini Live API has 10-min limit)
            this.sessionTimeout = setTimeout(() => {
                console.log('[App] Session timeout reached');
                this.ui.addTranscript('ai', 'Session time limit reached. Ending inspection...');
                this.stop();
            }, CONFIG.SESSION_TIMEOUT_MS);

        } catch (error) {
            console.error('[App] Error starting:', error);
            const message = this._getPermissionErrorMessage(error, 'device');
            this.ui.setConnectionStatus('error', message);
            this.stop();
        }
    }

    /**
     * Stop inspection session
     */
    async stop() {
        console.log('[App] Stopping inspection...');

        // Clear timeout
        if (this.sessionTimeout) {
            clearTimeout(this.sessionTimeout);
            this.sessionTimeout = null;
        }

        // Calculate session duration
        const sessionDuration = this.sessionStartTime ? Date.now() - this.sessionStartTime : 0;

        // Stop all components
        this.camera.stop();
        this.audio.stopInput();
        this.audio.stopPlayback();
        this.gemini.disconnect();

        // Collect session data (only if session ran for at least 5 seconds)
        if (this.isRunning && sessionDuration > 5000) {
            await this._sendWebhook(sessionDuration);
        }

        // Reset state
        this.isRunning = false;
        this.sessionStartTime = null;

        // Update UI
        this.ui.showStartButton();
        this.ui.setConnectionStatus('disconnected');
        this.ui.setCameraOverlay(true);
        this.ui.setUserSpeaking(false);
        this.ui.setAiSpeaking(false);

        console.log('[App] Inspection stopped');
    }

    /**
     * Send session data to webhook
     * @param {number} sessionDuration - Session duration in milliseconds
     */
    async _sendWebhook(sessionDuration) {
        const webhookUrl = this.ui.getWebhookUrl();
        if (!webhookUrl) {
            console.log('[App] No webhook URL configured');
            return;
        }

        const sessionData = this.ui.getSessionData(sessionDuration);

        try {
            console.log('[App] Sending webhook...', sessionData);

            const response = await fetch(webhookUrl, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(sessionData)
            });

            if (response.ok) {
                console.log('[App] Webhook sent successfully');
            } else {
                console.error('[App] Webhook failed:', response.status, response.statusText);
            }
        } catch (error) {
            console.error('[App] Webhook error:', error);
        }
    }

    /**
     * Monitor audio playback state for AI speaking indicator
     */
    _startPlaybackMonitor() {
        // Check if audio is still playing every 100ms
        setInterval(() => {
            if (this.isRunning) {
                const isPlaying = this.audio.isSpeakingNow();
                this.ui.setAiSpeaking(isPlaying);
            }
        }, 100);
    }
}

// Initialize app when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
    const app = new App();
    app.init();
    app._startPlaybackMonitor();

    // Expose for debugging
    window.app = app;
});
