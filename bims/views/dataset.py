# coding=utf-8
import os
from django.contrib import messages
from django.contrib.auth import get_user_model
from django.contrib.auth.mixins import LoginRequiredMixin, UserPassesTestMixin
from django.db.models import Q
from django.http import HttpResponseRedirect
from django.urls import reverse
from django.views.generic import ListView, View, CreateView, UpdateView

from bims.models.dataset import Dataset, DatasetAuthorship
from bims.utils.user import get_user_from_name


class DataSetListView(LoginRequiredMixin, ListView):
    model = Dataset
    template_name = 'rbis/data_sets.html'
    paginate_by = 15
    search_query = ''
    type_filter = ''
    collectors = None

    def get(self, request, *args, **kwargs):
        self.search_query = request.GET.get('q', '')
        self.type_filter = request.GET.get('type', '')
        self.collectors = request.GET.get('collectors', None)
        return super().get(request, *args, **kwargs)

    def get_queryset(self):
        qs = Dataset.objects.all()

        if self.search_query:
            qs = qs.filter(
                Q(title__icontains=self.search_query) |
                Q(source__icontains=self.search_query) |
                Q(notes__icontains=self.search_query)
            )

        if self.type_filter:
            types = [t.strip() for t in self.type_filter.split(',') if t.strip()]
            if types:
                qs = qs.filter(type__in=types)

        if self.collectors:
            collector_ids = [c.strip() for c in self.collectors.split(',') if c.strip()]
            if collector_ids:
                qs = qs.filter(authors__id__in=collector_ids)

        return qs.distinct()

    def get_context_data(self, **kwargs):
        context = super().get_context_data(**kwargs)
        all_qs = Dataset.objects.all()

        if self.search_query:
            all_qs = all_qs.filter(
                Q(title__icontains=self.search_query) |
                Q(source__icontains=self.search_query) |
                Q(notes__icontains=self.search_query)
            )

        context['search'] = self.search_query
        context['type_filters'] = [
            {
                'title': 'Published',
                'key': 'published',
                'count': all_qs.filter(type=Dataset.PUBLISHED).count(),
                'selected': 'published' in self.type_filter,
            },
            {
                'title': 'Unpublished',
                'key': 'unpublished',
                'count': all_qs.filter(type=Dataset.UNPUBLISHED).count(),
                'selected': 'unpublished' in self.type_filter,
            },
        ]

        # Selected authors for display
        selected_authors = []
        if self.collectors:
            collector_ids = [c.strip() for c in self.collectors.split(',') if c.strip()]
            selected_authors = get_user_model().objects.filter(id__in=collector_ids)
        context['selected_authors'] = selected_authors
        return context


class AddDataSetView(UserPassesTestMixin, CreateView):
    model = Dataset
    template_name = 'rbis/add_data_set.html'
    fields = '__all__'
    object = None

    def test_func(self):
        if self.request.user.is_anonymous:
            return False
        if self.request.user.is_superuser:
            return True
        return self.request.user.has_perm('bims.add_dataset')

    def get_success_url(self):
        return reverse('dataset-list')

    def get_context_data(self, **kwargs):
        context = super().get_context_data(**kwargs)
        context['past_url'] = self.request.GET.get('next')
        context['is_edit'] = False
        context['existing_authors'] = []
        return context

    def _save_authors(self, dataset, post_data):
        author_ids_raw = post_data.get('author_ids', '')
        order = 1
        # Existing users selected via autocomplete
        if author_ids_raw and author_ids_raw.strip():
            for author_id in author_ids_raw.split(','):
                author_id = author_id.strip()
                if not author_id:
                    continue
                try:
                    user = get_user_model().objects.get(id=author_id)
                    authorship, _ = DatasetAuthorship.objects.get_or_create(
                        dataset=dataset,
                        profile=user
                    )
                    authorship.ordering = order
                    authorship.save()
                    order += 1
                except get_user_model().DoesNotExist:
                    continue

        # New authors typed inline (new_author_0, new_author_1, ...)
        for key, value in post_data.items():
            if key.startswith('new_author_') and value.strip():
                parts = value.strip().split(' ', 1)
                first_name = parts[0]
                last_name = parts[1] if len(parts) > 1 else ''
                user = get_user_from_name(first_name=first_name, last_name=last_name)
                if user:
                    authorship, _ = DatasetAuthorship.objects.get_or_create(
                        dataset=dataset,
                        profile=user
                    )
                    authorship.ordering = order
                    authorship.save()
                    order += 1

    def _validate_file(self, file_obj):
        if not file_obj:
            return True
        allowed = {'.xlsx', '.xls', '.csv'}
        ext = os.path.splitext(file_obj.name)[1].lower()
        return ext in allowed

    def form_valid(self, form):
        post_data = self.request.POST.dict()
        file_obj = self.request.FILES.get('file')

        if not self._validate_file(file_obj):
            messages.error(
                self.request,
                'Only Excel (.xlsx, .xls) or CSV (.csv) files are accepted.',
                extra_tags='dataset'
            )
            return self.form_invalid(form)

        dataset = Dataset.objects.create(
            type=post_data.get('type', Dataset.UNPUBLISHED),
            title=post_data.get('title', '').strip(),
            source=post_data.get('source', '').strip() or None,
            year=post_data.get('year') or None,
            notes=post_data.get('notes', '').strip() or None,
            file=file_obj,
        )
        self._save_authors(dataset, post_data)
        self.object = dataset
        return HttpResponseRedirect(self.get_success_url())

    def form_invalid(self, form):
        return self.render_to_response(self.get_context_data(form=form))


class EditDataSetView(UserPassesTestMixin, UpdateView):
    model = Dataset
    template_name = 'rbis/add_data_set.html'
    fields = ['type', 'title', 'source', 'file', 'year', 'notes']

    def test_func(self):
        if self.request.user.is_anonymous:
            return False
        if self.request.user.is_superuser:
            return True
        return self.request.user.has_perm('bims.change_dataset')

    def get_success_url(self):
        next_url = self.request.GET.get('next')
        if next_url:
            return next_url
        return reverse('dataset-list')

    def get_context_data(self, **kwargs):
        context = super().get_context_data(**kwargs)
        context['past_url'] = self.request.GET.get('next')
        context['is_edit'] = True
        context['dataset'] = self.object
        context['existing_authors'] = [
            {'id': a.profile.id, 'name': '{} {}'.format(a.profile.first_name, a.profile.last_name).strip()}
            for a in self.object.datasetauthorship_set.select_related('profile').order_by('ordering')
        ]
        return context

    def _validate_file(self, file_obj):
        if not file_obj:
            return True
        allowed = {'.xlsx', '.xls', '.csv'}
        ext = os.path.splitext(file_obj.name)[1].lower()
        return ext in allowed

    def form_valid(self, form):
        post_data = self.request.POST.dict()
        file_obj = self.request.FILES.get('file')

        if not self._validate_file(file_obj):
            messages.error(
                self.request,
                'Only Excel (.xlsx, .xls) or CSV (.csv) files are accepted.',
                extra_tags='dataset'
            )
            return self.form_invalid(form)

        dataset = form.save(commit=False)

        if file_obj:
            # Delete old file from storage if it exists
            old_file = Dataset.objects.get(pk=dataset.pk).file
            if old_file:
                if os.path.isfile(old_file.path):
                    os.remove(old_file.path)
            dataset.file = file_obj
        else:
            # Keep existing file — restore from DB to avoid clearing it
            dataset.file = Dataset.objects.get(pk=dataset.pk).file

        dataset.save()

        # Replace all authors
        DatasetAuthorship.objects.filter(dataset=dataset).delete()
        order = 1
        author_ids_raw = post_data.get('author_ids', '')
        if author_ids_raw and author_ids_raw.strip():
            for author_id in author_ids_raw.split(','):
                author_id = author_id.strip()
                if not author_id:
                    continue
                try:
                    user = get_user_model().objects.get(id=author_id)
                    authorship = DatasetAuthorship.objects.create(
                        dataset=dataset, profile=user, ordering=order
                    )
                    order += 1
                except get_user_model().DoesNotExist:
                    continue

        for key, value in post_data.items():
            if key.startswith('new_author_') and value.strip():
                parts = value.strip().split(' ', 1)
                first_name = parts[0]
                last_name = parts[1] if len(parts) > 1 else ''
                user = get_user_from_name(first_name=first_name, last_name=last_name)
                if user:
                    DatasetAuthorship.objects.create(
                        dataset=dataset, profile=user, ordering=order
                    )
                    order += 1

        return HttpResponseRedirect(self.get_success_url())


class DeleteDataSetView(UserPassesTestMixin, View):

    def test_func(self):
        if self.request.user.is_anonymous:
            return False
        if self.request.user.is_superuser:
            return True
        return self.request.user.has_perm('bims.delete_dataset')

    def post(self, request, *args, **kwargs):
        dataset_id = request.POST.get('dataset_id')
        next_path = request.POST.get('next', reverse('dataset-list'))
        try:
            dataset = Dataset.objects.get(id=dataset_id)
        except Dataset.DoesNotExist:
            return HttpResponseRedirect(next_path)
        dataset_title = dataset.title
        dataset.delete()
        messages.success(
            request,
            'Dataset "{}" successfully deleted.'.format(dataset_title)
        )
        return HttpResponseRedirect(next_path)
