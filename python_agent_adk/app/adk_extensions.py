from google.adk.models import Gemini
from google.genai import Client, types
from functools import cached_property
import os
import sys

# Subclass Gemini to force Vertex AI authentication via environment variables
class VertexGemini(Gemini):
    @cached_property
    def api_client(self) -> Client:
        project = os.environ.get("GOOGLE_CLOUD_PROJECT")
        location = os.environ.get("GOOGLE_CLOUD_LOCATION", "global")
        
        # Replicate tracking headers logic from parent
        framework_label = f'google-adk/custom-vertex'
        language_label = 'gl-python/' + sys.version.split()[0]
        version_header_value = f'{framework_label} {language_label}'
        tracking_headers = {
            'x-goog-api-client': version_header_value,
            'user-agent': version_header_value,
        }

        # Return client with explicit Vertex AI config
        return Client(
            vertexai=True,
            project=project,
            location=location,
            http_options=types.HttpOptions(headers=tracking_headers)
        )
