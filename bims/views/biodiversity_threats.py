# coding=utf-8
from django.template.response import TemplateResponse
from bims.models import BiodiversityThreat

def biodiversity_threats_view(request, *args, **kwargs):
    """ View for the Biodiversity Threats page
    """

    biodiversity_threats = BiodiversityThreat.objects.all().order_by('created_at')
    context = {
        'biodiversity_threats': biodiversity_threats
    }
    biodiversity_threats_page_template = 'rbis/biodiversity_threats.html'

    return TemplateResponse(
        request,
        biodiversity_threats_page_template,
        context
    )


def biodiversity_threat_detail_view(request, pk, *args, **kwargs):
    """ View for the Biodiversity Threat Detail page
    """
    biodiversity_threat = BiodiversityThreat.objects.get(pk=pk)
    context = {
        'biodiversity_threat': biodiversity_threat
    }
    biodiversity_threat_detail_page_template = 'rbis/biodiversity_threat_detail.html'

    return TemplateResponse(
        request,
        biodiversity_threat_detail_page_template,
        context
    )