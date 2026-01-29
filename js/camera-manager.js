/**
 * Camera Manager
 * Handles camera access, preview, and frame capture
 */

class CameraManager {
    constructor() {
        this.videoElement = null;
        this.canvasElement = null;
        this.canvasContext = null;
        this.stream = null;
        this.captureInterval = null;
        this.isCapturing = false;

        // Callbacks
        this.onFrameCaptured = null;
        this.onError = null;
    }

    /**
     * Initialize camera manager with DOM elements
     * @param {HTMLVideoElement} videoElement - Video preview element
     * @param {HTMLCanvasElement} canvasElement - Canvas for frame capture
     */
    init(videoElement, canvasElement) {
        this.videoElement = videoElement;
        this.canvasElement = canvasElement;
        this.canvasContext = canvasElement.getContext('2d');

        // Set canvas dimensions
        this.canvasElement.width = CONFIG.VIDEO_WIDTH;
        this.canvasElement.height = CONFIG.VIDEO_HEIGHT;
    }

    /**
     * Start camera and preview
     */
    async start() {
        // Try different constraint sets for cross-browser compatibility
        const constraintOptions = [
            // Preferred: rear camera with ideal dimensions
            {
                video: {
                    facingMode: { ideal: 'environment' },
                    width: { ideal: CONFIG.VIDEO_WIDTH },
                    height: { ideal: CONFIG.VIDEO_HEIGHT }
                },
                audio: false
            },
            // Fallback 1: rear camera only
            {
                video: { facingMode: 'environment' },
                audio: false
            },
            // Fallback 2: any camera with dimensions
            {
                video: {
                    width: { ideal: CONFIG.VIDEO_WIDTH },
                    height: { ideal: CONFIG.VIDEO_HEIGHT }
                },
                audio: false
            },
            // Fallback 3: any camera
            {
                video: true,
                audio: false
            }
        ];

        let lastError = null;

        for (const constraints of constraintOptions) {
            try {
                console.log('[Camera] Trying constraints:', JSON.stringify(constraints));
                this.stream = await navigator.mediaDevices.getUserMedia(constraints);

                // Safari requires these attributes for inline video playback
                this.videoElement.setAttribute('playsinline', '');
                this.videoElement.setAttribute('webkit-playsinline', '');
                this.videoElement.muted = true;

                this.videoElement.srcObject = this.stream;

                // Wait for video to be ready
                await new Promise((resolve, reject) => {
                    const timeout = setTimeout(() => {
                        reject(new Error('Video load timeout'));
                    }, 10000);

                    this.videoElement.onloadedmetadata = () => {
                        clearTimeout(timeout);
                        this.videoElement.play()
                            .then(resolve)
                            .catch(reject);
                    };

                    this.videoElement.onerror = () => {
                        clearTimeout(timeout);
                        reject(new Error('Video element error'));
                    };
                });

                console.log('[Camera] Started successfully');
                console.log(`[Camera] Resolution: ${this.videoElement.videoWidth}x${this.videoElement.videoHeight}`);
                return true;

            } catch (error) {
                console.warn('[Camera] Constraint failed:', error.name, error.message);
                lastError = error;

                // Add user-friendly message based on error type
                if (error.name === 'NotAllowedError') {
                    lastError.userMessage = 'Camera access denied';
                } else if (error.name === 'NotFoundError') {
                    lastError.userMessage = 'No camera found';
                } else if (error.name === 'NotReadableError') {
                    lastError.userMessage = 'Camera in use by another app';
                } else if (error.name === 'OverconstrainedError') {
                    lastError.userMessage = 'Camera settings not supported';
                }

                // Stop any partial stream before trying next constraint
                if (this.stream) {
                    this.stream.getTracks().forEach(track => track.stop());
                    this.stream = null;
                }

                // For permission errors, don't try more constraints
                if (error.name === 'NotAllowedError') {
                    break;
                }
            }
        }

        // All constraints failed
        console.error('[Camera] All constraints failed:', lastError);
        if (this.onError) {
            this.onError(lastError);
        }
        return false;
    }

    /**
     * Stop camera and release resources
     */
    stop() {
        this.stopCapture();

        if (this.stream) {
            this.stream.getTracks().forEach(track => track.stop());
            this.stream = null;
        }

        if (this.videoElement) {
            this.videoElement.srcObject = null;
        }

        console.log('[Camera] Stopped');
    }

    /**
     * Start capturing frames at configured FPS
     */
    startCapture() {
        if (this.isCapturing) {
            return;
        }

        this.isCapturing = true;
        const intervalMs = 1000 / CONFIG.VIDEO_CAPTURE_FPS;

        this.captureInterval = setInterval(() => {
            this._captureFrame();
        }, intervalMs);

        console.log(`[Camera] Started capture at ${CONFIG.VIDEO_CAPTURE_FPS} FPS`);
    }

    /**
     * Stop capturing frames
     */
    stopCapture() {
        if (this.captureInterval) {
            clearInterval(this.captureInterval);
            this.captureInterval = null;
        }
        this.isCapturing = false;
        console.log('[Camera] Stopped capture');
    }

    /**
     * Capture a single frame (async to prevent UI blocking)
     */
    _captureFrame() {
        if (!this.videoElement || !this.videoElement.videoWidth) {
            return;
        }

        // Use requestAnimationFrame to prevent blocking the main thread
        requestAnimationFrame(() => {
            try {
                // Draw video frame to canvas
                this.canvasContext.drawImage(
                    this.videoElement,
                    0, 0,
                    this.canvasElement.width,
                    this.canvasElement.height
                );

                // Convert to JPEG base64
                const dataUrl = this.canvasElement.toDataURL('image/jpeg', CONFIG.JPEG_QUALITY);

                // Strip the data URL prefix to get raw base64
                const base64 = dataUrl.replace(/^data:image\/jpeg;base64,/, '');

                if (this.onFrameCaptured) {
                    this.onFrameCaptured(base64);
                }
            } catch (error) {
                console.error('[Camera] Error capturing frame:', error);
            }
        });
    }

    /**
     * Capture and return a single frame immediately
     * @returns {string|null} Base64 encoded JPEG or null on error
     */
    captureNow() {
        if (!this.videoElement || !this.videoElement.videoWidth) {
            return null;
        }

        try {
            this.canvasContext.drawImage(
                this.videoElement,
                0, 0,
                this.canvasElement.width,
                this.canvasElement.height
            );

            const dataUrl = this.canvasElement.toDataURL('image/jpeg', CONFIG.JPEG_QUALITY);
            return dataUrl.replace(/^data:image\/jpeg;base64,/, '');
        } catch (error) {
            console.error('[Camera] Error capturing frame:', error);
            return null;
        }
    }

    /**
     * Check if camera is active
     */
    isActive() {
        return this.stream !== null && this.stream.active;
    }
}
