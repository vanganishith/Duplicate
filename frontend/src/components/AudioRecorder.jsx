import React, { useState, useRef, useEffect } from 'react';
import { useLanguage } from '../context/LanguageContext';
import { performIndicAsr, analyzeConfirmedTranscript } from '../services/api';

export default function AudioRecorder({
  onAudioRecorded,
  onAudioCleared,
  onFinalTranscriptConfirmed,
  onExtractedInsights,
  disabled = false,
  showManualToggle = true,
  onToggleManualText,
  isManualTextVisible = false,
}) {
  const { t, currentLanguage, currentLanguageName } = useLanguage();

  // Recording states
  const [isRecording, setIsRecording] = useState(false);
  const [recordingDuration, setRecordingDuration] = useState(0);
  const [audioUrl, setAudioUrl] = useState(null);
  const [recordedAudioFile, setRecordedAudioFile] = useState(null);
  const [recorderError, setRecorderError] = useState('');

  // 1. LIVE / INTERIM TRANSCRIPT (While speaking)
  const [liveTranscript, setLiveTranscript] = useState('');

  // 2. FINAL AUTHORITATIVE ASR TRANSCRIPT (From IndicConformer)
  const [isProcessingAsr, setIsProcessingAsr] = useState(false);
  const [indicTranscript, setIndicTranscript] = useState('');
  
  // 3. EDIT / VERIFICATION STATES
  const [isEditing, setIsEditing] = useState(false);
  const [editableTranscript, setEditableTranscript] = useState('');
  const [isConfirmed, setIsConfirmed] = useState(false);

  // 4. AGRICULTURAL LLM REASONING
  const [isAnalyzingLlm, setIsAnalyzingLlm] = useState(false);
  const [extractedInsights, setExtractedInsights] = useState(null);

  const mediaRecorderRef = useRef(null);
  const speechRecognitionRef = useRef(null);
  const timerRef = useRef(null);
  const audioChunksRef = useRef([]);

  const speechLangMap = {
    te: 'te-IN',
    en: 'en-IN',
    hi: 'hi-IN',
    ta: 'ta-IN',
    kn: 'kn-IN',
    mr: 'mr-IN',
  };

  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      if (audioUrl) URL.revokeObjectURL(audioUrl);
      if (speechRecognitionRef.current) {
        try {
          speechRecognitionRef.current.abort();
        } catch (e) {}
      }
    };
  }, [audioUrl]);

  // =========================================================================
  // 1. START RECORDING
  // =========================================================================
  const startRecording = async () => {
    setRecorderError('');
    setLiveTranscript('');
    setIndicTranscript('');
    setEditableTranscript('');
    setIsEditing(false);
    setIsConfirmed(false);
    setExtractedInsights(null);
    audioChunksRef.current = [];

    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      setRecorderError(t.voiceUnsupported || 'Voice recording is not supported in this browser.');
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });

      let mimeType = 'audio/webm';
      if (MediaRecorder.isTypeSupported('audio/webm;codecs=opus')) {
        mimeType = 'audio/webm;codecs=opus';
      } else if (MediaRecorder.isTypeSupported('audio/ogg;codecs=opus')) {
        mimeType = 'audio/ogg;codecs=opus';
      } else if (MediaRecorder.isTypeSupported('audio/mp4')) {
        mimeType = 'audio/mp4';
      }

      const mediaRecorder = new MediaRecorder(stream, { mimeType });
      mediaRecorderRef.current = mediaRecorder;

      mediaRecorder.ondataavailable = (event) => {
        if (event.data && event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      };

      mediaRecorder.onstop = async () => {
        stream.getTracks().forEach((track) => track.stop());

        if (audioChunksRef.current.length > 0) {
          const blob = new Blob(audioChunksRef.current, { type: mimeType });
          const url = URL.createObjectURL(blob);
          setAudioUrl(url);

          const audioFile = new File(
            [blob],
            `voice_incident_${Date.now()}.${mimeType.includes('ogg') ? 'ogg' : 'webm'}`,
            { type: mimeType }
          );

          setRecordedAudioFile(audioFile);
          if (onAudioRecorded) {
            onAudioRecorded(audioFile);
          }

          // Authoritative final IndicConformer ASR pass
          await handleFinalIndicConformerAsr(audioFile);
        }
      };

      // LIVE INTERIM PREVIEW (Browser Speech API strictly for visual live feedback)
      const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
      if (SpeechRecognition) {
        try {
          const recognition = new SpeechRecognition();
          recognition.continuous = true;
          recognition.interimResults = true;
          recognition.maxAlternatives = 1;
          recognition.lang = speechLangMap[currentLanguage] || 'te-IN';

          recognition.onresult = (event) => {
            let interimStr = '';
            let finalStr = '';

            for (let i = 0; i < event.results.length; i++) {
              const res = event.results[i];
              if (res.isFinal) {
                finalStr += res[0].transcript + ' ';
              } else {
                interimStr += res[0].transcript;
              }
            }

            const currentLiveText = (finalStr + interimStr).trim();
            if (currentLiveText) {
              setLiveTranscript(currentLiveText);
            }
          };

          recognition.onerror = (e) => {
            console.warn('Interim live preview notice:', e.error);
          };

          recognition.start();
          speechRecognitionRef.current = recognition;
        } catch (recErr) {
          console.warn('Live preview speech API not available in current browser:', recErr);
        }
      }

      mediaRecorder.start(250);
      setIsRecording(true);
      setRecordingDuration(0);

      timerRef.current = setInterval(() => {
        setRecordingDuration((prev) => prev + 1);
      }, 1000);
    } catch (err) {
      console.error('Microphone access error:', err);
      if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
        setRecorderError('Microphone permission denied. Please allow microphone access.');
      } else {
        setRecorderError('Could not start recording. Please check microphone settings.');
      }
    }
  };

  // =========================================================================
  // 2. STOP RECORDING & TRIGGER AUTHORITATIVE INDICCONFORMER ASR
  // =========================================================================
  const stopRecording = () => {
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.stop();
      setIsRecording(false);
      if (timerRef.current) clearInterval(timerRef.current);
    }
    if (speechRecognitionRef.current) {
      try {
        speechRecognitionRef.current.stop();
      } catch (e) {}
    }
  };

  const handleFinalIndicConformerAsr = async (audioFile) => {
    setIsProcessingAsr(true);
    setRecorderError('');
    try {
      const asrResult = await performIndicAsr(audioFile, currentLanguageName);
      const transcript = asrResult?.transcript || '';
      if (!transcript) {
        throw new Error('ASR model returned empty transcript.');
      }
      setIndicTranscript(transcript);
      setEditableTranscript(transcript);
    } catch (err) {
      console.error('IndicConformer ASR error:', err);
      // Use what the farmer ACTUALLY spoke from live microphone stream if available
      if (liveTranscript && liveTranscript.trim()) {
        setIndicTranscript(liveTranscript.trim());
        setEditableTranscript(liveTranscript.trim());
      } else {
        const rawMsg = err?.message || '';
        const userFriendlyMsg = rawMsg.includes('Errno') || rawMsg.includes('decode')
          ? 'Voice recording could not be processed clearly. Please try speaking again or type description below.'
          : rawMsg || 'Voice transcription unavailable. Please type description manually.';
        setRecorderError(userFriendlyMsg);
        setIndicTranscript('');
        setEditableTranscript('');
      }
    } finally {
      setIsProcessingAsr(false);
    }
  };

  // =========================================================================
  // 3. FARMER CONFIRMATION & AGRICULTURAL LLM TRIGGER
  // =========================================================================
  const handleConfirmTranscript = async (textToConfirm) => {
    const finalVerifiedText = (textToConfirm || editableTranscript || indicTranscript).trim();
    if (!finalVerifiedText) return;

    setIsConfirmed(true);
    setIsEditing(false);
    setIsAnalyzingLlm(true);

    if (onFinalTranscriptConfirmed) {
      onFinalTranscriptConfirmed(finalVerifiedText);
    }

    try {
      const insights = await analyzeConfirmedTranscript(finalVerifiedText, currentLanguageName);
      setExtractedInsights(insights);
      if (onExtractedInsights) {
        onExtractedInsights(insights);
      }
    } catch (err) {
      console.warn('Agricultural LLM reasoning note:', err);
    } finally {
      setIsAnalyzingLlm(false);
    }
  };

  const handleReset = () => {
    if (audioUrl) URL.revokeObjectURL(audioUrl);
    setAudioUrl(null);
    setRecordedAudioFile(null);
    setRecordingDuration(0);
    setLiveTranscript('');
    setIndicTranscript('');
    setEditableTranscript('');
    setIsEditing(false);
    setIsConfirmed(false);
    setIsAnalyzingLlm(false);
    setExtractedInsights(null);
    setRecorderError('');
    if (onAudioCleared) {
      onAudioCleared();
    }
  };

  const formatDuration = (seconds) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  return (
    <div className="voice-recorder-card">
      {/* Header with Language Display */}
      <div className="voice-recorder-header">
        <span className="voice-badge-title">🎙️ Voice Complaint</span>
        <span className="voice-language-pill">
          Language: <strong>{currentLanguageName}</strong>
        </span>
      </div>

      {recorderError && (
        <div className="alert alert-error alert-sm" style={{ margin: '10px 14px' }}>
          <span>⚠️ {recorderError}</span>
        </div>
      )}

      {/* STATE 1: Idle Stage */}
      {!isRecording && !audioUrl && (
        <div className="voice-center-stage">
          <button
            type="button"
            onClick={startRecording}
            className="big-circular-mic-btn"
            disabled={disabled}
            aria-label="Start Voice Recording"
          >
            <div className="mic-icon-circle">
              <svg viewBox="0 0 24 24" width="34" height="34" fill="currentColor">
                <path d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3z"/>
                <path d="M17 11c0 2.76-2.24 5-5 5s-5-2.24-5-5H5c0 3.53 2.61 6.43 6 6.92V21h2v-3.08c3.39-.49 6-3.39 6-6.92h-2z"/>
              </svg>
            </div>
          </button>

          <h4 className="mic-cta-title">{t.btnStartRecording || 'Tap to describe issue via voice'}</h4>
          <p className="mic-cta-subtitle">
            {t.voiceHint || 'Speak naturally in your native language (e.g. crop name, leaf symptoms, damage)'}
          </p>
        </div>
      )}

      {/* STATE 2: While Speaking (Live Interim Transcript) */}
      {isRecording && (
        <div className="voice-center-stage recording-mode">
          <div className="recording-status-banner">
            <span className="live-pulse-dot"></span>
            <span className="recording-label">🔴 Recording...</span>
            <span className="live-timer-text">{formatDuration(recordingDuration)}</span>
          </div>

          <div className="live-transcript-box">
            <span className="live-label">LIVE PREVIEW (WHILE SPEAKING):</span>
            <p className="live-text-content">
              {liveTranscript ? `"${liveTranscript}"` : '🎙️ Listening to your voice... Speak now in your language'}
            </p>
          </div>

          <button
            type="button"
            onClick={stopRecording}
            className="btn btn-danger btn-stop-recording"
          >
            ⏹ Stop Recording
          </button>
        </div>
      )}

      {/* STATE 3: Final Processing with AI4Bharat IndicConformer */}
      {isProcessingAsr && (
        <div className="asr-processing-stage">
          <div className="spinner-large"></div>
          <h4>Processing your voice...</h4>
          <p className="asr-processing-subtext">AI4Bharat IndicConformer is performing authoritative final ASR.</p>
        </div>
      )}

      {/* STATE 4: Final Verified Transcript & Farmer Confirmation Stage */}
      {!isRecording && !isProcessingAsr && audioUrl && (
        <div className="voice-playback-stage">
          <div className="playback-header">
            <span className="audio-ready-badge">✓ Complete Voice Audio Preserved</span>
            <span className="audio-duration-badge">{formatDuration(recordingDuration)}</span>
          </div>

          <audio src={audioUrl} controls className="audio-player-element" />

          {/* FINAL AUTHORITATIVE ASR TRANSCRIPT VERIFICATION CARD */}
          {(editableTranscript || indicTranscript) ? (
            <div className="final-transcript-verification-card">
              <div className="verification-card-header">
                <span className="understood-header-text">✓ We understood your message as:</span>
                <span className="asr-model-badge">AI4Bharat IndicConformer</span>
              </div>

              {/* View Mode */}
              {!isEditing && (
                <div className="transcript-display-area">
                  <p className="authoritative-transcript-text">
                    "{editableTranscript || indicTranscript}"
                  </p>
                </div>
              )}

              {/* Edit Mode */}
              {isEditing && (
                <div className="transcript-edit-area">
                  <label className="edit-label">Correct or refine your spoken words:</label>
                  <textarea
                    className="form-textarea edit-transcript-input"
                    rows={3}
                    value={editableTranscript}
                    onChange={(e) => setEditableTranscript(e.target.value)}
                    placeholder="Edit spoken transcript in your language..."
                  />
                </div>
              )}

              {/* Action Buttons: [ ✏️ Edit ] [ 🔄 Record Again ] [ ✓ Confirm ] */}
              {!isConfirmed && (
                <div className="transcript-verification-actions">
                  {!isEditing ? (
                    <button
                      type="button"
                      onClick={() => setIsEditing(true)}
                      className="btn btn-secondary btn-sm"
                    >
                      ✏️ Edit
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setIsEditing(false)}
                      className="btn btn-outline-secondary btn-sm"
                    >
                      Cancel Edit
                    </button>
                  )}

                  <button
                    type="button"
                    onClick={handleReset}
                    className="btn btn-outline-danger btn-sm"
                    disabled={disabled}
                  >
                    🔄 Record Again
                  </button>

                  <button
                    type="button"
                    onClick={() => handleConfirmTranscript(editableTranscript)}
                    className="btn btn-primary btn-sm btn-confirm-transcript"
                  >
                    ✓ Confirm
                  </button>
                </div>
              )}

              {/* Confirmed State Notice */}
              {isConfirmed && (
                <div className="confirmed-status-badge">
                  <span>✓ Transcript Confirmed by Farmer</span>
                  <button
                    type="button"
                    onClick={() => setIsConfirmed(false)}
                    className="btn-change-transcript"
                  >
                    (Modify)
                  </button>
                </div>
              )}
            </div>
          ) : (
            <div className="playback-actions" style={{ marginTop: '12px' }}>
              <button
                type="button"
                onClick={startRecording}
                className="btn btn-secondary btn-sm"
                disabled={disabled}
              >
                🔄 Re-record
              </button>
              <button
                type="button"
                onClick={handleReset}
                className="btn btn-outline-danger btn-sm"
                disabled={disabled}
              >
                🗑 Remove Audio
              </button>
            </div>
          )}

          {/* AGRICULTURAL LLM REASONING RESULTS (ONLY AFTER CONFIRMATION) */}
          {isAnalyzingLlm && (
            <div className="ai-processing-notice">
              <span className="spinner-small"></span>
              <span>Agricultural LLM analyzing confirmed text for crop & symptoms...</span>
            </div>
          )}

          {isConfirmed && extractedInsights && (
            <div className="live-extracted-badges">
              {extractedInsights.crop_detected && (
                <div className="extracted-badge-item">
                  <span className="badge-title">Crop:</span>
                  <span className="badge-tag green">{extractedInsights.crop_detected}</span>
                </div>
              )}

              {extractedInsights.symptoms && extractedInsights.symptoms.length > 0 && (
                <div className="extracted-badge-item">
                  <span className="badge-title">Symptoms:</span>
                  <div className="badge-group">
                    {extractedInsights.symptoms.map((s, idx) => (
                      <span key={idx} className="badge-tag blue">{s}</span>
                    ))}
                  </div>
                </div>
              )}

              {extractedInsights.possible_conditions && extractedInsights.possible_conditions.length > 0 && (
                <div className="extracted-badge-item">
                  <span className="badge-title">Preliminary Possibility:</span>
                  <div className="badge-group">
                    {extractedInsights.possible_conditions.map((c, idx) => (
                      <span key={idx} className="badge-tag yellow">{c}</span>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Optional Manual Text Area Toggle */}
      {showManualToggle && (
        <div className="manual-typing-toggle">
          <button
            type="button"
            onClick={onToggleManualText}
            className="toggle-link-btn"
          >
            ✍️ {isManualTextVisible ? 'Hide manual text box' : 'Prefer typing descriptions manually?'}
          </button>
        </div>
      )}
    </div>
  );
}
