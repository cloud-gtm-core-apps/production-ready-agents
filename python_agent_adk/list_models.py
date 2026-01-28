import os
from google import genai

project_id = os.environ.get("GOOGLE_CLOUD_PROJECT")
location = os.environ.get("GOOGLE_CLOUD_LOCATION", "global")

print(f"Checking models for project: {project_id} in location: {location}")

try:
    client = genai.Client(vertexai=True, project=project_id, location=location)
    # Attempt to use the list_models akin to paginator or simple list
    # The SDK structure suggests client.models might have a list method or similar
    # If this fails, we catch it.
    
    # We will try to list publisher models which is usually where gemini lives
    # Note: 'models.list' usually lists tuned models. 
    # For foundation models it might be hard to list programmatically via high-level SDK unless we use the gapic or specific endpoint.
    # But let's try a standard generation with a known safely failing prompt to see if we can probe it, or just print the error details from a "gemini-1.5-flash" probe if we didn't already see it.
    
    # Actually, the error message listed earlier: 
    # "Publisher Model ... was not found or your project does not have access to it"
    
    # Let's try to list models if the method exists
    pager = client.models.list() 
    print("Models found:")
    for model in pager:
        print(f" - {model.name}")
        
except Exception as e:
    print(f"Error listing models: {e}")
