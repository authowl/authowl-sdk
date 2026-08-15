ARG NODE_BASE_IMAGE=scratch
ARG PLAYWRIGHT_BASE_IMAGE=scratch
FROM ${NODE_BASE_IMAGE} AS node-runtime
FROM ${PLAYWRIGHT_BASE_IMAGE}

ARG NODE_VERSION
ARG PNPM_VERSION
ARG PNPM_INTEGRITY

COPY --from=node-runtime /usr/local/ /usr/local/

RUN npm pack "pnpm@${PNPM_VERSION}" --silent --ignore-scripts --pack-destination /tmp \
  && actual_integrity="sha512-$(openssl dgst -sha512 -binary "/tmp/pnpm-${PNPM_VERSION}.tgz" | openssl base64 -A)" \
  && test "${actual_integrity}" = "${PNPM_INTEGRITY}" \
  && npm install --global --ignore-scripts "/tmp/pnpm-${PNPM_VERSION}.tgz" \
  && rm "/tmp/pnpm-${PNPM_VERSION}.tgz" \
  && npm cache clean --force \
  && test "$(node --version)" = "${NODE_VERSION}" \
  && test "$(pnpm --version)" = "${PNPM_VERSION}"

ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
