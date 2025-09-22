
"""Configuration for production server"""
# noinspection PyUnresolvedReferences
from .prod import *  # noqa
import ast
import os
import ast

DEBUG = False

ALLOWED_HOSTS = ['*']

ADMINS = (
    ('Byishimo Teto Joseph', 'tetobobo1@gmail.com'),
)

DATABASES = {
    'default': {
        'ENGINE': 'django.contrib.gis.db.backends.postgis',
        'NAME': os.environ.get('DATABASE_NAME'),
        'USER': os.environ.get('DATABASE_USERNAME'),
        'PASSWORD': os.environ.get('DATABASE_PASSWORD'),
        'HOST': os.environ.get('DATABASE_HOST'),
        'PORT': 5432,
        'TEST_NAME': 'unittests',
    }
}

if os.getenv('DEFAULT_BACKEND_DATASTORE'):
    DATABASES[os.getenv('DEFAULT_BACKEND_DATASTORE')] = {
        'ENGINE': 'django.contrib.gis.db.backends.postgis',
        'NAME': os.environ.get('GEONODE_GEODATABASE'),
        'USER': os.environ.get('GEONODE_GEODATABASE_USERNAME'),
        'PASSWORD': os.environ.get('GEONODE_GEODATABASE_PASSWORD'),
        'HOST': os.environ.get('GEONODE_GEODATABASE_HOST'),
        'PORT': 5432
    }