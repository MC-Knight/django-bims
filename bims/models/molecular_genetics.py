"""Molecular Genetics Models"""
from django.db import models
from django.contrib.auth import get_user_model

User = get_user_model()


class MolecularGeneticGroup(models.Model):
    """Model representing a molecular genetic group (e.g., Mammal, Amphibian)."""
    name = models.CharField(max_length=255, unique=True)
    created_by = models.ForeignKey(
        User,
        on_delete=models.CASCADE,
        related_name='created_genetic_groups'
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    def __str__(self):
        return self.name

    class Meta:
        verbose_name = "Molecular Genetic Group"
        verbose_name_plural = "Molecular Genetic Groups"
        ordering = ['-created_at']


class MolecularGeneticData(models.Model):
    """Model representing molecular genetic data files."""
    group = models.ForeignKey(
        MolecularGeneticGroup,
        on_delete=models.CASCADE,
        related_name='genetic_data'
    )
    title = models.CharField(max_length=255)
    file = models.FileField(upload_to='molecular_genetics/%Y/%m/%d/')
    uploaded_by = models.ForeignKey(
        User,
        on_delete=models.CASCADE,
        related_name='uploaded_genetic_data'
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    def __str__(self):
        return f"{self.title} - {self.group.name}"

    class Meta:
        verbose_name = "Molecular Genetic Data"
        verbose_name_plural = "Molecular Genetic Data"
        ordering = ['-created_at']


class MolecularGeneticDownloadRequest(models.Model):
    """Model representing download requests for molecular genetic data."""
    STATUS_CHOICES = (
        ('pending', 'Pending'),
        ('approved', 'Approved'),
        ('rejected', 'Rejected'),
    )

    data = models.ForeignKey(
        MolecularGeneticData,
        on_delete=models.CASCADE,
        related_name='download_requests'
    )
    user = models.ForeignKey(
        User,
        on_delete=models.CASCADE,
        related_name='genetic_download_requests'
    )
    reason = models.TextField(help_text='Reason for requesting download')
    status = models.CharField(
        max_length=20,
        choices=STATUS_CHOICES,
        default='pending'
    )
    approved_by = models.ForeignKey(
        User,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='approved_genetic_requests'
    )
    approved_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    def __str__(self):
        return f"{self.user.username} - {self.data.title} ({self.status})"

    def get_formatted_requester_name(self):
        """Return the requester's name in 'Last, First' format."""
        if self.user.first_name and self.user.last_name:
            return f"{self.user.last_name}, {self.user.first_name}"
        return self.user.username

    def get_formatted_approver_name(self):
        """Return the requester's name in 'Last, First' format."""
        if self.approved_by.first_name and self.approved_by.last_name:
            return f"{self.approved_by.last_name}, {self.approved_by.first_name}"
        return self.approved_by.username

    def genetic_data_id(self):
        return self.data.id

    class Meta:
        verbose_name = "Molecular Download Request"
        verbose_name_plural = "Molecular Download Requests"
        ordering = ['-created_at']
        unique_together = ['data', 'user']
