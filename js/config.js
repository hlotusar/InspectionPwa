/**
 * Configuration constants for AI Live Inspection PWA
 */

const CONFIG = {
    // API Credentials - Replace with your actual values
    GEMINI_API_KEY: 'AIzaSyDr2kLs5Pjjs5yZGdjTMgM7oZat24ork_I',
    WEBHOOK_URL: '',  // Optional: 'YOUR_WEBHOOK_URL_HERE'

    // Gemini Live API endpoint
    GEMINI_WS_URL: 'wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent',

    // Model must include 'models/' prefix - only this model supports Live API
    GEMINI_MODEL: 'models/gemini-2.5-flash-native-audio-preview-12-2025',

    // Audio settings
    INPUT_SAMPLE_RATE: 16000,   // Mic input sample rate
    OUTPUT_SAMPLE_RATE: 24000,  // Speaker output sample rate
    AUDIO_CHUNK_SIZE: 4096,     // Samples per audio chunk

    // Video settings
    VIDEO_CAPTURE_FPS: 1,       // Frames per second to send
    JPEG_QUALITY: 0.7,          // JPEG compression quality
    VIDEO_WIDTH: 640,           // Capture width
    VIDEO_HEIGHT: 480,          // Capture height

    // Voice Activity Detection
    VAD_THRESHOLD: 0.01,        // RMS energy threshold
    VAD_CONSECUTIVE_FRAMES: 3,  // Frames above threshold to trigger

    // Session
    SESSION_TIMEOUT_MS: 10 * 60 * 1000, // 10 minute limit

    // System prompt for HVAC inspection
    SYSTEM_PROMPT: `You are an AI inspection assistant helping a field technician inspect HVAC equipment in real-time. You can see through their camera and hear them speak.

YOUR ROLE:
- Guide the technician step-by-step through a structured inspection
- Analyze what you see in the camera feed
- Identify equipment details, issues, and safety concerns
- Speak naturally and concisely (1-2 sentences at a time)

INSPECTION FLOW:
1. Identify the Asset - ask to see nameplate/asset tag, read manufacturer, model, serial
2. External Visual Inspection - check for rust, corrosion, damage, debris
3. Electrical Components - wiring condition, connections, burn marks
4. Operational Indicators - gauges, displays, unusual sounds
5. Document Findings - summarize issues by severity

COMMUNICATION STYLE:
- Short, clear sentences
- Use specific spatial directions ("move camera left", "tilt up")
- Acknowledge what you see before asking for more
- Alert immediately for safety concerns

When you identify a finding, categorize it as:
- CRITICAL: Safety hazard or immediate failure risk
- WARNING: Issue requiring attention soon
- INFO: Observation or minor note

Start by greeting the technician and asking them to show you the equipment they'll be inspecting today.`
};

// Freeze to prevent accidental modification
Object.freeze(CONFIG);
