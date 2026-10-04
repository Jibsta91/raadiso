# Thin wrapper: every target delegates to ./raadi (one implementation).
# Run `make help` for the list of commands.
.DEFAULT_GOAL := help
COMMANDS := help up down dev logs ps summary restart migrate clean smoke e2e lint format typecheck \
            test test-integration build generate security iac-scan licenses sbom toolbox ca-cert otp

.PHONY: $(COMMANDS) secret
$(COMMANDS):
	@./raadi $@ $(ARGS)

# make secret NAME=keycloak_admin_password
secret:
	@./raadi secret $(NAME)
