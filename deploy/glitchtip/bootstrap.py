# GlitchTip's setup (ADR-0038), run by glitchtip-init through `manage.py shell`. Idempotent: the admin, the
# "Raadiso" organisation and the "Raadiso apps" project, with the project key from GLITCHTIP_PUBLIC_KEY so the
# DSN in .env is known in advance (a DSN's key is public by design: it ships inside the apps).
import os
import sys
import uuid

from apps.organizations_ext.constants import OrganizationUserRole
from apps.organizations_ext.models import Organization, OrganizationUser
from apps.projects.models import Project, ProjectKey
from apps.users.models import User

email = os.environ["GLITCHTIP_ADMIN_EMAIL"]
with open("/run/secrets/raadi/glitchtip_admin_password") as f:
    password = f.read().strip()
public_key = uuid.UUID(os.environ["GLITCHTIP_PUBLIC_KEY"])
expected_project_id = int(os.environ["GLITCHTIP_PROJECT_ID"])

user = User.objects.filter(email=email).first()
if user is None:
    user = User.objects.create_superuser(email=email, password=password)
    print(f"created the admin {email}")

# GlitchTip derives the slug from the name, so look the organisation up by name.
org = Organization.objects.filter(name="Raadiso").order_by("id").first()
if org is None:
    org = Organization.objects.create(name="Raadiso")
    print(f"created the organisation Raadiso ({org.slug})")
if not OrganizationUser.objects.filter(organization=org, user=user).exists():
    org.add_user(user, OrganizationUserRole.OWNER)

project = Project.objects.filter(organization=org, name="Raadiso apps").first()
if project is None:
    project = Project.objects.create(organization=org, name="Raadiso apps", platform="javascript")
    print(f"created the project 'Raadiso apps' (id {project.id})")
# No IP addresses, e-mail addresses or user names in stored events (GDPR, CLAUDE.md). The apps send none
# (no sendDefaultPii, no setUser); this catches what slips through, at ingest.
project.scrub_ip_addresses = True
project.scrub_config = {
    "enabled": True,
    "scrub_defaults": True,
    "scrub_emails": True,
    "sensitive_keys": ["ip_address", "email", "username"],
}
project.save(update_fields=["scrub_ip_addresses", "scrub_config"])

if project.id != expected_project_id:
    sys.exit(f"the project has id {project.id}, but GLITCHTIP_PROJECT_ID is {expected_project_id}: fix .env")
if not ProjectKey.objects.filter(public_key=public_key).exists():
    ProjectKey.objects.create(project=project, name="raadi apps", public_key=public_key)
    print("created the project key from GLITCHTIP_PUBLIC_KEY")
print(f"GlitchTip ready: project {project.id}, key {public_key.hex}")
