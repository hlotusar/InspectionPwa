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
        try {
            // Request camera with rear-facing preference
            const constraints = {
                video: {
                    facingMode: { ideal: 'environment' },
                    width: { ideal: CONFIG.VIDEO_WIDTH },
                    height: { ideal: CONFIG.VIDEO_HEIGHT }
                },
                audio: false // Audio handled separately
            };

            this.stream = await navigator.mediaDevices.getUserMedia(constraints);
            this.videoElement.srcObject = this.stream;

            // Wait for video to be ready
            await new Promise((resolve) => {
                this.videoElement.onloadedmetadata = () => {
                    this.videoElement.play();
                    resolve();
                };
            });

            console.log('[Camera] Started successfully');
            return true;
        } catch (error) {
            console.error('[Camera] Error starting camera:', error);
            if (this.onError) {
                this.onError(error);
            }
            return false;
        }
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
     * Capture a single frame
     */
    _captureFrame() {
        if (!this.videoElement || !this.videoElement.videoWidth) {
            return;
        }

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
