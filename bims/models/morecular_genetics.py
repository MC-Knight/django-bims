"""
eDNA sequences models.
"""
from django.db import models
from django.conf import settings
from django.contrib.postgres.fields import JSONField


class MolecularGeneticsGroup(models.Model):
    """Model representing a eDNA sequences group."""
    name = models.CharField(max_length=255, unique=True)
    attributes = JSONField(blank=True, null=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    def __str__(self):
        return self.name

    class Meta:
        verbose_name = "eDNA sequences Group"
        verbose_name_plural = "eDNA sequences Groups"
        ordering = ['-created_at']


class MolecularGeneticsData(models.Model):
    """Model representing eDNA sequences data."""
    title = models.CharField(max_length=255)
    group = models.ForeignKey(
        MolecularGeneticsGroup,
        on_delete=models.CASCADE,
        related_name='genetic_data'
    )
    data_file = models.FileField(upload_to='molecular_genetics/')
    uploaded_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name='uploaded_genetic_data',
        blank=True,
        null=True,
    )
    attributes = JSONField(blank=True, null=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    def __str__(self):
        return self.title

    class Meta:
        verbose_name = "eDNA sequences Data"
        verbose_name_plural = "eDNA sequences Data"
        ordering = ['-created_at']


class MolecularGeneticsDownloadRequest(models.Model):
    """Model representing a request to download eDNA sequences data."""
    STATUS_CHOICES = (
        ('pending', 'Pending'),
        ('approved', 'Approved'),
        ('rejected', 'Rejected'),
    )

    genetic_data = models.ForeignKey(
        MolecularGeneticsData,
        on_delete=models.CASCADE,
        related_name='download_requests'
    )
    reason = models.TextField()
    requester = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        models.CASCADE,
        related_name='requested_genetics_downloads',
        blank=True,
        null=True,
    )
    requested_at = models.DateTimeField(auto_now_add=True)
    status = models.CharField(
        max_length=20,
        choices=STATUS_CHOICES,
        default='pending'
    )
    approved = models.BooleanField(default=False)
    approved_at = models.DateTimeField(blank=True, null=True)
    approved_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        models.CASCADE,
        related_name='approved_genetics_downloads',
        blank=True,
        null=True,
    )


    def get_formatted_requester_name(self):
        if self.requester:
            if self.requester.first_name and self.requester.last_name:
                return f"{self.requester.first_name} {self.requester.last_name}"
        return self.requester.username


    def get_formatted_approver_name(self):
        if self.approved_by:
            if self.approved_by.first_name and self.approved_by.last_name:
                return f"{self.approved_by.first_name} {self.approved_by.last_name}"
        return self.approved_by.username

    def __str__(self):
        return f"Download request by {self.requester.first_name} {self.requester.last_name} on {self.requested_at}"

    class Meta:
        verbose_name = "eDNA sequences Download Request"
        verbose_name_plural = "eDNA sequences Download Requests"
        ordering = ['-requested_at']
        unique_together = ['genetic_data', 'requester']
