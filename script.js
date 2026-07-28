const BACKEND_URL = 'http://localhost:3000/api/interview/next';

let currentTurnIndex = 0;
let candidateName = '';
let candidateRole = '';
let resumeData = '';
let activeResumeMode = 'upload';
let isInterviewEnding = false;
let isProcessingTurn = false;

let conversationHistory = [];

let speechSynth = window.speechSynthesis;
let recognition = null;
let silenceTimer = null;
let currentAnswerTranscript = '';
let currentLang = 'en-US';

let radarChartInstance = null;
let totalFrames = 0;
let eyeContactFrames = 0;

function switchResumeTab(mode) {
    activeResumeMode = mode;
    document.getElementById('tab-upload-btn').classList.toggle('active', mode === 'upload');
    document.getElementById('tab-builder-btn').classList.toggle('active', mode === 'builder');
    document.getElementById('resume-upload-section').style.display = (mode === 'upload') ? 'block' : 'none';
    document.getElementById('resume-builder-section').style.display = (mode === 'builder') ? 'block' : 'none';
}

function handleFileUpload(event) {
    const file = event.target.files[0];
    if (!file) return;
    const fileTextStatus = document.getElementById('file-status-text');
    fileTextStatus.innerText = `Selected file: ${file.name}`;
    const reader = new FileReader();
    reader.onload = function(e) {
        resumeData = `Uploaded File: ${file.name}\nResume Content:\n` + e.target.result.slice(0, 3000);
        fileTextStatus.innerText = `✅ Loaded ${file.name}`;
    };
    reader.readAsText(file);
}

function openResumeModal() { document.getElementById('resume-modal').style.display = 'flex'; }
function closeResumeModal() { document.getElementById('resume-modal').style.display = 'none'; }

function saveBuiltResume() {
    const exp = document.getElementById('modal-experience').value.trim();
    const skills = document.getElementById('modal-skills').value.trim();
    const edu = document.getElementById('modal-education').value.trim();
    if (!exp && !skills) return alert("Please fill in Experience or Skills.");
    resumeData = `BUILT RESUME:\nExperience: ${exp}\nSkills: ${skills}\nEducation: ${edu}`;
    document.getElementById('builder-status-text').innerText = `✅ Resume details saved!`;
    closeResumeModal();
}

async function startInterview() {
    candidateName = document.getElementById('userName').value.trim();
    candidateRole = document.getElementById('jobCategory').value;

    if (!candidateName || !resumeData) return alert("Name and Resume details are required!");

    document.getElementById('display-name').innerText = candidateName;
    document.getElementById('avatar-initial').innerText = candidateName.charAt(0).toUpperCase();
    document.getElementById('display-role').innerText = candidateRole;

    document.getElementById('setup-screen').style.display = 'none';
    document.getElementById('dashboard-screen').style.display = 'grid';

    initWebcamAndFaceTracking();
    initSpeechRecognition();
    initChart();

    fetchAndPlayNextQuestion(null, false);
}

async function fetchAndPlayNextQuestion(lastAnswer, forceConclusion) {
    if (isInterviewEnding || isProcessingTurn) return;

    isProcessingTurn = true; 

    const statusText = document.getElementById('session-status');
    const qElement = document.getElementById('dynamic-question');
    const tipElement = document.getElementById('dynamic-tip');
    const recordingBadge = document.getElementById('recording-indicator');
    
    recordingBadge.style.display = 'none';
    statusText.innerText = forceConclusion ? 'Panel Assembling Report...' : 'Panel Thinking...';

    // Render candidate's previous response in transcript area
    if (lastAnswer && lastAnswer !== "Candidate provided no spoken input.") {
        const historyElem = document.getElementById('live-transcript');
        if (historyElem) {
            historyElem.innerHTML = `<strong>Your Last Answer:</strong> "${lastAnswer}"`;
        }
    }

    try {
        const response = await fetch(BACKEND_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                name: candidateName,
                role: candidateRole,
                resumeText: resumeData,
                turnIndex: currentTurnIndex,
                lastResponse: lastAnswer || "",
                forceConclusion: forceConclusion,
                history: conversationHistory
            })
        });

        const data = await response.json();

        // Push response turn to conversation history
        conversationHistory.push({
            userResponse: lastAnswer || "Initial Greeting",
            aiQuestion: data.question || ""
        });

        if (data.detectedLanguage) {
            currentLang = data.detectedLanguage;
            if (recognition) recognition.lang = currentLang;
        }

        renderVisualContext(data.visualType, data.visualContent);

        if (data.isFinished) {
            isInterviewEnding = true;
            renderFinalResults(data.finalScore, data.improvements);
            speakMultilingualOutLoud("Thank you for your time. The interview has concluded.", 'en-US', () => {});
            isProcessingTurn = false;
            return;
        }

        qElement.innerText = data.question;
        statusText.innerText = 'Panel Speaking...';

        // Render real-time feedback tip
        if (data.tip) {
            tipElement.innerText = `💡 Feedback / Hint: ${data.tip}`;
            tipElement.style.display = 'block';
        } else {
            tipElement.style.display = 'none';
        }

        // Update Question Stage Header
        if (currentTurnIndex === 0) {
            document.getElementById('question-tracker').innerText = "Warm-Up Phase";
        } else if (currentTurnIndex === 1) {
            document.getElementById('question-tracker').innerText = "Resume Verification";
        } else {
            document.getElementById('question-tracker').innerText = `Question #${currentTurnIndex - 1}`;
        }

        if (data.scores) updateDashboardScores(data.scores);

        speakMultilingualOutLoud(data.question, currentLang, () => {
            isProcessingTurn = false; 
            startCandidateVoiceRecording();
        });

    } catch (err) {
        console.error("Backend error:", err);
        qElement.innerText = "Let's move on. Tell me about a complex project from your resume.";
        isProcessingTurn = false;
        speakMultilingualOutLoud("Let's move on. Tell me about a complex project from your resume.", 'en-US', () => startCandidateVoiceRecording());
    }
}

function renderVisualContext(visualType, visualContent) {
    const container = document.getElementById('visual-context-container');
    const img = document.getElementById('visual-image');
    const code = document.getElementById('visual-code');

    container.style.display = 'none';
    img.style.display = 'none';
    code.style.display = 'none';

    if (visualType === 'image' && visualContent) {
        img.src = visualContent;
        img.style.display = 'block';
        container.style.display = 'block';
    } else if (visualType === 'code' && visualContent) {
        code.innerText = visualContent;
        code.style.display = 'block';
        container.style.display = 'block';
    }
}

function speakMultilingualOutLoud(text, targetLang, onCompleteCallback) {
    if (!speechSynth) return onCompleteCallback();

    speechSynth.cancel();

    const utterance = new SpeechSynthesisUtterance(text);
    utterance.rate = 0.95;
    utterance.pitch = 0.95;
    utterance.lang = targetLang || 'en-US';

    const voices = speechSynth.getVoices();
    const matchedVoice = voices.find(v => v.lang.startsWith((targetLang || 'en').slice(0, 2))) || voices.find(v => v.lang.includes('en'));
    if (matchedVoice) utterance.voice = matchedVoice;

    utterance.onend = () => onCompleteCallback();
    speechSynth.speak(utterance);
}

function initSpeechRecognition() {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) return alert("Speech Recognition not supported in this browser. Please use Chrome or Edge.");

    recognition = new SpeechRecognition();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = currentLang;

    recognition.onresult = (event) => {
        if (speechSynth && speechSynth.speaking) speechSynth.cancel();

        let transcript = '';
        for (let i = event.resultIndex; i < event.results.length; i++) {
            transcript += event.results[i][0].transcript;
        }

        currentAnswerTranscript = transcript;
        document.getElementById('live-transcript').innerText = `Listening: "${transcript}"`;

        clearTimeout(silenceTimer);
        silenceTimer = setTimeout(() => autoSubmitCandidateAnswer(), 3500);
    };
}

function startCandidateVoiceRecording() {
    if (!recognition || isInterviewEnding || isProcessingTurn) return;

    currentAnswerTranscript = '';
    document.getElementById('session-status').innerText = 'Panel Listening...';
    document.getElementById('recording-indicator').style.display = 'flex';

    try { 
        recognition.lang = currentLang;
        recognition.start(); 
    } catch (e) {}

    clearTimeout(silenceTimer);
    silenceTimer = setTimeout(() => autoSubmitCandidateAnswer(), 40000);
}

function autoSubmitCandidateAnswer() {
    if (recognition) try { recognition.stop(); } catch(e){}
    document.getElementById('recording-indicator').style.display = 'none';

    if (!currentAnswerTranscript.trim()) {
        currentAnswerTranscript = "Candidate provided no spoken input.";
    }

    currentTurnIndex++;
    fetchAndPlayNextQuestion(currentAnswerTranscript, false);
}

function requestFinalEvaluation() {
    if (confirm("End session and view feedback?")) {
        try { if (recognition) recognition.stop(); } catch(e){}
        if (speechSynth) speechSynth.cancel();
        isProcessingTurn = false;
        fetchAndPlayNextQuestion(currentAnswerTranscript, true);
    }
}

function renderFinalResults(score, feedbackText) {
    document.getElementById('video-panel').style.display = 'none';
    document.getElementById('metrics-panel').style.display = 'none';
    document.getElementById('end-interview-btn').style.display = 'none';
    
    const centerCol = document.getElementById('center-content');
    const template = document.getElementById('final-results-template').content.cloneNode(true);
    
    template.querySelector('#final-score-text').innerText = score || 0;
    template.querySelector('#final-improvements').innerHTML = (feedbackText || "No feedback generated.").replace(/\n/g, '<br/>');

    centerCol.appendChild(template);
    document.getElementById('session-status').innerText = 'Session Concluded';
}

function updateDashboardScores(scores) {
    if (!radarChartInstance) return;
    
    radarChartInstance.data.datasets[0].data = [
        scores.content || 80, 
        scores.communication || 85, 
        scores.problemSolving || 80,
        Math.round(((scores.content || 80) + (scores.communication || 85)) / 2),
        scores.confidence || 85
    ];
    radarChartInstance.update();

    const confScore = scores.confidence || 85;
    const scoreElem = document.getElementById('confidence-score');
    const statusElem = document.getElementById('confidence-status');
    
    scoreElem.innerText = `${confScore}%`;
    
    if (confScore >= 85) {
        scoreElem.style.color = 'var(--success)';
        statusElem.innerText = 'High Confidence & Articulate';
    } else if (confScore >= 70) {
        scoreElem.style.color = 'var(--warning)';
        statusElem.innerText = 'Moderate Hesitation';
    } else {
        scoreElem.style.color = 'var(--danger)';
        statusElem.innerText = 'Needs Articulation';
    }
}

function initWebcamAndFaceTracking() {
    const videoElement = document.getElementById('webcam');
    const faceMesh = new FaceMesh({ locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/face_mesh/${file}` });

    faceMesh.setOptions({ maxNumFaces: 1, refineLandmarks: true, minDetectionConfidence: 0.5, minTrackingConfidence: 0.5 });
    faceMesh.onResults((results) => {
        totalFrames++;
        if (results.multiFaceLandmarks && results.multiFaceLandmarks.length > 0) {
            const l = results.multiFaceLandmarks[0];
            const eyeDist = Math.abs((l[33].x + l[263].x) / 2 - l[1].x);
            if (eyeDist < 0.035) eyeContactFrames++;
        }

        if (totalFrames % 15 === 0) {
            const eyePct = Math.min(100, Math.round((eyeContactFrames / totalFrames) * 100));
            document.getElementById('metric-eye').innerText = `${eyePct}%`;
            document.getElementById('metric-clarity').innerText = `88%`;
            document.getElementById('metric-pace').innerText = `140 wpm`;
            document.getElementById('metric-filler').innerText = `2%`;
        }
    });

    const camera = new Camera(videoElement, { onFrame: async () => await faceMesh.send({ image: videoElement }), width: 640, height: 480 });
    camera.start();
}

function initChart() {
    const ctx = document.getElementById('radarChart').getContext('2d');
    radarChartInstance = new Chart(ctx, {
        type: 'radar',
        data: { 
            labels: ['Content', 'Clarity', 'Problem Solving', 'Structure', 'Confidence'], 
            datasets: [{ 
                data: [80, 85, 80, 75, 85], 
                backgroundColor: 'rgba(136, 189, 242, 0.4)', 
                borderColor: '#384959', 
                pointBackgroundColor: '#384959' 
            }] 
        },
        options: { scales: { r: { ticks: { display: false }, min: 0, max: 100 } }, plugins: { legend: { display: false } }, maintainAspectRatio: false }
    });
}