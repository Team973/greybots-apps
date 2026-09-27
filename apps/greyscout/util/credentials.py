
import json

def get_tba_credentials(input_creds, file="private_credentials.json"):
    tba_creds = None
    if input_creds is not None:
        tba_creds = json.loads(input_creds)
    else:
        with open(file, 'r') as f:
            prv_creds = json.load(f)
            tba_creds = prv_creds['tba']
    
    return tba_creds

def get_supabase_credentials(input_creds, file="private_credentials.json"):
    supabase_creds = None
    if input_creds is not None:
        supabase_creds = json.loads(input_creds)
    else:
        with open(file, 'r') as f:
            prv_creds = json.load(f)
            supabase_creds = prv_creds['supabase']
    
    return supabase_creds