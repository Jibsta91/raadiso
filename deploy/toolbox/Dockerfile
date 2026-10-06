# syntax=docker/dockerfile:1.12
# Raadi toolbox: every dev/ops CLI at a pinned version, so the host needs only
# Docker. Usage:  docker compose run --rm toolbox <command>   (or ./raadi / make)
# Base: the official Playwright image (Node + browsers for E2E tests).
FROM docker:29.8.2-cli@sha256:b1805116a6a86cc591b5d5f60a910a0715cdcc9d18d866ad68b1457ead25c35c AS dockercli
FROM ghcr.io/astral-sh/uv:0.12.22@sha256:f513a91fc62fe7c17567eee97230dd198e43edb8a9fbecca843714a4358fe1bc AS uv

FROM mcr.microsoft.com/playwright:v1.63.0-noble@sha256:eff16c30e6f3f4af0a03fa4b706120d5e9b0891c344a27d64559aff5900a4a27
ARG TARGETARCH
ARG PNPM_VERSION=10.34.6
ARG TURBO_VERSION=2.11.6
ARG PYTHON_VERSION=3.13
ARG TOFU_VERSION=1.13.1
ARG TFLINT_VERSION=0.64.0
ARG TRIVY_VERSION=0.75.0
ARG GITLEAKS_VERSION=8.30.1
ARG OSV_SCANNER_VERSION=2.6.0
ARG SYFT_VERSION=1.54.0
ARG OPA_VERSION=1.21.1
ARG CHECKOV_VERSION=3.3.22
ARG ANSIBLE_CORE_VERSION=2.21.4

SHELL ["/bin/bash", "-euo", "pipefail", "-c"]
ENV DEBIAN_FRONTEND=noninteractive \
    UV_TOOL_BIN_DIR=/usr/local/bin \
    UV_TOOL_DIR=/opt/uv-tools \
    UV_PYTHON_INSTALL_DIR=/opt/uv-python \
    PNPM_HOME=/pnpm \
    npm_config_store_dir=/pnpm/store \
    TURBO_TELEMETRY_DISABLED=1 \
    NEXT_TELEMETRY_DISABLED=1 \
    CHECKOV_RUN_SCA_PACKAGE_SCAN_V2=false

RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      git make jq curl ca-certificates unzip shellcheck openssh-client rsync gettext-base postgresql-client \
 && rm -rf /var/lib/apt/lists/*

COPY --from=dockercli /usr/local/bin/docker /usr/local/bin/docker
COPY --from=dockercli /usr/local/libexec/docker/cli-plugins/ /usr/local/libexec/docker/cli-plugins/
COPY --from=uv /uv /uvx /usr/local/bin/

RUN npm install -g "pnpm@${PNPM_VERSION}" "turbo@${TURBO_VERSION}" >/dev/null 2>&1

# Python tooling (isolated tool environments, pinned).
RUN uv python install "${PYTHON_VERSION}" \
 && uv tool install --python "${PYTHON_VERSION}" "checkov==${CHECKOV_VERSION}" \
 && uv tool install --python "${PYTHON_VERSION}" "ansible-core==${ANSIBLE_CORE_VERSION}" --with ansible-lint

# Static binaries, verified against the publishers' checksum files.
WORKDIR /tmp/dl
RUN arch="${TARGETARCH:-amd64}"; \
    fetch() { curl -fsSLo "$2" "$1"; }; \
    verify() { grep -E "[[:space:]]\*?$1\$" "$2" | sha256sum -c -; }; \
    # OpenTofu
    f="tofu_${TOFU_VERSION}_linux_${arch}.zip"; base="https://github.com/opentofu/opentofu/releases/download/v${TOFU_VERSION}"; \
    fetch "$base/$f" "$f"; fetch "$base/tofu_${TOFU_VERSION}_SHA256SUMS" sums; verify "$f" sums; \
    unzip -q "$f" tofu -d /usr/local/bin; rm -f ./*; \
    # TFLint
    f="tflint_linux_${arch}.zip"; base="https://github.com/terraform-linters/tflint/releases/download/v${TFLINT_VERSION}"; \
    fetch "$base/$f" "$f"; fetch "$base/checksums.txt" sums; verify "$f" sums; \
    unzip -q "$f" tflint -d /usr/local/bin; rm -f ./*; \
    # Trivy
    t=$([ "$arch" = arm64 ] && echo ARM64 || echo 64bit); f="trivy_${TRIVY_VERSION}_Linux-${t}.tar.gz"; \
    base="https://github.com/aquasecurity/trivy/releases/download/v${TRIVY_VERSION}"; \
    fetch "$base/$f" "$f"; fetch "$base/trivy_${TRIVY_VERSION}_checksums.txt" sums; verify "$f" sums; \
    tar -xzf "$f" -C /usr/local/bin trivy; rm -f ./*; \
    # Gitleaks
    g=$([ "$arch" = arm64 ] && echo arm64 || echo x64); f="gitleaks_${GITLEAKS_VERSION}_linux_${g}.tar.gz"; \
    base="https://github.com/gitleaks/gitleaks/releases/download/v${GITLEAKS_VERSION}"; \
    fetch "$base/$f" "$f"; fetch "$base/gitleaks_${GITLEAKS_VERSION}_checksums.txt" sums; verify "$f" sums; \
    tar -xzf "$f" -C /usr/local/bin gitleaks; rm -f ./*; \
    # OSV-Scanner
    f="osv-scanner_linux_${arch}"; base="https://github.com/google/osv-scanner/releases/download/v${OSV_SCANNER_VERSION}"; \
    fetch "$base/$f" "$f"; fetch "$base/osv-scanner_SHA256SUMS" sums; verify "$f" sums; \
    install -m 0755 "$f" /usr/local/bin/osv-scanner; rm -f ./*; \
    # Syft (SBOMs)
    f="syft_${SYFT_VERSION}_linux_${arch}.tar.gz"; base="https://github.com/anchore/syft/releases/download/v${SYFT_VERSION}"; \
    fetch "$base/$f" "$f"; fetch "$base/syft_${SYFT_VERSION}_checksums.txt" sums; verify "$f" sums; \
    tar -xzf "$f" -C /usr/local/bin syft; rm -f ./*; \
    # Open Policy Agent (policy unit tests and formatting)
    f="opa_linux_${arch}_static"; base="https://github.com/open-policy-agent/opa/releases/download/v${OPA_VERSION}"; \
    fetch "$base/$f" "$f"; fetch "$base/$f.sha256" sums; verify "$f" sums; \
    install -m 0755 "$f" /usr/local/bin/opa; rm -f ./*

COPY --chmod=0755 deploy/toolbox/raadi-tool.sh /usr/local/bin/raadi-tool
RUN git config --system --add safe.directory /workspace && mkdir -p /pnpm/store

WORKDIR /workspace
ENTRYPOINT ["/usr/local/bin/raadi-tool"]
CMD ["help"]
