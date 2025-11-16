from django.core.management.base import BaseCommand
from django.db import connection
from django.apps import apps


class Command(BaseCommand):
    help = 'Check for differences between models and database'

    def handle(self, *args, **options):
        models_to_check = apps.get_app_config('bims').get_models()

        for model in models_to_check:
            table_name = model._meta.db_table
            model_fields = {f.name: f for f in model._meta.fields}

            # Get database columns
            cursor = connection.cursor()
            cursor.execute(f"""
                SELECT column_name, data_type, is_nullable
                FROM information_schema.columns
                WHERE table_name = '{table_name}'
                ORDER BY ordinal_position;
            """)
            db_columns = {row[0]: row for row in cursor.fetchall()}

            # Compare
            model_field_names = set(model_fields.keys())
            db_column_names = set(db_columns.keys())

            missing_in_model = db_column_names - model_field_names
            missing_in_db = model_field_names - db_column_names

            if missing_in_model or missing_in_db:
                self.stdout.write(self.style.WARNING(f'\n{model.__name__} ({table_name}):'))

                if missing_in_model:
                    self.stdout.write(self.style.ERROR(f'  Missing in MODEL: {missing_in_model}'))

                if missing_in_db:
                    self.stdout.write(self.style.ERROR(f'  Missing in DB: {missing_in_db}'))
