from django import template
from django.conf import settings
from django.utils.safestring import mark_safe
from django.contrib.staticfiles.storage import staticfiles_storage
from bims.conf import settings as grunt_settings

register = template.Library()


def _optimized_url(module):
    """
    Return the static URL of the bundled build of a module, or None if the
    bundle hasn't been built (e.g. image built without the JS build step).
    """
    optimized = grunt_settings.GRUNT_MODULES[module]["optimized"]
    try:
        if not staticfiles_storage.exists(optimized):
            return None
        return staticfiles_storage.url(optimized)
    except ValueError:
        # Missing from the staticfiles manifest
        return None


@register.simple_tag
def grunt_module(module):
    """
    Render A Javascript based on grunt
    :param module:Script filename of js
    :return: Template to render
    """
    if not settings.DEBUG:
        optimized_url = _optimized_url(module)
        if optimized_url:
            # defer keeps the old RequireJS timing: run after the page parses
            return mark_safe(
                """<script defer src="{optimized}"></script>""".format(
                    optimized=optimized_url
                )
            )

    return mark_safe(
        """<script data-main={main} src={requirejs}></script>""".format(
            main=staticfiles_storage.url(
                    grunt_settings.GRUNT_MODULES[module]["main"]),
            requirejs=grunt_settings.REQUIRED_JS_PATH
        )
    )
