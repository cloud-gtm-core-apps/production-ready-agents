from pydantic_settings import BaseSettings, SettingsConfigDict
from pydantic import Field
from enum import Enum

class ModelSettings(BaseSettings):
    model_name: str = Field("gemini-3-flash-preview", validation_alias="MODEL_NAME")
    temperature: float = 0.3
    max_tokens: int = 2048
    streaming: bool = Field(True, validation_alias="MODEL_STREAMING")

class PromptSettings(BaseSettings):
    version: str = Field("v1", validation_alias="PROMPT_VERSION")

class TelemetrySettings(BaseSettings):
    level: str = Field("INFO", validation_alias="LOG_LEVEL")
    format: str = Field("%(asctime)s - %(name)s - %(levelname)s - %(message)s", validation_alias="LOG_FORMAT")

class AppSettings(BaseSettings):
    port: int = Field(8000, validation_alias="AGENT_PORT")
    google_cloud_project: str = Field(..., validation_alias="GOOGLE_CLOUD_PROJECT") # Required
    google_cloud_location: str = Field("global", validation_alias="GOOGLE_CLOUD_LOCATION")
    app_name: str = Field("app", validation_alias="APP_NAME")

    banned_words: list[str] = Field(
        default=["dominoes", "pizza hut", "papa johns"],
        validation_alias="BANNED_WORDS",
    )
    
    model: ModelSettings = Field(default_factory=ModelSettings)
    prompts: PromptSettings = Field(default_factory=PromptSettings)
    telemetry: TelemetrySettings = Field(default_factory=TelemetrySettings)
    
    model_config = SettingsConfigDict(
        env_file=".env",
        env_nested_delimiter="__",
        extra="ignore"
    )

# Singleton instance
settings = AppSettings()
