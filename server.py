"""Local and Render entry point; HTTP implementation lives in model_server.py."""
from model_server import Handler, ROOT, allowed_hosts, model_config, main, urllib

if __name__ == "__main__":
    main()
