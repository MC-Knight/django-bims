# coding=utf-8
from django.core.management.base import BaseCommand, CommandError
from bims.models.location_site import LocationSite
from bims.utils.geoserver_context import (
    configured_groups,
    update_location_contexts
)


class Command(BaseCommand):
    """Fill the areas sites lie in (the map's spatial filter) from the layers
    set on the location context groups, then rebuild the filter list, e.g.
    python manage.py update_spatial_context --group country districts
    """

    def add_arguments(self, parser):
        parser.add_argument(
            '--group',
            nargs='+',
            default=None,
            help='Keys (or geocontext group keys) of the location context '
                 'groups to update. Default: every group with a layer')
        parser.add_argument(
            '--site',
            nargs='+',
            type=int,
            default=None,
            help='IDs of the location sites to update. Default: all sites')

    def handle(self, *args, **options):
        group_keys = options['group']
        groups = configured_groups(group_keys)
        if group_keys:
            found = set(groups.values_list('key', flat=True)) | set(
                groups.values_list('geocontext_group_key', flat=True))
            missing = sorted(set(group_keys) - found)
            if missing:
                raise CommandError(
                    'No group with a layer name, WMS URL and layer '
                    'identifier for: {}'.format(', '.join(missing)))
        if not groups.exists():
            raise CommandError(
                'No location context group has a layer name, WMS URL and '
                'layer identifier yet')

        sites = LocationSite.objects.all()
        if options['site']:
            sites = sites.filter(id__in=options['site'])
        self.stdout.write('Looking up {} groups for {} sites'.format(
            groups.count(), sites.count()))

        results = update_location_contexts(sites, group_keys=group_keys)
        for group_name, result in results.items():
            self.stdout.write('  {}: {}'.format(group_name, result))
        self.stdout.write('Spatial filter list rebuilt')
