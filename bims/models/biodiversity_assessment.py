""" Biodiversity Assessment Models
"""
from django.db import models
from django.contrib.postgres.fields import JSONField
from ckeditor.fields import RichTextField

class BiodiversityAssessment(models.Model):
    """Model representing a biodiversity assessment."""
    title = models.CharField(max_length=255, unique=True)
    content_title = RichTextField(blank=True, null=True)
    main_doc_link = models.URLField(max_length=500, blank=True, null=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)


    def __str__(self):
        return self.title

    class Meta:
        verbose_name = "Biodiversity Assessment"
        verbose_name_plural = "Biodiversity Assessments"
        ordering = ['created_at']