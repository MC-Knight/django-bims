import json
import mock
from django.contrib.gis.geos import Point
from django.test import TestCase

from bims.utils import geoserver_context
from bims.utils.location_context import get_location_context_data
from bims.tests.model_factories import LocationSiteF, LocationContextGroupF
from bims.models.location_context import LocationContext


SQUARE = {
    'type': 'Polygon',
    'coordinates': [[[29, -2], [30, -2], [30, -1], [29, -1], [29, -2]]]
}


def mocked_wfs(properties):
    """requests.get returning one square polygon with these properties"""
    class MockResponse:
        status_code = 200
        text = json.dumps({
            'type': 'FeatureCollection',
            'features': [{
                'type': 'Feature',
                'geometry': SQUARE,
                'properties': properties
            }]
        })

        def raise_for_status(self):
            pass

        def json(self):
            return json.loads(self.text)

    return mock.Mock(return_value=MockResponse())


@mock.patch(
    'bims.tasks.location_context.generate_spatial_scale_filter', mock.Mock())
class TestLocationContext(TestCase):
    def setUp(self) -> None:
        geoserver_context._area_cache.clear()
        self.site_inside = LocationSiteF.create(
            geometry_point=Point(29.5, -1.5))
        self.site_outside = LocationSiteF.create(
            geometry_point=Point(31.5, -1.5))
        self.group = LocationContextGroupF.create(
            key='districts',
            layer_name='geonode:district_boundary',
            wms_url='https://geonode.example.org/geoserver/wms',
            layer_identifier='district'
        )

    def test_get_location_context_data(self):
        with mock.patch('requests.get', mocked_wfs(
                {'district': 'Gasabo, Kigali'})) as requests_get:
            get_location_context_data()
        self.assertEqual(
            requests_get.call_args[0][0],
            'https://geonode.example.org/geoserver/ows'
        )
        self.assertEqual(
            LocationContext.objects.get(
                site=self.site_inside, group=self.group).value,
            'Gasabo Kigali'
        )
        self.assertFalse(
            LocationContext.objects.filter(
                site=self.site_outside, group=self.group).exists()
        )

    def test_old_value_is_replaced(self):
        LocationContext.objects.create(
            site=self.site_outside, group=self.group, value='Old district')
        with mock.patch('requests.get', mocked_wfs({'district': 'Gasabo'})):
            get_location_context_data(site_id=str(self.site_outside.id))
        self.assertFalse(
            LocationContext.objects.filter(
                site=self.site_outside, group=self.group).exists()
        )

    def test_groups_without_a_layer_are_skipped(self):
        LocationContextGroupF.create(key='no_layer')
        with mock.patch('requests.get', mocked_wfs(
                {'district': 'Gasabo'})) as requests_get:
            get_location_context_data()
        self.assertEqual(requests_get.call_count, 1)

    def test_wrong_layer_identifier(self):
        self.group.layer_identifier = 'DISTR_NAME'
        self.group.save()
        with mock.patch('requests.get', mocked_wfs({'district': 'Gasabo'})):
            get_location_context_data()
        self.assertFalse(
            LocationContext.objects.filter(group=self.group).exists()
        )
