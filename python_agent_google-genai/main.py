import os
import sys

# Ensure we can import from local directory
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from python_agent.app.agent import OrderFlowAgent

def main():
    if not os.environ.get("GOOGLE_CLOUD_PROJECT"):
        print("WARNING: GOOGLE_CLOUD_PROJECT not set. Vertex AI might fail if not configured.")
        print("Please set it with: export GOOGLE_CLOUD_PROJECT=your-project-id")
    
    agent = OrderFlowAgent()
    agent.run()

if __name__ == "__main__":
    main()
