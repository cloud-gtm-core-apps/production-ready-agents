import logging
import sys
from .config import settings

def setup_logging():
    """
    Configures the root logger with a standardized format using settings.
    """
    level = settings.telemetry.level
    log_format = settings.telemetry.format
    
    numeric_level = getattr(logging, level.upper(), None)
    if not isinstance(numeric_level, int):
        print(f"Invalid log level: {level}. Defaulting to INFO.")
        numeric_level = logging.INFO

    logging.basicConfig(
        level=numeric_level,
        format=log_format,
        handlers=[
            logging.StreamHandler(sys.stdout)
        ]
    )
    logging.info(f"Logging initialized at level {level}")
