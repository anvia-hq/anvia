FROM mcr.microsoft.com/playwright:v1.61.0-noble

ARG PLAYWRIGHT_VERSION=1.61.0

RUN apt-get update \
  && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
    novnc \
    openbox \
    socat \
    websockify \
    x11vnc \
    xvfb \
  && rm -rf /var/lib/apt/lists/*

RUN install -d -o pwuser -g pwuser /opt/anvia-browser /home/pwuser/.anvia-browser \
  && cd /opt/anvia-browser \
  && npm init -y \
  && npm install --omit=dev --save-exact "playwright-core@${PLAYWRIGHT_VERSION}" \
  && npm cache clean --force

COPY configure.mjs start.mjs /opt/anvia-browser/
COPY anvia-browser-configure anvia-browser-start anvia-browser-version /usr/local/bin/

RUN chmod 0555 \
    /usr/local/bin/anvia-browser-configure \
    /usr/local/bin/anvia-browser-start \
    /usr/local/bin/anvia-browser-version \
  && chmod 0444 /opt/anvia-browser/configure.mjs /opt/anvia-browser/start.mjs

USER pwuser
WORKDIR /workspace

EXPOSE 6080 9222

CMD ["sh", "-c", "trap 'exit 0' TERM INT; while :; do sleep 3600 & wait $!; done"]
