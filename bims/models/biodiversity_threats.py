""" Biodiversity Threats Models
"""
from django.db import models
from django.contrib.postgres.fields import JSONField
from ckeditor.fields import RichTextField

class BiodiversityThreat(models.Model):
    """Model representing a biodiversity threat."""
    title = models.CharField(max_length=255, unique=True)
    poster = models.ImageField(
        upload_to='biodiversity_threats_posters',
        null=True,
        blank=True
    )
    attributes = JSONField(blank=True, null=True)
    description = models.TextField(blank=True, null=True)
    content = RichTextField()
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)


    def __str__(self):
        return self.title

    class Meta:
        verbose_name = "Biodiversity Threat"
        verbose_name_plural = "Biodiversity Threats"
        ordering = ['created_at']