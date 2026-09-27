
import json 

from credentials import get_supabase_credentials, get_tba_credentials

if __name__ == "__main__":
    # creds = get_tba_credentials(None)
    creds = get_supabase_credentials(None)
    print(repr(json.dumps(creds)))
