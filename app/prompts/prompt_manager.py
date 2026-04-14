from pathlib import Path
from ..config import settings

class PromptManager:
    def __init__(self):
        # Base path points to the versioned folder, e.g., app/prompts/v1
        self.base_path = Path(__file__).parent / settings.prompts.version
        
    def get_prompt(self, prompt_name: str) -> str:
        """
        Loads a prompt file by name from the versioned directory.
        Expects a .txt file.
        """
        prompt_file = self.base_path / f"{prompt_name}.txt"
        
        if not prompt_file.exists():
            raise FileNotFoundError(f"Prompt file not found: {prompt_file}")
            
        return prompt_file.read_text(encoding="utf-8")
