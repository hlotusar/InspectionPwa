/**
 * Audio Manager
 * Handles microphone input, speaker output, and voice activity detection
 */

class AudioManager {
    constructor() {
        // Audio contexts - separate for different sample rates
        this.inputContext = null;
        this.outputContext = null;

        // Input (microphone)
        this.mediaStream = null;
        this.sourceNode = null;
        this.workletNode = null;

        // Output (speaker)
        this.audioQueue = [];
        this.isPlaying = false;
        this.currentSource = null;

        // Voice Activity Detection
        this.vadFramesAboveThreshold = 0;
        this.isSpeaking = false;

        // Callbacks
        this.onAudioChunk = null;
        this.onSpeechStart = null;
        this.onSpeechEnd = null;
        this.onError = null;
    }

    /**
     * Initialize audio contexts and request microphone
     */
    async init() {
        try {
            // Create input context at 16kHz for Gemini
            this.inputContext = new AudioContext({ sampleRate: CONFIG.INPUT_SAMPLE_RATE });

            // Create output context at 24kHz for Gemini response
            this.outputContext = new AudioContext({ sampleRate: CONFIG.OUTPUT_SAMPLE_RATE });

            // Resume contexts (required after user gesture)
            await this.inputContext.resume();
            await this.outputContext.resume();

            console.log('[Audio] Contexts initialized');
            console.log(`[Audio] Input sample rate: ${this.inputContext.sampleRate}`);
            console.log(`[Audio] Output sample rate: ${this.outputContext.sampleRate}`);

            return true;
        } catch (error) {
            console.error('[Audio] Error initializing:', error);
            if (this.onError) {
                this.onError(error);
            }
            return false;
        }
    }

    /**
     * Start microphone input
     */
    async startInput() {
        try {
            // Get microphone stream
            this.mediaStream = await navigator.mediaDevices.getUserMedia({
                audio: {
                    echoCancellation: true,
                    noiseSuppression: true,
                    autoGainControl: true
                }
            });

            // Create source from stream
            this.sourceNode = this.inputContext.createMediaStreamSource(this.mediaStream);

            // Load and create AudioWorklet for processing
            await this.inputContext.audioWorklet.addModule(this._createWorkletURL());

            this.workletNode = new AudioWorkletNode(this.inputContext, 'audio-processor');

            // Handle processed audio from worklet
            this.workletNode.port.onmessage = (event) => {
                const { audioData, rms } = event.data;

                // Voice Activity Detection
                this._processVAD(rms);

                // Send audio chunk
                if (this.onAudioChunk) {
                    const base64 = this._float32ToBase64PCM16(audioData);
                    this.onAudioChunk(base64);
                }
            };

            // Connect nodes
            this.sourceNode.connect(this.workletNode);
            // Note: Don't connect to destination - we don't want to hear ourselves

            console.log('[Audio] Microphone started');
            return true;
        } catch (error) {
            console.error('[Audio] Error starting microphone:', error);
            if (this.onError) {
                this.onError(error);
            }
            return false;
        }
    }

    /**
     * Stop microphone input
     */
    stopInput() {
        if (this.workletNode) {
            this.workletNode.disconnect();
            this.workletNode = null;
        }

        if (this.sourceNode) {
            this.sourceNode.disconnect();
            this.sourceNode = null;
        }

        if (this.mediaStream) {
            this.mediaStream.getTracks().forEach(track => track.stop());
            this.mediaStream = null;
        }

        this.vadFramesAboveThreshold = 0;
        this.isSpeaking = false;

        console.log('[Audio] Microphone stopped');
    }

    /**
     * Queue audio for playback
     * @param {string} base64Audio - Base64 encoded PCM 16-bit audio at 24kHz
     */
    queueAudio(base64Audio) {
        try {
            const pcmData = this._base64ToPCM16Float32(base64Audio);
            this.audioQueue.push(pcmData);

            if (!this.isPlaying) {
                this._playNext();
            }
        } catch (error) {
            console.error('[Audio] Error queueing audio:', error);
        }
    }

    /**
     * Stop all playback and clear queue
     */
    stopPlayback() {
        // Clear queue
        this.audioQueue = [];

        // Stop current source
        if (this.currentSource) {
            try {
                this.currentSource.stop();
            } catch (e) {
                // Ignore errors if already stopped
            }
            this.currentSource = null;
        }

        this.isPlaying = false;
        console.log('[Audio] Playback stopped');
    }

    /**
     * Play next audio chunk from queue
     */
    _playNext() {
        if (this.audioQueue.length === 0) {
            this.isPlaying = false;
            return;
        }

        this.isPlaying = true;
        const pcmData = this.audioQueue.shift();

        try {
            // Create audio buffer
            const audioBuffer = this.outputContext.createBuffer(
                1, // mono
                pcmData.length,
                CONFIG.OUTPUT_SAMPLE_RATE
            );

            audioBuffer.copyToChannel(pcmData, 0);

            // Create and play source
            this.currentSource = this.outputContext.createBufferSource();
            this.currentSource.buffer = audioBuffer;
            this.currentSource.connect(this.outputContext.destination);

            this.currentSource.onended = () => {
                this.currentSource = null;
                this._playNext();
            };

            this.currentSource.start();
        } catch (error) {
            console.error('[Audio] Error playing audio:', error);
            this._playNext(); // Try next chunk
        }
    }

    /**
     * Process Voice Activity Detection
     * @param {number} rms - RMS energy level
     */
    _processVAD(rms) {
        if (rms > CONFIG.VAD_THRESHOLD) {
            this.vadFramesAboveThreshold++;

            if (!this.isSpeaking && this.vadFramesAboveThreshold >= CONFIG.VAD_CONSECUTIVE_FRAMES) {
                this.isSpeaking = true;
                console.log('[Audio] Speech started');
                if (this.onSpeechStart) {
                    this.onSpeechStart();
                }
            }
        } else {
            if (this.isSpeaking && this.vadFramesAboveThreshold > 0) {
                this.vadFramesAboveThreshold--;

                if (this.vadFramesAboveThreshold === 0) {
                    this.isSpeaking = false;
                    console.log('[Audio] Speech ended');
                    if (this.onSpeechEnd) {
                        this.onSpeechEnd();
                    }
                }
            } else {
                this.vadFramesAboveThreshold = 0;
            }
        }
    }

    /**
     * Convert Float32Array to Base64 encoded PCM 16-bit
     * @param {Float32Array} float32Array - Audio samples
     * @returns {string} Base64 encoded PCM data
     */
    _float32ToBase64PCM16(float32Array) {
        const int16Array = new Int16Array(float32Array.length);

        for (let i = 0; i < float32Array.length; i++) {
            const sample = float32Array[i];
            // Clamp and convert to int16
            const clamped = Math.max(-1, Math.min(1, sample));
            int16Array[i] = clamped < 0 ? clamped * 0x8000 : clamped * 0x7FFF;
        }

        // Convert to base64
        const bytes = new Uint8Array(int16Array.buffer);
        let binary = '';
        for (let i = 0; i < bytes.length; i++) {
            binary += String.fromCharCode(bytes[i]);
        }
        return btoa(binary);
    }

    /**
     * Convert Base64 encoded PCM 16-bit to Float32Array
     * @param {string} base64 - Base64 encoded PCM data
     * @returns {Float32Array} Audio samples
     */
    _base64ToPCM16Float32(base64) {
        // Decode base64 to bytes
        const binary = atob(base64);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) {
            bytes[i] = binary.charCodeAt(i);
        }

        // Convert to int16
        const int16Array = new Int16Array(bytes.buffer);

        // Convert to float32
        const float32Array = new Float32Array(int16Array.length);
        for (let i = 0; i < int16Array.length; i++) {
            float32Array[i] = int16Array[i] / 32768.0;
        }

        return float32Array;
    }

    /**
     * Create AudioWorklet processor as a Blob URL
     * @returns {string} Blob URL for the worklet
     */
    _createWorkletURL() {
        const workletCode = `
            class AudioProcessor extends AudioWorkletProcessor {
                constructor() {
                    super();
                    this.buffer = [];
                    this.chunkSize = ${CONFIG.AUDIO_CHUNK_SIZE};
                }

                process(inputs, outputs, parameters) {
                    const input = inputs[0];
                    if (!input || !input[0]) return true;

                    const channelData = input[0];

                    // Add samples to buffer
                    for (let i = 0; i < channelData.length; i++) {
                        this.buffer.push(channelData[i]);
                    }

                    // Send chunks when buffer is full
                    while (this.buffer.length >= this.chunkSize) {
                        const chunk = this.buffer.splice(0, this.chunkSize);
                        const audioData = new Float32Array(chunk);

                        // Calculate RMS for VAD
                        let sum = 0;
                        for (let i = 0; i < audioData.length; i++) {
                            sum += audioData[i] * audioData[i];
                        }
                        const rms = Math.sqrt(sum / audioData.length);

                        this.port.postMessage({ audioData, rms });
                    }

                    return true;
                }
            }

            registerProcessor('audio-processor', AudioProcessor);
        `;

        const blob = new Blob([workletCode], { type: 'application/javascript' });
        return URL.createObjectURL(blob);
    }

    /**
     * Resume audio contexts (call after user gesture)
     */
    async resume() {
        if (this.inputContext && this.inputContext.state === 'suspended') {
            await this.inputContext.resume();
        }
        if (this.outputContext && this.outputContext.state === 'suspended') {
            await this.outputContext.resume();
        }
    }

    /**
     * Check if currently speaking (playing audio)
     */
    isSpeakingNow() {
        return this.isPlaying;
    }

    /**
     * Check if user is speaking (based on VAD)
     */
    isUserSpeaking() {
        return this.isSpeaking;
    }

    /**
     * Cleanup all resources
     */
    destroy() {
        this.stopInput();
        this.stopPlayback();

        if (this.inputContext) {
            this.inputContext.close();
            this.inputContext = null;
        }

        if (this.outputContext) {
            this.outputContext.close();
            this.outputContext = null;
        }
    }
}
