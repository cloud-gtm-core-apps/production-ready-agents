import os
from google import genai
from google.genai import types

project_id = os.environ.get("GOOGLE_CLOUD_PROJECT")
location = os.environ.get("GOOGLE_CLOUD_LOCATION", "global")

try:
    client = genai.Client(vertexai=True, project=project_id, location=location)
    print(f"Attempting to generate with gemini-3-flash-preview in {project_id}...")
    
    response = client.models.generate_content(
        model="gemini-3-flash-preview", 
        contents="Hello, are you there?",
        config=types.GenerateContentConfig(
            temperature=0.7
        )
    )
    print("Success!")
    print(response.text)
        
except Exception as e:
    print(f"Error generating content: {e}")
