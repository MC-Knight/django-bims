# coding=utf-8
"""
Our own GeoContext: the area (province, district, catchment, ...) each site
lies in, read from GeoServer instead of Kartoza's GeoContext service.

A location context group is looked up when its layer name, WMS URL and layer
identifier are set. The layer's polygons are fetched over WFS, and each site
gets the layer identifier value of the polygon its centroid falls in. The
same three fields draw the chosen area's outline on the map.
"""
import json
import logging
import re
import time

import requests
from django.contrib.gis.geos import GEOSGeometry
from django.db import transaction
from django.db.models import Q
from django.utils import timezone

logger = logging.getLogger(__name__)

WFS_TIMEOUT = 300
# A worker reuses a layer's polygons for this long, so saving sites one by
# one doesn't download every layer each time.
CACHE_SECONDS = 600
_area_cache = {}


def configured_groups(group_keys=None):
    """Groups that have a layer to look up, optionally only some of them.

    :param group_keys: list of group keys or geocontext group keys
    """
    from bims.models.location_context_group import LocationContextGroup
    groups = LocationContextGroup.objects.exclude(
        Q(layer_name='') | Q(wms_url='') | Q(layer_identifier='')
    )
    if group_keys:
        groups = groups.filter(
            Q(key__in=group_keys) | Q(geocontext_group_key__in=group_keys))
    return groups.order_by('id')


def wfs_url(wms_url):
    """.../geoserver[/workspace]/wms (or /wfs, /ows) -> the matching /ows"""
    url = wms_url.strip().split('?')[0].rstrip('/')
    return re.sub(r'/(wms|wfs|ows)$', '', url, flags=re.IGNORECASE) + '/ows'


def fetch_areas(group):
    """Fetch the group's polygons from GeoServer.

    :return: list of (value, (xmin, ymin, xmax, ymax), prepared polygon)
    :raises ValueError: when the layer can't be used, with the reason
    """
    url = wfs_url(group.wms_url)
    cache_key = (url, group.layer_name, group.layer_identifier)
    cached = _area_cache.get(cache_key)
    if cached and time.time() - cached[0] < CACHE_SECONDS:
        return cached[1]

    response = requests.get(url, params={
        'service': 'WFS',
        'version': '1.0.0',
        'request': 'GetFeature',
        'typeName': group.layer_name,
        'outputFormat': 'application/json',
        # Longitude/latitude, whatever the layer is stored in
        'srsName': 'EPSG:4326',
    }, timeout=WFS_TIMEOUT)
    response.raise_for_status()
    try:
        features = response.json()['features']
    except (ValueError, KeyError):
        # GeoServer reports errors (unknown layer etc.) as XML
        raise ValueError('{} did not return features: {}'.format(
            group.layer_name, response.text[:300]))

    areas = []
    field_found = False
    for feature in features:
        properties = feature.get('properties') or {}
        geometry = feature.get('geometry')
        if group.layer_identifier in properties:
            field_found = True
        value = properties.get(group.layer_identifier)
        if not geometry or value is None or not str(value).strip():
            continue
        if geometry['type'] not in ('Polygon', 'MultiPolygon'):
            raise ValueError(
                '{} has {} shapes, only polygon layers are supported'.format(
                    group.layer_name, geometry['type']))
        polygon = GEOSGeometry(json.dumps(geometry), srid=4326)
        areas.append((
            # Commas separate the parts of a spatial filter value
            str(value).replace(',', '').strip()[:255],
            polygon.extent,
            polygon.prepared,
        ))
    if features and not field_found:
        raise ValueError('{} has no field "{}", its fields are: {}'.format(
            group.layer_name, group.layer_identifier,
            ', '.join(sorted(features[0].get('properties') or {}))))

    _area_cache[cache_key] = (time.time(), areas)
    return areas


def area_of(point, areas):
    """Value of the first area that contains the point (or its edge)."""
    x, y = point.x, point.y
    for value, (xmin, ymin, xmax, ymax), polygon in areas:
        if xmin <= x <= xmax and ymin <= y <= ymax and polygon.covers(point):
            return value
    return None


def update_group(group, sites):
    """Replace the group's values for these sites with the area each one
    lies in. Sites outside every area end up with no value.

    :return: number of sites that got a value
    """
    from bims.models.location_context import LocationContext
    areas = fetch_areas(group)
    now = timezone.now()
    site_ids = []
    contexts = []
    for site in sites:
        site_ids.append(site.id)
        centroid = site.get_centroid()
        if not centroid:
            continue
        value = area_of(centroid, areas)
        if value:
            contexts.append(LocationContext(
                site=site, group=group, value=value, fetch_time=now))
    with transaction.atomic():
        LocationContext.objects.filter(
            group=group, site_id__in=site_ids).delete()
        LocationContext.objects.bulk_create(contexts, batch_size=1000)
    return len(contexts)


def update_location_contexts(sites, group_keys=None, only_empty=False):
    """Look up every configured group for these sites, then rebuild the
    spatial filter list in the map's side panel.

    :param sites: location sites to update
    :param group_keys: only these groups (keys or geocontext group keys)
    :param only_empty: skip sites that already have a value for a group
    :return: {group name: result message}
    """
    from bims.models.location_context import LocationContext
    from bims.tasks.location_context import generate_spatial_scale_filter
    sites = list(sites)
    results = {}
    for group in configured_groups(group_keys):
        group_sites = sites
        if only_empty:
            done = set(LocationContext.objects.filter(
                group=group).values_list('site_id', flat=True))
            group_sites = [site for site in sites if site.id not in done]
        if not group_sites:
            continue
        try:
            found = update_group(group, group_sites)
            results[group.name] = '{} of {} sites'.format(
                found, len(group_sites))
        except Exception as e:  # noqa
            logger.error('Location context %s failed: %s', group.name, e)
            results[group.name] = 'FAILED: {}'.format(e)
    if results:
        generate_spatial_scale_filter()
    return results
