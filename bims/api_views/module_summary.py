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

        if taxon_group.logo:
            summary['icon'] = taxon_group.logo.url
        summary[
            'total'] = collections.count()
        summary[
            'total_site'] = (
            collections.distinct('site').count()
        )
        summary[
            'total_site_visit'] = (
            collections.distinct('survey').count()
        )
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