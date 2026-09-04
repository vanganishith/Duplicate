import React from 'react';
import { useLanguage } from '../context/LanguageContext';

export default function LanguageSelector() {
  const { currentLang, changeLanguage, languages } = useLanguage();

  return (
    <div className="language-selector-wrapper">
      <span className="language-icon" title="Select Language">🌐</span>
      <select
        className="language-dropdown"
        value={currentLang}
        onChange={(e) => changeLanguage(e.target.value)}
        aria-label="Select Language"
      >
        {languages.map((lang) => (
          <option key={lang.code} value={lang.code}>
            {lang.label} ({lang.name})
          </option>
        ))}
      </select>
    </div>
  );
}
