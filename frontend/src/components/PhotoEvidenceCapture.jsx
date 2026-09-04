import React, { useState, useRef } from 'react';

export default function PhotoEvidenceCapture({
  photos = [], // Array of { file: File, preview: string }
  onPhotosChange,
  // Legacy props for backward compatibility
  photoFile,
  photoPreview,
  onPhotoSelected,
  onPhotoCleared,
  disabled = false,
}) {
  const [isCameraActive, setIsCameraActive] = useState(false);
  const [cameraError, setCameraError] = useState('');
  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const fileInputRef = useRef(null);

  // Normalize active photos list from either new `photos` prop or legacy props
  const activePhotos = photos && photos.length > 0
    ? photos
    : (photoFile && photoPreview ? [{ file: photoFile, preview: photoPreview }] : []);

  const canAddMore = activePhotos.length < 4 && !disabled;

  // Add newly selected photo(s)
  const addPhotos = (newItems) => {
    const updated = [...activePhotos, ...newItems].slice(0, 4);
    if (onPhotosChange) {
      onPhotosChange(updated);
    } else if (onPhotoSelected && updated.length > 0) {
      onPhotoSelected(updated[0].file, updated[0].preview);
    }
  };

  // Remove a photo by index
  const removePhoto = (indexToRemove) => {
    const updated = activePhotos.filter((_, idx) => idx !== indexToRemove);
    if (onPhotosChange) {
      onPhotosChange(updated);
    } else if (onPhotoCleared && updated.length === 0) {
      onPhotoCleared();
    } else if (onPhotoSelected && updated.length > 0) {
      onPhotoSelected(updated[0].file, updated[0].preview);
    }
  };

  // 1. Open live camera stream
  const openCamera = async () => {
    setCameraError('');
    if (!canAddMore) return;
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      setCameraError('Camera is not supported on this browser/device.');
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: 'environment' },
          width: { ideal: 1280 },
          height: { ideal: 720 },
        },
      });

      streamRef.current = stream;
      setIsCameraActive(true);

      setTimeout(() => {
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          videoRef.current.play();
        }
      }, 100);
    } catch (err) {
      console.error('Camera access error:', err);
      setCameraError('Could not access camera. Please allow camera permissions or upload a file.');
    }
  };

  // 2. Capture snapshot from video stream
  const snapPhoto = () => {
    if (!videoRef.current) return;

    const video = videoRef.current;
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth || 640;
    canvas.height = video.videoHeight || 480;

    const ctx = canvas.getContext('2d');
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

    canvas.toBlob((blob) => {
      if (blob) {
        const file = new File([blob], `crop_evidence_${Date.now()}.jpg`, { type: 'image/jpeg' });
        const previewUrl = URL.createObjectURL(blob);
        addPhotos([{ file, preview: previewUrl }]);
        closeCamera();
      }
    }, 'image/jpeg', 0.85);
  };

  const closeCamera = () => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    setIsCameraActive(false);
  };

  // 3. Handle file input change (multiple files allowed up to remaining slots)
  const handleFileChange = (e) => {
    const files = Array.from(e.target.files || []);
    if (!files.length) return;

    const availableSlots = 4 - activePhotos.length;
    const filesToProcess = files.slice(0, availableSlots);

    const newPhotoItems = [];
    let processedCount = 0;

    filesToProcess.forEach((file) => {
      if (file.size > 10 * 1024 * 1024) {
        setCameraError('One or more photos exceed 10MB limit.');
        return;
      }
      const reader = new FileReader();
      reader.onloadend = () => {
        newPhotoItems.push({ file, preview: reader.result });
        processedCount++;
        if (processedCount === filesToProcess.length) {
          addPhotos(newPhotoItems);
        }
      };
      reader.readAsDataURL(file);
    });

    // Reset input so same file can be re-selected if removed
    if (e.target) e.target.value = '';
  };

  const handleDrop = (e) => {
    e.preventDefault();
    if (!canAddMore) return;
    const files = Array.from(e.dataTransfer.files || []).filter((f) => f.type.startsWith('image/'));
    if (!files.length) return;

    const availableSlots = 4 - activePhotos.length;
    const filesToProcess = files.slice(0, availableSlots);

    const newPhotoItems = [];
    let processedCount = 0;

    filesToProcess.forEach((file) => {
      const reader = new FileReader();
      reader.onloadend = () => {
        newPhotoItems.push({ file, preview: reader.result });
        processedCount++;
        if (processedCount === filesToProcess.length) {
          addPhotos(newPhotoItems);
        }
      };
      reader.readAsDataURL(file);
    });
  };

  const handleDragOver = (e) => {
    e.preventDefault();
  };

  return (
    <div className="photo-evidence-wrapper" data-testid="photo-evidence-wrapper">
      <div className="section-label-header">
        <span>1. CROP PHOTO EVIDENCE *</span>
        <span
          className={`photo-count-pill ${activePhotos.length === 0 ? 'photo-count-pill-required' : ''}`}
          data-testid="photo-count-pill"
        >
          {activePhotos.length === 0 ? '0/4 Photos (At least 1 required)' : `${activePhotos.length}/4 Photos`}
        </span>
      </div>

      <div className="photo-evidence-card">
        <div className="photo-header-row">
          <div>
            <h4 className="photo-section-title">Add Crop Photos * (Mandatory: 1 to 4 photos)</h4>
            <p className="photo-section-subtitle">
              Please take or upload at least 1 clear photo of the affected crop (maximum 4 photos allowed).
            </p>
          </div>
        </div>

        {cameraError && (
          <div className="alert alert-error alert-sm" style={{ marginBottom: '12px' }}>
            <span>⚠️ {cameraError}</span>
          </div>
        )}

        {/* Live Camera View */}
        {isCameraActive && (
          <div className="camera-modal-container">
            <div className="camera-viewfinder">
              <video ref={videoRef} autoPlay playsInline muted className="camera-video-feed" />
              <div className="viewfinder-overlay">
                <span className="viewfinder-guide">Center affected crop / leaves in frame</span>
              </div>
            </div>
            <div className="camera-controls">
              <button type="button" onClick={snapPhoto} className="btn btn-primary btn-snap">
                📸 SNAP PHOTO
              </button>
              <button type="button" onClick={closeCamera} className="btn btn-secondary">
                Cancel
              </button>
            </div>
          </div>
        )}

        {/* Action Buttons & Dropzone (when fewer than 4 photos) */}
        {!isCameraActive && canAddMore && (
          <div>
            <div className="photo-action-buttons-row">
              <button
                type="button"
                onClick={openCamera}
                className="btn btn-camera-action"
                disabled={disabled}
                data-testid="open-camera-btn"
              >
                <span className="btn-icon">📷</span>
                <span>OPEN LIVE CAMERA</span>
              </button>

              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="btn btn-gallery-action"
                disabled={disabled}
                data-testid="choose-gallery-btn"
              >
                <span className="btn-icon">📁</span>
                <span>CHOOSE PHOTOS (UP TO 4)</span>
              </button>
            </div>

            {/* Drag and Drop Dropzone */}
            <div
              className="photo-dropzone"
              onClick={() => fileInputRef.current?.click()}
              onDrop={handleDrop}
              onDragOver={handleDragOver}
              data-testid="photo-dropzone"
            >
              <div className="dropzone-cloud-icon">☁️</div>
              <p className="dropzone-primary-text">Click to choose photos or drag &amp; drop images here</p>
              <small className="dropzone-subtext">Optional &bull; Max 4 Photos &bull; JPEG, PNG, WebP up to 10MB each</small>
            </div>
          </div>
        )}

        {/* Max Photos Reached Notice */}
        {!isCameraActive && activePhotos.length >= 4 && (
          <div className="max-photos-banner" data-testid="max-photos-reached-msg">
            <span>✓ Maximum 4 photos selected. You can remove a photo if you wish to replace it.</span>
          </div>
        )}

        {/* Selected Photos Grid Preview */}
        {activePhotos.length > 0 && (
          <div className="multi-photos-preview-grid" data-testid="multi-photos-preview-grid">
            {activePhotos.map((item, index) => (
              <div key={index} className="photo-preview-item" data-testid={`photo-preview-item-${index}`}>
                <img
                  src={item.preview}
                  alt={`Photo ${index + 1}`}
                  className="photo-preview-thumb"
                />
                <div className="photo-preview-item-footer">
                  <span className="photo-item-badge">Photo {index + 1}</span>
                  <button
                    type="button"
                    onClick={() => removePhoto(index)}
                    className="photo-item-remove-btn"
                    disabled={disabled}
                    aria-label={`Remove photo ${index + 1}`}
                    data-testid={`remove-photo-btn-${index}`}
                  >
                    ✕
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Hidden Native File Input (multiple allowed) */}
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          multiple
          onChange={handleFileChange}
          style={{ display: 'none' }}
          data-testid="photo-file-input"
        />
      </div>
    </div>
  );
}
