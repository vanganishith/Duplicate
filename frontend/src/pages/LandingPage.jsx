import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useLanguage } from '../context/LanguageContext';
import NearbyCommunityIssues from '../components/NearbyCommunityIssues';

const PRESET_REGIONS = {
  warangal: { name: 'Warangal Agricultural Heartland', lat: 17.9689, lng: 79.5941 },
  nalgonda: { name: 'Nalgonda District', lat: 17.0575, lng: 79.2684 },
  khammam: { name: 'Khammam District', lat: 17.2473, lng: 80.1514 },
  karimnagar: { name: 'Karimnagar District', lat: 18.4386, lng: 79.1288 },
  nizamabad: { name: 'Nizamabad District', lat: 18.6725, lng: 78.0941 },
  hyderabad: { name: 'Rangareddy / Hyderabad Rural', lat: 17.3850, lng: 78.4867 },
};

export default function LandingPage() {
  const { t, currentLang } = useLanguage();

  // 3 KM Community Radar Location State
  const [selectedRegion, setSelectedRegion] = useState('warangal');
  const [radarLat, setRadarLat] = useState(17.9689);
  const [radarLng, setRadarLng] = useState(79.5941);
  const [locName, setLocName] = useState('Warangal Agricultural Heartland');
  const [isDetectingGps, setIsDetectingGps] = useState(false);

  const handleRegionChange = (e) => {
    const key = e.target.value;
    setSelectedRegion(key);
    if (PRESET_REGIONS[key]) {
      setRadarLat(PRESET_REGIONS[key].lat);
      setRadarLng(PRESET_REGIONS[key].lng);
      setLocName(PRESET_REGIONS[key].name);
    }
  };

  const handleDetectGps = () => {
    if (!navigator.geolocation) {
      alert('Geolocation is not supported by your browser.');
      return;
    }
    setIsDetectingGps(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setRadarLat(pos.coords.latitude);
        setRadarLng(pos.coords.longitude);
        setLocName('Your Detected GPS Location');
        setSelectedRegion('custom');
        setIsDetectingGps(false);
      },
      (err) => {
        console.warn('GPS detection failed:', err);
        setIsDetectingGps(false);
        alert('Could not detect exact GPS location. Showing default agricultural region.');
      },
      { timeout: 8000 }
    );
  };

  return (
    <div className="landing-page">
      {/* 1. HERO SECTION */}
      <section className="hero-section">
        <div className="hero-container">
          <div className="hero-content">
            <div className="hero-pill-badge">
              <span className="badge-leaf">🌱</span>
              <span>{t.heroBadge}</span>
            </div>

            <h1 className="hero-main-title">
              <span className="hero-brand-name">KisaanSathi</span>
              <span className="hero-headline-text">{t.heroTitle}</span>
            </h1>

            <p className="hero-tagline">
              {t.heroDescription}
            </p>

            <div className="hero-actions">
              <Link to="/report" className="btn btn-hero-primary">
                <span>{t.heroCta}</span>
              </Link>
            </div>

            <div className="hero-voice-note">
              <span className="voice-mic-icon">🎙️</span>
              <span className="voice-hint-text">{t.heroAudioHint}</span>
            </div>
          </div>

          <div className="hero-visual-wrapper">
            {/* Farmer Photo */}
            <div className="hero-photo-card">
              <img
                src="/images/hero_farmer.jpg"
                alt="Farmer using KisaanSathi mobile app in field"
                className="hero-farmer-img"
              />
            </div>

            {/* Mobile App Interactive Mockup */}
            <div className="phone-mockup-floating">
              <div className="phone-bezel">
                <div className="phone-speaker"></div>
                <div className="phone-screen">
                  <div className="phone-header">
                    <span className="phone-brand">🌱 KisaanSathi</span>
                    <span className="phone-signal">5G 📶</span>
                  </div>

                  <div className="phone-body">
                    <div className="phone-greeting">
                      <h4>
                        {currentLang === 'te'
                          ? 'నమస్కారం రైతు గారు!'
                          : currentLang === 'hi'
                          ? 'नमस्ते किसान भाई!'
                          : currentLang === 'ta'
                          ? 'வணக்கம் உழவர் தோழரே!'
                          : 'Hello Farmer!'}
                      </h4>
                      <p>
                        {currentLang === 'te'
                          ? 'మీ సమస్యను రికార్డ్ చేయండి'
                          : currentLang === 'hi'
                          ? 'अपनी समस्या रिकॉर्ड करें'
                          : currentLang === 'ta'
                          ? 'சிக்கலைப் பதிவு செய்யவும்'
                          : 'Record your crop issue'}
                      </p>
                    </div>

                    <div className="phone-mic-container">
                      <div className="phone-mic-pulse"></div>
                      <Link to="/report" className="phone-mic-btn" title="Record Voice">
                        <svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"></path>
                          <path d="M19 10v2a7 7 0 0 1-14 0v-2"></path>
                          <line x1="12" y1="19" x2="12" y2="23"></line>
                          <line x1="8" y1="23" x2="16" y2="23"></line>
                        </svg>
                      </Link>
                    </div>

                    <p className="phone-mic-sub">
                      {currentLang === 'te'
                        ? 'రికార్డ్ చేయడానికి నొక్కండి'
                        : currentLang === 'hi'
                        ? 'बोलने के लिए टैप करें'
                        : currentLang === 'ta'
                        ? 'பேசத் தட்டவும்'
                        : 'Tap to speak & record'}
                    </p>

                    <div className="phone-divider">
                      <span>{currentLang === 'te' ? 'లేదా టైప్ చేయండి' : 'OR TYPE'}</span>
                    </div>

                    <div className="phone-input-fake">
                      <span>{currentLang === 'te' ? 'మీ సమస్యను ఇక్కడ టైప్ చేయండి...' : 'Type issue here...'}</span>
                    </div>

                    <Link to="/report" className="phone-submit-btn">
                      {currentLang === 'te' ? 'పంపండి' : currentLang === 'hi' ? 'सबमिट करें' : 'Submit'}
                    </Link>
                  </div>

                  <div className="phone-bottom-nav">
                    <span className="phone-nav-item active">🏠 {t.navHome}</span>
                    <span className="phone-nav-item">📋 {currentLang === 'te' ? 'చరిత్ర' : 'History'}</span>
                    <span className="phone-nav-item">👨‍🌾 {currentLang === 'te' ? 'నిపుణులు' : 'AEO'}</span>
                    <span className="phone-nav-item">👤 {currentLang === 'te' ? 'ప్రొఫైల్' : 'Profile'}</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* 2. LIVE 3 KM NEARBY COMMUNITY ISSUES RADAR */}
      <section className="home-community-radar-section" id="community-radar">
        <div className="section-header-center">
          <div className="hero-pill-badge" style={{ margin: '0 auto 10px auto' }}>
            <span className="badge-leaf">📍</span>
            <span>{currentLang === 'te' ? 'ప్రత్యక్ష 3 కి.మీ కమ్యూనిటీ సమస్యలు' : 'LIVE 3 KM COMMUNITY RADAR'}</span>
          </div>
          <h2 className="section-heading">
            {currentLang === 'te' ? 'మీ ప్రాంతంలో ఇతర రైతులు ఎదుర్కొంటున్న సమస్యలు' : 'Nearby Agricultural Issues & Local Alerts'}
          </h2>
          <p className="section-subheading">
            {currentLang === 'te'
              ? 'మీ పొలం నుండి 3 కిలోమీటర్ల పరిధిలోని సమస్యలను చూడండి. మీకూ అదే సమస్య ఉంటే "Me Too" నొక్కి ఆఫీసర్‌కు తెలియజేయండి.'
              : 'Real-time agricultural reports within 3 km of your farm. If you face the same problem, tap "Me Too" to alert the officer without creating a duplicate case.'}
          </p>
        </div>

        <div className="radar-container">
          <div className="radar-location-bar">
            <div className="radar-location-info">
              <span className="radar-pin-icon">📍</span>
              <div className="radar-loc-text">
                <span className="loc-label">{currentLang === 'te' ? 'ఎంచుకున్న ప్రాంతం:' : 'Selected Location:'}</span>
                <strong>{locName}</strong>
                <span className="loc-coords">({radarLat.toFixed(4)}, {radarLng.toFixed(4)})</span>
              </div>
            </div>

            <div className="radar-quick-locs">
              <button
                type="button"
                className="btn btn-sm btn-outline btn-radar-gps"
                onClick={handleDetectGps}
                disabled={isDetectingGps}
              >
                {isDetectingGps ? '🔄 Locating...' : '🎯 Detect My GPS'}
              </button>

              <select
                className="radar-region-select"
                value={selectedRegion}
                onChange={handleRegionChange}
              >
                <option value="warangal">Warangal (Heartland)</option>
                <option value="nalgonda">Nalgonda</option>
                <option value="khammam">Khammam</option>
                <option value="karimnagar">Karimnagar</option>
                <option value="nizamabad">Nizamabad</option>
                <option value="hyderabad">Rangareddy / Hyderabad Rural</option>
                {selectedRegion === 'custom' && <option value="custom">📍 Detected GPS Location</option>}
              </select>
            </div>
          </div>

          <div className="radar-feed-wrap">
            <NearbyCommunityIssues
              latitude={radarLat}
              longitude={radarLng}
              crop=""
              farmerPhone=""
              farmerName="Nearby Farmer"
            />
          </div>
        </div>
      </section>

      {/* 3. USER FLOW / HOW IT WORKS (మా పని విధానం) */}
      <section className="workflow-section">
        <div className="section-header-center">
          <h2 className="section-heading">{t.howItWorksTitle}</h2>
          <p className="section-subheading">{t.howItWorksSubtitle}</p>
        </div>

        <div className="workflow-steps-track">
          {/* Step 1 */}
          <div className="workflow-step-card">
            <div className="step-icon-circle step-icon-mic">
              <span className="step-symbol">🎙️</span>
            </div>
            <div className="step-step-badge">{t.step1Num}</div>
            <h3 className="workflow-step-title">{t.step1Title}</h3>
            <p className="workflow-step-desc">{t.step1Text}</p>
          </div>

          <div className="workflow-arrow-connector">➔</div>

          {/* Step 2 */}
          <div className="workflow-step-card">
            <div className="step-icon-circle step-icon-ai">
              <span className="step-symbol">🤖</span>
            </div>
            <div className="step-step-badge">{t.step2Num}</div>
            <h3 className="workflow-step-title">{t.step2Title}</h3>
            <p className="workflow-step-desc">{t.step2Text}</p>
          </div>

          <div className="workflow-arrow-connector">➔</div>

          {/* Step 3 */}
          <div className="workflow-step-card">
            <div className="step-icon-circle step-icon-expert">
              <span className="step-symbol">👨‍🌾</span>
            </div>
            <div className="step-step-badge">{t.step3Num}</div>
            <h3 className="workflow-step-title">{t.step3Title}</h3>
            <p className="workflow-step-desc">{t.step3Text}</p>
          </div>

          <div className="workflow-arrow-connector">➔</div>

          {/* Step 4 */}
          <div className="workflow-step-card">
            <div className="step-icon-circle step-icon-crop">
              <span className="step-symbol">🌱</span>
            </div>
            <div className="step-step-badge">{t.step4Num}</div>
            <h3 className="workflow-step-title">{t.step4Title}</h3>
            <p className="workflow-step-desc">{t.step4Text}</p>
          </div>
        </div>
      </section>

      {/* 3. AI MULTIMODAL FEATURE DEEP DIVE (AI శక్తీతో వ్యవసాయానికి కొత్త దారి) */}
      <section className="ai-feature-showcase-section">
        <div className="ai-feature-card">
          <div className="ai-feature-content">
            <div className="ai-feature-icon-badge">
              <svg viewBox="0 0 24 24" width="36" height="36" fill="none" stroke="#16a34a" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 2a4 4 0 0 0-4 4v1H6a2 2 0 0 0-2 2v2a2 2 0 0 0 2 2h2v1a4 4 0 0 0 8 0v-1h2a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-2V6a4 4 0 0 0-4-4z"></path>
                <circle cx="9" cy="10" r="1"></circle>
                <circle cx="15" cy="10" r="1"></circle>
                <path d="M9.5 15a3.5 3.5 0 0 0 5 0"></path>
              </svg>
            </div>

            <h2 className="ai-feature-heading">{t.aiFeatureTitle}</h2>
            <p className="ai-feature-description">{t.aiFeatureDesc}</p>

            <ul className="ai-feature-checklist">
              <li>
                <span className="check-bullet">✓</span>
                <span>{t.aiFeature1}</span>
              </li>
              <li>
                <span className="check-bullet">✓</span>
                <span>{t.aiFeature2}</span>
              </li>
              <li>
                <span className="check-bullet">✓</span>
                <span>{t.aiFeature3}</span>
              </li>
              <li>
                <span className="check-bullet">✓</span>
                <span>{t.aiFeature4}</span>
              </li>
            </ul>

            <div className="ai-feature-cta-row">
              <Link to="/report" className="btn btn-primary">
                {t.heroCta}
              </Link>
            </div>
          </div>

          <div className="ai-feature-media">
            <div className="ai-media-frame">
              <img
                src="/images/crop_scan.jpg"
                alt="Farmer scanning crop leaf with smartphone video and camera"
                className="ai-media-img"
              />
              <div className="ai-media-tag">
                <span className="ai-tag-pulse"></span>
                <span>{currentLang === 'te' ? 'వీడియో & ఫోటో స్కాన్ మోడ్' : 'Video & Photo AI Scanner'}</span>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* 4. COMPARISON SECTION (సంప్రదాయ విధానాలతో పోలిస్తే మనం ఎందుకు మెరుగ్గా?) */}
      <section className="comparison-section">
        <div className="section-header-center">
          <h2 className="section-heading">{t.comparisonTitle}</h2>
          <p className="section-subheading">{t.comparisonSubtitle}</p>
        </div>

        <div className="comparison-wrapper">
          <div className="comparison-card-grid">
            {/* Traditional Card */}
            <div className="comp-card comp-card-traditional">
              <div className="comp-card-header">
                <span className="comp-header-badge red-badge">❌ {t.traditionalTitle}</span>
              </div>
              <ul className="comp-list comp-list-bad">
                <li>
                  <span className="comp-icon red-x">✕</span>
                  <span>{t.traditionalItem1}</span>
                </li>
                <li>
                  <span className="comp-icon red-x">✕</span>
                  <span>{t.traditionalItem2}</span>
                </li>
                <li>
                  <span className="comp-icon red-x">✕</span>
                  <span>{t.traditionalItem3}</span>
                </li>
                <li>
                  <span className="comp-icon red-x">✕</span>
                  <span>{t.traditionalItem4}</span>
                </li>
              </ul>
            </div>

            {/* VS Badge */}
            <div className="comp-vs-badge">
              <span>VS</span>
            </div>

            {/* KisaanSathi Card */}
            <div className="comp-card comp-card-kisaan">
              <div className="comp-card-header">
                <span className="comp-header-badge green-badge">🌱 {t.kisaanTitle}</span>
              </div>
              <ul className="comp-list comp-list-good">
                <li>
                  <span className="comp-icon green-check">✓</span>
                  <span>{t.kisaanItem1}</span>
                </li>
                <li>
                  <span className="comp-icon green-check">✓</span>
                  <span>{t.kisaanItem2}</span>
                </li>
                <li>
                  <span className="comp-icon green-check">✓</span>
                  <span>{t.kisaanItem3}</span>
                </li>
                <li>
                  <span className="comp-icon green-check">✓</span>
                  <span>{t.kisaanItem4}</span>
                </li>
              </ul>
            </div>
          </div>

          {/* Satisfied Farmer Photo */}
          <div className="comp-photo-wrapper">
            <img
              src="/images/farmer_success.jpg"
              alt="Satisfied farmer in green field with crop mobile advisory"
              className="comp-farmer-photo"
            />
          </div>
        </div>
      </section>

      {/* 5. TRUST METRICS STRIP */}
      <section className="metrics-strip-section">
        <div className="metrics-container">
          <div className="metric-box">
            <div className="metric-icon-wrap">👥</div>
            <div className="metric-text-wrap">
              <div className="metric-val">{t.stat1Value}</div>
              <div className="metric-lbl">{t.stat1Label}</div>
            </div>
          </div>

          <div className="metric-box">
            <div className="metric-icon-wrap">💬</div>
            <div className="metric-text-wrap">
              <div className="metric-val">{t.stat2Value}</div>
              <div className="metric-lbl">{t.stat2Label}</div>
            </div>
          </div>

          <div className="metric-box">
            <div className="metric-icon-wrap">🌱</div>
            <div className="metric-text-wrap">
              <div className="metric-val">{t.stat3Value}</div>
              <div className="metric-lbl">{t.stat3Label}</div>
            </div>
          </div>

          <div className="metric-box">
            <div className="metric-icon-wrap">🛡️</div>
            <div className="metric-text-wrap">
              <div className="metric-val">{t.stat4Value}</div>
              <div className="metric-lbl">{t.stat4Label}</div>
            </div>
          </div>
        </div>
      </section>

      {/* 6. BOTTOM CTA BANNER (మీ పంట సమస్యకు ఇక వెయిట్ చేయాల్సిన అవసరం లేదు!) */}
      <section className="cta-banner-section">
        <div className="cta-banner-card">
          <div className="cta-banner-left">
            <div className="cta-farmer-avatar">
              <span className="farmer-emoji">👨‍🌾</span>
            </div>
            <div className="cta-text-content">
              <h3 className="cta-banner-title">{t.ctaBannerTitle}</h3>
              <p className="cta-banner-subtitle">{t.ctaBannerSubtitle}</p>
            </div>
          </div>

          <div className="cta-banner-right">
            <Link to="/report" className="btn btn-cta-register">
              {t.ctaBannerBtn}
            </Link>
          </div>
        </div>
      </section>
    </div>
  );
}
