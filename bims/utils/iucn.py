import requests
import json
import logging
from requests.exceptions import HTTPError
from django.conf import settings
from bims.models.iucn_status import IUCNStatus
from preferences import preferences

logger = logging.getLogger('bims')


def get_iucn_status(taxon_id=None, species_name=None, only_returns_json=None):
    """
    Fetch iucn status of the species, and update the iucn record.

    :param taxon_id: taxon id of the species
    :param species_name: name of the species
    :param only_returns_json: if True, return raw JSON response
    """
    api_iucn_key = preferences.SiteSetting.iucn_api_key

    if not api_iucn_key:
        return None

    api_url = settings.IUCN_API_URL

    if taxon_id:
        api_url += '/id/' + str(taxon_id)
    elif species_name:
        api_url += '/species/' + species_name
    else:
        return None

    # Add token
    api_url += '?token=' + api_iucn_key

    try:
        response = requests.get(api_url, timeout=10)

        # ✅ FIXED: Handle malformed JSON from IUCN API
        try:
            json_result = response.json()
        except (ValueError, json.JSONDecodeError) as e:
            logger.warning(f"Failed to parse IUCN API response for {species_name or taxon_id}: {e}")
            logger.warning(f"Response content: {response.text[:200]}")
            return None

        if only_returns_json:
            return json_result

        try:
            if json_result and 'result' in json_result and len(json_result['result']) > 0:
                iucn_status = IUCNStatus.objects.filter(
                    category=json_result['result'][0]['category']
                )
                if not iucn_status:
                    iucn_status = IUCNStatus.objects.create(
                        category=json_result['result'][0]['category']
                    )
                    return iucn_status
                return iucn_status[0]
        except (TypeError, KeyError, IndexError) as e:
            logger.warning(f"Error processing IUCN result for {species_name or taxon_id}: {e}")
            pass

        return None

    except HTTPError as e:
        logger.warning(f"HTTP error fetching IUCN status for {species_name or taxon_id}: {e}")
        return None
    except requests.exceptions.Timeout:
        logger.warning(f"Timeout fetching IUCN status for {species_name or taxon_id}")
        return None
    except requests.exceptions.RequestException as e:
        logger.warning(f"Request error fetching IUCN status for {species_name or taxon_id}: {e}")
        return None
    except Exception as e:
        logger.error(f"Unexpected error fetching IUCN status for {species_name or taxon_id}: {e}")
        return None
