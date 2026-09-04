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
        "http://localhost:5174",
        "http://127.0.0.1:5174",
        "http://localhost:5175",
        "http://127.0.0.1:5175",
        "http://localhost:3000",
        "http://127.0.0.1:3000",
    ]
    
    # Supabase Configuration
    SUPABASE_URL: str = ""
    SUPABASE_KEY: str = ""
    
    # Featherless AI Configuration (Qwen/Qwen3-VL-30B-A3B-Instruct)
    FEATHERLESS_API_KEY: str = ""
    FEATHERLESS_BASE_URL: str = "https://api.featherless.ai/v1"
    FEATHERLESS_MODEL_NAME: str = "Qwen/Qwen3-VL-30B-A3B-Instruct"
    GOOGLE_API_KEY: str = ""

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore"
    )


settings = Settings()
