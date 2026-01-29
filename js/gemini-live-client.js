/**
 * Gemini Live API WebSocket Client
 * Handles bidirectional communication with Gemini's real-time API
 */

class GeminiLiveClient {
    constructor() {
        this.ws = null;
        this.isConnected = false;
        this.isSetupComplete = false;

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
    }

    /**
     * Connect to Gemini Live API
     * @param {string} apiKey - Gemini API key
     */
    connect(apiKey) {
        if (this.ws) {
            this.disconnect();
        }

        const wsUrl = `${CONFIG.GEMINI_WS_URL}?key=${apiKey}`;

        try {
            this.ws = new WebSocket(wsUrl);
            this.ws.binaryType = 'arraybuffer';

            this.ws.onopen = () => {
                console.log('[GeminiLive] WebSocket connected');
                this.isConnected = true;
                this._sendSetupMessage();
            };

            this.ws.onmessage = (event) => {
                this._handleMessage(event.data);
            };

            this.ws.onerror = (error) => {
                console.error('[GeminiLive] WebSocket error:', error);
                if (this.onError) {
                    this.onError(error);
                }
            };

            this.ws.onclose = (event) => {
                console.log('[GeminiLive] WebSocket closed:', event.code, event.reason);
                console.log('[GeminiLive] Close event details:', JSON.stringify({
                    code: event.code,
                    reason: event.reason,
                    wasClean: event.wasClean
                }));
                this.isConnected = false;
                this.isSetupComplete = false;
                if (this.onDisconnected) {
                    this.onDisconnected(event);
                }
            };
        } catch (error) {
            console.error('[GeminiLive] Connection error:', error);
            if (this.onError) {
                this.onError(error);
            }
        }
    }

    /**
     * Disconnect from Gemini Live API
     */
    disconnect() {
        if (this.ws) {
            this.ws.close();
            this.ws = null;
        }
        this.isConnected = false;
        this.isSetupComplete = false;
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
            console.warn('[GeminiLive] Cannot send audio: setup not complete');
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
            console.warn('[GeminiLive] Cannot send video: setup not complete');
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
            const text = typeof data === 'string' ? data : new TextDecoder().decode(data);
            const message = JSON.parse(text);

            // Log all incoming messages for debugging
            console.log('[GeminiLive] Received:', JSON.stringify(message).substring(0, 500));

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
            console.warn('[GeminiLive] Cannot send: WebSocket not open');
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
