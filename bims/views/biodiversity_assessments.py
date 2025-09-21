# coding=utf-8
from django.template.response import TemplateResponse
from bims.models import BiodiversityAssessment

def biodiversity_assessments_view(request, *args, **kwargs):
    """ View for the Biodiversity Assessments page
    """

    biodiversity_assessments = BiodiversityAssessment.objects.all().order_by('created_at')
    context = {
        'biodiversity_assessments': biodiversity_assessments
    }
    biodiversity_assessments_page_template = 'rbis/biodiversity_assessments.html'

    return TemplateResponse(
        request,
        biodiversity_assessments_page_template,
        context
    )


def biodiversity_assesment_detail_view(request, pk, *args, **kwargs):
    """ View for the Biodiversity Assessment Detail page
    """
    biodiversity_assessment = BiodiversityAssessment.objects.get(pk=pk)
    context = {
        'biodiversity_assessment': biodiversity_assessment
    }
    biodiversity_assessment_detail_page_template = 'rbis/biodiversity_assessment_detail.html'

    return TemplateResponse(
        request,
        biodiversity_assessment_detail_page_template,
        context
    )