from typing import List
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    APP_NAME: str = "RythuBandhu API"
    APP_ENV: str = "development"
    API_V1_PREFIX: str = "/api/v1"
    
    # CORS Configuration
    CORS_ORIGINS: List[str] = [
        "http://localhost:5173",
        "http://127.0.0.1:5173",
        "http://localhost:3000",
    ]
    
    # Supabase Configuration
    SUPABASE_URL: str = ""
    SUPABASE_KEY: str = ""
    
    # Google Gemini & Google AI Configuration
    GEMINI_API_KEY: str = ""
    GEMINI_API_KEYS: str = ""
    GOOGLE_API_KEY: str = ""
    LLM_MODEL_NAME: str = "gemini-3.5-flash"
    
    def get_gemini_keys(self) -> List[str]:
        """
        Returns a list of all configured valid Gemini API keys for rotation and rate-limit fallback.
        Filters out dummy placeholders.
        """
        keys = []
        raw_candidates = []
        if self.GEMINI_API_KEY and self.GEMINI_API_KEY.strip():
            raw_candidates.append(self.GEMINI_API_KEY.strip())
        if self.GOOGLE_API_KEY and self.GOOGLE_API_KEY.strip():
            raw_candidates.append(self.GOOGLE_API_KEY.strip())
        if self.GEMINI_API_KEYS and self.GEMINI_API_KEYS.strip():
            raw_candidates.extend([k.strip() for k in self.GEMINI_API_KEYS.split(",") if k.strip()])
            
        for k in raw_candidates:
            # Ignore obvious placeholders
            if k.lower() in ["key1_here", "key2_here", "key3_here", "your_api_key", "your_key", ""]:
                continue
            if k not in keys:
                keys.append(k)
        return keys

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore"
    )


settings = Settings()
