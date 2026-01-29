/**
 * Audio Manager
 * Handles microphone input, speaker output, and voice activity detection
 * Compatible with Safari, Chrome, and other modern browsers
 */

class AudioManager {
    constructor() {
        // Audio contexts
        this.inputContext = null;
        this.outputContext = null;

        // Input (microphone)
        this.mediaStream = null;
        this.sourceNode = null;
        this.processorNode = null; // Can be AudioWorklet or ScriptProcessor
        this.useWorklet = false;

        // Resampling for input (if needed)
        this.inputResampler = null;

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
     * Get AudioContext constructor (handles Safari webkit prefix)
     */
    _getAudioContextClass() {
        return window.AudioContext || window.webkitAudioContext;
    }

    /**
     * Check if AudioWorklet is supported
     */
    _isWorkletSupported() {
        const AudioContextClass = this._getAudioContextClass();
        if (!AudioContextClass) return false;

        try {
            const testCtx = new AudioContextClass();
            const supported = testCtx.audioWorklet !== undefined;
            testCtx.close();
            return supported;
        } catch (e) {
            return false;
        }
    }

    /**
     * Initialize audio contexts
     */
    async init() {
        try {
            const AudioContextClass = this._getAudioContextClass();
            if (!AudioContextClass) {
                throw new Error('AudioContext not supported');
            }

            // Check worklet support
            this.useWorklet = this._isWorkletSupported();
            console.log(`[Audio] AudioWorklet supported: ${this.useWorklet}`);

            // Safari doesn't support custom sample rates well
            // Create contexts and let browser choose sample rate
            // We'll resample as needed
            try {
                this.inputContext = new AudioContextClass({ sampleRate: CONFIG.INPUT_SAMPLE_RATE });
            } catch (e) {
                // Safari fallback - use default sample rate
                console.log('[Audio] Custom sample rate not supported, using default');
                this.inputContext = new AudioContextClass();
            }

            try {
                this.outputContext = new AudioContextClass({ sampleRate: CONFIG.OUTPUT_SAMPLE_RATE });
            } catch (e) {
                // Safari fallback
                this.outputContext = new AudioContextClass();
            }

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
            // Get microphone stream with Safari-compatible constraints
            const constraints = {
                audio: {
                    echoCancellation: { ideal: true },
                    noiseSuppression: { ideal: true },
                    autoGainControl: { ideal: true }
                }
            };

            this.mediaStream = await navigator.mediaDevices.getUserMedia(constraints);

            // Create source from stream
            this.sourceNode = this.inputContext.createMediaStreamSource(this.mediaStream);

            if (this.useWorklet) {
                await this._setupWorklet();
            } else {
                this._setupScriptProcessor();
            }

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
     * Setup AudioWorklet for audio processing (modern browsers)
     */
    async _setupWorklet() {
        try {
            await this.inputContext.audioWorklet.addModule(this._createWorkletURL());
            this.processorNode = new AudioWorkletNode(this.inputContext, 'audio-processor');

            this.processorNode.port.onmessage = (event) => {
                this._handleAudioData(event.data.audioData, event.data.rms);
            };

            this.sourceNode.connect(this.processorNode);
            console.log('[Audio] Using AudioWorklet');
        } catch (error) {
            console.warn('[Audio] AudioWorklet failed, falling back to ScriptProcessor:', error);
            this._setupScriptProcessor();
        }
    }

    /**
     * Setup ScriptProcessorNode for audio processing (Safari fallback)
     */
    _setupScriptProcessor() {
        const bufferSize = CONFIG.AUDIO_CHUNK_SIZE;
        // ScriptProcessorNode is deprecated but works in Safari
        this.processorNode = this.inputContext.createScriptProcessor(bufferSize, 1, 1);

        this.processorNode.onaudioprocess = (event) => {
            const inputData = event.inputBuffer.getChannelData(0);
            const audioData = new Float32Array(inputData);

            // Calculate RMS for VAD
            let sum = 0;
            for (let i = 0; i < audioData.length; i++) {
                sum += audioData[i] * audioData[i];
            }
            const rms = Math.sqrt(sum / audioData.length);

            this._handleAudioData(audioData, rms);
        };

        this.sourceNode.connect(this.processorNode);
        // ScriptProcessor requires connection to destination (even if silent)
        this.processorNode.connect(this.inputContext.destination);
        console.log('[Audio] Using ScriptProcessor (Safari fallback)');
    }

    /**
     * Handle processed audio data
     */
    _handleAudioData(audioData, rms) {
        // Resample if input sample rate differs from target
        let processedData = audioData;
        if (this.inputContext.sampleRate !== CONFIG.INPUT_SAMPLE_RATE) {
            processedData = this._resample(audioData, this.inputContext.sampleRate, CONFIG.INPUT_SAMPLE_RATE);
        }

        // Voice Activity Detection
        this._processVAD(rms);

        // Send audio chunk
        if (this.onAudioChunk) {
            const base64 = this._float32ToBase64PCM16(processedData);
            this.onAudioChunk(base64);
        }
    }

    /**
     * Simple linear resampling
     */
    _resample(audioData, fromRate, toRate) {
        if (fromRate === toRate) return audioData;

        const ratio = fromRate / toRate;
        const newLength = Math.round(audioData.length / ratio);
        const result = new Float32Array(newLength);

        for (let i = 0; i < newLength; i++) {
            const srcIndex = i * ratio;
            const srcIndexFloor = Math.floor(srcIndex);
            const srcIndexCeil = Math.min(srcIndexFloor + 1, audioData.length - 1);
            const t = srcIndex - srcIndexFloor;
            result[i] = audioData[srcIndexFloor] * (1 - t) + audioData[srcIndexCeil] * t;
        }

        return result;
    }

    /**
     * Stop microphone input
     */
    stopInput() {
        if (this.processorNode) {
            this.processorNode.disconnect();
            // Clean up ScriptProcessor event handler
            if (this.processorNode.onaudioprocess) {
                this.processorNode.onaudioprocess = null;
            }
            this.processorNode = null;
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

            // Resample if output sample rate differs from source
            let processedData = pcmData;
            if (this.outputContext.sampleRate !== CONFIG.OUTPUT_SAMPLE_RATE) {
                processedData = this._resample(pcmData, CONFIG.OUTPUT_SAMPLE_RATE, this.outputContext.sampleRate);
            }

            this.audioQueue.push(processedData);

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
        this.audioQueue = [];

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
            // Create audio buffer at context's sample rate
            const audioBuffer = this.outputContext.createBuffer(
                1, // mono
                pcmData.length,
                this.outputContext.sampleRate
            );

            audioBuffer.copyToChannel(pcmData, 0);

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
            this._playNext();
        }
    }

    /**
     * Process Voice Activity Detection
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
     */
    _float32ToBase64PCM16(float32Array) {
        const int16Array = new Int16Array(float32Array.length);

        for (let i = 0; i < float32Array.length; i++) {
            const sample = float32Array[i];
            const clamped = Math.max(-1, Math.min(1, sample));
            int16Array[i] = clamped < 0 ? clamped * 0x8000 : clamped * 0x7FFF;
        }

        const bytes = new Uint8Array(int16Array.buffer);
        let binary = '';
        for (let i = 0; i < bytes.length; i++) {
            binary += String.fromCharCode(bytes[i]);
        }
        return btoa(binary);
    }

    /**
     * Convert Base64 encoded PCM 16-bit to Float32Array
     */
    _base64ToPCM16Float32(base64) {
        const binary = atob(base64);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) {
            bytes[i] = binary.charCodeAt(i);
        }

        const int16Array = new Int16Array(bytes.buffer);
        const float32Array = new Float32Array(int16Array.length);
        for (let i = 0; i < int16Array.length; i++) {
            float32Array[i] = int16Array[i] / 32768.0;
        }

        return float32Array;
    }

    /**
     * Create AudioWorklet processor as a Blob URL
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

                    for (let i = 0; i < channelData.length; i++) {
                        this.buffer.push(channelData[i]);
                    }

                    while (this.buffer.length >= this.chunkSize) {
                        const chunk = this.buffer.splice(0, this.chunkSize);
                        const audioData = new Float32Array(chunk);

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
