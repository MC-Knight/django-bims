"""
Views for eDNA sequences module
"""
from django.shortcuts import render, redirect, get_object_or_404
from django.contrib.auth.decorators import login_required
from django.contrib import messages
from django.core.mail import send_mail
from django.conf import settings
from django.template.loader import render_to_string
from django.utils import timezone
from django.db.models import Q

from bims.models.molecular_genetics import (
    MolecularGeneticGroup,
    MolecularGeneticData,
    MolecularGeneticDownloadRequest
)


def molecular_genetics_home(request):
    """Main page showing all eDNA sequences groups"""
    groups = MolecularGeneticGroup.objects.all().order_by('-created_at')
    context = {
        'groups': groups,
        'is_superuser': request.user.is_authenticated and request.user.is_superuser
    }
    return render(request, 'rbis/molecular_genetics.html', context)


def molecular_genetics_group_detail(request, group_id):
    """Detail page showing all data for a specific group"""
    group = get_object_or_404(MolecularGeneticGroup, id=group_id)
    genetic_data = MolecularGeneticData.objects.filter(group=group).order_by('-created_at')

    # Get download requests for current user
    user_requests = {}
    if request.user.is_authenticated:
        requests_qs = MolecularGeneticDownloadRequest.objects.filter(
            user=request.user,
            data__group=group
        )
        user_requests = {req.data.id: req for req in requests_qs}

    context = {
        'group': group,
        'genetic_data': genetic_data,
        'user_requests': user_requests,
        'is_superuser': request.user.is_authenticated and request.user.is_superuser
    }
    return render(request, 'rbis/molecular_genetics_group_detail.html', context)


@login_required
def add_molecular_genetics_group(request):
    """Add a new eDNA sequences group (superuser only)"""
    if not request.user.is_superuser:
        messages.error(request, 'You do not have permission to add groups.')
        return redirect('molecular-genetics-home')

    if request.method == 'POST':
        name = request.POST.get('name', '').strip()

        if not name:
            messages.error(request, 'Group name is required.')
            return render(request, 'rbis/add_molecular_genetics_group.html')

        if MolecularGeneticGroup.objects.filter(name=name).exists():
            messages.error(request, f'A group with the name "{name}" already exists.')
            return render(request, 'rbis/add_molecular_genetics_group.html')

        group = MolecularGeneticGroup.objects.create(name=name, created_by=request.user)
        messages.success(request, f'Group "{name}" created successfully!')
        return redirect('molecular-genetics-home')

    return render(request, 'rbis/add_molecular_genetics_group.html')


@login_required
def add_molecular_genetics_data(request, group_id):
    """Add new data to a eDNA sequences group (superuser only)"""
    if not request.user.is_superuser:
        messages.error(request, 'You do not have permission to add data.')
        return redirect('molecular-genetics-group-detail', group_id=group_id)

    group = get_object_or_404(MolecularGeneticGroup, id=group_id)

    if request.method == 'POST':
        title = request.POST.get('title', '').strip()
        data_file = request.FILES.get('data_file')

        if not title:
            messages.error(request, 'Title is required.')
            context = {'group': group}
            return render(request, 'rbis/add_molecular_genetics_data.html', context)

        if not data_file:
            messages.error(request, 'Please select a file to upload.')
            context = {'group': group}
            return render(request, 'rbis/add_molecular_genetics_data.html', context)

        genetic_data = MolecularGeneticData.objects.create(
            title=title,
            group=group,
            file=data_file,
            uploaded_by=request.user
        )

        messages.success(request, f'Data "{title}" added successfully!')
        return redirect('molecular-genetics-group-detail', group_id=group_id)

    context = {'group': group}
    return render(request, 'rbis/add_molecular_genetics_data.html', context)


@login_required
def request_molecular_genetics_download(request, data_id):
    """Request download access for eDNA sequences data"""
    genetic_data = get_object_or_404(MolecularGeneticData, id=data_id)

    # Check if user already has a request
    existing_request = MolecularGeneticDownloadRequest.objects.filter(
        data=genetic_data,
        user=request.user
    ).first()

    if existing_request:
        messages.info(request, 'You have already requested access to this data.')
        return redirect('molecular-genetics-group-detail', group_id=genetic_data.group.id)

    if request.method == 'POST':
        reason = request.POST.get('reason', '').strip()

        if not reason:
            messages.error(request, 'Please provide a reason for your download request.')
            context = {'genetic_data': genetic_data}
            return render(request, 'rbis/request_molecular_genetics_download.html', context)

        download_request = MolecularGeneticDownloadRequest.objects.create(
            data=genetic_data,
            user=request.user,
            reason=reason,
            status='pending'
        )

        # Send email to superusers
        send_download_request_email(download_request)

        messages.success(request, 'Your download request has been submitted and is pending approval.')
        return redirect('molecular-genetics-group-detail', group_id=genetic_data.group.id)

    context = {'genetic_data': genetic_data}
    return render(request, 'rbis/request_molecular_genetics_download.html', context)


@login_required
def molecular_genetics_download_requests(request):
    """View and manage download requests"""
    if request.user.is_superuser:
        # Superusers see all requests with filtering
        status_filter = request.GET.get('status', 'all')

        requests_qs = MolecularGeneticDownloadRequest.objects.all().select_related(
            'data', 'user', 'approved_by'
        ).order_by('-created_at')

        if status_filter != 'all':
            requests_qs = requests_qs.filter(status=status_filter)

        context = {
            'download_requests': requests_qs,
            'is_superuser': True,
            'status_filter': status_filter
        }
    else:
        # Regular users see only their requests
        requests_qs = MolecularGeneticDownloadRequest.objects.filter(
            user=request.user
        ).select_related('data', 'approved_by').order_by('-created_at')

        context = {
            'download_requests': requests_qs,
            'is_superuser': False
        }

    return render(request, 'rbis/molecular_genetics_download_requests.html', context)


@login_required
def approve_molecular_genetics_download(request, request_id):
    """Approve a download request (superuser only)"""
    if not request.user.is_superuser:
        messages.error(request, 'You do not have permission to approve requests.')
        return redirect('molecular-genetics-download-requests')

    download_request = get_object_or_404(MolecularGeneticDownloadRequest, id=request_id)

    if download_request.status == 'approved':
        messages.info(request, 'This request has already been approved.')
        return redirect('molecular-genetics-download-requests')

    download_request.status = 'approved'
    download_request.approved = True
    download_request.approved_by = request.user
    download_request.approved_at = timezone.now()
    download_request.save()

    # Send approval email to requester
    send_approval_email(download_request)

    messages.success(request, f'Download request approved for {download_request.user.username}.')
    return redirect('molecular-genetics-download-requests')


@login_required
def reject_molecular_genetics_download(request, request_id):
    """Reject a download request (superuser only)"""
    if not request.user.is_superuser:
        messages.error(request, 'You do not have permission to reject requests.')
        return redirect('molecular-genetics-download-requests')

    download_request = get_object_or_404(MolecularGeneticDownloadRequest, id=request_id)

    download_request.status = 'rejected'
    download_request.approved = False
    download_request.approved_by = request.user
    download_request.approved_at = timezone.now()
    download_request.save()

    messages.success(request, f'Download request rejected for {download_request.user.username}.')
    return redirect('molecular-genetics-download-requests')


def send_download_request_email(download_request):
    """Send email notification to superusers about new download request"""
    from django.contrib.auth import get_user_model
    User = get_user_model()

    superusers = User.objects.filter(is_superuser=True, is_active=True)
    recipient_emails = [user.email for user in superusers if user.email]

    if not recipient_emails:
        return

    subject = f'New eDNA sequences Download Request from {download_request.get_formatted_requester_name()}'

    context = {
        'user_name': download_request.user.get_full_name(),
        'user_email': download_request.user.email,
        'data_title': download_request.data.title,
        'group_name': download_request.data.group.name,
        'requested_at': download_request.created_at,
        'reason': download_request.reason,
        "created_at": download_request.created_at,
        'review_url': f"{settings.SITE_DOMAIN_NAME if hasattr(settings, 'SITE_DOMAIN_NAME') else 'http://localhost:8000'}/molecular-genetics/download-requests/?status=pending",
    }


    html_message = render_to_string('emails/molecular_genetics_download_request.html', context)
    plain_message = render_to_string('emails/molecular_genetics_download_request.txt', context)

    try:
        send_mail(
            subject,
            plain_message,
            settings.DEFAULT_FROM_EMAIL,
            recipient_emails,
            html_message=html_message,
            fail_silently=False,
        )
    except Exception as e:
        print(f"Failed to send email: {e}")


def send_approval_email(download_request):
    """Send email notification to requester about approval"""
    if not download_request.user.email:
        return

    requester = download_request.user
    approver = download_request.approved_by
    data = download_request.data
    site_url = settings.SITE_DOMAIN_NAME if hasattr(settings, 'SITE_DOMAIN_NAME') else 'http://localhost:8000'


    context = {
        'requester_name': requester.get_full_name(),
        'data_title': data.title,
        'group_name': data.group.name,
        'approved_at': download_request.approved_at,
        'approver_name': approver.get_formatted_approver_name(),
        'download_url': f"{site_url}/{data.file.url}",
    }

    subject = f'Your eDNA sequences Download Request Has Been Approved'

    html_message = render_to_string('emails/molecular_genetics_download_approved.html', context)
    plain_message = render_to_string('emails/molecular_genetics_download_approved.txt', context)

    try:
        send_mail(
            subject,
            plain_message,
            settings.DEFAULT_FROM_EMAIL,
            [requester.email],
            html_message=html_message,
            fail_silently=False,
        )
    except Exception as e:
        print(f"Failed to send email: {e}")

