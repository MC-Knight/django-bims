from rest_framework.views import APIView
from rest_framework.response import Response
from django.db.models import Count, F, Case, When, Value, Q
from allauth.utils import get_user_model
from bims.models import (
    TaxonGroup,
    BiologicalCollectionRecord,
    IUCNStatus,
    DownloadRequest,
    Survey
)
from bims.models.taxonomy import Taxonomy
from bims.enums.taxonomic_group_category import TaxonomicGroupCategory
from sass.models.site_visit_taxon import SiteVisitTaxon
from sass.models.site_visit import SiteVisit


def get_species_group(species):
    """Query taxon_group for species group then return the queryset results"""
    taxon_group = TaxonGroup.objects.filter(
        category=TaxonomicGroupCategory.SPECIES_MODULE.name,
        name__icontains=species
    )
    if taxon_group.exists():
        return taxon_group[0]
    else:
        return None


class ModuleSummary(APIView):
    """
    Summary for species module
    """

    def module_summary_data(self, taxon_group):
        """
        Return summary data for module
        :param taxon_group: taxon group object
        :return: dict of summary data
        """
        summary = {}
        collections = BiologicalCollectionRecord.objects.filter(
            module_group=taxon_group
        )

        # Existing chart data logic (keeping your existing code)
        if taxon_group.chart_data == 'division':
            summary['division'] = collections.values(
                'taxonomy__additional_data__Division').annotate(
                count=Count('taxonomy__additional_data__Division')
            ).values('taxonomy__additional_data__Division', 'count')
        elif taxon_group.chart_data == 'origin':
            origin_data = dict(
                collections.exclude(taxonomy__origin__exact='').values(
                    'taxonomy__origin').annotate(
                    count=Count('taxonomy__origin')
                ).values_list('taxonomy__origin', 'count'))
            updated_origin_data = {}
            origin_category = dict(Taxonomy.CATEGORY_CHOICES)
            for key in origin_data.keys():
                updated_origin_data[origin_category[key]] = (
                    origin_data[key]
                )
            summary['origin'] = updated_origin_data
        elif taxon_group.chart_data == 'endemism':
            summary['endemism'] = dict(collections.annotate(
                value=Case(When(taxonomy__endemism__isnull=False,
                                then=F('taxonomy__endemism__name')),
                        default=Value('Unknown'))
            ).values('value').annotate(
                count=Count('value')).values_list('value', 'count'))
        elif taxon_group.chart_data == 'sass':
            site_visit_ecological = SiteVisitTaxon.objects.filter(
                **{
                    'site_visit__sitevisitecologicalcondition__'
                    'ecological_condition__isnull': False,
                }
            ).annotate(
                value=F('site_visit__'
                        'sitevisitecologicalcondition__'
                        'ecological_condition__category')
            ).values('value').annotate(
                count=Count('value'),
                color=F('site_visit__'
                        'sitevisitecologicalcondition__'
                        'ecological_condition__colour')
            ).values('value', 'count', 'color').order_by(
                'value'
            )
            summary['ecological_data'] = list(
                site_visit_ecological
            )
            summary['total_sass'] = SiteVisit.objects.all().count()
        else:
            summary_temp = dict(
                collections.exclude(taxonomy__origin__exact='').annotate(
                    value=Case(When(taxonomy__iucn_status__isnull=False,
                                    then=F('taxonomy__iucn_status__category')),
                            default=Value('Not evaluated'))
                ).values('value').annotate(
                    count=Count('value')
                ).values_list('value', 'count')
            )
            iucn_category = dict(IUCNStatus.CATEGORY_CHOICES)
            updated_summary = {}
            for key in summary_temp.keys():
                if key in iucn_category:
                    updated_summary[iucn_category[key]] = summary_temp[key]
            summary['conservation-status'] = updated_summary

        # FAST: Only counts for taxonomy hierarchy
        from bims.enums.taxonomic_rank import TaxonomicRank
        
        unique_taxonomy_ids = collections.values_list('taxonomy', flat=True).distinct()
        taxonomies = Taxonomy.objects.filter(id__in=unique_taxonomy_ids)
        
        # Collect unique names efficiently
        order_names = set()
        family_names = set()
        species_count = 0
        
        for taxonomy in taxonomies:
            if taxonomy.order_name:
                order_names.add(taxonomy.order_name)
            if taxonomy.family_name:
                family_names.add(taxonomy.family_name)
            if taxonomy.rank in [TaxonomicRank.SPECIES.name, TaxonomicRank.SUBSPECIES.name]:
                species_count += 1
        
        # ADD: Include taxon group ID for reference
        summary['taxon_group_id'] = taxon_group.id
        summary['orders'] = {'total': len(order_names)}
        summary['families'] = {'total': len(family_names)}
        summary['species'] = {'total': species_count}

        # Existing summary data
        if taxon_group.logo:
            summary['icon'] = taxon_group.logo.url
        summary['total'] = collections.count()
        summary['total_site'] = collections.distinct('site').count()
        summary['total_site_visit'] = collections.distinct('survey').count()
        
        return summary

    def general_summary_data(self):
        """
        This function calculates a summary of key metrics
        including total occurrences, total taxa,
        total users, total uploads, and total downloads.

        Returns:
            dict: A dictionary containing the calculated summary metrics.
        """
        upload_counts = Survey.objects.exclude(
            Q(owner__username__icontains='gbif') |
            Q(owner__username__icontains='admin') |
            Q(owner__username__icontains='map_vm')
        ).count()

        taxon_groups = TaxonGroup.objects.filter(
            category=TaxonomicGroupCategory.SPECIES_MODULE.name
        )

        # Use the same relationship structure as your existing code
        total_occurrences = 0
        total_taxa = 0
        
        for taxon_group in taxon_groups:
            # Count occurrences using the same filter as your existing module_summary_data
            occurrences_count = BiologicalCollectionRecord.objects.filter(
                module_group=taxon_group
            ).count()
            total_occurrences += occurrences_count
            
            # Count taxa for this taxon group
            taxa_count = BiologicalCollectionRecord.objects.filter(
                module_group=taxon_group
            ).values('taxonomy').distinct().count()
            total_taxa += taxa_count

        counts = {
            'total_occurrences': total_occurrences,
            'total_taxa': total_taxa,
            'total_users': get_user_model().objects.filter(
                last_login__isnull=False
            ).count(),
            'total_uploads': upload_counts,
            'total_downloads': DownloadRequest.objects.all().count()
        }

        return counts

    def get(self, request, *args):
        response_data = dict()
        
        # Add general summary
        response_data['general_summary'] = self.general_summary_data()
        
        # Add taxon group summaries
        taxon_groups = TaxonGroup.objects.filter(
            category=TaxonomicGroupCategory.SPECIES_MODULE.name,
        ).order_by('display_order')
        for taxon_group in taxon_groups:
            taxon_group_name = taxon_group.name
            response_data[taxon_group_name] = (
                self.module_summary_data(taxon_group)
            )
        return Response(response_data)
    

class TaxonGroupOrdersAPIView(APIView):
    """
    API endpoint for orders within a specific taxon group
    """
    def get(self, request, taxon_group_id):
        try:
            taxon_group = TaxonGroup.objects.get(id=taxon_group_id)
        except TaxonGroup.DoesNotExist:
            return Response({'error': 'Taxon group not found'}, status=404)
        
        # Pagination
        page = int(request.GET.get('page', 1))
        page_size = int(request.GET.get('page_size', 50))
        search = request.GET.get('search', '')
        
        collections = BiologicalCollectionRecord.objects.filter(
            module_group=taxon_group
        )
        unique_taxonomy_ids = collections.values_list('taxonomy', flat=True).distinct()
        taxonomies = Taxonomy.objects.filter(id__in=unique_taxonomy_ids)
        
        # Collect order data
        orders_data = {}  # Use dict to avoid duplicates
        
        for taxonomy in taxonomies:
            order_name = taxonomy.order_name
            if order_name:
                if search.lower() in order_name.lower():
                    # Find an actual order-level taxonomy if it exists
                    order_taxonomy = taxonomy.parent_by_rank('ORDER')
                    orders_data[order_name] = {
                        'id': order_taxonomy.id if order_taxonomy else None,
                        'name': order_name,
                        'scientific_name': order_taxonomy.scientific_name if order_taxonomy else order_name
                    }
        
        # Convert to list and sort
        orders_list = list(orders_data.values())
        orders_list.sort(key=lambda x: x['name'])
        
        # Apply pagination
        total = len(orders_list)
        start = (page - 1) * page_size
        end = start + page_size
        paginated_orders = orders_list[start:end]
        
        return Response({
            'taxon_group_id': taxon_group_id,
            'taxon_group_name': taxon_group.name,
            'data': paginated_orders,
            'total': total,
            'page': page,
            'page_size': page_size,
            'has_next': end < total,
            'has_previous': page > 1
        })


class TaxonGroupFamiliesAPIView(APIView):
    """
    API endpoint for families within a specific taxon group
    """
    def get(self, request, taxon_group_id):
        try:
            taxon_group = TaxonGroup.objects.get(id=taxon_group_id)
        except TaxonGroup.DoesNotExist:
            return Response({'error': 'Taxon group not found'}, status=404)
        
        # Pagination
        page = int(request.GET.get('page', 1))
        page_size = int(request.GET.get('page_size', 50))
        search = request.GET.get('search', '')
        
        collections = BiologicalCollectionRecord.objects.filter(
            module_group=taxon_group
        )
        unique_taxonomy_ids = collections.values_list('taxonomy', flat=True).distinct()
        taxonomies = Taxonomy.objects.filter(id__in=unique_taxonomy_ids)
        
        # Collect family data
        families_data = {}
        
        for taxonomy in taxonomies:
            family_name = taxonomy.family_name
            if family_name:
                if search.lower() in family_name.lower():
                    family_taxonomy = taxonomy.parent_by_rank('FAMILY')
                    families_data[family_name] = {
                        'id': family_taxonomy.id if family_taxonomy else None,
                        'name': family_name,
                        'scientific_name': family_taxonomy.scientific_name if family_taxonomy else family_name,
                        'order_name': taxonomy.order_name
                    }
        
        # Convert to list and sort
        families_list = list(families_data.values())
        families_list.sort(key=lambda x: x['name'])
        
        # Apply pagination
        total = len(families_list)
        start = (page - 1) * page_size
        end = start + page_size
        paginated_families = families_list[start:end]
        
        return Response({
            'taxon_group_id': taxon_group_id,
            'taxon_group_name': taxon_group.name,
            'data': paginated_families,
            'total': total,
            'page': page,
            'page_size': page_size,
            'has_next': end < total,
            'has_previous': page > 1
        })


class TaxonGroupSpeciesAPIView(APIView):
    """
    API endpoint for species within a specific taxon group
    """
    def get(self, request, taxon_group_id):
        try:
            taxon_group = TaxonGroup.objects.get(id=taxon_group_id)
        except TaxonGroup.DoesNotExist:
            return Response({'error': 'Taxon group not found'}, status=404)
        
        # Pagination
        page = int(request.GET.get('page', 1))
        page_size = int(request.GET.get('page_size', 50))
        search = request.GET.get('search', '')
        
        from bims.enums.taxonomic_rank import TaxonomicRank
        
        collections = BiologicalCollectionRecord.objects.filter(
            module_group=taxon_group
        )
        unique_taxonomy_ids = collections.values_list('taxonomy', flat=True).distinct()
        
        # Filter species-level taxonomies
        species_taxonomies = Taxonomy.objects.filter(
            id__in=unique_taxonomy_ids,
            rank__in=[TaxonomicRank.SPECIES.name, TaxonomicRank.SUBSPECIES.name]
        )
        
        # Apply search filter
        if search:
            species_taxonomies = species_taxonomies.filter(
                models.Q(canonical_name__icontains=search) |
                models.Q(scientific_name__icontains=search)
            )
        
        # Get total count before pagination
        total = species_taxonomies.count()
        
        # Apply pagination
        start = (page - 1) * page_size
        end = start + page_size
        paginated_species = species_taxonomies[start:end]
        
        # Format data
        species_data = []
        for taxonomy in paginated_species:
            species_data.append({
                'id': taxonomy.id,
                'name': taxonomy.canonical_name or taxonomy.scientific_name,
                'scientific_name': taxonomy.scientific_name,
                'rank': taxonomy.rank,
                'family_name': taxonomy.family_name,
                'order_name': taxonomy.order_name,
                'conservation_status': taxonomy.iucn_status.category if taxonomy.iucn_status else 'Not evaluated',
                'origin': dict(Taxonomy.CATEGORY_CHOICES).get(taxonomy.origin, 'Unknown') if taxonomy.origin else 'Unknown'
            })
        
        return Response({
            'taxon_group_id': taxon_group_id,
            'taxon_group_name': taxon_group.name,
            'data': species_data,
            'total': total,
            'page': page,
            'page_size': page_size,
            'has_next': end < total,
            'has_previous': page > 1
        })
