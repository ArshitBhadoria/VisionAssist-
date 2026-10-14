/**
 * VisionAssist – Nayana Vision Assist: Main Application Script
 * Orchestrates Web Speech API, MediaDevices camera feed, Geolocation,
 * and communicates with FastAPI backend for YOLO11n & EasyOCR.
 */

(function () {
    'use strict';

    // Application Configuration & State
    const state = {
        backendUrl: window.location.origin.includes('8000') ? window.location.origin : 'http://127.0.0.1:8000',
        backendOnline: false,
        cameraStream: null,
        cameraFacingMode: 'environment', // Default to back camera for viewing surroundings
        isListening: false,
        isSpeaking: false,
        isProcessing: false,
        lastSpokenText: '',
        recognition: null,
        speechSynthesis: window.speechSynthesis,
        selectedVoice: null,
        speechRate: 1.0,
        audioCuesEnabled: true,
        currentDetections: [],
        currentOcrBlocks: []
    };

    // DOM Elements Cache
    const el = {
        srAnnouncer: document.getElementById('srAnnouncer'),
        dotBackend: document.getElementById('dotBackend'),
        lblBackend: document.getElementById('lblBackend'),
        dotCamera: document.getElementById('dotCamera'),
        lblCamera: document.getElementById('lblCamera'),
        dotMic: document.getElementById('dotMic'),
        lblMic: document.getElementById('lblMic'),
        dotGeo: document.getElementById('dotGeo'),
        lblGeo: document.getElementById('lblGeo'),

        assistantSection: document.getElementById('assistantSection'),
        pulseAura: document.getElementById('pulseAura'),
        assistantStateLabel: document.getElementById('assistantStateLabel'),
        assistantSpeechText: document.getElementById('assistantSpeechText'),
        transcriptHint: document.getElementById('transcriptHint'),

        btnListen: document.getElementById('btnListen'),
        listenBtnText: document.getElementById('listenBtnText'),
        micIcon: document.getElementById('micIcon'),
        btnStopSpeaking: document.getElementById('btnStopSpeaking'),
        btnRepeat: document.getElementById('btnRepeat'),
        btnHelp: document.getElementById('btnHelp'),

        cameraVideo: document.getElementById('cameraVideo'),
        overlayCanvas: document.getElementById('overlayCanvas'),
        cameraPlaceholder: document.getElementById('cameraPlaceholder'),
        btnStartCameraPrompt: document.getElementById('btnStartCameraPrompt'),
        btnToggleCamera: document.getElementById('btnToggleCamera'),
        cameraToggleText: document.getElementById('cameraToggleText'),
        btnFlipCamera: document.getElementById('btnFlipCamera'),

        btnDetect: document.getElementById('btnDetect'),
        btnOcr: document.getElementById('btnOcr'),
        btnLocation: document.getElementById('btnLocation'),

        badgeObjectCount: document.getElementById('badgeObjectCount'),
        objectsList: document.getElementById('objectsList'),

        ocrDisplayBox: document.getElementById('ocrDisplayBox'),
        btnCopyText: document.getElementById('btnCopyText'),
        btnSpeakText: document.getElementById('btnSpeakText'),

        locStatusBadge: document.getElementById('locStatusBadge'),
        locAddress: document.getElementById('locAddress'),
        locCoords: document.getElementById('locCoords'),
        locMapLink: document.getElementById('locMapLink'),

        // Settings Dialog
        settingsDialog: document.getElementById('settingsDialog'),
        btnSettingsModal: document.getElementById('btnSettingsModal'),
        btnCloseSettings: document.getElementById('btnCloseSettings'),
        selectVoice: document.getElementById('selectVoice'),
        rangeRate: document.getElementById('rangeRate'),
        lblRate: document.getElementById('lblRate'),
        chkAudioCues: document.getElementById('chkAudioCues'),
        txtBackendUrl: document.getElementById('txtBackendUrl'),
        btnSaveSettings: document.getElementById('btnSaveSettings')
    };

    // =========================================================================
    // Screen Reader Announcer & Accessibility
    // =========================================================================
    function announce(message) {
        if (!el.srAnnouncer) return;
        el.srAnnouncer.textContent = '';
        setTimeout(() => {
            el.srAnnouncer.textContent = message;
        }, 50);
    }

    // =========================================================================
    // Assistant State & Visuals
    // =========================================================================
    function setAssistantState(mode, label) {
        if (!el.pulseAura || !el.assistantStateLabel) return;
        el.pulseAura.className = 'pulse-aura ' + mode;
        el.assistantStateLabel.textContent = label;

        if (mode === 'speaking' || mode === 'listening') {
            el.assistantSection.classList.add('active-audio');
        } else {
            el.assistantSection.classList.remove('active-audio');
        }
    }

    // =========================================================================
    // Speech Synthesis (Text-to-Speech)
    // =========================================================================
    function speak(text, options = {}) {
        if (!state.speechSynthesis) {
            console.warn('Speech synthesis not supported in this browser.');
            return;
        }

        // Cancel ongoing speech
        stopSpeaking();

        state.lastSpokenText = text;
        if (el.assistantSpeechText) {
            el.assistantSpeechText.textContent = `"${text}"`;
        }
        announce(text);

        const utterance = new SpeechSynthesisUtterance(text);
        utterance.rate = state.speechRate;
        utterance.pitch = 1.0;

        if (state.selectedVoice) {
            utterance.voice = state.selectedVoice;
        }

        utterance.onstart = () => {
            state.isSpeaking = true;
            setAssistantState('speaking', 'Speaking...');
        };

        utterance.onend = () => {
            state.isSpeaking = false;
            if (!state.isListening && !state.isProcessing) {
                setAssistantState('idle', 'VisionAssist Ready');
            }
            if (options.onEnd) options.onEnd();
        };

        utterance.onerror = (e) => {
            console.error('Speech synthesis error:', e);
            state.isSpeaking = false;
            setAssistantState('idle', 'VisionAssist Ready');
        };

        state.speechSynthesis.speak(utterance);
    }

    function stopSpeaking() {
        if (state.speechSynthesis && state.speechSynthesis.speaking) {
            state.speechSynthesis.cancel();
            state.isSpeaking = false;
            setAssistantState('idle', 'VisionAssist Ready');
            announce('Speech stopped.');
            if (window.audioCues) window.audioCues.playTick();
        }
    }

    function repeatLastSpeech() {
        if (state.lastSpokenText) {
            speak(state.lastSpokenText);
        } else {
            speak('There is no previous response to repeat.');
        }
    }

    // Populate Available Voices
    function loadVoices() {
        if (!state.speechSynthesis) return;
        const voices = state.speechSynthesis.getVoices();
        if (!voices || voices.length === 0) return;

        el.selectVoice.innerHTML = '';
        
        // Prefer natural English voices (e.g., en-IN, en-US, en-GB, Google, Microsoft)
        let defaultChoice = null;

        voices.forEach((voice, index) => {
            const opt = document.createElement('option');
            opt.value = index;
            opt.textContent = `${voice.name} (${voice.lang})${voice.default ? ' [Default]' : ''}`;
            
            if (!defaultChoice && (voice.lang.includes('en-IN') || voice.lang.includes('en_IN'))) {
                defaultChoice = voice;
                opt.selected = true;
            } else if (!defaultChoice && voice.lang.startsWith('en')) {
                defaultChoice = voice;
                opt.selected = true;
            }

            el.selectVoice.appendChild(opt);
        });

        if (defaultChoice && !state.selectedVoice) {
            state.selectedVoice = defaultChoice;
        }
    }

    if (state.speechSynthesis) {
        state.speechSynthesis.onvoiceschanged = loadVoices;
        loadVoices();
    }

    // =========================================================================
    // Speech Recognition (Voice Commands Input)
    // =========================================================================
    function initSpeechRecognition() {
        const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
        if (!SpeechRecognition) {
            console.warn('Web Speech Recognition API not available.');
            el.lblMic.textContent = 'Unsupported';
            el.dotMic.className = 'status-dot warning';
            return null;
        }

        const recognition = new SpeechRecognition();
        recognition.continuous = false;
        recognition.interimResults = true;
        recognition.lang = 'en-US';

        recognition.onstart = () => {
            state.isListening = true;
            el.dotMic.className = 'status-dot online';
            el.lblMic.textContent = 'Listening';
            setAssistantState('listening', 'Listening for command...');
            el.listenBtnText.textContent = 'Listening...';
            el.btnListen.classList.add('btn-primary');
            el.btnListen.classList.remove('btn-saffron');
            if (window.audioCues) window.audioCues.playChimeListening();
            announce('Microphone active. Speak your command now.');
        };

        recognition.onresult = (event) => {
            let transcript = '';
            for (let i = event.resultIndex; i < event.results.length; ++i) {
                transcript += event.results[i][0].transcript;
            }
            transcript = transcript.trim();
            el.transcriptHint.innerHTML = `What I heard: <strong>"${transcript}"</strong>`;

            if (event.results[0].isFinal) {
                console.log('Final speech command recognized:', transcript);
                handleVoiceCommand(transcript);
            }
        };

        recognition.onerror = (event) => {
            console.error('Speech recognition error:', event.error);
            state.isListening = false;
            el.dotMic.className = 'status-dot';
            el.lblMic.textContent = 'Idle';
            setAssistantState('idle', 'VisionAssist Ready');
            el.listenBtnText.textContent = 'Start Listening';
            el.btnListen.classList.remove('btn-primary');
            el.btnListen.classList.add('btn-saffron');

            if (event.error === 'not-allowed') {
                speak('Microphone access was denied. Please allow microphone permissions in your browser settings.');
            } else if (event.error === 'no-speech') {
                // Silent timeout
            } else {
                if (window.audioCues) window.audioCues.playError();
            }
        };

        recognition.onend = () => {
            state.isListening = false;
            el.dotMic.className = 'status-dot';
            el.lblMic.textContent = 'Idle';
            if (!state.isSpeaking && !state.isProcessing) {
                setAssistantState('idle', 'VisionAssist Ready');
            }
            el.listenBtnText.textContent = 'Start Listening';
            el.btnListen.classList.remove('btn-primary');
            el.btnListen.classList.add('btn-saffron');
        };

        return recognition;
    }

    function toggleListening() {
        if (!state.recognition) {
            state.recognition = initSpeechRecognition();
        }
        if (!state.recognition) {
            speak('Speech recognition is not supported in this browser. Please use Chrome, Edge, or Safari.');
            return;
        }

        if (state.isListening) {
            state.recognition.stop();
            if (window.audioCues) window.audioCues.playChimeStop();
        } else {
            // Stop TTS if speaking so mic doesn't catch assistant's own voice
            stopSpeaking();
            try {
                state.recognition.start();
            } catch (err) {
                console.warn('Recognition start caught:', err);
            }
        }
    }

    // =========================================================================
    // Centralized Natural-Language Command Handler
    // =========================================================================
    function handleVoiceCommand(rawText) {
        const cmd = rawText.toLowerCase().trim();

        // 1. Describe Surroundings / Objects
        if (
            cmd.includes('describe') ||
            cmd.includes('surrounding') ||
            cmd.includes('what do you see') ||
            cmd.includes('what objects') ||
            cmd.includes('what is in front of me') ||
            cmd.includes("what's in front of me") ||
            cmd.includes('detect') ||
            cmd.includes('analyze scene') ||
            cmd.includes('look around')
        ) {
            triggerObjectDetection();
            return;
        }

        // 2. Read Text (OCR)
        if (
            cmd.includes('read this text') ||
            cmd.includes('read text') ||
            cmd.includes('read this') ||
            cmd.includes('what does it say') ||
            cmd.includes('read document') ||
            cmd.includes('read words') ||
            cmd.includes('scan text') ||
            cmd === 'read'
        ) {
            triggerTextRecognition();
            return;
        }

        // 3. Location / Where am I
        if (
            cmd.includes('where am i') ||
            cmd.includes('where i am') ||
            cmd.includes('what is my location') ||
            cmd.includes('my location') ||
            cmd.includes('what street') ||
            cmd.includes('find me') ||
            cmd.includes('current address')
        ) {
            triggerLocationLookup();
            return;
        }

        // 4. Camera Controls
        if (cmd.includes('start camera') || cmd.includes('turn on camera') || cmd.includes('open camera')) {
            startCamera();
            speak('Camera started.');
            return;
        }
        if (cmd.includes('stop camera') || cmd.includes('turn off camera') || cmd.includes('close camera')) {
            stopCamera();
            speak('Camera stopped.');
            return;
        }
        if (cmd.includes('flip camera') || cmd.includes('switch camera')) {
            flipCamera();
            return;
        }

        // 5. Speech Output Controls
        if (cmd.includes('stop speaking') || cmd.includes('be quiet') || cmd.includes('shut up') || cmd.includes('silence') || cmd.includes('mute')) {
            stopSpeaking();
            return;
        }
        if (cmd.includes('repeat that') || cmd.includes('say again') || cmd.includes('repeat')) {
            repeatLastSpeech();
            return;
        }

        // 6. Help / Capabilities
        if (cmd.includes('help') || cmd.includes('what can you do') || cmd.includes('commands') || cmd.includes('how to use')) {
            giveHelp();
            return;
        }

        // Unrecognized command fallback
        speak(`I heard "${rawText}". I didn't recognize that command. You can say: "Describe my surroundings", "Read this text", "Where am I?", or say "Help".`);
    }

    function giveHelp() {
        const helpText = 
            "Here is what I can do: " +
            "Say 'Describe my surroundings' to detect objects in front of you. " +
            "Say 'Read this text' to read signs, papers, or packaging. " +
            "Say 'Where am I' to check your location and street address. " +
            "Say 'Stop speaking' to silence my voice, or 'Repeat that' to hear the last response again. " +
            "You can also use keyboard shortcuts: Spacebar to talk, D for detect, T for read text, and L for location.";
        speak(helpText);
    }

    // =========================================================================
    // Camera Feed & Video Viewport Management
    // =========================================================================
    function getVideoRenderRect(video) {
        if (!video) return { x: 0, y: 0, width: 640, height: 480 };
        const videoWidth = video.videoWidth || 640;
        const videoHeight = video.videoHeight || 480;
        const elementWidth = video.clientWidth || 640;
        const elementHeight = video.clientHeight || 480;

        const videoRatio = videoWidth / videoHeight;
        const elementRatio = elementWidth / elementHeight;

        let renderWidth = elementWidth;
        let renderHeight = elementHeight;
        let x = 0;
        let y = 0;

        if (elementRatio > videoRatio) {
            renderWidth = elementHeight * videoRatio;
            x = (elementWidth - renderWidth) / 2;
        } else {
            renderHeight = elementWidth / videoRatio;
            y = (elementHeight - renderHeight) / 2;
        }

        return { x, y, width: renderWidth, height: renderHeight };
    }

    async function startCamera() {
        if (state.cameraStream) return;

        if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
            console.warn('MediaDevices API not supported.');
            el.dotCamera.className = 'status-dot warning';
            el.lblCamera.textContent = 'Unsupported';
            el.cameraPlaceholder.innerHTML = `
                <div style="font-size: 2.5rem;" aria-hidden="true">⚠️</div>
                <h3>Camera API Not Supported</h3>
                <p>Your browser does not support webcam capture. Please use Chrome, Edge, or Safari on localhost.</p>
            `;
            el.cameraPlaceholder.classList.remove('hidden');
            speak('Camera API is not supported in this browser.');
            return;
        }

        try {
            let stream = null;
            try {
                // 1. Try ideal constraint with user's selected facingMode
                const constraints = {
                    audio: false,
                    video: {
                        facingMode: { ideal: state.cameraFacingMode },
                        width: { ideal: 1280 },
                        height: { ideal: 720 }
                    }
                };
                stream = await navigator.mediaDevices.getUserMedia(constraints);
            } catch (constraintErr) {
                console.warn('FacingMode constraint rejected, attempting fallback:', constraintErr);
                // 2. Fallback to basic video stream (works on any webcam/laptop)
                stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: true });
            }

            state.cameraStream = stream;
            el.cameraVideo.srcObject = stream;
            el.cameraVideo.setAttribute('playsinline', '');
            el.cameraVideo.setAttribute('muted', '');

            try {
                await el.cameraVideo.play();
            } catch (playErr) {
                console.warn('Video auto play prevented:', playErr);
            }

            el.dotCamera.className = 'status-dot online';
            el.lblCamera.textContent = 'Active';
            el.cameraPlaceholder.classList.add('hidden');
            el.cameraToggleText.textContent = 'Stop Camera';

            if (state.cameraFacingMode === 'user') {
                el.cameraVideo.classList.add('user-facing');
            } else {
                el.cameraVideo.classList.remove('user-facing');
            }

            el.cameraVideo.onloadedmetadata = () => {
                resizeCanvas();
            };

            announce('Camera feed activated.');
        } catch (err) {
            console.error('Error starting camera:', err);
            el.dotCamera.className = 'status-dot warning';
            el.lblCamera.textContent = 'Blocked';
            el.cameraPlaceholder.classList.remove('hidden');

            let guidance = 'Please click "Start Camera" to grant camera access.';
            let spokenWarning = 'Unable to access device camera. Please check camera permissions in your browser.';

            if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
                guidance = 'Camera permission was denied. Please click the camera icon in your browser address bar to allow camera access, then click "Start Camera".';
                spokenWarning = 'Camera permission was denied. Please allow camera permissions in your browser.';
            } else if (err.name === 'NotFoundError' || err.name === 'DevicesNotFoundError') {
                guidance = 'No camera device detected on this system. Please connect a webcam or enable your built-in camera.';
                spokenWarning = 'No camera device found on this system.';
            } else if (err.name === 'NotReadableError' || err.name === 'TrackStartError') {
                guidance = 'Camera is already in use by another application. Please close other software using the camera and retry.';
                spokenWarning = 'Your camera is in use by another program. Please close it and retry.';
            }

            el.cameraPlaceholder.innerHTML = `
                <div style="font-size: 2.5rem;" aria-hidden="true">📷</div>
                <h3>Camera Standby / Permission</h3>
                <p>${escapeHtml(guidance)}</p>
                <button id="btnStartCameraPrompt" class="btn btn-primary">Start Camera</button>
            `;

            const promptBtn = document.getElementById('btnStartCameraPrompt');
            if (promptBtn) {
                promptBtn.addEventListener('click', startCamera);
            }

            speak(spokenWarning);
        }
    }

    function stopCamera() {
        if (state.cameraStream) {
            state.cameraStream.getTracks().forEach(track => track.stop());
            state.cameraStream = null;
            el.cameraVideo.srcObject = null;
        }
        el.dotCamera.className = 'status-dot';
        el.lblCamera.textContent = 'Standby';
        el.cameraPlaceholder.classList.remove('hidden');
        el.cameraToggleText.textContent = 'Start Camera';
        clearOverlayCanvas();
        announce('Camera feed paused.');
    }

    function toggleCamera() {
        if (state.cameraStream) {
            stopCamera();
            if (window.audioCues) window.audioCues.playTick();
        } else {
            startCamera();
            if (window.audioCues) window.audioCues.playTick();
        }
    }

    function flipCamera() {
        state.cameraFacingMode = state.cameraFacingMode === 'environment' ? 'user' : 'environment';
        if (state.cameraStream) {
            stopCamera();
            startCamera();
            speak(`Switched to ${state.cameraFacingMode === 'environment' ? 'rear' : 'front'} camera.`);
        } else {
            startCamera();
        }
    }

    function resizeCanvas() {
        if (!el.cameraVideo || !el.overlayCanvas) return;
        const rect = el.cameraVideo.getBoundingClientRect();
        el.overlayCanvas.width = rect.width;
        el.overlayCanvas.height = rect.height;
    }

    window.addEventListener('resize', resizeCanvas);

    function clearOverlayCanvas() {
        if (!el.overlayCanvas) return;
        const ctx = el.overlayCanvas.getContext('2d');
        ctx.clearRect(0, 0, el.overlayCanvas.width, el.overlayCanvas.height);
    }

    // Capture Snapshot Frame as Blob
    function captureVideoFrameBlob() {
        return new Promise((resolve, reject) => {
            if (!state.cameraStream) {
                reject(new Error('Camera is not active. Please click Start Camera.'));
                return;
            }

            function performCapture() {
                try {
                    const width = el.cameraVideo.videoWidth || 640;
                    const height = el.cameraVideo.videoHeight || 480;

                    const offCanvas = document.createElement('canvas');
                    offCanvas.width = width;
                    offCanvas.height = height;
                    const offCtx = offCanvas.getContext('2d');

                    // If mirrored, flip horizontal
                    if (state.cameraFacingMode === 'user') {
                        offCtx.translate(width, 0);
                        offCtx.scale(-1, 1);
                    }

                    offCtx.drawImage(el.cameraVideo, 0, 0, width, height);

                    offCanvas.toBlob((blob) => {
                        if (blob) {
                            resolve(blob);
                        } else {
                            reject(new Error('Failed to encode frame as image blob.'));
                        }
                    }, 'image/jpeg', 0.90);
                } catch (e) {
                    reject(e);
                }
            }

            if (!el.cameraVideo.videoWidth || !el.cameraVideo.videoHeight) {
                setTimeout(performCapture, 300);
            } else {
                performCapture();
            }
        });
    }

    // =========================================================================
    // Core Feature 1: YOLO11n Object Detection
    // =========================================================================
    async function triggerObjectDetection() {
        if (state.isProcessing) return;

        // Ensure camera is running
        if (!state.cameraStream) {
            await startCamera();
            // Wait briefly for camera stream to stabilize
            await new Promise(r => setTimeout(r, 600));
        }

        try {
            state.isProcessing = true;
            setAssistantState('processing', 'Analyzing surroundings...');
            if (window.audioCues) window.audioCues.playShutter();
            announce('Capturing scene and detecting objects with YOLO11n AI...');

            const blob = await captureVideoFrameBlob();
            const formData = new FormData();
            formData.append('file', blob, 'frame.jpg');

            const resp = await fetch(`${state.backendUrl}/api/detect`, {
                method: 'POST',
                body: formData
            });

            if (!resp.ok) {
                throw new Error(`Server returned HTTP ${resp.status}`);
            }

            const data = await resp.json();
            console.log('Detection results:', data);

            state.currentDetections = data.detections || [];
            renderDetectedObjects(data.detections || []);
            drawBoundingBoxes(data.detections || [], data.image_size);

            if (window.audioCues) window.audioCues.playSuccess();
            speak(data.narrative);

        } catch (err) {
            console.error('Detection failed:', err);
            if (window.audioCues) window.audioCues.playError();
            speak(`Detection could not be completed: ${err.message}. Please verify the backend server is running.`);
        } finally {
            state.isProcessing = false;
        }
    }

    function renderDetectedObjects(detections) {
        el.badgeObjectCount.textContent = `${detections.length} detected`;

        if (!detections || detections.length === 0) {
            el.objectsList.innerHTML = `
                <div style="color: var(--text-muted); font-size: 0.9rem; text-align: center; padding: 1.5rem;">
                    No distinct objects found in view.
                </div>
            `;
            return;
        }

        el.objectsList.innerHTML = '';
        detections.forEach(d => {
            const item = document.createElement('div');
            item.className = 'object-item';
            item.innerHTML = `
                <div class="object-info">
                    <span class="object-name">${escapeHtml(d.label)}</span>
                    <span class="object-badge">${escapeHtml(d.position)}</span>
                </div>
                <span class="confidence-meter">${d.confidence}%</span>
            `;
            el.objectsList.appendChild(item);
        });
    }

    function drawBoundingBoxes(detections, origSize) {
        if (!el.overlayCanvas || !origSize || !el.cameraVideo) return;
        resizeCanvas();
        const ctx = el.overlayCanvas.getContext('2d');
        const canvasW = el.overlayCanvas.width;
        const canvasH = el.overlayCanvas.height;

        ctx.clearRect(0, 0, canvasW, canvasH);

        const vRect = getVideoRenderRect(el.cameraVideo);
        const scaleX = vRect.width / origSize.width;
        const scaleY = vRect.height / origSize.height;

        detections.forEach(d => {
            let [x1, y1, x2, y2] = d.box;
            
            // If mirrored (front camera), flip box horizontally
            if (state.cameraFacingMode === 'user') {
                const flippedX1 = origSize.width - x2;
                const flippedX2 = origSize.width - x1;
                x1 = flippedX1;
                x2 = flippedX2;
            }

            const bx = vRect.x + x1 * scaleX;
            const by = vRect.y + y1 * scaleY;
            const bw = (x2 - x1) * scaleX;
            const bh = (y2 - y1) * scaleY;

            // Draw glowing bounding box
            ctx.strokeStyle = '#4F8CFF';
            ctx.lineWidth = 3;
            ctx.shadowColor = '#4F8CFF';
            ctx.shadowBlur = 10;
            ctx.strokeRect(bx, by, bw, bh);

            // Draw label pill
            const labelText = `${d.label.toUpperCase()} ${d.confidence}%`;
            ctx.font = 'bold 12px Inter, sans-serif';
            const textWidth = ctx.measureText(labelText).width;

            ctx.shadowBlur = 0;
            ctx.fillStyle = '#4F8CFF';
            ctx.fillRect(bx, Math.max(0, by - 22), textWidth + 12, 22);

            ctx.fillStyle = '#FFFFFF';
            ctx.fillText(labelText, bx + 6, Math.max(15, by - 6));
        });
    }

    function drawOcrBoxes(blocks) {
        if (!el.overlayCanvas || !el.cameraVideo || !blocks || blocks.length === 0) return;
        resizeCanvas();
        const ctx = el.overlayCanvas.getContext('2d');
        const canvasW = el.overlayCanvas.width;
        const canvasH = el.overlayCanvas.height;

        ctx.clearRect(0, 0, canvasW, canvasH);

        const vRect = getVideoRenderRect(el.cameraVideo);
        const videoW = el.cameraVideo.videoWidth || canvasW;
        const videoH = el.cameraVideo.videoHeight || canvasH;

        const scaleX = vRect.width / videoW;
        const scaleY = vRect.height / videoH;

        blocks.forEach(b => {
            if (!b.box || b.box.length < 4) return;
            const x1 = Math.min(b.box[0][0], b.box[3][0]);
            const y1 = Math.min(b.box[0][1], b.box[1][1]);
            const x2 = Math.max(b.box[1][0], b.box[2][0]);
            const y2 = Math.max(b.box[2][1], b.box[3][1]);

            let drawX1 = x1;
            let drawX2 = x2;
            if (state.cameraFacingMode === 'user') {
                drawX1 = videoW - x2;
                drawX2 = videoW - x1;
            }

            const bx = vRect.x + drawX1 * scaleX;
            const by = vRect.y + y1 * scaleY;
            const bw = (drawX2 - drawX1) * scaleX;
            const bh = (y2 - y1) * scaleY;

            ctx.strokeStyle = '#FF9933';
            ctx.lineWidth = 2;
            ctx.shadowColor = '#FF9933';
            ctx.shadowBlur = 8;
            ctx.strokeRect(bx, by, bw, bh);

            const tagText = b.text.length > 22 ? b.text.substring(0, 20) + '...' : b.text;
            ctx.font = 'bold 11px Inter, sans-serif';
            const tw = ctx.measureText(tagText).width;
            ctx.fillStyle = 'rgba(255, 153, 51, 0.95)';
            ctx.fillRect(bx, Math.max(0, by - 18), tw + 8, 18);
            ctx.fillStyle = '#000000';
            ctx.fillText(tagText, bx + 4, Math.max(13, by - 5));
        });
    }

    // =========================================================================
    // Core Feature 2: EasyOCR Text Reading
    // =========================================================================
    async function triggerTextRecognition() {
        if (state.isProcessing) return;

        if (!state.cameraStream) {
            await startCamera();
            await new Promise(r => setTimeout(r, 600));
        }

        try {
            state.isProcessing = true;
            setAssistantState('processing', 'Reading text...');
            if (window.audioCues) window.audioCues.playShutter();
            announce('Capturing image and reading text with EasyOCR...');

            const blob = await captureVideoFrameBlob();
            const formData = new FormData();
            formData.append('file', blob, 'ocr_frame.jpg');

            const resp = await fetch(`${state.backendUrl}/api/ocr`, {
                method: 'POST',
                body: formData
            });

            if (!resp.ok) {
                throw new Error(`Server returned HTTP ${resp.status}`);
            }

            const data = await resp.json();
            console.log('OCR results:', data);

            state.currentOcrBlocks = data.blocks || [];
            drawOcrBoxes(data.blocks || []);
            
            if (data.text) {
                el.ocrDisplayBox.textContent = data.text;
                if (window.audioCues) window.audioCues.playSuccess();
                speak(data.narrative);
            } else {
                el.ocrDisplayBox.textContent = "No readable text detected in this frame.";
                if (window.audioCues) window.audioCues.playError();
                speak(data.narrative);
            }

        } catch (err) {
            console.error('OCR failed:', err);
            if (window.audioCues) window.audioCues.playError();
            speak(`Text recognition failed: ${err.message}. Please ensure the backend is running.`);
        } finally {
            state.isProcessing = false;
        }
    }

    // =========================================================================
    // Core Feature 3: Geolocation & Reverse Geocoding
    // =========================================================================
    function triggerLocationLookup() {
        if (!navigator.geolocation) {
            speak('Geolocation is not supported by your browser.');
            return;
        }

        setAssistantState('processing', 'Acquiring GPS location...');
        el.locStatusBadge.textContent = 'Locating...';
        el.locStatusBadge.className = 'status-badge warning';
        announce('Acquiring your precise GPS coordinates...');

        navigator.geolocation.getCurrentPosition(
            async (position) => {
                const lat = position.coords.latitude;
                const lon = position.coords.longitude;
                const accuracy = Math.round(position.coords.accuracy);

                el.dotGeo.className = 'status-dot online';
                el.lblGeo.textContent = 'Active';
                el.locStatusBadge.textContent = `GPS ±${accuracy}m`;
                el.locStatusBadge.className = 'status-badge online';
                el.locCoords.textContent = `Latitude: ${lat.toFixed(5)}, Longitude: ${lon.toFixed(5)} (Accuracy: ${accuracy}m)`;

                // Backend Reverse Geocoding
                try {
                    const resp = await fetch(`${state.backendUrl}/api/geocode`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ latitude: lat, longitude: lon })
                    });

                    if (resp.ok) {
                        const data = await resp.json();
                        el.locAddress.textContent = data.display_name || data.narrative;
                        el.locMapLink.href = data.maps_url;
                        el.locMapLink.style.display = 'inline-flex';

                        if (window.audioCues) window.audioCues.playSuccess();
                        speak(data.narrative);
                    } else {
                        throw new Error('Geocoding response failed');
                    }
                } catch (err) {
                    console.warn('Geocoding endpoint failed, using direct coordinates:', err);
                    const coordNarrative = `Your current coordinates are latitude ${lat.toFixed(4)} and longitude ${lon.toFixed(4)}.`;
                    el.locAddress.textContent = coordNarrative;
                    el.locMapLink.href = `https://www.google.com/maps?q=${lat},${lon}`;
                    el.locMapLink.style.display = 'inline-flex';
                    speak(coordNarrative);
                }
            },
            (err) => {
                console.error('Geolocation error:', err);
                el.dotGeo.className = 'status-dot warning';
                el.lblGeo.textContent = 'Denied';
                el.locStatusBadge.textContent = 'Error';
                let errMsg = 'Location access was denied. Please allow location permissions in your browser.';
                if (err.code === 2) errMsg = 'Location position is currently unavailable.';
                if (err.code === 3) errMsg = 'Location request timed out.';
                speak(errMsg);
            },
            {
                enableHighAccuracy: true,
                timeout: 10000,
                maximumAge: 5000
            }
        );
    }

    // =========================================================================
    // Backend Health Ping Loop
    // =========================================================================
    async function checkBackendHealth() {
        try {
            const res = await fetch(`${state.backendUrl}/api/health`, { method: 'GET' });
            if (res.ok) {
                const data = await res.json();
                state.backendOnline = true;
                el.dotBackend.className = 'status-dot online';
                el.lblBackend.textContent = 'Online';
            } else {
                throw new Error('Non-200 health response');
            }
        } catch (e) {
            state.backendOnline = false;
            el.dotBackend.className = 'status-dot';
            el.lblBackend.textContent = 'Offline';
        }
    }

    // Check immediately, then poll every 10 seconds
    checkBackendHealth();
    setInterval(checkBackendHealth, 10000);

    // =========================================================================
    // Keyboard Shortcuts for Blind / Low-Vision Access
    // =========================================================================
    window.addEventListener('keydown', (e) => {
        // Do not intercept if user is typing in a text input or textarea
        if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'SELECT') {
            return;
        }

        const key = e.key.toUpperCase();

        if (e.code === 'Space') {
            e.preventDefault();
            toggleListening();
        } else if (key === 'D') {
            e.preventDefault();
            triggerObjectDetection();
        } else if (key === 'T') {
            e.preventDefault();
            triggerTextRecognition();
        } else if (key === 'L') {
            e.preventDefault();
            triggerLocationLookup();
        } else if (key === 'C') {
            e.preventDefault();
            toggleCamera();
        } else if (key === 'S') {
            e.preventDefault();
            stopSpeaking();
        } else if (key === 'R') {
            e.preventDefault();
            repeatLastSpeech();
        } else if (key === 'H') {
            e.preventDefault();
            giveHelp();
        }
    });

    // =========================================================================
    // Event Listeners Binding
    // =========================================================================
    function bindEvents() {
        // Voice Controls
        el.btnListen.addEventListener('click', toggleListening);
        el.btnStopSpeaking.addEventListener('click', stopSpeaking);
        el.btnRepeat.addEventListener('click', repeatLastSpeech);
        el.btnHelp.addEventListener('click', giveHelp);

        // Camera Controls
        el.btnToggleCamera.addEventListener('click', toggleCamera);
        el.btnStartCameraPrompt.addEventListener('click', startCamera);
        el.btnFlipCamera.addEventListener('click', flipCamera);

        // Core Actions
        el.btnDetect.addEventListener('click', triggerObjectDetection);
        el.btnOcr.addEventListener('click', triggerTextRecognition);
        el.btnLocation.addEventListener('click', triggerLocationLookup);

        // OCR Actions
        el.btnCopyText.addEventListener('click', () => {
            const txt = el.ocrDisplayBox.textContent.trim();
            if (txt && !txt.startsWith('No text')) {
                navigator.clipboard.writeText(txt).then(() => {
                    speak('Text copied to clipboard.');
                    if (window.audioCues) window.audioCues.playSuccess();
                });
            } else {
                speak('No text available to copy.');
            }
        });

        el.btnSpeakText.addEventListener('click', () => {
            const txt = el.ocrDisplayBox.textContent.trim();
            if (txt && !txt.startsWith('No text')) {
                speak(txt);
            } else {
                speak('No text available to read.');
            }
        });

        // Settings Dialog
        el.btnSettingsModal.addEventListener('click', () => {
            el.txtBackendUrl.value = state.backendUrl;
            el.rangeRate.value = state.speechRate;
            el.lblRate.textContent = `${state.speechRate}x`;
            el.chkAudioCues.checked = state.audioCuesEnabled;
            el.settingsDialog.showModal();
        });

        el.btnCloseSettings.addEventListener('click', () => {
            el.settingsDialog.close();
        });

        el.rangeRate.addEventListener('input', (e) => {
            el.lblRate.textContent = `${e.target.value}x`;
        });

        el.btnSaveSettings.addEventListener('click', () => {
            state.speechRate = parseFloat(el.rangeRate.value);
            state.audioCuesEnabled = el.chkAudioCues.checked;
            if (window.audioCues) window.audioCues.enabled = state.audioCuesEnabled;

            if (el.txtBackendUrl.value.trim()) {
                state.backendUrl = el.txtBackendUrl.value.trim().replace(/\/$/, '');
            }

            const selectedIdx = el.selectVoice.value;
            const voices = state.speechSynthesis ? state.speechSynthesis.getVoices() : [];
            if (voices[selectedIdx]) {
                state.selectedVoice = voices[selectedIdx];
            }

            el.settingsDialog.close();
            checkBackendHealth();
            speak('Settings updated successfully.');
        });
    }

    // Utility: HTML Escaping
    function escapeHtml(str) {
        if (!str) return '';
        return String(str)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }

    // =========================================================================
    // Initialization & User Welcome Greeting
    // =========================================================================
    window.addEventListener('DOMContentLoaded', () => {
        bindEvents();
        state.recognition = initSpeechRecognition();

        // Unlock Web Audio Context and SpeechSynthesis on first user interaction
        const unlockAudio = () => {
            if (window.audioCues) {
                window.audioCues._initContext();
            }
            window.removeEventListener('click', unlockAudio);
            window.removeEventListener('keydown', unlockAudio);
            window.removeEventListener('touchstart', unlockAudio);
        };
        window.addEventListener('click', unlockAudio);
        window.addEventListener('keydown', unlockAudio);
        window.addEventListener('touchstart', unlockAudio);

        // Autostart camera for hands-free immediate visual awareness
        startCamera();

        // Welcome greeting with gentle delay
        setTimeout(() => {
            const welcomeGreeting = "Welcome to Nayana VisionAssist. Your accessibility assistant is ready. Press Spacebar to speak a command, or press D to describe your surroundings.";
            speak(welcomeGreeting);
        }, 800);
    });

})();
