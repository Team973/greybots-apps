
import io
import time

import requests
from PIL import Image

from supabase_client_interface import create_supabase_client
from tba_client import TBAClient

TEAM_TABLE = "Team"
ROBOT_PHOTO_TABLE = "RobotPhoto"
ROBOT_PHOTO_BUCKET = "robot-photos"

# Source images from TBA/imgur can be several MB at full resolution, which is
# way more than a small in-app thumbnail needs. Downscale and re-encode as
# JPEG so the site loads them quickly, especially on mobile.
MAX_PHOTO_DIMENSION = 800
JPEG_QUALITY = 80
CACHE_CONTROL_SECONDS = "3600"

# Imgur throttles anonymous requests fairly aggressively when downloading many
# images back-to-back; pace requests and retry with backoff on 429s rather
# than treating a rate limit as "no photo available".
DOWNLOAD_DELAY_SECONDS = 1.5
MAX_DOWNLOAD_RETRIES = 3


def _download_with_retry(url):
    for attempt in range(MAX_DOWNLOAD_RETRIES):
        response = requests.get(url, headers={"User-Agent": "Mozilla/5.0"})
        if response.status_code != 429:
            return response
        wait = 5 * (attempt + 1)
        print(f"  rate limited, waiting {wait}s before retry ({attempt + 1}/{MAX_DOWNLOAD_RETRIES})")
        time.sleep(wait)
    return response


def _resize_and_compress(image_bytes):
    """
    Downscale to MAX_PHOTO_DIMENSION on the longest side (preserving aspect
    ratio, never upscaling) and re-encode as JPEG. Returns the new bytes.
    """
    image = Image.open(io.BytesIO(image_bytes))
    image = image.convert("RGB")  # JPEG has no alpha channel
    image.thumbnail((MAX_PHOTO_DIMENSION, MAX_PHOTO_DIMENSION), Image.LANCZOS)

    buffer = io.BytesIO()
    image.save(buffer, format="JPEG", quality=JPEG_QUALITY, optimize=True)
    return buffer.getvalue()


def _pick_robot_photo_url(tba_client, team_number, year):
    """
    Return a direct image URL for the team's robot photo, or None if they
    don't have one on TBA. Only TBA's "imgur" media type is used — it's the
    one type that reliably points straight at an image (other types like
    "avatar" are team icons, "youtube" is video, "cd-thread" points at a
    forum page rather than an image).
    """
    response = tba_client.get_data(f"/team/frc{team_number}/media/{year}")
    if response.status_code != 200:
        return None

    media = response.json()
    if not isinstance(media, list):
        return None

    photos = [item for item in media if item.get('type') == 'imgur' and item.get('direct_url')]
    if not photos:
        return None

    # Prefer media the team has marked as preferred.
    photos.sort(key=lambda item: item.get('preferred', False), reverse=True)
    return photos[0]['direct_url']


def update_robot_photos_for_event(sb_credentials, tba_credentials, event_id):
    sb_client = create_supabase_client(sb_credentials)
    tba_client = TBAClient(tba_credentials['base_url'], tba_credentials['api_key'])

    year = int(event_id[:4])

    teams_response = sb_client.table(TEAM_TABLE).select("team_number").eq("event_id", event_id).execute()
    team_numbers = sorted({row['team_number'] for row in teams_response.data})

    updated = 0
    skipped = 0

    for team_number in team_numbers:
        image_url = _pick_robot_photo_url(tba_client, team_number, year)
        if not image_url:
            print(f"{team_number}: no robot photo on TBA, skipping")
            skipped += 1
            continue

        time.sleep(DOWNLOAD_DELAY_SECONDS)
        image_response = _download_with_retry(image_url)
        if image_response.status_code != 200:
            print(f"{team_number}: failed to download {image_url} ({image_response.status_code})")
            skipped += 1
            continue

        try:
            resized_bytes = _resize_and_compress(image_response.content)
        except Exception as e:
            print(f"{team_number}: failed to process image ({e})")
            skipped += 1
            continue

        filename = f"{team_number}_photo"

        sb_client.storage.from_(ROBOT_PHOTO_BUCKET).upload(
            filename,
            resized_bytes,
            file_options={
                "content-type": "image/jpeg",
                "cache-control": CACHE_CONTROL_SECONDS,
                "upsert": "true"
            }
        )

        photo_url = f"{sb_credentials['url']}/storage/v1/object/public/{ROBOT_PHOTO_BUCKET}/{filename}"
        sb_client.table(ROBOT_PHOTO_TABLE).upsert({
            'team_number': team_number,
            'photo_url': photo_url
        }).execute()

        print(f"{team_number}: uploaded {image_url} ({len(image_response.content)} -> {len(resized_bytes)} bytes)")
        updated += 1

    print(f"Done. {updated} photos updated, {skipped} teams skipped (no photo on TBA or download failed).")
