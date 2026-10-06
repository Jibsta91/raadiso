# syntax=docker/dockerfile:1.12
# imgproxy (OSS, Apache-2.0): resizes listing images on the fly from SeaweedFS.
# The wrapper reads the URL-signing key/salt and S3 secret from the secrets mount.
FROM darthsim/imgproxy:v4.0.17@sha256:db0b4b9cd690c8b3590203dea300fb759a18c4ec2af7b37424f0bdef23ce317d
COPY --chmod=0755 entrypoint.sh /opt/raadi/entrypoint.sh
USER 999
ENTRYPOINT ["/opt/raadi/entrypoint.sh"]
CMD ["imgproxy"]
