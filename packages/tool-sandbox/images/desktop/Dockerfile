# A reference image for a remote sandbox with a desktop: a virtual display an agent can see and
# drive and a person can take over, plus Chromium, tmux, and the Anvia daemon.
#
#   docker build -t my-desktop-sandbox packages/tool-sandbox/images/desktop
#   docker run --rm -e ANVIA_CONTROL_URL=wss://hub.example.com/daemon \
#     -e ANVIA_SANDBOX_TOKEN=... my-desktop-sandbox
#
# The daemon dials out to your hub, so nothing needs to be published. Nothing graphical runs until
# the desktop is first used. To build against a local package instead of the published one:
#   npm pack && docker build --build-arg ANVIA_SANDBOX_PACKAGE=/ctx/anvia-sandbox-*.tgz \
#     -f images/desktop/Dockerfile .   (with the tarball in the build context)
FROM node:22-bookworm

ARG ANVIA_SANDBOX_PACKAGE=@anvia/sandbox
ARG NODE_PTY_VERSION=^1.1.0

# Xvfb, openbox, tint2, x11vnc: the display, a light window manager, a taskbar, and the VNC server
# (loopback only). Openbox's autostart sets a wallpaper and starts the taskbar.
# xdotool and ImageMagick: the agent's input and screenshots. xrandr: resizing. tmux and node-pty
# (below): terminals that survive reconnects. The node base image already carries the compilers
# node-pty builds with on Linux.
RUN apt-get update \
  && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
    xvfb openbox tint2 x11vnc xdotool imagemagick x11-utils x11-xserver-utils \
    fonts-dejavu-core fonts-liberation fonts-noto-color-emoji \
    chromium tmux procps ca-certificates \
  && rm -rf /var/lib/apt/lists/*

# `--mount` lets ANVIA_SANDBOX_PACKAGE point at a tarball in the build context (as /ctx/...).
RUN --mount=type=bind,target=/ctx \
  npm install -g "${ANVIA_SANDBOX_PACKAGE}" "node-pty@${NODE_PTY_VERSION}" \
  && npm cache clean --force
ENV NODE_PATH=/usr/local/lib/node_modules

COPY anvia-chromium /usr/local/bin/anvia-chromium
COPY tint2/tint2rc /etc/anvia/tint2rc
COPY --chown=node:node openbox/autostart /home/node/.config/openbox/autostart
RUN chmod 0555 /usr/local/bin/anvia-chromium \
  && install -d -o node -g node /workspace

USER node
WORKDIR /workspace
ENV ANVIA_SANDBOX_WORKDIR=/workspace \
    ANVIA_SANDBOX_STATE_DIR=/home/node/.anvia-sandbox

# Required at run time: ANVIA_CONTROL_URL and ANVIA_SANDBOX_TOKEN.
CMD ["anvia-sandbox-daemon"]
