// Estado de la aplicación
let mediaRecorder;
let audioChunks = [];
let isRecording = false;
let isProcessing = false;
let recognition; // Para Web Speech API
let recognitionActive = false; // Control de estado del reconocimiento
let audioContext;
let analyser;
let dataArray;
let animationId;

// Elementos del DOM
const orb = document.getElementById('orb');
const orbText = document.getElementById('orbText');
const status = document.getElementById('status');
const chatContainer = document.getElementById('chatContainer');
const canvas = document.getElementById('waveformCanvas');
const ctx = canvas.getContext('2d');

// Configurar canvas
canvas.width = window.innerWidth;
canvas.height = window.innerHeight;

window.addEventListener('resize', () => {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
});

// Función para mostrar estado
function showStatus(message, type = '') {
    status.textContent = message;
    status.className = `status ${type}`;
}

// Función para actualizar texto del orbe
function updateOrbText(text) {
    orbText.textContent = text;
}

// Función para animar el orbe según el audio
function visualizeAudio(stream) {
    if (!audioContext) {
        audioContext = new (window.AudioContext || window.webkitAudioContext)();
    }
    
    const source = audioContext.createMediaStreamSource(stream);
    analyser = audioContext.createAnalyser();
    analyser.fftSize = 256;
    
    source.connect(analyser);
    
    const bufferLength = analyser.frequencyBinCount;
    dataArray = new Uint8Array(bufferLength);
    
    drawWaveform();
}

function drawWaveform() {
    if (!analyser) return;
    
    animationId = requestAnimationFrame(drawWaveform);
    
    analyser.getByteFrequencyData(dataArray);
    
    // Limpiar canvas
    ctx.fillStyle = 'rgba(0, 0, 0, 0.1)';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    
    // Calcular promedio de frecuencias para escalar el orbe
    const average = dataArray.reduce((a, b) => a + b) / dataArray.length;
    const scale = 1 + (average / 255) * 0.3;
    
    // Animar el tamaño del orbe-core
    const orbCore = orb.querySelector('.orb-core');
    if (orbCore && isRecording) {
        orbCore.style.transform = `translate(-50%, -50%) scale(${scale})`;
    }
    
    // Dibujar ondas
    ctx.strokeStyle = '#3b82f6';
    ctx.lineWidth = 2;
    
    const sliceWidth = canvas.width / dataArray.length;
    let x = 0;
    
    ctx.beginPath();
    
    for (let i = 0; i < dataArray.length; i++) {
        const v = dataArray[i] / 255.0;
        const y = (canvas.height / 2) + (v * canvas.height / 2 - canvas.height / 4);
        
        if (i === 0) {
            ctx.moveTo(x, y);
        } else {
            ctx.lineTo(x, y);
        }
        
        x += sliceWidth;
    }
    
    ctx.stroke();
}

function stopVisualization() {
    if (animationId) {
        cancelAnimationFrame(animationId);
        animationId = null;
    }
    
    // Resetear orbe
    const orbCore = orb.querySelector('.orb-core');
    if (orbCore) {
        orbCore.style.transform = 'translate(-50%, -50%) scale(1)';
    }
    
    // Limpiar canvas
    ctx.clearRect(0, 0, canvas.width, canvas.height);
}

// Función para agregar mensaje al chat
function addMessage(text, sender) {
    // Remover mensaje de bienvenida si existe
    const welcome = chatContainer.querySelector('.welcome-message');
    if (welcome) {
        welcome.remove();
    }

    const messageDiv = document.createElement('div');
    messageDiv.className = `message ${sender}`;
    
    const label = document.createElement('div');
    label.className = 'message-label';
    label.textContent = sender === 'user' ? 'TÚ' : 'JARVIS';
    
    const content = document.createElement('div');
    content.className = 'message-content';
    content.textContent = text;
    
    messageDiv.appendChild(label);
    messageDiv.appendChild(content);
    chatContainer.appendChild(messageDiv);
    
    // Scroll al final
    chatContainer.scrollTop = chatContainer.scrollHeight;
}

// Función para reproducir audio
async function playAudio(audioBlob) {
    // Asegurar que el audio esté desbloqueado
    await unlockAudio();
    
    return new Promise((resolve, reject) => {
        const audio = new Audio();
        const url = URL.createObjectURL(audioBlob);
        
        audio.src = url;
        audio.volume = 1.0; // Volumen al máximo
        
        audio.onended = () => {
            URL.revokeObjectURL(url); // Liberar memoria
            console.log('Reproducción de audio finalizada');
            resolve();
        };
        
        audio.onerror = (error) => {
            URL.revokeObjectURL(url);
            console.error('Error al reproducir audio:', error);
            reject(error);
        };
        
        // Cargar y reproducir
        audio.load();
        
        const playPromise = audio.play();
        
        if (playPromise !== undefined) {
            playPromise
                .then(() => {
                    console.log('✓ Audio reproduciéndose correctamente');
                })
                .catch(err => {
                    URL.revokeObjectURL(url);
                    console.error('✗ Error al iniciar reproducción:', err);
                    console.log('Tipo de error:', err.name, '-', err.message);
                    
                    if (err.name === 'NotAllowedError') {
                        showStatus('⚠️ Haz click en la página para permitir audio', 'error');
                    }
                    
                    reject(err);
                });
        }
    });
}

// Función principal para procesar audio
async function processAudio(audioBlob) {
    isProcessing = true;
    orb.classList.remove('listening');
    orb.classList.remove('speaking');
    
    try {
        // 1. Transcribir audio con Whisper
        showStatus('Transcribiendo tu mensaje', 'processing');
        updateOrbText('Transcribiendo...');
        
        const formData = new FormData();
        formData.append('audio', audioBlob, 'audio.webm');
        
        const transcribeResponse = await fetch('/api/transcribe', {
            method: 'POST',
            body: formData
        });
        
        if (!transcribeResponse.ok) {
            throw new Error('Error al transcribir audio');
        }
        
        const { text: transcription } = await transcribeResponse.json();
        
        if (!transcription || transcription.trim() === '') {
            showStatus('No se detectó voz. Intenta de nuevo', 'error');
            updateOrbText('Di "Jarvis" para comenzar');
            isProcessing = false; // Desbloquear
            return;
        }
        
        // Mostrar transcripción
        addMessage(transcription, 'user');
        
        // 2. Obtener respuesta de GPT
        showStatus('Pensando una respuesta', 'processing');
        updateOrbText('Pensando...');
        
        const chatResponse = await fetch('/api/chat', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ message: transcription })
        });
        
        if (!chatResponse.ok) {
            throw new Error('Error al obtener respuesta');
        }
        
        const { response: assistantResponse } = await chatResponse.json();
        
        // Mostrar respuesta
        addMessage(assistantResponse, 'assistant');
        
        // 3. Generar y reproducir audio
        showStatus('Generando voz', 'processing');
        updateOrbText('Generando voz...');
        
        console.log('→ Enviando texto a TTS:', assistantResponse.substring(0, 50) + '...');
        
        const ttsResponse = await fetch('/api/speak', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ text: assistantResponse })
        });
        
        console.log('← Respuesta TTS recibida:', ttsResponse.status, ttsResponse.statusText);
        
        if (!ttsResponse.ok) {
            const errorText = await ttsResponse.text();
            console.error('Error del servidor TTS:', errorText);
            throw new Error('Error al generar audio: ' + ttsResponse.status);
        }
        
        const audioResponseBlob = await ttsResponse.blob();
        
        console.log('Audio TTS recibido, tamaño:', audioResponseBlob.size, 'bytes', 'tipo:', audioResponseBlob.type);
        
        showStatus('Reproduciendo respuesta', 'processing');
        updateOrbText('Hablando...');
        orb.classList.add('speaking');
        
        try {
            await playAudio(audioResponseBlob);
            console.log('Audio reproducido completamente');
        } catch (audioError) {
            console.error('Error al reproducir:', audioError);
            showStatus('Error al reproducir audio', 'error');
        }
        
        orb.classList.remove('speaking');
        
        showStatus('Di "Jarvis" cuando necesites algo', 'success');
        updateOrbText('Di "Jarvis" para comenzar');
        
    } catch (error) {
        console.error('Error:', error);
        showStatus(`Error: ${error.message}`, 'error');
        updateOrbText('Di "Jarvis" para comenzar');
        orb.classList.remove('speaking');
    } finally {
        isProcessing = false;
    }
}

// Función para iniciar grabación (función legacy, ya no se usa con botones)
async function startRecording() {
    // Redirigir a startRecordingAuto
    startRecordingAuto();
}

// Función para detener grabación (función legacy)
function stopRecording() {
    if (mediaRecorder && isRecording) {
        mediaRecorder.stop();
        isRecording = false;
        orb.classList.remove('listening');
        showStatus('Procesando audio', 'processing');
        updateOrbText('Procesando...');
    }
}


// Variable para saber si el audio está desbloqueado
let audioUnlocked = false;

// Función para desbloquear audio en el navegador
async function unlockAudio() {
    if (audioUnlocked) return true;
    
    try {
        // Crear y reproducir un silencio breve para desbloquear el audio
        if (!audioContext) {
            audioContext = new (window.AudioContext || window.webkitAudioContext)();
        }
        
        if (audioContext.state === 'suspended') {
            await audioContext.resume();
        }
        
        // Crear un buffer de silencio
        const buffer = audioContext.createBuffer(1, 1, 22050);
        const source = audioContext.createBufferSource();
        source.buffer = buffer;
        source.connect(audioContext.destination);
        source.start(0);
        
        audioUnlocked = true;
        console.log('✓ Audio desbloqueado en el navegador');
        return true;
    } catch (e) {
        console.log('No se pudo desbloquear audio:', e);
        return false;
    }
}

// Inicializar reconocimiento de voz para "Jarvis"
function initVoiceActivation() {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    
    if (!SpeechRecognition) {
        console.log('Web Speech API no disponible');
        showStatus('Reconocimiento de voz no disponible en este navegador', 'error');
        return;
    }
    
    recognition = new SpeechRecognition();
    recognition.continuous = true;
    recognition.interimResults = false;
    recognition.lang = 'es-ES';
    
    recognition.onstart = () => {
        recognitionActive = true;
        console.log('✓ Reconocimiento de voz ACTIVO - di "Jarvis" cuando quieras');
    };
    
    recognition.onresult = (event) => {
        const last = event.results.length - 1;
        const text = event.results[last][0].transcript.toLowerCase().trim();
        
        console.log('🎤 Escuchado:', '"' + text + '"');
        
        // Detectar "Jarvis" o variaciones (MUY permisivo)
        const activationWords = [
            'jarvis', 'harris', 'yarviz', 'jarvi', 'jarviz', 'harvis', 'yarvis',
            'jarbs', 'jarbis', 'jarbs', 'yarbis', 'harviz', 'jarvix',
            'cervix', 'harvey', 'serviz', 'charviz' // Más variaciones comunes
        ];
        
        const shouldActivate = activationWords.some(word => text.includes(word));
        
        console.log('¿Contiene palabra de activación?', shouldActivate);
        
        if (shouldActivate) {
            console.log('✓✓✓ ¡JARVIS DETECTADO!', text);
            
            // Activar SIEMPRE, cancelando cualquier proceso anterior si es necesario
            if (isRecording && mediaRecorder && mediaRecorder.state === 'recording') {
                // Detener grabación actual
                mediaRecorder.stop();
                isRecording = false;
            }
            
            if (!isProcessing) {
                playBeep();
                showStatus('¡A sus órdenes!', 'success');
                updateOrbText('¿Qué necesita, Jefe?');
                
                setTimeout(() => {
                    startRecordingAuto();
                }, 500);
            } else {
                console.log('Procesando respuesta anterior, espere un momento...');
                showStatus('Un momento, Jefe...', 'processing');
            }
        }
    };
    
    recognition.onerror = (event) => {
        console.log('Error en reconocimiento:', event.error);
        
        // Ignorar errores comunes que no son críticos
        if (event.error === 'no-speech' || event.error === 'aborted') {
            return;
        }
        
        if (event.error === 'not-allowed' || event.error === 'service-not-allowed') {
            showStatus('⚠️ Permite el acceso al micrófono', 'error');
            updateOrbText('Click para activar');
        }
    };
    
    recognition.onend = () => {
        recognitionActive = false;
        console.log('Reconocimiento finalizado, reiniciando en 500ms...');
        
        // SIEMPRE reiniciar automáticamente para escuchar continuamente
        setTimeout(() => {
            if (!isRecording && !recognitionActive) {  // Solo reiniciar si no está activo
                try {
                    recognition.start();
                    console.log('✓ Reconocimiento reiniciado - escuchando "Jarvis"');
                } catch (e) {
                    console.log('No se pudo reiniciar (probablemente ya activo):', e.message);
                }
            }
        }, 500);
    };
    
    // Pedir permisos de micrófono y desbloquear audio al inicio
    navigator.mediaDevices.getUserMedia({ audio: true })
        .then(stream => {
            // Detener el stream inmediatamente, solo queríamos el permiso
            stream.getTracks().forEach(track => track.stop());
            
            console.log('✓ Permiso de micrófono concedido');
            
            // Desbloquear audio
            return unlockAudio();
        })
        .then(() => {
            // Iniciar reconocimiento
            if (!recognitionActive) {
                try {
                    recognition.start();
                    showStatus('🎧 Escuchando "Jarvis"...', 'processing');
                    updateOrbText('Di "Jarvis" cuando necesites algo');
                    console.log('✓ Reconocimiento de voz iniciado correctamente');
                } catch (e) {
                    console.log('No se pudo iniciar (puede estar ya activo):', e.message);
                    showStatus('🎧 Escuchando "Jarvis"...', 'processing');
                }
            }
        })
        .catch(e => {
            console.error('Error al obtener permisos:', e);
            showStatus('⚠️ Haz click en el orbe para activar', 'error');
            updateOrbText('Click para activar');
            
            // Permitir activación manual con click
            orb.style.cursor = 'pointer';
        });
}

// Función para hacer un beep de confirmación
function playBeep() {
    const audioContext = new (window.AudioContext || window.webkitAudioContext)();
    const oscillator = audioContext.createOscillator();
    const gainNode = audioContext.createGain();
    
    oscillator.connect(gainNode);
    gainNode.connect(audioContext.destination);
    
    oscillator.frequency.value = 800;
    oscillator.type = 'sine';
    
    gainNode.gain.setValueAtTime(0.3, audioContext.currentTime);
    gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.1);
    
    oscillator.start(audioContext.currentTime);
    oscillator.stop(audioContext.currentTime + 0.1);
}

// Función para grabar automáticamente después de "Jarvis"
async function startRecordingAuto() {
    if (isRecording || isProcessing) return;
    
    try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        
        // Iniciar visualización
        visualizeAudio(stream);
        
        mediaRecorder = new MediaRecorder(stream, {
            mimeType: 'audio/webm'
        });
        
        audioChunks = [];
        
        mediaRecorder.ondataavailable = (event) => {
            if (event.data.size > 0) {
                audioChunks.push(event.data);
            }
        };
        
        mediaRecorder.onstop = async () => {
            const audioBlob = new Blob(audioChunks, { type: 'audio/webm' });
            stream.getTracks().forEach(track => track.stop());
            stopVisualization();
            await processAudio(audioBlob);
        };
        
        mediaRecorder.start();
        isRecording = true;
        orb.classList.add('listening');
        updateOrbText('Te estoy escuchando...');
        
        // Grabar por 5 segundos automáticamente
        setTimeout(() => {
            if (isRecording && mediaRecorder && mediaRecorder.state === 'recording') {
                stopRecording();
            }
        }, 5000);
        
    } catch (error) {
        console.error('Error al grabar:', error);
        showStatus('Error al acceder al micrófono', 'error');
        updateOrbText('Error de micrófono');
    }
}

// Función para detener grabación
function stopRecording() {
    if (mediaRecorder && isRecording) {
        mediaRecorder.stop();
        isRecording = false;
        orb.classList.remove('listening');
        showStatus('Procesando audio', 'processing');
        updateOrbText('Procesando...');
    }
}

// Función para hacer un beep de confirmación
function playBeep() {
    try {
        const audioContext = new (window.AudioContext || window.webkitAudioContext)();
        const oscillator = audioContext.createOscillator();
        const gainNode = audioContext.createGain();
        
        oscillator.connect(gainNode);
        gainNode.connect(audioContext.destination);
        
        oscillator.frequency.value = 800;
        oscillator.type = 'sine';
        
        gainNode.gain.setValueAtTime(0.3, audioContext.currentTime);
        gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.1);
        
        oscillator.start(audioContext.currentTime);
        oscillator.stop(audioContext.currentTime + 0.1);
    } catch (e) {
        console.log('No se pudo reproducir beep');
    }
}

// Click en el orbe para activar manualmente
orb.addEventListener('click', async () => {
    console.log('Click en el orbe');
    
    // Desbloquear audio primero
    await unlockAudio();
    
    // Si el reconocimiento no está activo, iniciarlo
    if (recognition && !recognitionActive) {
        try {
            recognition.start();
            showStatus('🎧 Escuchando "Jarvis"...', 'processing');
            updateOrbText('Di "Jarvis" para comenzar');
            console.log('Reconocimiento iniciado manualmente');
        } catch (e) {
            console.log('No se pudo iniciar:', e.message);
        }
    } else if (recognitionActive) {
        console.log('Reconocimiento ya está activo');
    }
    
    // También permite grabación directa
    if (!isRecording && !isProcessing) {
        playBeep();
        showStatus('¡Habla ahora!', 'success');
        updateOrbText('Te escucho...');
        setTimeout(() => {
            startRecordingAuto();
        }, 500);
    }
});

// Inicializar al cargar
initVoiceActivation();
