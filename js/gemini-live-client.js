/**
 * Gemini Live API WebSocket Client
 * Handles bidirectional communication with Gemini's real-time API
 * Includes retry logic and connection timeout for reliability
 */

class GeminiLiveClient {
    constructor() {
        this.ws = null;
        this.isConnected = false;
        this.isSetupComplete = false;

        // Retry configuration
        this.maxRetries = 3;
        this.retryCount = 0;
        this.connectionTimeout = null;
        this.CONNECTION_TIMEOUT_MS = 15000; // 15 seconds

        // Callbacks
        this.onConnected = null;
        this.onDisconnected = null;
        this.onError = null;
        this.onAudioResponse = null;
        this.onTextResponse = null;
        this.onTranscript = null;
        this.onInterrupted = null;
        this.onTurnComplete = null;
        this.onSetupComplete = null;
        this.onRetry = null; // New: called on retry attempt
        this.onConnecting = null; // New: called when connecting
    }

    /**
     * Connect to Gemini Live API with retry support
     * @param {number} maxRetries - Maximum retry attempts (default: 3)
     */
    connect(maxRetries = 3) {
        this.maxRetries = maxRetries;
        this.retryCount = 0;
        this._attemptConnection();
    }

    /**
     * Attempt to establish WebSocket connection
     */
    _attemptConnection() {
        if (this.ws) {
            this._cleanupConnection();
        }

        const wsUrl = `${CONFIG.GEMINI_WS_URL}?key=${CONFIG.GEMINI_API_KEY}`;

        console.log(`[GeminiLive] Connecting... (attempt ${this.retryCount + 1}/${this.maxRetries + 1})`);

        if (this.onConnecting) {
            this.onConnecting(this.retryCount + 1, this.maxRetries + 1);
        }

        // Set connection timeout
        this.connectionTimeout = setTimeout(() => {
            console.warn('[GeminiLive] Connection timeout');
            this._cleanupConnection();
            this._handleRetry('Connection timeout');
        }, this.CONNECTION_TIMEOUT_MS);

        try {
            this.ws = new WebSocket(wsUrl);
            this.ws.binaryType = 'arraybuffer';

            this.ws.onopen = () => {
                console.log('[GeminiLive] WebSocket connected');
                this._clearConnectionTimeout();
                this.isConnected = true;
                this.retryCount = 0; // Reset retry count on successful connection
                this._sendSetupMessage();
            };

            this.ws.onmessage = (event) => {
                this._handleMessage(event.data);
            };

            this.ws.onerror = (error) => {
                console.error('[GeminiLive] WebSocket error:', error);
                this._clearConnectionTimeout();
                // Don't call onError here - let onclose handle retry
            };

            this.ws.onclose = (event) => {
                this._clearConnectionTimeout();
                console.log('[GeminiLive] WebSocket closed:', event.code, event.reason);

                const wasConnected = this.isConnected;
                this.isConnected = false;
                this.isSetupComplete = false;

                // If we were connected and got disconnected unexpectedly, notify
                if (wasConnected) {
                    if (this.onDisconnected) {
                        this.onDisconnected(event);
                    }
                } else {
                    // Connection failed before establishing - try retry
                    this._handleRetry(event.reason || `Connection closed (code: ${event.code})`);
                }
            };
        } catch (error) {
            console.error('[GeminiLive] Connection error:', error);
            this._clearConnectionTimeout();
            this._handleRetry(error.message);
        }
    }

    /**
     * Handle retry logic with exponential backoff
     * @param {string} reason - Reason for retry
     */
    _handleRetry(reason) {
        if (this.retryCount < this.maxRetries) {
            const delay = Math.pow(2, this.retryCount + 1) * 1000; // 2s, 4s, 8s
            this.retryCount++;

            console.log(`[GeminiLive] Retrying in ${delay / 1000}s... (${this.retryCount}/${this.maxRetries})`);

            if (this.onRetry) {
                this.onRetry(this.retryCount, this.maxRetries, reason);
            }

            setTimeout(() => {
                this._attemptConnection();
            }, delay);
        } else {
            console.error('[GeminiLive] Max retries exceeded:', reason);
            if (this.onError) {
                this.onError(new Error(`Connection failed after ${this.maxRetries} retries: ${reason}`));
            }
        }
    }

    /**
     * Clear connection timeout
     */
    _clearConnectionTimeout() {
        if (this.connectionTimeout) {
            clearTimeout(this.connectionTimeout);
            this.connectionTimeout = null;
        }
    }

    /**
     * Cleanup WebSocket connection
     */
    _cleanupConnection() {
        this._clearConnectionTimeout();
        if (this.ws) {
            this.ws.onopen = null;
            this.ws.onmessage = null;
            this.ws.onerror = null;
            this.ws.onclose = null;
            try {
                this.ws.close();
            } catch (e) {
                // Ignore close errors
            }
            this.ws = null;
        }
    }

    /**
     * Disconnect from Gemini Live API
     */
    disconnect() {
        this._cleanupConnection();
        this.isConnected = false;
        this.isSetupComplete = false;
        this.retryCount = 0;
    }

    /**
     * Send setup message to configure the session
     */
    _sendSetupMessage() {
        const setupMessage = {
            setup: {
                model: CONFIG.GEMINI_MODEL,
                generationConfig: {
                    responseModalities: ['AUDIO'],
                    speechConfig: {
                        voiceConfig: {
                            prebuiltVoiceConfig: {
                                voiceName: 'Kore'
                            }
                        }
                    }
                },
                systemInstruction: {
                    parts: [{ text: CONFIG.SYSTEM_PROMPT }]
                }
            }
        };

        this._send(setupMessage);
        console.log('[GeminiLive] Setup message sent');
    }

    /**
     * Send audio chunk to Gemini
     * @param {string} base64Audio - Base64 encoded PCM audio (16-bit, 16kHz)
     */
    sendAudio(base64Audio) {
        if (!this.isSetupComplete) {
            return;
        }

        const message = {
            realtimeInput: {
                mediaChunks: [{
                    mimeType: 'audio/pcm;rate=16000',
                    data: base64Audio
                }]
            }
        };

        this._send(message);
    }

    /**
     * Send video frame to Gemini
     * @param {string} base64Image - Base64 encoded JPEG image (without data URL prefix)
     */
    sendVideoFrame(base64Image) {
        if (!this.isSetupComplete) {
            return;
        }

        const message = {
            realtimeInput: {
                mediaChunks: [{
                    mimeType: 'image/jpeg',
                    data: base64Image
                }]
            }
        };

        this._send(message);
    }

    /**
     * Send text message to Gemini
     * @param {string} text - Text message
     */
    sendText(text) {
        if (!this.isSetupComplete) {
            console.warn('[GeminiLive] Cannot send text: setup not complete');
            return;
        }

        const message = {
            clientContent: {
                turns: [{
                    role: 'user',
                    parts: [{ text: text }]
                }],
                turnComplete: true
            }
        };

        this._send(message);
    }

    /**
     * Handle incoming WebSocket message
     * @param {string|ArrayBuffer} data - Message data
     */
    _handleMessage(data) {
        try {
            // Handle both string and ArrayBuffer (Safari may send Blob)
            let text;
            if (typeof data === 'string') {
                text = data;
            } else if (data instanceof ArrayBuffer) {
                text = new TextDecoder().decode(data);
            } else if (data instanceof Blob) {
                // Safari fallback - shouldn't happen with binaryType='arraybuffer'
                console.warn('[GeminiLive] Received Blob, converting...');
                data.text().then(t => this._handleMessage(t));
                return;
            } else {
                text = new TextDecoder().decode(data);
            }

            const message = JSON.parse(text);

            // Log incoming messages (truncated for readability)
            console.log('[GeminiLive] Received:', JSON.stringify(message).substring(0, 300));

            // Handle setup completion
            if (message.setupComplete) {
                console.log('[GeminiLive] Setup complete');
                this.isSetupComplete = true;
                if (this.onSetupComplete) {
                    this.onSetupComplete();
                }
                if (this.onConnected) {
                    this.onConnected();
                }
                return;
            }

            // Handle server content (AI responses)
            if (message.serverContent) {
                this._handleServerContent(message.serverContent);
            }

            // Handle tool calls (if any)
            if (message.toolCall) {
                console.log('[GeminiLive] Tool call received:', message.toolCall);
            }

            // Handle error messages from server
            if (message.error) {
                console.error('[GeminiLive] Server error:', message.error);
                if (this.onError) {
                    this.onError(new Error(message.error.message || 'Server error'));
                }
            }

        } catch (error) {
            console.error('[GeminiLive] Error parsing message:', error);
        }
    }

    /**
     * Handle server content (AI responses)
     * @param {object} content - Server content object
     */
    _handleServerContent(content) {
        // Check if this is an interruption
        if (content.interrupted) {
            console.log('[GeminiLive] Response interrupted');
            if (this.onInterrupted) {
                this.onInterrupted();
            }
            return;
        }

        // Process model turn
        if (content.modelTurn) {
            const parts = content.modelTurn.parts || [];

            for (const part of parts) {
                // Handle audio response
                if (part.inlineData && part.inlineData.mimeType?.startsWith('audio/')) {
                    if (this.onAudioResponse) {
                        this.onAudioResponse(part.inlineData.data);
                    }
                }

                // Handle text response
                if (part.text) {
                    if (this.onTextResponse) {
                        this.onTextResponse(part.text);
                    }
                }
            }
        }

        // Handle output transcription (what AI said)
        if (content.outputTranscription) {
            if (this.onTranscript) {
                this.onTranscript('ai', content.outputTranscription.text || '');
            }
        }

        // Handle input transcription (what user said)
        if (content.inputTranscription) {
            if (this.onTranscript) {
                this.onTranscript('user', content.inputTranscription.text || '');
            }
        }

        // Check if turn is complete
        if (content.turnComplete) {
            console.log('[GeminiLive] Turn complete');
            if (this.onTurnComplete) {
                this.onTurnComplete();
            }
        }
    }

    /**
     * Send JSON message over WebSocket
     * @param {object} message - Message object to send
     */
    _send(message) {
        if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
            return;
        }

        try {
            this.ws.send(JSON.stringify(message));
        } catch (error) {
            console.error('[GeminiLive] Error sending message:', error);
        }
    }

    /**
     * Check if client is ready to send/receive
     */
    isReady() {
        return this.isConnected && this.isSetupComplete;
    }
}
