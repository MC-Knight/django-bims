# coding=utf-8
from rest_framework.views import APIView
from rest_framework.response import Response
from sorl.thumbnail import get_thumbnail
from bims.models.taxon_group import TaxonGroup
from bims.enums.taxonomic_group_category import TaxonomicGroupCategory


class ModuleList(APIView):
    """Return list of species module"""

    def get(self, request, *args):
        taxon_group_list = []
        taxon_groups = TaxonGroup.objects.filter(
                    category=TaxonomicGroupCategory.SPECIES_MODULE.name
                )
        for _module in taxon_groups:
            if _module.logo:
                logo = request.build_absolute_uri(_module.logo.url)
            else:
                logo = ''
            taxon_group_list.append({
                'name': _module.name,
                'id': _module.id,
                'logo': logo
            })
        return Response(taxon_group_list)
