# coding=utf-8
from django.db import models
from django.conf import settings


class DatasetAuthorship(models.Model):
    dataset = models.ForeignKey(
        'Dataset',
        on_delete=models.CASCADE
    )
    profile = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE
    )
    ordering = models.IntegerField(default=0)

    class Meta:
        ordering = ['ordering']
        unique_together = ('dataset', 'profile')

    def __str__(self):
        return '{} - {}'.format(self.dataset.title, self.profile)


class Dataset(models.Model):
    PUBLISHED = 'published'
    UNPUBLISHED = 'unpublished'

    TYPE_CHOICES = [
        (PUBLISHED, 'Published'),
        (UNPUBLISHED, 'Unpublished'),
    ]

    type = models.CharField(
        max_length=20,
        choices=TYPE_CHOICES,
        default=UNPUBLISHED
    )
    title = models.CharField(max_length=512)
    source = models.CharField(
        max_length=512,
        null=True,
        blank=True
    )
    file = models.FileField(
        upload_to='datasets/',
        null=True,
        blank=True
    )
    year = models.IntegerField(null=True, blank=True)
    notes = models.TextField(null=True, blank=True)
    authors = models.ManyToManyField(
        to=settings.AUTH_USER_MODEL,
        blank=True,
        through='DatasetAuthorship'
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['-created_at']

    def __str__(self):
        return self.title

    @property
    def type_display(self):
        return dict(self.TYPE_CHOICES).get(self.type, self.type)

    @property
    def authors_string(self):
        author_list = []
        for author in self.authors.all().order_by('datasetauthorship__ordering'):
            name = '{} {}'.format(author.first_name, author.last_name).strip()
            if name:
                author_list.append(name)
        return ', '.join(author_list)
